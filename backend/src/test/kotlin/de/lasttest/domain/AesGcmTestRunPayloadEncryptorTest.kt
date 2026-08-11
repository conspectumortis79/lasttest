package de.lasttest.domain

import java.util.Base64
import javax.crypto.spec.SecretKeySpec
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class AesGcmTestRunPayloadEncryptorTest {
    private fun encryptor(keyBytes: ByteArray = randomKey()): AesGcmTestRunPayloadEncryptor = AesGcmTestRunPayloadEncryptor(SecretKeySpec(keyBytes, "AES"))

    @Test
    fun `round trip returns the original plaintext for a non-empty input`() {
        val sut = encryptor()
        val plain = """{"apiTitle":"Pet API","baseUrl":"https://example.test","secret":"hunter2"}"""

        val encrypted = sut.encrypt(plain)
        val decrypted = sut.decrypt(encrypted)

        assertEquals(plain, decrypted)
    }

    @Test
    fun `round trip returns an empty string for an empty input`() {
        val sut = encryptor()

        val encrypted = sut.encrypt("")
        val decrypted = sut.decrypt(encrypted)

        assertEquals("", decrypted)
    }

    @Test
    fun `encrypt returns null for a null input and decrypt returns null for a null input`() {
        val sut = encryptor()

        assertNull(sut.encrypt(null))
        assertNull(sut.decrypt(null))
    }

    @Test
    fun `encrypt produces a different ciphertext for two consecutive calls with the same plaintext`() {
        val sut = encryptor()
        val plain = """{"apiTitle":"Pet API"}"""

        val first = sut.encrypt(plain)
        val second = sut.encrypt(plain)

        assertNotNull(first)
        assertNotNull(second)
        assertNotEquals(first, second)
    }

    @Test
    fun `encrypted blob starts with the Base64 form of the LENC magic prefix`() {
        val sut = encryptor()

        val encrypted = assertNotNull(sut.encrypt("plain"))
        assertTrue(encrypted.startsWith("TEVOQ"), "expected encrypted blob to start with TEVOQ, got: $encrypted")
    }

    @Test
    fun `decrypt returns the input unchanged when the blob is not Base64 or does not carry the magic prefix`() {
        val sut = encryptor()

        val plainJson = """{"apiTitle":"Pet API"}"""
        assertEquals(plainJson, sut.decrypt(plainJson))
    }

    @Test
    fun `decrypt returns null when the blob carries the magic prefix but cannot be decrypted with the configured key`() {
        val keyA = randomKey()
        val keyB = randomKey()
        val writer = AesGcmTestRunPayloadEncryptor(SecretKeySpec(keyA, "AES"))
        val reader = AesGcmTestRunPayloadEncryptor(SecretKeySpec(keyB, "AES"))

        val encrypted = assertNotNull(writer.encrypt("payload"))
        assertNull(reader.decrypt(encrypted))
    }

    @Test
    fun `decrypt returns the input unchanged when the Base64 decode fails after the magic prefix`() {
        val sut = encryptor()

        val malformed = "TEVOQ!!!not-valid-base64!!!"
        assertEquals(malformed, sut.decrypt(malformed))
    }

    @Test
    fun `decrypt returns the input unchanged when the blob is shorter than the magic + IV + tag minimum`() {
        val sut = encryptor()
        val shortBlob = Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(10))

        assertEquals(shortBlob, sut.decrypt(shortBlob))
    }

    @Test
    fun `decrypt returns null when the GCM tag is tampered with`() {
        val sut = encryptor()
        val encrypted = assertNotNull(sut.encrypt("payload"))
        assertTrue(encrypted.length > 8, "blob must be long enough for a mid-string flip")
        val tamperedIndex = encrypted.length / 2
        val tamperedChar = encrypted[tamperedIndex]
        val replacement = if (tamperedChar == 'A') 'B' else 'A'
        val tampered = encrypted.substring(0, tamperedIndex) + replacement + encrypted.substring(tamperedIndex + 1)

        assertNotEquals(encrypted, tampered)
        assertNull(sut.decrypt(tampered))
    }

    @Test
    fun `NoOpTestRunPayloadEncryptor is the identity function for encrypt and decrypt`() {
        val sut = NoOpTestRunPayloadEncryptor

        assertNull(sut.encrypt(null))
        assertNull(sut.decrypt(null))
        assertEquals("plain", sut.encrypt("plain"))
        assertEquals("plain", sut.decrypt("plain"))
    }

    @Test
    fun `the magic prefix is exactly four bytes long and starts with L`() {
        val sut = encryptor()
        val encrypted = assertNotNull(sut.encrypt("x"))
        val decoded = Base64.getUrlDecoder().decode(encrypted)

        assertTrue(decoded.size >= 4)
        assertEquals('L'.code.toByte(), decoded[0])
        assertEquals('E'.code.toByte(), decoded[1])
        assertEquals('N'.code.toByte(), decoded[2])
        assertEquals('C'.code.toByte(), decoded[3])
    }

    @Test
    fun `encrypted blob always contains at least the magic version IV and a 16-byte GCM tag`() {
        val sut = encryptor()
        val encrypted = assertNotNull(sut.encrypt(""))
        val decoded = Base64.getUrlDecoder().decode(encrypted)

        assertEquals(33, decoded.size)
    }

    @Test
    fun `encrypted output is ASCII-safe because the Base64 alphabet is used`() {
        val sut = encryptor()
        val encrypted = assertNotNull(sut.encrypt("plain"))

        assertTrue(encrypted.all { it.code in 0x21..0x7E }, "expected ASCII-safe characters, got: $encrypted")
        assertFalse(encrypted.endsWith("="), "expected no padding characters, got: $encrypted")
    }

    @Test
    fun `creating an encryptor with a key of the wrong length fails the AES key spec`() {
        val sut = AesGcmTestRunPayloadEncryptor(SecretKeySpec(ByteArray(15), "AES"))

        assertFailsWith<Exception> { sut.encrypt("payload") }
    }

    private companion object {
        fun randomKey(): ByteArray {
            val out = ByteArray(32)
            java.security.SecureRandom().nextBytes(out)
            return out
        }
    }
}

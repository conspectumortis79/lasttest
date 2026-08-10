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

/**
 * Unit tests for [AesGcmTestRunPayloadEncryptor]. The encryptor
 * is the trust boundary between the in-memory test-run model
 * and the H2 file on disk: every test pins a behaviour the
 * rest of the system relies on, so a future refactor that
 * silently changes the wire format or breaks backward
 * compatibility surfaces here instead of in production.
 */
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
        // An empty plaintext is encrypted as an empty cipher
        // payload (the IV / tag still wrap the empty string), and
        // decrypting the result yields the empty string back.
        // This keeps the field's nullability identical to the
        // input.
        val sut = encryptor()

        val encrypted = sut.encrypt("")
        val decrypted = sut.decrypt(encrypted)

        assertEquals("", decrypted)
    }

    @Test
    fun `encrypt returns null for a null input and decrypt returns null for a null input`() {
        // The mapper's `configuration?.let { ... }` block relies on
        // this so a run without a configuration does not get a
        // spurious empty-string column written to the database.
        val sut = encryptor()

        assertNull(sut.encrypt(null))
        assertNull(sut.decrypt(null))
    }

    @Test
    fun `encrypt produces a different ciphertext for two consecutive calls with the same plaintext`() {
        // AES/GCM uses a fresh random IV for every call — re-using
        // the same key + same plaintext must NOT yield the same
        // ciphertext, otherwise the IV was mis-seeded and the
        // confidentiality guarantee of GCM is gone.
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
        // The read-side fast path discriminates encrypted vs
        // plaintext columns by the encoded magic prefix; pin the
        // prefix so a refactor that drops the magic (or changes
        // the alphabet) does not silently break the
        // backward-compat branch.
        val sut = encryptor()

        val encrypted = assertNotNull(sut.encrypt("plain"))
        assertTrue(encrypted.startsWith("TEVOQ"), "expected encrypted blob to start with TEVOQ, got: $encrypted")
    }

    @Test
    fun `decrypt returns the input unchanged when the blob is not Base64 or does not carry the magic prefix`() {
        // The legacy-rows branch: an old build wrote a column of
        // plain JSON, so the first characters are `{` / `[` /
        // `"` — none of which decode to the LENC magic. The
        // encryptor must return the input verbatim so the
        // mapper's JSON parser can still consume it.
        val sut = encryptor()

        val plainJson = """{"apiTitle":"Pet API"}"""
        assertEquals(plainJson, sut.decrypt(plainJson))
    }

    @Test
    fun `decrypt returns null when the blob carries the magic prefix but cannot be decrypted with the configured key`() {
        // A column written by container A (key A) is read by
        // container B (key B). The Base64 prefix decodes, the
        // IV / tag are well-formed, but AES/GCM raises an
        // authentication error on the wrong key. The encryptor
        // surfaces that as `null` so the mapper at the call
        // site treats the row as "no configuration" instead of
        // a hard 500.
        val keyA = randomKey()
        val keyB = randomKey()
        val writer = AesGcmTestRunPayloadEncryptor(SecretKeySpec(keyA, "AES"))
        val reader = AesGcmTestRunPayloadEncryptor(SecretKeySpec(keyB, "AES"))

        val encrypted = assertNotNull(writer.encrypt("payload"))
        assertNull(reader.decrypt(encrypted))
    }

    @Test
    fun `decrypt returns the input unchanged when the Base64 decode fails after the magic prefix`() {
        // A blob that begins with the URL-safe form of "LENC"
        // (5 characters: "TEVOQ") but is not valid Base64
        // afterwards. The previous behaviour would throw, which
        // surfaces as a 500 in the dashboard; the current
        // behaviour logs once and returns the input unchanged so
        // the user at least sees a string in the UI rather than
        // an empty report.
        val sut = encryptor()

        val malformed = "TEVOQ!!!not-valid-base64!!!"
        assertEquals(malformed, sut.decrypt(malformed))
    }

    @Test
    fun `decrypt returns the input unchanged when the blob is shorter than the magic + IV + tag minimum`() {
        // The wire format needs at least 4 (magic) + 1 (version)
        // + 12 (IV) + 16 (GCM tag) = 33 bytes. Anything shorter
        // cannot be a valid encrypted blob; the encryptor must
        // not try to parse it and must not throw.
        val sut = encryptor()
        val shortBlob = Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(10))

        assertEquals(shortBlob, sut.decrypt(shortBlob))
    }

    @Test
    fun `decrypt returns null when the GCM tag is tampered with`() {
        // Flip a character in the MIDDLE of the ciphertext:
        // GCM's authentication tag must catch the tamper and
        // the decryptor must surface `null` rather than return
        // a corrupted string.
        //
        // The previous implementation flipped the LAST base64
        // character of the blob, which is flaky because the
        // last character carries unused padding bits. The
        // decoded bytes can be identical after the flip, GCM
        // decodes successfully, and the test fails
        // intermittently in the full Gradle run (passes in
        // isolation, fails under parallel scheduling). A flip
        // inside the ciphertext always lands inside a byte the
        // JCE actually consumes, so the auth tag mismatches
        // deterministically.
        val sut = encryptor()
        val encrypted = assertNotNull(sut.encrypt("payload"))
        assertTrue(encrypted.length > 8, "blob must be long enough for a mid-string flip")
        // Pick an index well past the magic prefix so the
        // tamper lands inside the ciphertext, not the IV.
        val tamperedIndex = encrypted.length / 2
        val tamperedChar = encrypted[tamperedIndex]
        val replacement = if (tamperedChar == 'A') 'B' else 'A'
        val tampered = encrypted.substring(0, tamperedIndex) + replacement + encrypted.substring(tamperedIndex + 1)

        assertNotEquals(encrypted, tampered)
        assertNull(sut.decrypt(tampered))
    }

    @Test
    fun `NoOpTestRunPayloadEncryptor is the identity function for encrypt and decrypt`() {
        // Pin the no-op contract so test code that defaults to
        // the no-op never has to wonder whether the default
        // is silently doing something. The mapper's default
        // parameter relies on this.
        val sut = NoOpTestRunPayloadEncryptor

        assertNull(sut.encrypt(null))
        assertNull(sut.decrypt(null))
        assertEquals("plain", sut.encrypt("plain"))
        assertEquals("plain", sut.decrypt("plain"))
    }

    @Test
    fun `the magic prefix is exactly four bytes long and starts with L`() {
        // Document the on-the-wire layout in code form: the
        // magic has to be 4 bytes (1 ASCII character per byte)
        // and must begin with 'L' so a hex-dump of the H2 file
        // is recognisable. A future refactor that bumps the
        // magic to a UUID would break the backward-compat
        // branch — the test fails first.
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
        // The minimum encrypted size is 4 (magic) + 1 (version)
        // + 12 (IV) + 16 (GCM tag) = 33 bytes. The encryptor
        // always emits exactly that overhead on top of the
        // plaintext (empty input included). This pins the
        // algorithm choice — a future swap to AES/CBC would
        // surface here because the overhead is different.
        val sut = encryptor()
        val encrypted = assertNotNull(sut.encrypt(""))
        val decoded = Base64.getUrlDecoder().decode(encrypted)

        // 33 bytes overhead + 0 bytes plaintext = 33 bytes
        // total for an empty input.
        assertEquals(33, decoded.size)
    }

    @Test
    fun `encrypted output is ASCII-safe because the Base64 alphabet is used`() {
        // The H2 column is a `VARCHAR` / `CLOB` and the
        // dashboard's "timeline" view occasionally logs the raw
        // column in debug mode. The output must therefore be
        // printable ASCII — i.e. URL-safe Base64 with no
        // padding — so a copy-paste of the value does not
        // corrupt the surrounding log line.
        val sut = encryptor()
        val encrypted = assertNotNull(sut.encrypt("plain"))

        assertTrue(encrypted.all { it.code in 0x21..0x7E }, "expected ASCII-safe characters, got: $encrypted")
        // No padding — the URL-safe decoder is not the
        // padding-aware one.
        assertFalse(encrypted.endsWith("="), "expected no padding characters, got: $encrypted")
    }

    @Test
    fun `creating an encryptor with a key of the wrong length fails the AES key spec`() {
        // AES requires a 16-, 24- or 32-byte key. The encryptor
        // constructor takes a [SecretKey] which is already
        // validated by the JCE, so the wrong-length case
        // surfaces on `Cipher.init` rather than on
        // construction. Pin the failure mode so a future
        // refactor that calls `SecretKeySpec` with a wrong
        // length still raises — a silent 0-byte key would
        // encrypt everything with zeros.
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

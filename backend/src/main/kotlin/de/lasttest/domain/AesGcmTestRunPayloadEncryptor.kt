package de.lasttest.domain

import org.slf4j.LoggerFactory
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class AesGcmTestRunPayloadEncryptor(
    private val key: SecretKey,
) : TestRunPayloadEncryptor {
    private fun cipher(): Cipher = Cipher.getInstance(TRANSFORMATION)

    override fun encrypt(plain: String?): String? {
        if (plain == null) return null
        val iv = randomBytes(IV_LENGTH)
        val cipher = cipher()
        cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(TAG_LENGTH_BITS, iv))
        val ciphertext = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        val out = ByteArray(MAGIC.size + VERSION.size + iv.size + ciphertext.size)
        var offset = 0
        System.arraycopy(MAGIC, 0, out, offset, MAGIC.size)
        offset += MAGIC.size
        System.arraycopy(VERSION, 0, out, offset, VERSION.size)
        offset += VERSION.size
        System.arraycopy(iv, 0, out, offset, iv.size)
        offset += iv.size
        System.arraycopy(ciphertext, 0, out, offset, ciphertext.size)
        return Base64.getUrlEncoder().withoutPadding().encodeToString(out)
    }

    override fun decrypt(blob: String?): String? {
        if (blob == null) return null
        if (!blob.startsWith(ENCODED_MAGIC_PREFIX)) return blob
        val bytes =
            try {
                Base64.getUrlDecoder().decode(blob)
            } catch (exception: IllegalArgumentException) {
                log.warn("Blob beginnt mit Verschlüsselungs-Magic, ist aber kein gültiges Base64: {}", exception.message)
                return blob
            }
        if (bytes.size < MAGIC.size + VERSION.size + IV_LENGTH + TAG_LENGTH_BYTES) {
            log.warn("Verschlüsselter Blob ist zu kurz ({} Bytes) — gebe ihn unverändert zurück.", bytes.size)
            return blob
        }
        if (!MAGIC.contentEquals(bytes.copyOfRange(0, MAGIC.size))) {
            log.warn("Blob-Magic stimmt nach Base64-Decode nicht überein — gebe ihn unverändert zurück.")
            return blob
        }
        if (VERSION[0] != bytes[MAGIC.size]) {
            log.warn("Unbekannte Verschlüsselungs-Version 0x{} — gebe Blob unverändert zurück.", bytes[MAGIC.size])
            return blob
        }
        val iv = bytes.copyOfRange(MAGIC.size + VERSION.size, MAGIC.size + VERSION.size + IV_LENGTH)
        val payload = bytes.copyOfRange(MAGIC.size + VERSION.size + IV_LENGTH, bytes.size)
        val cipher = cipher()
        return try {
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_LENGTH_BITS, iv))
            String(cipher.doFinal(payload), Charsets.UTF_8)
        } catch (exception: Exception) {
            log.warn("Entschlüsselung fehlgeschlagen ({}): {}. Gebe null zurück.", exception::class.java.simpleName, exception.message)
            null
        }
    }

    private companion object {
        const val TRANSFORMATION: String = "AES/GCM/NoPadding"
        const val IV_LENGTH: Int = 12
        const val TAG_LENGTH_BITS: Int = 128
        const val TAG_LENGTH_BYTES: Int = TAG_LENGTH_BITS / 8

        val MAGIC: ByteArray = byteArrayOf(0x4C, 0x45, 0x4E, 0x43)
        val VERSION: ByteArray = byteArrayOf(0x01)

        const val ENCODED_MAGIC_PREFIX: String = "TEVOQ"

        private val log = LoggerFactory.getLogger(AesGcmTestRunPayloadEncryptor::class.java)
    }
}

private fun randomBytes(length: Int): ByteArray {
    val out = ByteArray(length)
    SECURE_RANDOM.nextBytes(out)
    return out
}

private val SECURE_RANDOM: java.security.SecureRandom = java.security.SecureRandom()

package de.lasttest.config

import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.attribute.PosixFilePermissions
import java.util.Base64
import javax.crypto.SecretKey
import javax.crypto.spec.SecretKeySpec

/**
 * Resolves the AES key the timeline encryptor uses. The
 * resolution order is:
 *
 *   1. [TestRunEncryptionProperties.key] (Base64-encoded 32 bytes)
 *   2. `LASTTEST_ENCRYPTION_KEY` environment variable (same format)
 *   3. [TestRunEncryptionProperties.keyFile] (raw 32 bytes)
 *   4. [TestRunEncryptionProperties.keyFile] generated and persisted
 *      (when no source above yields a key)
 *
 * The result is cached so the file is read at most once per JVM
 * and a freshly-generated key is not re-rolled between calls.
 *
 * The application is the source of truth for the key — that is
 * the contract the user asked for: "the key is set by the
 * lasttest application itself for encryption and decryption".
 * The class only consults the env var / property / file as a
 * way to let operators share a key across multiple instances
 * of the same H2 file. With no operator input, the app
 * generates a random 32-byte key, writes it to the key file
 * and uses that forever after.
 */
@Component
class TestRunEncryptionKeyProvider(
    private val properties: TestRunEncryptionProperties,
    private val dataDir: Path,
    private val environment: EnvironmentVariables = SystemEnvironmentVariables,
) {
    private val log = LoggerFactory.getLogger(TestRunEncryptionKeyProvider::class.java)

    @Volatile
    private var cached: SecretKey? = null

    /**
     * Returns the AES key the encryptor should use, resolving
     * it lazily on the first call. Subsequent calls return
     * the cached instance — the same key is used for every
     * encrypt/decrypt operation of the running JVM, and the
     * same key file keeps producing the same key across
     * restarts.
     *
     * @throws IllegalStateException when no key source yields
     *   a usable 32-byte value. The error is intentional:
     *   failing fast at startup is preferable to silently
     *   using a default key that an attacker could guess.
     */
    fun resolveKey(): SecretKey {
        cached?.let { return it }
        synchronized(this) {
            cached?.let { return it }
            val resolved = loadOrGenerate()
            cached = resolved
            return resolved
        }
    }

    private fun loadOrGenerate(): SecretKey {
        val raw = loadRawKey() ?: generateAndPersist()
        require(raw.size == KEY_LENGTH_BYTES) {
            "Verschlüsselungs-Schlüssel muss $KEY_LENGTH_BYTES Bytes lang sein, ist aber ${raw.size} Bytes."
        }
        return SecretKeySpec(raw, "AES")
    }

    /**
     * Returns the 32 raw bytes the key is built from, or
     * `null` when no source (property, env var, file) is
     * available and a fresh key has to be generated. The
     * caller decides whether to fall back to the
     * generate-and-persist path.
     */
    private fun loadRawKey(): ByteArray? {
        decodeBase64Property(properties.key, "lasttest.encryption.key")?.let { return it }
        environment.get(ENV_VAR)?.let { value ->
            log.info("Lese Verschlüsselungs-Schlüssel aus Umgebungsvariable {}.", ENV_VAR)
            return decodeBase64(value, ENV_VAR)
        }
        val file = effectiveKeyFile() ?: return null
        if (!Files.exists(file)) return null
        log.info("Lese Verschlüsselungs-Schlüssel aus Datei {}.", file)
        return stripTrailingWhitespace(Files.readAllBytes(file))
    }

    /**
     * Tolerates a trailing newline / space that an operator
     * may have added when editing the file by hand. The
     * raw-bytes contract on the file is loose enough that
     * stripping whitespace is safer than rejecting the file
     * outright — a `0x0A` accidentally appended in a text
     * editor would otherwise turn a 32-byte key into a
     * 33-byte value and fail the length check below.
     */
    private fun stripTrailingWhitespace(bytes: ByteArray): ByteArray {
        var end = bytes.size
        while (end > 0) {
            val last = bytes[end - 1].toInt()
            if (last != 0x0A && last != 0x0D && last != 0x20) break
            end--
        }
        if (end == bytes.size) return bytes
        val out = ByteArray(end)
        System.arraycopy(bytes, 0, out, 0, end)
        return out
    }

    private fun decodeBase64Property(
        value: String?,
        source: String,
    ): ByteArray? {
        if (value.isNullOrBlank()) return null
        log.info("Lese Verschlüsselungs-Schlüssel aus Property {}.", source)
        return decodeBase64(value, source)
    }

    private fun decodeBase64(
        value: String,
        source: String,
    ): ByteArray =
        try {
            Base64.getDecoder().decode(value)
        } catch (exception: IllegalArgumentException) {
            throw IllegalStateException("Wert in $source ist kein gültiges Base64: ${exception.message}", exception)
        }

    /**
     * Generates a fresh 32-byte AES key, persists it to the
     * effective key file (creating parent directories as
     * needed) and returns the raw bytes. The file is created
     * with mode `0600` on POSIX file systems so a casual
     * directory listing on the Docker host does not leak the
     * key. On non-POSIX systems the permission request is
     * silently ignored — Windows does not support the POSIX
     * permission model natively, and the container image is
     * Alpine anyway.
     */
    private fun generateAndPersist(): ByteArray {
        val raw = ByteArray(KEY_LENGTH_BYTES)
        SECURE_RANDOM.nextBytes(raw)
        val file = effectiveKeyFile()
        if (file != null) {
            Files.createDirectories(file.parent ?: dataDir)
            Files.write(file, raw)
            applyOwnerOnlyPermissions(file)
            log.warn(
                "Neuer Verschlüsselungs-Schlüssel wurde generiert und unter {} abgelegt. " +
                    "Ohne diese Datei sind gespeicherte Timeline-Einträge nicht mehr lesbar.",
                file,
            )
        } else {
            // No key file configured and no key from env/property
            // — the encryptor will run with an in-memory key that
            // is lost on the next restart. Warn loudly so an
            // operator notices. The in-memory key is still
            // useful for short-lived processes (CI, tests).
            log.warn(
                "Kein Schlüssel-File und keine Property/Umgebungsvariable gesetzt — generiere " +
                    "flüchtigen Schlüssel, der beim Neustart verloren geht.",
            )
        }
        return raw
    }

    private fun effectiveKeyFile(): Path? = properties.keyFile ?: dataDir.resolve(DEFAULT_KEY_FILE_NAME)

    private fun applyOwnerOnlyPermissions(file: Path) {
        try {
            Files.setPosixFilePermissions(file, PosixFilePermissions.fromString("rw-------"))
        } catch (exception: UnsupportedOperationException) {
            // Non-POSIX file system (e.g. Windows native FS in a
            // dev shell). The container image is Alpine, so this
            // branch only fires during local development on
            // Windows hosts — and the operator has bigger
            // problems to solve than the file mode of a key
            // file.
        } catch (exception: Exception) {
            log.warn("Konnte Datei-Modus 0600 für {} nicht setzen: {}", file, exception.message)
        }
    }

    private companion object {
        const val ENV_VAR: String = "LASTTEST_ENCRYPTION_KEY"
        const val KEY_LENGTH_BYTES: Int = 32
        const val DEFAULT_KEY_FILE_NAME: String = "encryption.key"

        /**
         * Dedicated [java.security.SecureRandom] instance. The
         * default constructor uses the platform's strongest
         * available entropy source; we keep the reference
         * here so the call sites in
         * [TestRunEncryptionKeyProvider.generateAndPersist] do
         * not have to spell out the import each time.
         */
        val SECURE_RANDOM: java.security.SecureRandom = java.security.SecureRandom()
    }
}

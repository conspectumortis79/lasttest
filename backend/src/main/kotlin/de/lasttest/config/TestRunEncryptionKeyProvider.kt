package de.lasttest.config

import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.attribute.PosixFilePermissions
import java.util.Base64
import javax.crypto.SecretKey
import javax.crypto.spec.SecretKeySpec

@Component
class TestRunEncryptionKeyProvider(
    private val properties: TestRunEncryptionProperties,
    private val dataDir: Path,
    private val environment: EnvironmentVariables = SystemEnvironmentVariables,
) {
    private val log = LoggerFactory.getLogger(TestRunEncryptionKeyProvider::class.java)

    @Volatile
    private var cached: SecretKey? = null

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
            return
        } catch (exception: Exception) {
            log.warn("Konnte Datei-Modus 0600 für {} nicht setzen: {}", file, exception.message)
        }
    }

    private companion object {
        const val ENV_VAR: String = "LASTTEST_ENCRYPTION_KEY"
        const val KEY_LENGTH_BYTES: Int = 32
        const val DEFAULT_KEY_FILE_NAME: String = "encryption.key"

        val SECURE_RANDOM: java.security.SecureRandom = java.security.SecureRandom()
    }
}

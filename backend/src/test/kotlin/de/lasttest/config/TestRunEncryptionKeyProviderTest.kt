package de.lasttest.config

import java.nio.file.Files
import java.nio.file.Path
import java.util.Base64
import javax.crypto.spec.SecretKeySpec
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class TestRunEncryptionKeyProviderTest {
    private val tmpDir: Path = Files.createTempDirectory("lasttest-encryption-key-test")

    @Test
    fun `property value takes precedence over the key file`() {
        val propertyKey = randomKey()
        val staleFileKey = randomKey()
        val keyFile = tmpDir.resolve("stale.key")
        Files.write(keyFile, staleFileKey)
        val provider =
            TestRunEncryptionKeyProvider(
                properties = TestRunEncryptionProperties(key = encode(propertyKey), keyFile = keyFile),
                dataDir = tmpDir,
                environment = MapEnvironmentVariables(emptyMap()),
            )

        val key = provider.resolveKey()

        assertContentEquals(propertyKey, key.encoded)
    }

    @Test
    fun `environment variable takes precedence over the key file when the property is empty`() {
        val envKey = randomKey()
        val fileKey = randomKey()
        val keyFile = tmpDir.resolve("file.key")
        Files.write(keyFile, fileKey)
        val provider =
            TestRunEncryptionKeyProvider(
                properties = TestRunEncryptionProperties(keyFile = keyFile),
                dataDir = tmpDir,
                environment = MapEnvironmentVariables(mapOf("LASTTEST_ENCRYPTION_KEY" to encode(envKey))),
            )

        val key = provider.resolveKey()

        assertContentEquals(envKey, key.encoded)
    }

    @Test
    fun `key file is read when neither property nor env var is set`() {
        val fileKey = randomKey()
        val keyFile = tmpDir.resolve("preexisting.key")
        Files.write(keyFile, fileKey)
        val provider =
            TestRunEncryptionKeyProvider(
                properties = TestRunEncryptionProperties(keyFile = keyFile),
                dataDir = tmpDir,
                environment = MapEnvironmentVariables(emptyMap()),
            )

        val key = provider.resolveKey()

        assertContentEquals(fileKey, key.encoded)
    }

    @Test
    fun `key file tolerates a trailing newline so hand-edited files still work`() {
        val fileKey = randomKey()
        val keyFile = tmpDir.resolve("with-newline.key")
        Files.write(keyFile, fileKey + byteArrayOf(0x0A))
        val provider =
            TestRunEncryptionKeyProvider(
                properties = TestRunEncryptionProperties(keyFile = keyFile),
                dataDir = tmpDir,
                environment = MapEnvironmentVariables(emptyMap()),
            )

        val key = provider.resolveKey()

        assertContentEquals(fileKey, key.encoded)
    }

    @Test
    fun `a new key is generated and persisted when no source is available`() {
        val provider =
            TestRunEncryptionKeyProvider(
                properties = TestRunEncryptionProperties(keyFile = null),
                dataDir = tmpDir,
                environment = MapEnvironmentVariables(emptyMap()),
            )
        val keyFile = tmpDir.resolve("encryption.key")
        assertFalse(Files.exists(keyFile))

        val key = provider.resolveKey()

        assertEquals(32, key.encoded.size)
        assertTrue(Files.exists(keyFile), "expected key file to be created at $keyFile")
        assertContentEquals(key.encoded, Files.readAllBytes(keyFile))
    }

    @Test
    fun `the same key is returned on every call within the same JVM`() {
        val provider =
            TestRunEncryptionKeyProvider(
                properties = TestRunEncryptionProperties(),
                dataDir = tmpDir,
                environment = MapEnvironmentVariables(emptyMap()),
            )

        val first = provider.resolveKey()
        val second = provider.resolveKey()
        val third = provider.resolveKey()

        assertContentEquals(first.encoded, second.encoded)
        assertContentEquals(first.encoded, third.encoded)
    }

    @Test
    fun `an invalid Base64 property value is rejected with a clear error`() {
        val provider =
            TestRunEncryptionKeyProvider(
                properties = TestRunEncryptionProperties(key = "not-base64!"),
                dataDir = tmpDir,
                environment = MapEnvironmentVariables(emptyMap()),
            )

        val exception = assertFailsWith<IllegalStateException> { provider.resolveKey() }
        assertTrue(
            exception.message!!.contains("lasttest.encryption.key"),
            "expected error to mention the property, got: ${exception.message}",
        )
    }

    @Test
    fun `a key of the wrong length is rejected with a clear error`() {
        val tooShort = ByteArray(24)
        val keyFile = tmpDir.resolve("short.key")
        Files.write(keyFile, tooShort)
        val provider =
            TestRunEncryptionKeyProvider(
                properties = TestRunEncryptionProperties(keyFile = keyFile),
                dataDir = tmpDir,
                environment = MapEnvironmentVariables(emptyMap()),
            )

        val exception = assertFailsWith<IllegalArgumentException> { provider.resolveKey() }
        assertTrue(
            exception.message!!.contains("32"),
            "expected error to mention the expected key length, got: ${exception.message}",
        )
    }

    @Test
    fun `an in-memory key is generated when no key file is configured and no property or env var is set`() {
        val provider =
            TestRunEncryptionKeyProvider(
                properties = TestRunEncryptionProperties(keyFile = null),
                dataDir = tmpDir.resolve("does-not-exist"),
                environment = MapEnvironmentVariables(emptyMap()),
            )

        val key = provider.resolveKey()

        assertNotNull(key)
        assertEquals(32, key.encoded.size)
    }

    @Test
    fun `generated key file is created with owner-only permissions on POSIX file systems`() {
        val keyFile = tmpDir.resolve("perm.key")
        val provider =
            TestRunEncryptionKeyProvider(
                properties = TestRunEncryptionProperties(keyFile = keyFile),
                dataDir = tmpDir,
                environment = MapEnvironmentVariables(emptyMap()),
            )

        provider.resolveKey()

        val attrs =
            try {
                Files.readAttributes(keyFile, java.nio.file.attribute.PosixFileAttributes::class.java)
            } catch (exception: UnsupportedOperationException) {
                return
            }
        val perms = attrs.permissions()
        assertTrue(perms.contains(java.nio.file.attribute.PosixFilePermission.OWNER_READ))
        assertTrue(perms.contains(java.nio.file.attribute.PosixFilePermission.OWNER_WRITE))
        assertFalse(perms.contains(java.nio.file.attribute.PosixFilePermission.OTHERS_READ))
        assertFalse(perms.contains(java.nio.file.attribute.PosixFilePermission.GROUP_READ))
    }

    @Test
    fun `a fresh key is generated in the data dir when the key file path is not configured`() {
        val provider =
            TestRunEncryptionKeyProvider(
                properties = TestRunEncryptionProperties(keyFile = null),
                dataDir = tmpDir,
                environment = MapEnvironmentVariables(emptyMap()),
            )

        val key = provider.resolveKey()
        val defaultFile = tmpDir.resolve("encryption.key")

        assertTrue(Files.exists(defaultFile), "expected key file at $defaultFile")
        assertContentEquals(key.encoded, Files.readAllBytes(defaultFile))
    }

    @Test
    fun `a fresh key is generated in the data dir when the key file does not exist yet`() {
        val customDataDir = Files.createTempDirectory(tmpDir, "data")
        val provider =
            TestRunEncryptionKeyProvider(
                properties = TestRunEncryptionProperties(),
                dataDir = customDataDir,
                environment = MapEnvironmentVariables(emptyMap()),
            )

        val key = provider.resolveKey()
        val defaultFile = customDataDir.resolve("encryption.key")

        assertTrue(Files.exists(defaultFile), "expected key file at $defaultFile")
        assertContentEquals(key.encoded, Files.readAllBytes(defaultFile))
    }

    @Test
    fun `the produced SecretKey is a 32-byte AES key`() {
        val provider =
            TestRunEncryptionKeyProvider(
                properties = TestRunEncryptionProperties(),
                dataDir = tmpDir,
                environment = MapEnvironmentVariables(emptyMap()),
            )

        val key = provider.resolveKey()

        assertEquals(32, key.encoded.size)
        assertEquals("AES", key.algorithm)
        assertTrue(key is SecretKeySpec)
    }

    private companion object {
        fun randomKey(): ByteArray {
            val out = ByteArray(32)
            java.security.SecureRandom().nextBytes(out)
            val forbidden = setOf(0x0A.toByte(), 0x0D.toByte(), 0x20.toByte())
            while (out[out.size - 1] in forbidden) {
                java.security.SecureRandom().nextBytes(out)
            }
            return out
        }

        fun encode(bytes: ByteArray): String = Base64.getEncoder().encodeToString(bytes)
    }
}

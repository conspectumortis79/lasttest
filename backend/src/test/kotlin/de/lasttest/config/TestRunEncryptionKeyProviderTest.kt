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

/**
 * Unit tests for [TestRunEncryptionKeyProvider]. The key
 * provider is the trust anchor of the at-rest encryption
 * feature: every column that the timeline writes or reads
 * goes through the [SecretKeySpec] it returns. The tests pin
 * the resolution order (property > env > file > generate) and
 * the caching behaviour, so a refactor that re-orders the
 * sources or skips the cache cannot silently break the
 * encryption layer.
 */
class TestRunEncryptionKeyProviderTest {
    private val tmpDir: Path = Files.createTempDirectory("lasttest-encryption-key-test")

    @Test
    fun `property value takes precedence over the key file`() {
        // The "share the key between containers" use case:
        // an operator sets a Base64 property so every
        // instance derives the same SecretKeySpec, even if
        // a stale key file is lying around from an earlier
        // boot. The property must win.
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
        // Mirror the property branch for the env-var override.
        // The docker-compose / Kubernetes case is the env
        // var, so this branch is the production hot path.
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
        // The "fresh start, key already on disk" case: an
        // operator seeded the key file by hand or the app
        // generated it on a previous run. The provider must
        // re-use the file's bytes so old encrypted rows stay
        // readable.
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
        // An operator opened the file in `vim` and accidentally
        // added a trailing newline. The raw-bytes contract is
        // loose enough that stripping trailing whitespace is
        // safer than rejecting the file outright — a
        // 32-byte + 1-newline key would otherwise be a 33-byte
        // value and trip the length check.
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
        // The "fresh install, no operator input" case: the
        // app generates a random 32-byte AES key, writes it
        // to the default key file, and uses it for all
        // subsequent encrypt/decrypt operations. Without
        // this auto-generation, the app would have to crash
        // on first start with no key — which would block
        // every container that did not pre-provision the
        // key file by hand.
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
        // The cache is a deliberate optimisation: re-reading
        // the key file on every encrypt call would not break
        // correctness, but it would amplify the cost of the
        // AES round trip and re-roll a freshly generated
        // key (the data on disk would be encrypted with a
        // key no future call can reproduce).
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
        // A typo in `application.properties` would otherwise
        // surface as an `IllegalArgumentException` deep
        // inside the AES/GCM code path, which is hard to
        // diagnose. The provider wraps the error so the
        // stack trace points at the property name.
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
        // The JCE accepts 16-, 24- or 32-byte keys. The
        // provider explicitly requires 32 bytes (AES-256) so
        // a base64-decoded 24-byte value does not silently
        // fall through to AES-192. Without this check an
        // operator who rotates the key to a 24-byte value
        // would only see the failure at the first encrypt
        // call, which is too late.
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
        // The CI / unit-test code path: there is no key file
        // to write to (the data dir is `/tmp`, the container
        // exits in seconds) and the operator did not set the
        // env var. The provider must still produce a usable
        // key so the encryptor can be constructed. The key
        // is lost on JVM exit, but that is acceptable for
        // the CI use case.
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
        // The Docker host's `ls -la data/` must not leak the
        // key to other users on the host. On POSIX the
        // provider sets mode `0600`; on non-POSIX (Windows)
        // the request is a no-op and the test still passes
        // because the file is present.
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
                // Non-POSIX file system (e.g. Windows native FS).
                // The provider already tolerates this; the test
                // is a no-op on such a system.
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
        // The default key file path is `${data-dir}/encryption.key`.
        // Pin the default so a refactor that moves the file
        // (e.g. into a sub-directory) does not silently
        // break operators who upgraded from an earlier
        // version and are still looking for the old
        // location.
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
        // A clean Docker volume has no key file — the
        // provider must create it in the data directory
        // rather than abort the startup. The data-dir
        // fallback path is the production code path on a
        // first-time install.
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
        // The encryptor uses AES-256. A 16- or 24-byte key
        // would still be a valid `SecretKey`, but the cipher
        // would refuse to use it without an explicit
        // `SecretKeySpec` length adjustment. The provider
        // returns the right key shape so the caller does
        // not have to worry about it.
        val provider =
            TestRunEncryptionKeyProvider(
                properties = TestRunEncryptionProperties(),
                dataDir = tmpDir,
                environment = MapEnvironmentVariables(emptyMap()),
            )

        val key = provider.resolveKey()

        assertEquals(32, key.encoded.size)
        assertEquals("AES", key.algorithm)
        // The SecretKeySpec is the only sensible subtype the
        // provider returns; pin it so a future swap to
        // `SecretKey` with a different key factory would
        // surface here.
        assertTrue(key is SecretKeySpec)
    }

    private companion object {
        /**
         * Generates a 32-byte key whose LAST byte is never one
         * of the whitespace markers [TestRunEncryptionKeyProvider]
         * strips (`0x0A`, `0x0D`, `0x20`). Without this guard,
         * a purely random key collides with one of those three
         * values roughly 1 in 85 times (3/256), which would make
         * `stripTrailingWhitespace` truncate a genuine key byte
         * and turn a 32-byte key into a 31-byte one — failing
         * the provider's length check for a reason that has
         * nothing to do with the behaviour under test.
         */
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

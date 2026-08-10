package de.lasttest.config

import de.lasttest.domain.AesGcmTestRunPayloadEncryptor
import de.lasttest.domain.NoOpTestRunPayloadEncryptor
import de.lasttest.domain.TestRunPayloadEncryptor
import org.springframework.beans.factory.annotation.Value
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import java.nio.file.Path

/**
 * Wires the at-rest encryption layer for the timeline. The
 * actual algorithm lives in [AesGcmTestRunPayloadEncryptor];
 * this class is the Spring glue that picks between the real
 * encryptor and the no-op fallback based on
 * [TestRunEncryptionProperties.enabled], and that surfaces
 * the data directory as a constructor argument to the key
 * provider.
 *
 * The encryptor is exposed as a [TestRunPayloadEncryptor] so
 * the consumers (the [de.lasttest.domain.TestRunMappers]
 * extension functions) depend on the abstraction rather than
 * on the concrete implementation. The mappers' default
 * parameter is the no-op, so a test that does not care about
 * encryption does not have to wire a real key.
 */
@Configuration
class TestRunEncryptionConfiguration {
    /**
     * Resolves the active [TestRunPayloadEncryptor]. When the
     * `lasttest.encryption.enabled` flag is `true` (the
     * default), the application generates or loads a 32-byte
     * AES key via [TestRunEncryptionKeyProvider] and returns
     * an [AesGcmTestRunPayloadEncryptor]. When the flag is
     * `false`, the no-op implementation is returned so the
     * mapper layer sees an identity function and the columns
     * are stored in plaintext — useful for forensic
     * debugging or for users who have a separate
     * encryption-at-rest policy on the Docker volume.
     */
    @Bean
    fun testRunPayloadEncryptor(
        properties: TestRunEncryptionProperties,
        keyProvider: TestRunEncryptionKeyProvider,
    ): TestRunPayloadEncryptor =
        if (properties.enabled) {
            AesGcmTestRunPayloadEncryptor(keyProvider.resolveKey())
        } else {
            NoOpTestRunPayloadEncryptor
        }

    /**
     * The [TestRunEncryptionKeyProvider] needs the data
     * directory to decide on a default key file path. We
     * inject `lasttest.data-dir` via [Value] rather than
     * pulling the property through Spring's data-source
     * autoconfiguration so the key file lives next to the
     * H2 file in any deployment (Docker volume, dev
     * workstation, CI).
     */
    @Bean
    fun testRunEncryptionKeyProvider(
        properties: TestRunEncryptionProperties,
        @Value("\${lasttest.data-dir:/tmp/lasttest-data}") dataDir: String,
    ): TestRunEncryptionKeyProvider = TestRunEncryptionKeyProvider(properties, Path.of(dataDir))
}

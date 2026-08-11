package de.lasttest.config

import de.lasttest.domain.AesGcmTestRunPayloadEncryptor
import de.lasttest.domain.NoOpTestRunPayloadEncryptor
import de.lasttest.domain.TestRunPayloadEncryptor
import org.springframework.beans.factory.annotation.Value
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import java.nio.file.Path

@Configuration
class TestRunEncryptionConfiguration {
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

    @Bean
    fun testRunEncryptionKeyProvider(
        properties: TestRunEncryptionProperties,
        @Value("\${lasttest.data-dir:/tmp/lasttest-data}") dataDir: String,
    ): TestRunEncryptionKeyProvider = TestRunEncryptionKeyProvider(properties, Path.of(dataDir))
}

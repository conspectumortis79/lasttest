package de.lasttest.config

import org.springframework.boot.context.properties.ConfigurationProperties
import java.nio.file.Path

@ConfigurationProperties(prefix = "lasttest.encryption")
data class TestRunEncryptionProperties(
    val enabled: Boolean = true,
    val key: String? = null,
    val keyFile: Path? = null,
)

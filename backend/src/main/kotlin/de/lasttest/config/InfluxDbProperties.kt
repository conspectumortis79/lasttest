package de.lasttest.config

import org.springframework.boot.context.properties.ConfigurationProperties

@ConfigurationProperties(prefix = "lasttest.influxdb")
data class InfluxDbProperties(
    val url: String = "http://influxdb:8086",
    val bucket: String = "k6",
    val user: String = "k6-writer",
    val token: String = "lasttest-writer-password",
    val enabled: Boolean = true,
)

package de.lasttest.config

import org.springframework.boot.context.properties.ConfigurationProperties

/**
 * Configuration for the InfluxDB 1.x endpoint that k6 streams its
 * output to. All fields have defaults matching the docker-compose
 * setup, so a freshly cloned project works without further changes.
 * Override via `application.properties` or `LASTTEST_INFLUXDB_*`
 * environment variables.
 */
@ConfigurationProperties(prefix = "lasttest.influxdb")
data class InfluxDbProperties(
    /** Base URL of InfluxDB. */
    val url: String = "http://influxdb:8086",
    /**
     * Database name. In InfluxDB v1 the concept is called "Database",
     * not "Bucket" — we keep the property name for historical reasons.
     */
    val bucket: String = "k6",
    /** HTTP Basic Auth username (in docker-compose.yml: `k6-writer`). */
    val user: String = "k6-writer",
    /** HTTP Basic Auth password. */
    val token: String = "lasttest-writer-password",
    /**
     * When false, k6 does NOT write to InfluxDB and the backend does
     * not try to load a measured curve. Useful for CI tests and
     * minimal setups without an InfluxDB container.
     */
    val enabled: Boolean = true,
)

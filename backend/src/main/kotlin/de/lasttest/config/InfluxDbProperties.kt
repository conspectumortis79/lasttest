package de.lasttest.config

import org.springframework.boot.context.properties.ConfigurationProperties

/**
 * Konfiguration für den InfluxDB-1.x-Endpunkt, an den k6 seinen
 * Output streamt. Alle Felder haben Defaults, die zum
 * docker-compose-Setup passen, sodass ein frisch geklontes Projekt
 * ohne weitere Anpassung funktioniert. Wird per
 * `application.properties` oder `LASTTEST_INFLUXDB_*`-Env-Variablen
 * überschrieben.
 */
@ConfigurationProperties(prefix = "lasttest.influxdb")
data class InfluxDbProperties(
    /** Basis-URL von InfluxDB. */
    val url: String = "http://influxdb:8086",
    /**
     * Datenbank-Name. Bei InfluxDB-v1 heißt das Konzept "Database",
     * nicht "Bucket" — wir behalten den Property-Namen aus
     * historischen Gründen.
     */
    val bucket: String = "k6",
    /** HTTP-Basic-Auth Username (in docker-compose.yml: `k6-writer`). */
    val user: String = "k6-writer",
    /** HTTP-Basic-Auth Passwort. */
    val token: String = "lasttest-writer-password",
    /**
     * Wenn false, schreibt k6 NICHT nach InfluxDB und das Backend
     * versucht nicht, eine Ist-Kurve zu laden. Nützlich für CI-Tests
     * und Minimal-Setups ohne InfluxDB-Container.
     */
    val enabled: Boolean = true,
)

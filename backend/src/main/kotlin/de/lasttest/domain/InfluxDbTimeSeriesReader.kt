package de.lasttest.domain

import de.lasttest.config.InfluxDbProperties
import org.slf4j.LoggerFactory
import org.springframework.http.HttpEntity
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpMethod
import org.springframework.stereotype.Service
import org.springframework.web.client.RestTemplate
import java.net.URI
import java.time.Instant

/**
 * Liest Time-Series-Daten aus InfluxDB 1.11 für einen abgeschlossenen
 * k6-Lauf. Wird vom Frontend-Endpoint `/api/test-runs/{id}/time-series`
 * aufgerufen, um die echte Ist-Lastkurve zu rendern.
 *
 * k6 schreibt unter dem Measurement `vus` einen Datenpunkt pro
 * Sekunde (Standard-`summaryTrendStats`-Intervall). Wir lesen diese
 * Punkte per InfluxQL und liefern sie als flaches Array zurück —
 * der Frontend-SVG-Renderer braucht keine Query-Semantik.
 *
 * InfluxDB-v1 unterstützt keine Authorization-Header, sondern
 * erwartet HTTP Basic Auth in Form von `?u=<user>&p=<password>` als
 * Query-Parameter. Wenn InfluxDB nicht erreichbar ist oder die
 * Datenbank noch leer ist, geben wir ein leeres Array zurück, statt
 * einen 5xx zu erzeugen — die Ramp-Grafik zeigt dann nur die
 * Soll-Linie, was ein klares Signal ist.
 */
@Service
class InfluxDbTimeSeriesReader(
    private val properties: InfluxDbProperties,
    private val restTemplate: RestTemplate,
) : TimeSeriesReader {
    /**
     * Liefert VU-Werte (Anzahl aktiver Virtual Users) pro Sekunde für
     * den Lauf mit der ID [runId]. k6 schreibt das Measurement `vus`
     * automatisch; wir filtern auf das `run_id`-Tag, das das Backend
     * beim k6-Start setzt, damit parallele oder alte Läufe sich
     * nicht vermischen.
     *
     * @return sortiert nach Zeit aufsteigend, leere Liste bei Fehler
     */
    override fun readVusOverTime(
        runId: String,
        startedAt: String,
        finishedAt: String,
    ): List<TimeSeriesPoint> {
        val start = parseInstant(startedAt) ?: return emptyList()
        val stop = parseInstant(finishedAt) ?: Instant.now()
        val startNanos = start.epochSecond
        val stopNanos = stop.epochSecond
        val influxql =
            """
            SELECT value FROM vus WHERE run_id = '${escape(runId)}' AND time >= ${startNanos}s AND time <= ${stopNanos}s ORDER BY time ASC
            """.trimIndent()
        return queryInfluxQL(influxql)
    }

    /**
     * Liefert HTTP-Requests-pro-Sekunde als Time-Series. k6 schreibt
     * das in InfluxDB-v1 als Measurement `http_reqs` mit dem Feld
     * `value` (Anzahl). Wir liefern diese Counters, weil die Y-Achse
     * dann RPS-konsistent ist.
     */
    override fun readRequestsPerSecond(
        runId: String,
        startedAt: String,
        finishedAt: String,
    ): List<TimeSeriesPoint> {
        val start = parseInstant(startedAt) ?: return emptyList()
        val stop = parseInstant(finishedAt) ?: Instant.now()
        val startNanos = start.epochSecond
        val stopNanos = stop.epochSecond
        val influxql =
            """
            SELECT value FROM http_reqs WHERE run_id = '${escape(runId)}' AND time >= ${startNanos}s AND time <= ${stopNanos}s ORDER BY time ASC
            """.trimIndent()
        return queryInfluxQL(influxql)
    }

    /**
     * Führt eine InfluxQL-Query gegen InfluxDB-v1 aus und gibt die
     * Zeitstempel + Wert-Paare als TimeSeriesPoints zurück. Die
     * Authentifizierung erfolgt per HTTP-Basic-Auth via Query-Param.
     */
    private fun queryInfluxQL(influxql: String): List<TimeSeriesPoint> {
        val uri =
            URI.create(
                "${properties.url.trimEnd('/')}/query" +
                    "?db=${properties.bucket}" +
                    "&u=${properties.user}" +
                    "&p=${properties.token}" +
                    "&q=${java.net.URLEncoder.encode(influxql, Charsets.UTF_8)}",
            )
        return try {
            val response =
                restTemplate.exchange(
                    uri,
                    HttpMethod.GET,
                    HttpEntity<String>(HttpHeaders().apply { accept = listOf(org.springframework.http.MediaType.APPLICATION_JSON) }),
                    String::class.java,
                )
            parseInfluxQLJson(response.body.orEmpty())
        } catch (exception: Exception) {
            logger.warn("InfluxDB-Query fehlgeschlagen (uri={}): {}", uri, exception.message)
            emptyList()
        }
    }

    /**
     * Sehr simpler InfluxDB-v1-JSON-Parser. InfluxDB-v1 liefert
     * Antworten im JSON-Format:
     *   { "results": [{ "statement_id": 0, "series": [{ "name": "vus", "columns": ["time", "value"], "values": [[ts, 1], ...] }] }] }
     * Wir lesen nur `time` + `value` und ignorieren alles andere, um
     * eine Abhängigkeit auf eine InfluxDB-spezifische Bibliothek zu
     * vermeiden.
     */
    private fun parseInfluxQLJson(json: String): List<TimeSeriesPoint> {
        if (json.isBlank()) return emptyList()
        val mapper =
            com.fasterxml.jackson.databind
                .ObjectMapper()
        val root =
            try {
                mapper.readTree(json)
            } catch (_: Exception) {
                return emptyList()
            }
        val results = root.path("results")
        if (!results.isArray) return emptyList()
        val points = mutableListOf<TimeSeriesPoint>()
        for (result in results) {
            val series = result.path("series")
            if (!series.isArray) continue
            for (s in series) {
                val columns = s.path("columns")
                val values = s.path("values")
                if (!columns.isArray || !values.isArray) continue
                val timeIndex = (0 until columns.size()).firstOrNull { columns[it].asText() == "time" } ?: continue
                val valueIndex = (0 until columns.size()).firstOrNull { columns[it].asText() == "value" } ?: continue
                for (row in values) {
                    if (!row.isArray || row.size() <= maxOf(timeIndex, valueIndex)) continue
                    val time = row[timeIndex].asText()
                    val value = row[valueIndex].asDouble()
                    points.add(TimeSeriesPoint(time = time, value = value))
                }
            }
        }
        return points
    }

    private fun parseInstant(value: String?): Instant? =
        try {
            if (value.isNullOrBlank()) null else Instant.parse(value)
        } catch (_: Exception) {
            null
        }

    private fun escape(value: String): String = value.replace("'", "\\'").replace("\n", " ")

    private companion object {
        val logger = LoggerFactory.getLogger(InfluxDbTimeSeriesReader::class.java)
    }
}

data class TimeSeriesPoint(
    val time: String,
    val value: Number,
)

/**
 * Abstraktion über die Time-Series-Quelle. Wird vom REST-Controller
 * injiziert, damit Tests einen Fake einsetzen können, ohne einen
 * echten InfluxDB-Server hochfahren zu müssen. Die Produktiv-
 * Implementierung ist [InfluxDbTimeSeriesReader].
 */
interface TimeSeriesReader {
    fun readVusOverTime(
        runId: String,
        startedAt: String,
        finishedAt: String,
    ): List<TimeSeriesPoint>

    fun readRequestsPerSecond(
        runId: String,
        startedAt: String,
        finishedAt: String,
    ): List<TimeSeriesPoint>
}

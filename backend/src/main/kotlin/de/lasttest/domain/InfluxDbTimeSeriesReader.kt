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
 * Reads time-series data from InfluxDB 1.11 for a completed k6 run.
 * Invoked by the frontend endpoint `/api/test-runs/{id}/time-series`
 * to render the actual measured load curve.
 *
 * k6 writes one data point per second under the `vus` measurement
 * (default `summaryTrendStats` interval). We read those points via
 * InfluxQL and return them as a flat array — the frontend SVG
 * renderer does not need query semantics.
 *
 * InfluxDB v1 does not support the `Authorization` header. It expects
 * HTTP Basic Auth in the form `?u=<user>&p=<password>` as query
 * parameters. If InfluxDB is unreachable or the database is still
 * empty, we return an empty array instead of a 5xx — the ramp chart
 * then shows only the target line, which is a clear signal.
 */
@Service
class InfluxDbTimeSeriesReader(
    private val properties: InfluxDbProperties,
    private val restTemplate: RestTemplate,
) : TimeSeriesReader {
    /**
     * Returns the VU values (number of active virtual users) per second
     * for the run with ID [runId]. k6 writes the `vus` measurement
     * automatically; we filter on the `run_id` tag that the backend
     * sets when k6 starts, so that parallel or older runs do not mix in.
     *
     * @return sorted by time ascending, empty list on error
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
     * Returns HTTP requests per second as a time series. k6 writes
     * this in InfluxDB v1 as the `http_reqs` measurement with the
     * `value` field (count). We return these counters so that the
     * Y-axis is consistently RPS.
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
     * Runs an InfluxQL query against InfluxDB v1 and returns the
     * timestamp + value pairs as TimeSeriesPoints. Authentication is
     * performed via HTTP Basic Auth through query parameters.
     */
    internal fun queryInfluxQL(influxql: String): List<TimeSeriesPoint> {
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
            logger.warn("InfluxDB query failed (uri={}): {}", uri, exception.message)
            emptyList()
        }
    }

    /**
     * Very simple InfluxDB v1 JSON parser. InfluxDB v1 returns
     * responses in the JSON format:
     *   { "results": [{ "statement_id": 0, "series": [{ "name": "vus", "columns": ["time", "value"], "values": [[ts, 1], ...] }] }] }
     * We only read `time` + `value` and ignore everything else to
     * avoid a dependency on an InfluxDB-specific library.
     */
    internal fun parseInfluxQLJson(json: String): List<TimeSeriesPoint> {
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

    internal fun parseInstant(value: String?): Instant? =
        try {
            if (value.isNullOrBlank()) null else Instant.parse(value)
        } catch (_: Exception) {
            null
        }

    internal fun escape(value: String): String = value.replace("'", "\\'").replace("\n", " ")

    private companion object {
        val logger = LoggerFactory.getLogger(InfluxDbTimeSeriesReader::class.java)
    }
}

data class TimeSeriesPoint(
    val time: String,
    val value: Number,
)

/**
 * Abstraction over the time-series source. Injected by the REST
 * controller so that tests can plug in a fake without having to
 * spin up a real InfluxDB server. The production implementation is
 * [InfluxDbTimeSeriesReader].
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

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

@Service
class InfluxDbTimeSeriesReader(
    private val properties: InfluxDbProperties,
    private val restTemplate: RestTemplate,
) : TimeSeriesReader {
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

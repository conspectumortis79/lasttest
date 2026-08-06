package de.lasttest.domain

import de.lasttest.config.InfluxDbProperties
import org.junit.jupiter.api.Test
import org.springframework.http.HttpMethod
import org.springframework.http.MediaType
import org.springframework.test.web.client.MockRestServiceServer
import org.springframework.test.web.client.match.MockRestRequestMatchers.method
import org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo
import org.springframework.test.web.client.response.MockRestResponseCreators.withException
import org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess
import org.springframework.web.client.RestTemplate
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class InfluxDbTimeSeriesReaderTest {
    private val properties =
        InfluxDbProperties(
            url = "http://influxdb.test:8086",
            bucket = "k6",
            user = "k6-writer",
            token = "test-password",
            enabled = true,
        )

    @Test
    fun `parseInfluxQLJson returns empty list for blank input`() {
        val reader = reader()
        assertTrue(reader.parseInfluxQLJson("").isEmpty())
        assertTrue(reader.parseInfluxQLJson("   ").isEmpty())
    }

    @Test
    fun `parseInfluxQLJson returns empty list for invalid JSON`() {
        val reader = reader()
        assertTrue(reader.parseInfluxQLJson("not-a-json").isEmpty())
    }

    @Test
    fun `parseInfluxQLJson returns empty list when results key is missing`() {
        val reader = reader()
        val json = """{"foo":"bar"}"""
        assertTrue(reader.parseInfluxQLJson(json).isEmpty())
    }

    @Test
    fun `parseInfluxQLJson skips result entries that have no series array`() {
        val reader = reader()
        val json = """{"results":[{"statement_id":0}]}"""
        assertTrue(reader.parseInfluxQLJson(json).isEmpty())
    }

    @Test
    fun `parseInfluxQLJson skips series with columns but no values array`() {
        val reader = reader()
        val json = """{"results":[{"series":[{"columns":["time","value"]}]}]}"""
        assertTrue(reader.parseInfluxQLJson(json).isEmpty())
    }

    @Test
    fun `parseInfluxQLJson skips series with values but no columns array`() {
        val reader = reader()
        val json = """{"results":[{"series":[{"values":[["t",1]]}]}]}"""
        assertTrue(reader.parseInfluxQLJson(json).isEmpty())
    }

    @Test
    fun `parseInfluxQLJson skips series where only the time column is missing`() {
        val reader = reader()
        val json = """{"results":[{"series":[{"columns":["foo","value"],"values":[[1,2]]}]}]}"""
        assertTrue(reader.parseInfluxQLJson(json).isEmpty())
    }

    @Test
    fun `parseInfluxQLJson skips series where only the value column is missing`() {
        val reader = reader()
        val json = """{"results":[{"series":[{"columns":["time","foo"],"values":[["t",2]]}]}]}"""
        assertTrue(reader.parseInfluxQLJson(json).isEmpty())
    }

    @Test
    fun `parseInfluxQLJson parses a valid InfluxQL JSON response into time-series points`() {
        val reader = reader()
        val json =
            """
            {"results":[{"statement_id":0,"series":[
              {"columns":["time","value"],"values":[
                ["2026-08-04T16:50:00Z",1],
                ["2026-08-04T16:50:01Z",5],
                ["2026-08-04T16:50:02Z",12]
              ]}
            ]}]}
            """.trimIndent()
        val points = reader.parseInfluxQLJson(json)
        assertEquals(3, points.size)
        assertEquals("2026-08-04T16:50:00Z", points[0].time)
        assertEquals(1, points[0].value.toInt())
        assertEquals("2026-08-04T16:50:02Z", points[2].time)
        assertEquals(12, points[2].value.toInt())
    }

    @Test
    fun `parseInfluxQLJson handles swapped column order`() {
        val reader = reader()
        val json = """{"results":[{"series":[{"columns":["value","time"],"values":[[42,"t1"]]}]}]}"""
        val points = reader.parseInfluxQLJson(json)
        assertEquals(1, points.size)
        assertEquals("t1", points[0].time)
        assertEquals(42, points[0].value.toInt())
    }

    @Test
    fun `parseInfluxQLJson skips rows that are too short to contain the value column`() {
        val reader = reader()
        val json = """{"results":[{"series":[{"columns":["time","value"],"values":[["t1"]]}]}]}"""
        assertTrue(reader.parseInfluxQLJson(json).isEmpty())
    }

    @Test
    fun `parseInfluxQLJson handles series with an empty values array`() {
        val reader = reader()
        val json = """{"results":[{"series":[{"columns":["time","value"],"values":[]}]}]}"""
        assertTrue(reader.parseInfluxQLJson(json).isEmpty())
    }

    @Test
    fun `parseInfluxQLJson skips row entries that are not arrays`() {
        val reader = reader()
        val json = """{"results":[{"series":[{"columns":["time","value"],"values":["not-an-array"]}]}]}"""
        assertTrue(reader.parseInfluxQLJson(json).isEmpty())
    }

    @Test
    fun `parseInstant returns null for null, blank, or invalid input`() {
        val reader = reader()
        assertEquals(null, reader.parseInstant(null))
        assertEquals(null, reader.parseInstant(""))
        assertEquals(null, reader.parseInstant("   "))
        assertEquals(null, reader.parseInstant("not-a-timestamp"))
    }

    @Test
    fun `parseInstant returns the Instant for a valid ISO-8601 timestamp`() {
        val reader = reader()
        val instant = assertNotNull(reader.parseInstant("2026-08-04T16:50:00Z"))
        // Reference point: 2026-08-04T16:50:00Z is 1785862200 epoch seconds.
        // We assert the parsed instant is a deterministic future point in time
        // to keep the test stable across clocks (e.g. CI containers).
        assertEquals(1785862200L, instant.epochSecond)
    }

    @Test
    fun `escape replaces single quotes and newlines to keep the InfluxQL safe`() {
        val reader = reader()
        assertEquals("a\\'b c", reader.escape("a'b\nc"))
        assertEquals("clean", reader.escape("clean"))
    }

    @Test
    fun `readVusOverTime returns an empty list when startedAt is invalid`() {
        val reader = reader()
        assertTrue(reader.readVusOverTime("run-1", "not-a-timestamp", "also-not").isEmpty())
    }

    @Test
    fun `readVusOverTime falls back to Instant now when finishedAt is invalid`() {
        val restTemplate = RestTemplate()
        val server = MockRestServiceServer.createServer(restTemplate)
        server
            .expect(requestTo(org.hamcrest.Matchers.containsString("/query")))
            .andRespond(withSuccess("""{"results":[]}""", MediaType.APPLICATION_JSON))

        val reader = InfluxDbTimeSeriesReader(properties, restTemplate)
        val points =
            reader.readVusOverTime("run-1", "2026-08-04T16:50:00Z", "not-a-timestamp")
        server.verify()
        assertTrue(points.isEmpty())
    }

    @Test
    fun `readRequestsPerSecond returns an empty list when startedAt is invalid`() {
        val reader = reader()
        assertTrue(reader.readRequestsPerSecond("run-1", "not-a-timestamp", "also-not").isEmpty())
    }

    @Test
    fun `readRequestsPerSecond falls back to Instant now when finishedAt is invalid`() {
        val restTemplate = RestTemplate()
        val server = MockRestServiceServer.createServer(restTemplate)
        server
            .expect(requestTo(org.hamcrest.Matchers.containsString("http_reqs")))
            .andRespond(withSuccess("""{"results":[]}""", MediaType.APPLICATION_JSON))

        val reader = InfluxDbTimeSeriesReader(properties, restTemplate)
        val points =
            reader.readRequestsPerSecond("run-1", "2026-08-04T16:50:00Z", "not-a-timestamp")
        server.verify()
        assertTrue(points.isEmpty())
    }

    @Test
    fun `readVusOverTime returns parsed points for a valid time range`() {
        val restTemplate = RestTemplate()
        val server = MockRestServiceServer.createServer(restTemplate)
        val json =
            """{"results":[{"series":[{"columns":["time","value"],"values":[["2026-08-04T16:50:00Z",7]]}]}]}"""
        server
            .expect(requestTo(org.hamcrest.Matchers.containsString("/query")))
            .andExpect(method(HttpMethod.GET))
            .andRespond(withSuccess(json, MediaType.APPLICATION_JSON))

        val reader = InfluxDbTimeSeriesReader(properties, restTemplate)
        val points =
            reader.readVusOverTime("run-1", "2026-08-04T16:50:00Z", "2026-08-04T16:52:00Z")
        server.verify()
        assertEquals(1, points.size)
        assertEquals(7, points[0].value.toInt())
    }

    @Test
    fun `readVusOverTime escapes single quotes in the runId to keep the InfluxQL safe`() {
        val restTemplate = RestTemplate()
        val server = MockRestServiceServer.createServer(restTemplate)
        server
            .expect(requestTo(org.hamcrest.Matchers.containsString("evil%5C%27")))
            .andRespond(withSuccess("""{"results":[]}""", MediaType.APPLICATION_JSON))

        val reader = InfluxDbTimeSeriesReader(properties, restTemplate)
        val points =
            reader.readVusOverTime("evil'", "2026-08-04T16:50:00Z", "2026-08-04T16:52:00Z")
        server.verify()
        assertTrue(points.isEmpty())
    }

    @Test
    fun `readVusOverTime returns an empty list when the RestTemplate throws`() {
        val restTemplate = RestTemplate()
        val server = MockRestServiceServer.createServer(restTemplate)
        server
            .expect(requestTo(org.hamcrest.Matchers.containsString("/query")))
            .andRespond(withException(java.io.IOException("connection refused")))

        val reader = InfluxDbTimeSeriesReader(properties, restTemplate)
        val points =
            reader.readVusOverTime("run-1", "2026-08-04T16:50:00Z", "2026-08-04T16:52:00Z")
        server.verify()
        assertTrue(points.isEmpty())
    }

    @Test
    fun `readRequestsPerSecond uses the http_reqs measurement and returns parsed points`() {
        val restTemplate = RestTemplate()
        val server = MockRestServiceServer.createServer(restTemplate)
        val json =
            """{"results":[{"series":[{"columns":["time","value"],"values":[["2026-08-04T16:50:00Z",100]]}]}]}"""
        server
            .expect(requestTo(org.hamcrest.Matchers.containsString("http_reqs")))
            .andRespond(withSuccess(json, MediaType.APPLICATION_JSON))

        val reader = InfluxDbTimeSeriesReader(properties, restTemplate)
        val points =
            reader.readRequestsPerSecond("run-1", "2026-08-04T16:50:00Z", "2026-08-04T16:52:00Z")
        server.verify()
        assertEquals(1, points.size)
        assertEquals(100, points[0].value.toInt())
    }

    @Test
    fun `disabled properties still allow constructing the reader and querying the backend`() {
        val restTemplate = RestTemplate()
        val server = MockRestServiceServer.createServer(restTemplate)
        server
            .expect(requestTo(org.hamcrest.Matchers.containsString("/query")))
            .andRespond(withSuccess("""{"results":[]}""", MediaType.APPLICATION_JSON))

        val disabled = InfluxDbProperties(enabled = false)
        val reader = InfluxDbTimeSeriesReader(disabled, restTemplate)
        val points =
            reader.readVusOverTime("run-1", "2026-08-04T16:50:00Z", "2026-08-04T16:52:00Z")
        server.verify()
        assertEquals(false, disabled.enabled)
        assertTrue(points.isEmpty())
    }

    @Test
    fun `queryInfluxQL forwards the trimmed URL and returns parsed points`() {
        val restTemplate = RestTemplate()
        val server = MockRestServiceServer.createServer(restTemplate)
        val json =
            """{"results":[{"series":[{"columns":["time","value"],"values":[["t",3]]}]}]}"""
        server
            .expect(requestTo(org.hamcrest.Matchers.containsString("/query?")))
            .andRespond(withSuccess(json, MediaType.APPLICATION_JSON))

        val reader = InfluxDbTimeSeriesReader(properties, restTemplate)
        val points = reader.queryInfluxQL("SELECT value FROM vus")
        server.verify()
        assertEquals(1, points.size)
        assertEquals(3, points[0].value.toInt())
    }

    @Test
    fun `queryInfluxQL returns an empty list when the RestTemplate throws`() {
        val restTemplate = RestTemplate()
        val server = MockRestServiceServer.createServer(restTemplate)
        server
            .expect(requestTo(org.hamcrest.Matchers.containsString("/query")))
            .andRespond(withException(java.net.ConnectException("boom")))

        val reader = InfluxDbTimeSeriesReader(properties, restTemplate)
        val points = reader.queryInfluxQL("SELECT 1")
        server.verify()
        assertTrue(points.isEmpty())
    }

    @Test
    fun `queryInfluxQL parses an empty response body as an empty list`() {
        val restTemplate = RestTemplate()
        val server = MockRestServiceServer.createServer(restTemplate)
        server
            .expect(requestTo(org.hamcrest.Matchers.containsString("/query")))
            .andRespond(withSuccess("", MediaType.APPLICATION_JSON))

        val reader = InfluxDbTimeSeriesReader(properties, restTemplate)
        val points = reader.queryInfluxQL("SELECT 1")
        server.verify()
        assertTrue(points.isEmpty())
    }

    private fun reader(): InfluxDbTimeSeriesReader = InfluxDbTimeSeriesReader(properties, RestTemplate())
}

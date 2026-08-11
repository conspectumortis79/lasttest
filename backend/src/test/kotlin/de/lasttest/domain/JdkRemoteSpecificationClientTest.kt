package de.lasttest.domain

import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

class JdkRemoteSpecificationClientTest {
    private lateinit var server: HttpServer
    private lateinit var baseUrl: String

    @BeforeTest
    fun startServer() {
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.start()
        baseUrl = "http://127.0.0.1:${server.address.port}"
    }

    @AfterTest
    fun stopServer() {
        server.stop(0)
    }

    @Test
    fun `returns the response status and content type for a direct json document`() {
        val hits = AtomicInteger(0)
        server.createContext("/openapi.json") { exchange ->
            hits.incrementAndGet()
            exchange.responseHeaders.add("Content-Type", "application/json; charset=utf-8")
            val body = """{"openapi":"3.0.3","info":{"title":"From Real Server"}}"""
            exchange.sendResponseHeaders(200, body.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(body.toByteArray()) }
        }

        val response = JdkRemoteSpecificationClient().get("$baseUrl/openapi.json")

        assertEquals(200, response.statusCode)
        assertEquals("application/json; charset=utf-8", response.contentType)
        assertEquals("""{"openapi":"3.0.3","info":{"title":"From Real Server"}}""", response.body)
        assertEquals("$baseUrl/openapi.json", response.finalUrl)
        assertEquals(1, hits.get())
    }

    @Test
    fun `returns the response without a Content-Type header when the server omits it`() {
        server.createContext("/raw") { exchange ->
            val body = "openapi: 3.0.3\ninfo:\n  title: No Content Type\n"
            exchange.sendResponseHeaders(200, body.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(body.toByteArray()) }
        }

        val response = JdkRemoteSpecificationClient().get("$baseUrl/raw")

        assertEquals(200, response.statusCode)
        assertNull(response.contentType)
        assertTrue(response.body.startsWith("openapi:"))
    }

    @Test
    fun `reports the final URL after a redirect to the same host`() {
        server.createContext("/redirect") { exchange ->
            exchange.responseHeaders.add("Location", "$baseUrl/openapi.json")
            exchange.sendResponseHeaders(302, -1L)
            exchange.close()
        }
        server.createContext("/openapi.json") { exchange ->
            exchange.responseHeaders.add("Content-Type", "application/json")
            val body = """{"openapi":"3.0.3"}"""
            exchange.sendResponseHeaders(200, body.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(body.toByteArray()) }
        }

        val response = JdkRemoteSpecificationClient().get("$baseUrl/redirect")

        assertEquals(200, response.statusCode)
        assertEquals("$baseUrl/openapi.json", response.finalUrl)
    }

    @Test
    fun `rejects responses that exceed the maximum size limit`() {
        server.createContext("/huge") { exchange ->
            val oversized = "x".repeat(OVERSIZE_BYTES)
            exchange.sendResponseHeaders(200, oversized.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(oversized.toByteArray()) }
        }

        val exception = assertFailsWith<RemoteSpecificationFetchException> { JdkRemoteSpecificationClient().get("$baseUrl/huge") }
        assertTrue(exception.message!!.contains("zu große"))
    }

    @Test
    fun `secondary constructor with a custom SSL context uses that context for the request`() {
        val customContext =
            javax.net.ssl.SSLContext
                .getDefault()
        val client = JdkRemoteSpecificationClient(customContext)
        server.createContext("/json") { exchange ->
            exchange.responseHeaders.add("Content-Type", "application/json")
            val body = """{"openapi":"3.0.3"}"""
            exchange.sendResponseHeaders(200, body.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(body.toByteArray()) }
        }

        val response = client.get("$baseUrl/json")

        assertEquals(200, response.statusCode)
        assertEquals("""{"openapi":"3.0.3"}""", response.body)
    }

    private companion object {
        const val OVERSIZE_BYTES: Int = 5 * 1024 * 1024 + 1
    }
}

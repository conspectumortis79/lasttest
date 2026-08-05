package de.lasttest.domain

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

class HttpRemoteSpecificationFetcherTest {
    @Test
    fun `returns the JSON body when the URL serves an application json document`() {
        val client =
            FakeRemoteSpecificationClient(
                mapOf(
                    "https://api.example.com/openapi.json" to
                        remoteResponse(
                            url = "https://api.example.com/openapi.json",
                            statusCode = 200,
                            contentType = "application/json",
                            body = """{"openapi":"3.0.3","info":{"title":"Direct"}}""",
                        ),
                ),
            )
        val fetcher = HttpRemoteSpecificationFetcher(client)

        val result = fetcher.fetch("https://api.example.com/openapi.json")

        assertEquals("""{"openapi":"3.0.3","info":{"title":"Direct"}}""", result.content)
        assertEquals("https://api.example.com/openapi.json", result.resolvedUrl)
        assertEquals("direct", result.source)
    }

    @Test
    fun `returns the YAML body when the URL serves a yaml document`() {
        val client =
            FakeRemoteSpecificationClient(
                mapOf(
                    "https://api.example.com/openapi.yaml" to
                        remoteResponse(
                            url = "https://api.example.com/openapi.yaml",
                            statusCode = 200,
                            contentType = "application/yaml",
                            body = "openapi: 3.0.3\ninfo:\n  title: Direct YAML\n",
                        ),
                ),
            )
        val fetcher = HttpRemoteSpecificationFetcher(client)

        val result = fetcher.fetch("https://api.example.com/openapi.yaml")

        assertEquals("openapi: 3.0.3\ninfo:\n  title: Direct YAML\n", result.content)
        assertEquals("direct", result.source)
    }

    @Test
    fun `detects YAML for text plain content with an openapi declaration`() {
        val client =
            FakeRemoteSpecificationClient(
                mapOf(
                    "https://api.example.com/openapi.txt" to
                        remoteResponse(
                            url = "https://api.example.com/openapi.txt",
                            statusCode = 200,
                            contentType = "text/plain; charset=utf-8",
                            body = "openapi: 3.0.3\ninfo:\n  title: Plain\n",
                        ),
                ),
            )
        val fetcher = HttpRemoteSpecificationFetcher(client)

        val result = fetcher.fetch("https://api.example.com/openapi.txt")

        assertEquals("direct", result.source)
        assertTrue(result.content.startsWith("openapi:"))
    }

    @Test
    fun `detects JSON content when the content type is missing but the body is JSON`() {
        val client =
            FakeRemoteSpecificationClient(
                mapOf(
                    "https://api.example.com/missing" to
                        remoteResponse(
                            url = "https://api.example.com/missing",
                            statusCode = 200,
                            contentType = null,
                            body = """{"openapi":"3.0.3"}""",
                        ),
                ),
            )
        val fetcher = HttpRemoteSpecificationFetcher(client)

        assertEquals("direct", fetcher.fetch("https://api.example.com/missing").source)
    }

    @Test
    fun `detects JSON content when the body starts with an array`() {
        val client =
            FakeRemoteSpecificationClient(
                mapOf(
                    "https://api.example.com/array" to
                        remoteResponse(
                            url = "https://api.example.com/array",
                            statusCode = 200,
                            contentType = null,
                            body = "[1,2,3]",
                        ),
                ),
            )
        val fetcher = HttpRemoteSpecificationFetcher(client)

        assertEquals("direct", fetcher.fetch("https://api.example.com/array").source)
    }

    @Test
    fun `detects swagger 2 by the swagger prefix in the body`() {
        val client =
            FakeRemoteSpecificationClient(
                mapOf(
                    "https://api.example.com/swagger" to
                        remoteResponse(
                            url = "https://api.example.com/swagger",
                            statusCode = 200,
                            contentType = null,
                            body = "swagger: \"2.0\"\ninfo:\n  title: Older\n",
                        ),
                ),
            )
        val fetcher = HttpRemoteSpecificationFetcher(client)

        assertEquals("direct", fetcher.fetch("https://api.example.com/swagger").source)
    }

    @Test
    fun `detects openapi on a later line when the body has leading whitespace`() {
        val client =
            FakeRemoteSpecificationClient(
                mapOf(
                    "https://api.example.com/leading" to
                        remoteResponse(
                            url = "https://api.example.com/leading",
                            statusCode = 200,
                            contentType = null,
                            body = "\n  openapi: 3.0.3\ninfo:\n  title: Spaced\n",
                        ),
                ),
            )
        val fetcher = HttpRemoteSpecificationFetcher(client)

        assertEquals("direct", fetcher.fetch("https://api.example.com/leading").source)
    }

    @Test
    fun `detects openapi on a later line past a leading prefix`() {
        val client =
            FakeRemoteSpecificationClient(
                mapOf(
                    "https://api.example.com/later-openapi" to
                        remoteResponse(
                            url = "https://api.example.com/later-openapi",
                            statusCode = 200,
                            contentType = null,
                            body = "# vendor extension\nopenapi: 3.0.3\ninfo:\n  title: Inline\n",
                        ),
                ),
            )
        val fetcher = HttpRemoteSpecificationFetcher(client)

        assertEquals("direct", fetcher.fetch("https://api.example.com/later-openapi").source)
    }

    @Test
    fun `detects swagger on a later line past a leading prefix`() {
        val client =
            FakeRemoteSpecificationClient(
                mapOf(
                    "https://api.example.com/later-swagger" to
                        remoteResponse(
                            url = "https://api.example.com/later-swagger",
                            statusCode = 200,
                            contentType = null,
                            body = "# vendor extension\nswagger: \"2.0\"\ninfo:\n  title: Inline\n",
                        ),
                ),
            )
        val fetcher = HttpRemoteSpecificationFetcher(client)

        assertEquals("direct", fetcher.fetch("https://api.example.com/later-swagger").source)
    }

    @Test
    fun `detects swagger on a later line when the body has leading whitespace`() {
        val client =
            FakeRemoteSpecificationClient(
                mapOf(
                    "https://api.example.com/leading-swagger" to
                        remoteResponse(
                            url = "https://api.example.com/leading-swagger",
                            statusCode = 200,
                            contentType = null,
                            body = "\n  swagger: \"2.0\"\ninfo:\n  title: Spaced\n",
                        ),
                ),
            )
        val fetcher = HttpRemoteSpecificationFetcher(client)

        assertEquals("direct", fetcher.fetch("https://api.example.com/leading-swagger").source)
    }

    @Test
    fun `rejects unknown content types with a null content type and reports the unknown content type`() {
        val client =
            FakeRemoteSpecificationClient(
                mapOf(
                    "https://api.example.com/binary" to
                        remoteResponse(
                            url = "https://api.example.com/binary",
                            statusCode = 200,
                            contentType = null,
                            body = "<html>not really</html>",
                        ),
                ),
            )
        val fetcher = HttpRemoteSpecificationFetcher(client)

        val exception = assertFailsWith<RemoteSpecificationFetchException> { fetcher.fetch("https://api.example.com/binary") }
        assertTrue(exception.message!!.contains("unbekannt"))
    }

    @Test
    fun `rejects unknown content types with an error message`() {
        val client =
            FakeRemoteSpecificationClient(
                mapOf(
                    "https://api.example.com/binary" to
                        remoteResponse(
                            url = "https://api.example.com/binary",
                            statusCode = 200,
                            contentType = "application/octet-stream",
                            body = "<html>not really</html>",
                        ),
                ),
            )
        val fetcher = HttpRemoteSpecificationFetcher(client)

        val exception = assertFailsWith<RemoteSpecificationFetchException> { fetcher.fetch("https://api.example.com/binary") }
        assertTrue(exception.message!!.contains("unerwarteten Inhaltstyp"))
    }

    @Test
    fun `reports non-2xx responses from the initial URL`() {
        val client =
            FakeRemoteSpecificationClient(
                mapOf(
                    "https://api.example.com/missing" to
                        remoteResponse(
                            url = "https://api.example.com/missing",
                            statusCode = 404,
                            contentType = "text/plain",
                            body = "not found",
                        ),
                ),
            )
        val fetcher = HttpRemoteSpecificationFetcher(client)

        val exception = assertFailsWith<RemoteSpecificationFetchException> { fetcher.fetch("https://api.example.com/missing") }
        assertTrue(exception.message!!.contains("HTTP 404"))
    }

    @Test
    fun `treats HTTP 199 as a non-success status code on the initial URL`() {
        val client =
            FakeRemoteSpecificationClient(
                mapOf(
                    "https://api.example.com/old" to
                        remoteResponse(
                            url = "https://api.example.com/old",
                            statusCode = 199,
                            contentType = "text/plain",
                            body = "old",
                        ),
                ),
            )
        val fetcher = HttpRemoteSpecificationFetcher(client)

        val exception = assertFailsWith<RemoteSpecificationFetchException> { fetcher.fetch("https://api.example.com/old") }
        assertTrue(exception.message!!.contains("HTTP 199"))
    }

    @Test
    fun `treats HTTP 199 as a non-success status code on the resolved spec URL`() {
        val html =
            """
            <script>
              window.ui = SwaggerUIBundle({ url: "/v3/api-docs" })
            </script>
            """.trimIndent()
        val client =
            FakeRemoteSpecificationClient(
                mapOf(
                    "https://api.example.com/swagger-ui" to
                        remoteResponse(
                            url = "https://api.example.com/swagger-ui",
                            statusCode = 200,
                            contentType = "text/html",
                            body = html,
                        ),
                    "https://api.example.com/v3/api-docs" to
                        remoteResponse(
                            url = "https://api.example.com/v3/api-docs",
                            statusCode = 199,
                            contentType = "application/json",
                            body = "old",
                        ),
                ),
            )
        val fetcher = HttpRemoteSpecificationFetcher(client)

        val exception = assertFailsWith<RemoteSpecificationFetchException> { fetcher.fetch("https://api.example.com/swagger-ui") }
        assertTrue(exception.message!!.contains("HTTP 199"))
    }

    @Test
    fun `follows a Swagger UI URL to the documented spec URL`() {
        val html =
            """
            <!DOCTYPE html>
            <html>
            <head><title>Swagger UI</title></head>
            <body>
              <script>
                window.ui = SwaggerUIBundle({
                  url: "/v3/api-docs",
                  dom_id: "#swagger-ui"
                })
              </script>
            </body>
            </html>
            """.trimIndent()
        val client =
            FakeRemoteSpecificationClient(
                mapOf(
                    "https://api.example.com/swagger-ui/index.html" to
                        remoteResponse(
                            url = "https://api.example.com/swagger-ui/index.html",
                            statusCode = 200,
                            contentType = "text/html; charset=utf-8",
                            body = html,
                        ),
                    "https://api.example.com/v3/api-docs" to
                        remoteResponse(
                            url = "https://api.example.com/v3/api-docs",
                            statusCode = 200,
                            contentType = "application/json",
                            body = """{"openapi":"3.0.3","info":{"title":"Resolved"}}""",
                        ),
                ),
            )
        val fetcher = HttpRemoteSpecificationFetcher(client)

        val result = fetcher.fetch("https://api.example.com/swagger-ui/index.html")

        assertEquals("swagger-ui", result.source)
        assertEquals("https://api.example.com/v3/api-docs", result.resolvedUrl)
        assertEquals("""{"openapi":"3.0.3","info":{"title":"Resolved"}}""", result.content)
    }

    @Test
    fun `follows the first URL in a Swagger UI urls array configuration`() {
        val html =
            """
            <script>
              window.ui = SwaggerUIBundle({
                urls: [
                  { name: "First", url: "https://api.example.com/openapi-first.json" },
                  { name: "Second", url: "https://api.example.com/openapi-second.json" }
                ]
              })
            </script>
            """.trimIndent()
        val client =
            FakeRemoteSpecificationClient(
                mapOf(
                    "https://api.example.com/swagger-ui/index.html" to
                        remoteResponse(
                            url = "https://api.example.com/swagger-ui/index.html",
                            statusCode = 200,
                            contentType = "text/html",
                            body = html,
                        ),
                    "https://api.example.com/openapi-first.json" to
                        remoteResponse(
                            url = "https://api.example.com/openapi-first.json",
                            statusCode = 200,
                            contentType = "application/json",
                            body = """{"openapi":"3.0.3","info":{"title":"First"}}""",
                        ),
                ),
            )
        val fetcher = HttpRemoteSpecificationFetcher(client)

        val result = fetcher.fetch("https://api.example.com/swagger-ui/index.html")

        assertEquals("https://api.example.com/openapi-first.json", result.resolvedUrl)
    }

    @Test
    fun `ignores urls array when entries are not plausible URLs and falls back to the single url entry`() {
        val html =
            """
            <script>
              window.ui = SwaggerUIBundle({
                urls: [
                  { name: "Broken", url: "" },
                  { name: "Missing" }
                ],
                url: "/v3/api-docs",
                deepLinking: true
              })
            </script>
            """.trimIndent()
        val client =
            FakeRemoteSpecificationClient(
                mapOf(
                    "https://api.example.com/swagger-ui" to
                        remoteResponse(
                            url = "https://api.example.com/swagger-ui",
                            statusCode = 200,
                            contentType = "text/html",
                            body = html,
                        ),
                    "https://api.example.com/v3/api-docs" to
                        remoteResponse(
                            url = "https://api.example.com/v3/api-docs",
                            statusCode = 200,
                            contentType = "application/json",
                            body = """{"openapi":"3.0.3"}""",
                        ),
                ),
            )
        val fetcher = HttpRemoteSpecificationFetcher(client)

        val result = fetcher.fetch("https://api.example.com/swagger-ui")

        assertEquals("https://api.example.com/v3/api-docs", result.resolvedUrl)
    }

    @Test
    fun `keeps the placeholder when no url entry is present in the Swagger UI config`() {
        val html =
            """
            <script>
              window.ui = SwaggerUIBundle({
                dom_id: "#swagger-ui",
                deepLinking: true
              })
            </script>
            """.trimIndent()
        val client =
            FakeRemoteSpecificationClient(
                mapOf(
                    "https://api.example.com/swagger-ui" to
                        remoteResponse(
                            url = "https://api.example.com/swagger-ui",
                            statusCode = 200,
                            contentType = "text/html",
                            body = html,
                        ),
                ),
            )
        val fetcher = HttpRemoteSpecificationFetcher(client)

        val exception = assertFailsWith<RemoteSpecificationFetchException> { fetcher.fetch("https://api.example.com/swagger-ui") }
        assertTrue(exception.message!!.contains("keine erkennbare"))
    }

    @Test
    fun `rejects cross-origin URLs in the Swagger UI configuration`() {
        val html =
            """
            <script>
              window.ui = SwaggerUIBundle({ url: "https://attacker.example.com/openapi.json" })
            </script>
            """.trimIndent()
        val client =
            FakeRemoteSpecificationClient(
                mapOf(
                    "https://api.example.com/swagger-ui" to
                        remoteResponse(
                            url = "https://api.example.com/swagger-ui",
                            statusCode = 200,
                            contentType = "text/html",
                            body = html,
                        ),
                ),
            )
        val fetcher = HttpRemoteSpecificationFetcher(client)

        val exception = assertFailsWith<RemoteSpecificationFetchException> { fetcher.fetch("https://api.example.com/swagger-ui") }
        assertTrue(exception.message!!.contains("andere Domain"))
    }

    @Test
    fun `reports non-2xx responses from the resolved spec URL`() {
        val html =
            """
            <script>
              window.ui = SwaggerUIBundle({ url: "/v3/api-docs" })
            </script>
            """.trimIndent()
        val client =
            FakeRemoteSpecificationClient(
                mapOf(
                    "https://api.example.com/swagger-ui" to
                        remoteResponse(
                            url = "https://api.example.com/swagger-ui",
                            statusCode = 200,
                            contentType = "text/html",
                            body = html,
                        ),
                    "https://api.example.com/v3/api-docs" to
                        remoteResponse(
                            url = "https://api.example.com/v3/api-docs",
                            statusCode = 500,
                            contentType = "text/plain",
                            body = "boom",
                        ),
                ),
            )
        val fetcher = HttpRemoteSpecificationFetcher(client)

        val exception = assertFailsWith<RemoteSpecificationFetchException> { fetcher.fetch("https://api.example.com/swagger-ui") }
        assertTrue(exception.message!!.contains("HTTP 500"))
    }

    @Test
    fun `reports empty spec responses from the resolved spec URL`() {
        val html =
            """
            <script>
              window.ui = SwaggerUIBundle({ url: "/v3/api-docs" })
            </script>
            """.trimIndent()
        val client =
            FakeRemoteSpecificationClient(
                mapOf(
                    "https://api.example.com/swagger-ui" to
                        remoteResponse(
                            url = "https://api.example.com/swagger-ui",
                            statusCode = 200,
                            contentType = "text/html",
                            body = html,
                        ),
                    "https://api.example.com/v3/api-docs" to
                        remoteResponse(
                            url = "https://api.example.com/v3/api-docs",
                            statusCode = 200,
                            contentType = "application/json",
                            body = "",
                        ),
                ),
            )
        val fetcher = HttpRemoteSpecificationFetcher(client)

        val exception = assertFailsWith<RemoteSpecificationFetchException> { fetcher.fetch("https://api.example.com/swagger-ui") }
        assertTrue(exception.message!!.contains("leere Antwort"))
    }

    @Test
    fun `falls back to probing common Swagger UI endpoints when the HTML has no configuration`() {
        val client =
            FakeRemoteSpecificationClient(
                mapOf(
                    "https://api.example.com/swagger-ui" to
                        remoteResponse(
                            url = "https://api.example.com/swagger-ui",
                            statusCode = 200,
                            contentType = "text/html",
                            body = "<html><body><div id='swagger-ui'></div></body></html>",
                        ),
                    "https://api.example.com/v3/api-docs" to
                        remoteResponse(
                            url = "https://api.example.com/v3/api-docs",
                            statusCode = 404,
                            contentType = "application/json",
                            body = "missing",
                        ),
                    "https://api.example.com/v3/api-docs.yaml" to
                        remoteResponse(
                            url = "https://api.example.com/v3/api-docs.yaml",
                            statusCode = 404,
                            contentType = "application/yaml",
                            body = "missing",
                        ),
                    "https://api.example.com/v2/api-docs" to
                        remoteResponse(
                            url = "https://api.example.com/v2/api-docs",
                            statusCode = 404,
                            contentType = "application/json",
                            body = "missing",
                        ),
                    "https://api.example.com/swagger.json" to
                        remoteResponse(
                            url = "https://api.example.com/swagger.json",
                            statusCode = 200,
                            contentType = "application/json",
                            body = """{"openapi":"3.0.3","info":{"title":"Probed"}}""",
                        ),
                ),
            )
        val fetcher = HttpRemoteSpecificationFetcher(client)

        val result = fetcher.fetch("https://api.example.com/swagger-ui")

        assertEquals("swagger-ui", result.source)
        assertEquals("https://api.example.com/swagger.json", result.resolvedUrl)
    }

    @Test
    fun `probes common endpoints under the swagger-ui path when the page URL contains a deeper path`() {
        val client =
            FakeRemoteSpecificationClient(
                mapOf(
                    "https://api.example.com/swagger-ui/index.html" to
                        remoteResponse(
                            url = "https://api.example.com/swagger-ui/index.html",
                            statusCode = 200,
                            contentType = "text/html",
                            body = "<html><body><div id='swagger-ui'></div></body></html>",
                        ),
                    "https://api.example.com/swagger-ui/v3/api-docs" to
                        remoteResponse(
                            url = "https://api.example.com/swagger-ui/v3/api-docs",
                            statusCode = 200,
                            contentType = "application/json",
                            body = """{"openapi":"3.0.3","info":{"title":"Deep Probed"}}""",
                        ),
                ),
            )
        val fetcher = HttpRemoteSpecificationFetcher(client)

        val result = fetcher.fetch("https://api.example.com/swagger-ui/index.html")

        assertEquals("swagger-ui", result.source)
        assertEquals("https://api.example.com/swagger-ui/v3/api-docs", result.resolvedUrl)
    }

    @Test
    fun `treats an HTTP 300 response as a non-success status code on the initial URL`() {
        val client =
            FakeRemoteSpecificationClient(
                mapOf(
                    "https://api.example.com/swagger-ui" to
                        remoteResponse(
                            url = "https://api.example.com/swagger-ui",
                            statusCode = 300,
                            contentType = "text/html",
                            body = "<html><body></body></html>",
                        ),
                ),
            )
        val fetcher = HttpRemoteSpecificationFetcher(client)

        val exception = assertFailsWith<RemoteSpecificationFetchException> { fetcher.fetch("https://api.example.com/swagger-ui") }
        assertTrue(exception.message!!.contains("HTTP 300"))
    }

    @Test
    fun `rejects the URL when probing common endpoints does not find any document`() {
        val client =
            FakeRemoteSpecificationClient(
                mapOf(
                    "https://api.example.com/swagger-ui" to
                        remoteResponse(
                            url = "https://api.example.com/swagger-ui",
                            statusCode = 200,
                            contentType = "text/html",
                            body = "<html><body><div id='swagger-ui'></div></body></html>",
                        ),
                    "https://api.example.com/v3/api-docs" to
                        remoteResponse(
                            url = "https://api.example.com/v3/api-docs",
                            statusCode = 404,
                            contentType = "application/json",
                            body = "missing",
                        ),
                    "https://api.example.com/v3/api-docs.yaml" to
                        remoteResponse(
                            url = "https://api.example.com/v3/api-docs.yaml",
                            statusCode = 404,
                            contentType = "application/yaml",
                            body = "missing",
                        ),
                    "https://api.example.com/v2/api-docs" to
                        remoteResponse(
                            url = "https://api.example.com/v2/api-docs",
                            statusCode = 404,
                            contentType = "application/json",
                            body = "missing",
                        ),
                    "https://api.example.com/swagger.json" to
                        remoteResponse(
                            url = "https://api.example.com/swagger.json",
                            statusCode = 404,
                            contentType = "application/json",
                            body = "missing",
                        ),
                    "https://api.example.com/swagger.yaml" to
                        remoteResponse(
                            url = "https://api.example.com/swagger.yaml",
                            statusCode = 404,
                            contentType = "application/yaml",
                            body = "missing",
                        ),
                    "https://api.example.com/openapi.json" to
                        remoteResponse(
                            url = "https://api.example.com/openapi.json",
                            statusCode = 404,
                            contentType = "application/json",
                            body = "missing",
                        ),
                    "https://api.example.com/openapi.yaml" to
                        remoteResponse(
                            url = "https://api.example.com/openapi.yaml",
                            statusCode = 404,
                            contentType = "application/yaml",
                            body = "missing",
                        ),
                ),
            )
        val fetcher = HttpRemoteSpecificationFetcher(client)

        val exception = assertFailsWith<RemoteSpecificationFetchException> { fetcher.fetch("https://api.example.com/swagger-ui") }
        assertTrue(exception.message!!.contains("keine erkennbare"))
    }

    @Test
    fun `treats blank responses from probing common endpoints as missing documents`() {
        val client =
            FakeRemoteSpecificationClient(
                mapOf(
                    "https://api.example.com/swagger-ui" to
                        remoteResponse(
                            url = "https://api.example.com/swagger-ui",
                            statusCode = 200,
                            contentType = "text/html",
                            body = "<html><body><div id='swagger-ui'></div></body></html>",
                        ),
                    "https://api.example.com/v3/api-docs" to
                        remoteResponse(
                            url = "https://api.example.com/v3/api-docs",
                            statusCode = 200,
                            contentType = "application/json",
                            body = "",
                        ),
                    "https://api.example.com/v3/api-docs.yaml" to
                        remoteResponse(
                            url = "https://api.example.com/v3/api-docs.yaml",
                            statusCode = 200,
                            contentType = "application/yaml",
                            body = " ",
                        ),
                    "https://api.example.com/v2/api-docs" to
                        remoteResponse(
                            url = "https://api.example.com/v2/api-docs",
                            statusCode = 200,
                            contentType = "application/json",
                            body = " ",
                        ),
                    "https://api.example.com/swagger.json" to
                        remoteResponse(
                            url = "https://api.example.com/swagger.json",
                            statusCode = 200,
                            contentType = "application/json",
                            body = "  ",
                        ),
                    "https://api.example.com/swagger.yaml" to
                        remoteResponse(
                            url = "https://api.example.com/swagger.yaml",
                            statusCode = 200,
                            contentType = "application/yaml",
                            body = "  ",
                        ),
                    "https://api.example.com/openapi.json" to
                        remoteResponse(
                            url = "https://api.example.com/openapi.json",
                            statusCode = 200,
                            contentType = "application/json",
                            body = "  ",
                        ),
                    "https://api.example.com/openapi.yaml" to
                        remoteResponse(
                            url = "https://api.example.com/openapi.yaml",
                            statusCode = 200,
                            contentType = "application/yaml",
                            body = "  ",
                        ),
                ),
            )
        val fetcher = HttpRemoteSpecificationFetcher(client)

        val exception = assertFailsWith<RemoteSpecificationFetchException> { fetcher.fetch("https://api.example.com/swagger-ui") }
        assertTrue(exception.message!!.contains("keine erkennbare"))
    }

    @Test
    fun `treats HTTP 199 and 300 responses from probing common endpoints as missing documents`() {
        val client =
            FakeRemoteSpecificationClient(
                mapOf(
                    "https://api.example.com/swagger-ui" to
                        remoteResponse(
                            url = "https://api.example.com/swagger-ui",
                            statusCode = 200,
                            contentType = "text/html",
                            body = "<html><body><div id='swagger-ui'></div></body></html>",
                        ),
                    "https://api.example.com/v3/api-docs" to
                        remoteResponse(
                            url = "https://api.example.com/v3/api-docs",
                            statusCode = 199,
                            contentType = "application/json",
                            body = "old",
                        ),
                    "https://api.example.com/v3/api-docs.yaml" to
                        remoteResponse(
                            url = "https://api.example.com/v3/api-docs.yaml",
                            statusCode = 300,
                            contentType = "application/yaml",
                            body = "old",
                        ),
                    "https://api.example.com/v2/api-docs" to
                        remoteResponse(
                            url = "https://api.example.com/v2/api-docs",
                            statusCode = 199,
                            contentType = "application/json",
                            body = "old",
                        ),
                    "https://api.example.com/swagger.json" to
                        remoteResponse(
                            url = "https://api.example.com/swagger.json",
                            statusCode = 300,
                            contentType = "application/json",
                            body = "old",
                        ),
                    "https://api.example.com/swagger.yaml" to
                        remoteResponse(
                            url = "https://api.example.com/swagger.yaml",
                            statusCode = 199,
                            contentType = "application/yaml",
                            body = "old",
                        ),
                    "https://api.example.com/openapi.json" to
                        remoteResponse(
                            url = "https://api.example.com/openapi.json",
                            statusCode = 300,
                            contentType = "application/json",
                            body = "old",
                        ),
                    "https://api.example.com/openapi.yaml" to
                        remoteResponse(
                            url = "https://api.example.com/openapi.yaml",
                            statusCode = 299,
                            contentType = "application/yaml",
                            body = "",
                        ),
                ),
            )
        val fetcher = HttpRemoteSpecificationFetcher(client)

        val exception = assertFailsWith<RemoteSpecificationFetchException> { fetcher.fetch("https://api.example.com/swagger-ui") }
        assertTrue(exception.message!!.contains("keine erkennbare"))
    }

    @Test
    fun `tolerates network failures while probing common endpoints`() {
        val initial =
            remoteResponse(
                url = "https://api.example.com/swagger-ui",
                statusCode = 200,
                contentType = "text/html",
                body = "<html><body><div id='swagger-ui'></div></body></html>",
            )
        val client = ThrowingOnProbeClient(initialResponse = initial)

        val fetcher = HttpRemoteSpecificationFetcher(client)

        val exception = assertFailsWith<RemoteSpecificationFetchException> { fetcher.fetch("https://api.example.com/swagger-ui") }
        assertTrue(exception.message!!.contains("keine erkennbare"))
    }

    @Test
    fun `rejects the URL when the swagger-ui page redirects to a host-less URL`() {
        val initial =
            remoteResponse(
                url = "https://api.example.com/swagger-ui",
                statusCode = 200,
                contentType = "text/html",
                body = "<html><body><div id='swagger-ui'></div></body></html>",
            )
        val client = FixedUrlClient(initialResponse = initial, finalUrl = "https:///redirect")

        val fetcher = HttpRemoteSpecificationFetcher(client)

        val exception = assertFailsWith<RemoteSpecificationFetchException> { fetcher.fetch("https://api.example.com/swagger-ui") }
        assertTrue(exception.message!!.contains("keine erkennbare"))
    }

    @Test
    fun `validateUrl rejects empty input`() {
        val fetcher = HttpRemoteSpecificationFetcher(FakeRemoteSpecificationClient(emptyMap()))
        val exception = assertFailsWith<RemoteSpecificationFetchException> { fetcher.validateUrl("   ") }
        assertTrue(exception.message!!.contains("keine URL"))
    }

    @Test
    fun `validateUrl rejects URLs longer than the maximum`() {
        val fetcher = HttpRemoteSpecificationFetcher(FakeRemoteSpecificationClient(emptyMap()))
        val tooLong = "https://api.example.com/" + "a".repeat(HttpRemoteSpecificationFetcher.MAX_URL_LENGTH)
        val exception = assertFailsWith<RemoteSpecificationFetchException> { fetcher.validateUrl(tooLong) }
        assertTrue(exception.message!!.contains("zu lang"))
    }

    @Test
    fun `validateUrl rejects URLs with an invalid syntax`() {
        val fetcher = HttpRemoteSpecificationFetcher(FakeRemoteSpecificationClient(emptyMap()))
        val exception = assertFailsWith<RemoteSpecificationFetchException> { fetcher.validateUrl("not a url") }
        assertTrue(exception.message!!.contains("ungültig"))
    }

    @Test
    fun `validateUrl rejects non-http schemes`() {
        val fetcher = HttpRemoteSpecificationFetcher(FakeRemoteSpecificationClient(emptyMap()))
        val exception = assertFailsWith<RemoteSpecificationFetchException> { fetcher.validateUrl("ftp://example.com/spec.json") }
        assertTrue(exception.message!!.contains("http://"))
    }

    @Test
    fun `validateUrl rejects schemes that are missing entirely`() {
        val fetcher = HttpRemoteSpecificationFetcher(FakeRemoteSpecificationClient(emptyMap()))
        val exception = assertFailsWith<RemoteSpecificationFetchException> { fetcher.validateUrl("example.com/spec.json") }
        assertTrue(exception.message!!.contains("http://"))
    }

    @Test
    fun `validateUrl rejects URLs without a host`() {
        val fetcher = HttpRemoteSpecificationFetcher(FakeRemoteSpecificationClient(emptyMap()))
        val exception = assertFailsWith<RemoteSpecificationFetchException> { fetcher.validateUrl("https:///path") }
        assertTrue(exception.message!!.contains("keinen Host"))
    }

    @Test
    fun `validateUrl rejects URLs that contain credentials`() {
        val fetcher = HttpRemoteSpecificationFetcher(FakeRemoteSpecificationClient(emptyMap()))
        val exception = assertFailsWith<RemoteSpecificationFetchException> { fetcher.validateUrl("https://user:pass@example.com/openapi.json") }
        assertTrue(exception.message!!.contains("Zugangsdaten"))
    }

    @Test
    fun `validateUrl accepts http URLs`() {
        val fetcher = HttpRemoteSpecificationFetcher(FakeRemoteSpecificationClient(emptyMap()))
        assertEquals("http://api.example.com/openapi.json", fetcher.validateUrl("http://api.example.com/openapi.json"))
    }

    @Test
    fun `validateUrl returns the trimmed URL on success`() {
        val fetcher = HttpRemoteSpecificationFetcher(FakeRemoteSpecificationClient(emptyMap()))
        assertEquals("https://api.example.com/openapi.json", fetcher.validateUrl("  https://api.example.com/openapi.json  "))
    }

    @Test
    fun `extractSpecUrlFromHtml returns null when the page is not a Swagger UI document`() {
        val fetcher = HttpRemoteSpecificationFetcher(FakeRemoteSpecificationClient(emptyMap()))
        assertNull(fetcher.extractSpecUrlFromHtml("<html><body>nothing</body></html>", "https://api.example.com/"))
    }

    @Test
    fun `extractSpecUrlFromHtml returns the first URL from a urls array entry`() {
        val html =
            """
            <script>
              window.ui = SwaggerUIBundle({
                urls: [
                  { name: "First", url: "https://api.example.com/openapi-first.json" }
                ]
              })
            </script>
            """.trimIndent()
        val fetcher = HttpRemoteSpecificationFetcher(FakeRemoteSpecificationClient(emptyMap()))
        assertEquals("https://api.example.com/openapi-first.json", fetcher.extractSpecUrlFromHtml(html, "https://api.example.com/swagger-ui"))
    }

    @Test
    fun `extractSpecUrlFromHtml returns the URL from a single url entry`() {
        val html =
            """
            <script>
              window.ui = SwaggerUIBundle({ url: "/v3/api-docs" })
            </script>
            """.trimIndent()
        val fetcher = HttpRemoteSpecificationFetcher(FakeRemoteSpecificationClient(emptyMap()))
        assertEquals("/v3/api-docs", fetcher.extractSpecUrlFromHtml(html, "https://api.example.com/swagger-ui"))
    }

    @Test
    fun `isPlausibleSpecUrl accepts absolute paths and ignores other shapes`() {
        val fetcher = HttpRemoteSpecificationFetcher(FakeRemoteSpecificationClient(emptyMap()))
        assertEquals(false, fetcher.isPlausibleSpecUrl(""))
        assertEquals(false, fetcher.isPlausibleSpecUrl("//cdn.example.com/spec.json"))
        assertEquals(false, fetcher.isPlausibleSpecUrl("relative.json"))
        assertEquals(true, fetcher.isPlausibleSpecUrl("/v3/api-docs"))
        assertEquals(true, fetcher.isPlausibleSpecUrl("http://x/y"))
        assertEquals(true, fetcher.isPlausibleSpecUrl("https://x/y"))
    }

    @Test
    fun `resolveAgainst returns absolute URLs unchanged and resolves relative paths against the base`() {
        val fetcher = HttpRemoteSpecificationFetcher(FakeRemoteSpecificationClient(emptyMap()))
        assertEquals("https://other.example.com/spec.json", fetcher.resolveAgainst("https://other.example.com/spec.json", "https://api.example.com/swagger-ui"))
        assertEquals("http://other.example.com/spec.json", fetcher.resolveAgainst("http://other.example.com/spec.json", "https://api.example.com/swagger-ui"))
        assertEquals("https://api.example.com/v3/api-docs", fetcher.resolveAgainst("/v3/api-docs", "https://api.example.com/swagger-ui/index.html"))
        assertEquals("https://api.example.com/v3/api-docs", fetcher.resolveAgainst("v3/api-docs", "https://api.example.com/swagger-ui"))
    }

    @Test
    fun `resolveAgainst returns the input when the base URL cannot be parsed`() {
        val fetcher = HttpRemoteSpecificationFetcher(FakeRemoteSpecificationClient(emptyMap()))
        assertEquals("/v3/api-docs", fetcher.resolveAgainst("/v3/api-docs", "not a url"))
    }

    @Test
    fun `baseUrlOf returns null for invalid URLs and URLs without scheme or host`() {
        val fetcher = HttpRemoteSpecificationFetcher(FakeRemoteSpecificationClient(emptyMap()))
        assertNull(fetcher.baseUrlOf("not a url"))
        assertNull(fetcher.baseUrlOf("/path/only"))
        assertNull(fetcher.baseUrlOf("https://"))
        assertNull(fetcher.baseUrlOf("https:///path"))
    }

    @Test
    fun `baseUrlOf omits default ports and keeps custom ports and implicit port`() {
        val fetcher = HttpRemoteSpecificationFetcher(FakeRemoteSpecificationClient(emptyMap()))
        assertEquals("https://api.example.com", fetcher.baseUrlOf("https://api.example.com:443/v3/api-docs"))
        assertEquals("http://api.example.com", fetcher.baseUrlOf("http://api.example.com:80/v3/api-docs"))
        assertEquals("https://api.example.com:8443", fetcher.baseUrlOf("https://api.example.com:8443/v3/api-docs"))
        assertEquals("https://api.example.com", fetcher.baseUrlOf("https://api.example.com/v3/api-docs"))
        assertEquals("http://api.example.com:1234", fetcher.baseUrlOf("http://api.example.com:1234/v3/api-docs"))
    }

    @Test
    fun `isSameOrigin compares the scheme host and port of two URLs`() {
        val fetcher = HttpRemoteSpecificationFetcher(FakeRemoteSpecificationClient(emptyMap()))
        assertEquals(true, fetcher.isSameOrigin("https://api.example.com/a", "https://api.example.com/b"))
        assertEquals(true, fetcher.isSameOrigin("HTTPS://API.EXAMPLE.COM/a", "https://api.example.com/b"))
        assertEquals(false, fetcher.isSameOrigin("https://api.example.com/a", "https://api.example.com:8443/a"))
        assertEquals(false, fetcher.isSameOrigin("https://api.example.com/a", "https://other.example.com/a"))
        assertEquals(false, fetcher.isSameOrigin("not a url", "https://api.example.com"))
        assertEquals(false, fetcher.isSameOrigin("https://api.example.com", "not a url"))
    }

    @Test
    fun `isHtmlContentType matches text html and application xhtml`() {
        val fetcher = HttpRemoteSpecificationFetcher(FakeRemoteSpecificationClient(emptyMap()))
        assertEquals(true, fetcher.isHtmlContentType("text/html; charset=utf-8"))
        assertEquals(true, fetcher.isHtmlContentType("application/xhtml+xml"))
        assertEquals(false, fetcher.isHtmlContentType("application/json"))
    }

    @Test
    fun `isJsonContentType matches application json and vendor JSON variants`() {
        val fetcher = HttpRemoteSpecificationFetcher(FakeRemoteSpecificationClient(emptyMap()))
        assertEquals(true, fetcher.isJsonContentType("application/json"))
        assertEquals(true, fetcher.isJsonContentType("application/vnd.api+json"))
        assertEquals(true, fetcher.isJsonContentType("text/json"))
        assertEquals(false, fetcher.isJsonContentType("application/yaml"))
    }

    @Test
    fun `isYamlContentType matches application yaml and text yaml and vendor YAML variants`() {
        val fetcher = HttpRemoteSpecificationFetcher(FakeRemoteSpecificationClient(emptyMap()))
        assertEquals(true, fetcher.isYamlContentType("application/yaml"))
        assertEquals(true, fetcher.isYamlContentType("application/x-yaml"))
        assertEquals(true, fetcher.isYamlContentType("text/yaml"))
        assertEquals(true, fetcher.isYamlContentType("text/x-yaml"))
        assertEquals(true, fetcher.isYamlContentType("application/vnd.api+yaml"))
        assertEquals(false, fetcher.isYamlContentType("application/json"))
    }

    private fun remoteResponse(
        url: String,
        statusCode: Int,
        contentType: String?,
        body: String,
    ): RemoteSpecificationResponse =
        RemoteSpecificationResponse(
            statusCode = statusCode,
            contentType = contentType,
            body = body,
            finalUrl = url,
        )

    private class FakeRemoteSpecificationClient(
        private val responses: Map<String, RemoteSpecificationResponse>,
    ) : RemoteSpecificationClient {
        override fun get(url: String): RemoteSpecificationResponse = responses[url] ?: throw IllegalStateException("Unexpected URL: $url")
    }

    private class ThrowingOnProbeClient(
        private val initialResponse: RemoteSpecificationResponse,
    ) : RemoteSpecificationClient {
        override fun get(url: String): RemoteSpecificationResponse {
            if (url == initialResponse.finalUrl) return initialResponse
            throw java.io.IOException("Connection failed for $url")
        }
    }

    private class FixedUrlClient(
        private val initialResponse: RemoteSpecificationResponse,
        private val finalUrl: String,
    ) : RemoteSpecificationClient {
        override fun get(url: String): RemoteSpecificationResponse =
            if (url == initialResponse.finalUrl) initialResponse.copy(finalUrl = finalUrl) else throw IllegalStateException("Unexpected URL: $url")
    }
}

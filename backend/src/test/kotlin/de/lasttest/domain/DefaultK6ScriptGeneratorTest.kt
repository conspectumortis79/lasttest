package de.lasttest.domain

import de.lasttest.api.ApiOperation
import de.lasttest.api.ApiParameter
import de.lasttest.api.ImportedSpecification
import de.lasttest.api.OperationConfiguration
import de.lasttest.api.ParameterValue
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class DefaultK6ScriptGeneratorTest {
    private val generator = DefaultK6ScriptGenerator()
    private val specification =
        ImportedSpecification(
            title = "API",
            version = "1",
            baseUrl = "",
            operations =
                listOf(
                    ApiOperation(
                        operationId = "getPet",
                        method = "GET",
                        path = "/pets/{id}",
                        summary = "",
                        destructive = false,
                        parameters =
                            listOf(
                                ApiParameter("id", "path", true, 42),
                                ApiParameter("expand", "query", false, "owner"),
                                ApiParameter("X-Tenant", "header", false, "demo"),
                                ApiParameter("session", "cookie", false, "abc"),
                            ),
                        requestBodyExample = null,
                    ),
                    ApiOperation("deletePet", "DELETE", "/pets/{id}", "", true, listOf(ApiParameter("id", "path", true, 42)), null),
                    ApiOperation(
                        operationId = "createPet",
                        method = "POST",
                        path = "/pets",
                        summary = "",
                        destructive = true,
                        parameters = emptyList(),
                        requestBodyExample = mapOf("name" to "Fido"),
                        hasRequestBody = true,
                        requestBodyRequired = true,
                    ),
                ),
        )

    @Test
    fun `generates iterations and omits duration when useIterations is true`() {
        val script = generator.generate(specification, "https://example.test", setOf("getPet"), emptyList(), 250, 10, useIterations = true)

        assertTrue(script.contains("vus: 250"))
        assertTrue(script.contains("iterations: 250"))
        assertTrue(!script.contains("duration: '10s'"))
        assertTrue(script.contains("/pets/42?expand=owner"))
    }

    @Test
    fun `defaults useIterations to false and keeps the duration block`() {
        val script = generator.generate(specification, "https://example.test", setOf("getPet"), emptyList(), 2, 15)

        assertTrue(script.contains("duration: '15s'"))
        assertTrue(!script.contains("iterations:"))
    }

    @Test
    fun `wraps load options in a k6 v2 scenario block with the right executor`() {
        val durationScript = generator.generate(specification, "https://example.test", setOf("getPet"), emptyList(), 2, 15)
        val iterationsScript = generator.generate(specification, "https://example.test", setOf("getPet"), emptyList(), 250, 10, useIterations = true)

        // k6 v1+ requires scenarios; the top-level vus/duration shortcuts
        // were removed in v2 alongside gracefulStop. Make sure we emit the
        // canonical scenario-based form so k6 does not warn about unknown
        // top-level fields.
        for (script in listOf(durationScript, iterationsScript)) {
            assertTrue(script.contains("scenarios:"))
            assertTrue(script.contains("default:"))
            assertTrue(script.contains("gracefulStop: '0s'"))
        }

        assertTrue(durationScript.contains("executor: 'constant-vus'"))
        assertTrue(durationScript.contains("duration: '15s'"))
        assertTrue(!durationScript.contains("executor: 'shared-iterations'"))

        assertTrue(iterationsScript.contains("executor: 'shared-iterations'"))
        assertTrue(iterationsScript.contains("iterations: 250"))
        assertTrue(!iterationsScript.contains("executor: 'constant-vus'"))
    }

    @Test
    fun `generates selected operation with tags and thresholds`() {
        val script = generator.generate(specification, "https://example.test", setOf("getPet"), emptyList(), 2, 15)

        assertTrue(script.contains("vus: 2"))
        assertTrue(script.contains("duration: '15s'"))
        assertTrue(script.contains("gracefulStop: '0s'"))
        assertTrue(script.contains("/pets/42?expand=owner"))
        assertTrue(script.contains("\"operationId\":\"getPet\""))
        assertTrue(!script.contains("deletePet"))
    }

    @Test
    fun `accepts thirty thousand virtual users`() {
        val script = generator.generate(specification, "https://example.test", setOf("getPet"), emptyList(), 30000, 10)

        assertTrue(script.contains("vus: 30000"))
    }

    @Test
    fun `rejects virtual users above thirty thousand with the documented message`() {
        val exception =
            assertFailsWith<IllegalArgumentException> {
                generator.generate(specification, "https://example.test", setOf("getPet"), emptyList(), 30001, 10)
            }

        assertTrue(exception.message!!.contains("zwischen 1 und 30000"))
    }

    @Test
    fun `uses endpoint parameter and bearer overrides`() {
        val configuration =
            OperationConfiguration(
                operationId = "getPet",
                parameterValues =
                    listOf(
                        ParameterValue("id", "path", "7"),
                        ParameterValue("expand", "query", "full details"),
                        ParameterValue("X-Tenant", "header", "customer-a"),
                        ParameterValue("session", "cookie", "session value"),
                    ),
                bearerToken = "secret-token",
            )

        val script = generator.generate(specification, "https://example.test", setOf("getPet"), listOf(configuration), 1, 10)

        assertTrue(script.contains("/pets/7?expand=full%20details"))
        assertTrue(script.contains("\"X-Tenant\":\"customer-a\""))
        assertTrue(script.contains("\"Cookie\":\"session=session%20value\""))
        assertTrue(script.contains("\"Authorization\":\"Bearer secret-token\""))
    }

    @Test
    fun `uses an editable JSON request body`() {
        val configuration = OperationConfiguration(operationId = "createPet", requestBodyJson = """{"name":"Luna"}""")

        val script = generator.generate(specification, "https://example.test", setOf("createPet"), listOf(configuration), 1, 10)

        assertTrue(script.contains("JSON.stringify({\"name\":\"Luna\"})"))
        assertTrue(script.contains("\"Content-Type\":\"application/json\""))
    }

    @Test
    fun `omits a cleared optional parameter`() {
        val configuration =
            OperationConfiguration(
                operationId = "getPet",
                parameterValues = listOf(ParameterValue("expand", "query", "")),
            )

        val script = generator.generate(specification, "https://example.test", setOf("getPet"), listOf(configuration), 1, 10)

        assertTrue(!script.contains("expand="))
    }

    @Test
    fun `rejects malformed JSON request body`() {
        val configuration = OperationConfiguration(operationId = "createPet", requestBodyJson = "{invalid}")

        assertFailsWith<IllegalArgumentException> {
            generator.generate(specification, "https://example.test", setOf("createPet"), listOf(configuration), 1, 10)
        }
    }

    @Test
    fun `supports http targets empty selections delete calls and documented request bodies`() {
        val script = generator.generate(specification, "http://example.test", emptySet(), emptyList(), 1, 3600)

        assertContains(script, "vus: 1")
        assertContains(script, "duration: '3600s'")
        assertContains(script, "http.del")
        assertContains(script, "JSON.stringify({\"name\":\"Fido\"})")
    }

    @Test
    fun `validates lower virtual user and duration boundaries`() {
        assertFailsWith<IllegalArgumentException> { generator.generate(specification, "https://example.test", setOf("getPet"), emptyList(), 0, 10) }
        assertFailsWith<IllegalArgumentException> { generator.generate(specification, "https://example.test", setOf("getPet"), emptyList(), 1, 0) }
        assertFailsWith<IllegalArgumentException> { generator.generate(specification, "https://example.test", setOf("getPet"), emptyList(), 1, 3601) }
    }

    @Test
    fun `rejects duplicate and unknown operation configurations`() {
        val configuration = OperationConfiguration("getPet")
        assertFailsWith<IllegalArgumentException> {
            generator.generate(specification, "https://example.test", setOf("getPet"), listOf(configuration, configuration), 1, 10)
        }
        assertFailsWith<IllegalArgumentException> {
            generator.generate(specification, "https://example.test", setOf("getPet"), listOf(OperationConfiguration("deletePet")), 1, 10)
        }
        assertFailsWith<IllegalArgumentException> {
            generator.generate(specification, "https://example.test", setOf("getPet"), listOf(OperationConfiguration("missing")), 1, 10)
        }
    }

    @Test
    fun `rejects duplicate unknown and empty required parameters`() {
        val id = ParameterValue("id", "path", "7")
        assertFailsWith<IllegalArgumentException> {
            generator.generate(specification, "https://example.test", setOf("getPet"), listOf(OperationConfiguration("getPet", listOf(id, id))), 1, 10)
        }
        assertFailsWith<IllegalArgumentException> {
            generator.generate(
                specification,
                "https://example.test",
                setOf("getPet"),
                listOf(OperationConfiguration("getPet", listOf(ParameterValue("unknown", "query", "x")))),
                1,
                10,
            )
        }
        assertFailsWith<IllegalArgumentException> {
            generator.generate(
                specification,
                "https://example.test",
                setOf("getPet"),
                listOf(OperationConfiguration("getPet", listOf(ParameterValue("id", "PATH", " ")))),
                1,
                10,
            )
        }
    }

    @Test
    fun `uses a default value when a parameter has no example`() {
        val operation = ApiOperation("missingExample", "GET", "/missing", "", false, listOf(ApiParameter("value", "query", false, null)), null)
        val missingExampleSpecification = specification.copy(operations = listOf(operation))

        val script = generator.generate(missingExampleSpecification, "https://example.test", emptySet(), emptyList(), 1, 10)

        assertContains(script, "value=test")
    }

    @Test
    fun `serializes JSON nulls and parsed lists`() {
        val operation = ApiOperation("jsonList", "POST", "/json", "", true, emptyList(), null, hasRequestBody = true)
        val jsonSpecification = specification.copy(operations = listOf(operation))
        val configuration = OperationConfiguration("jsonList", requestBodyJson = "{\"nothing\":null,\"items\":[1,true]}")

        val script = generator.generate(jsonSpecification, "https://example.test", emptySet(), listOf(configuration), 1, 10)

        assertContains(script, "JSON.stringify({\"nothing\":null,\"items\":[1,true]})")
    }

    @Test
    fun `supports bearer prefix blank bearer and parameter collection examples`() {
        val collectionOperation =
            ApiOperation(
                operationId = "collections",
                method = "GET",
                path = "/collections",
                summary = "",
                destructive = false,
                parameters =
                    listOf(
                        ApiParameter("map", "query", false, mapOf("active" to true)),
                        ApiParameter("list", "query", false, listOf("a", "b")),
                        ApiParameter("array", "query", false, arrayOf(1, 2)),
                    ),
                requestBodyExample = null,
            )
        val collectionSpecification = specification.copy(operations = listOf(collectionOperation))
        val prefixed = OperationConfiguration("collections", bearerToken = "Bearer existing")
        val blank = OperationConfiguration("collections", bearerToken = " ")

        val prefixedScript = generator.generate(collectionSpecification, "https://example.test", emptySet(), listOf(prefixed), 1, 10)
        val blankScript = generator.generate(collectionSpecification, "https://example.test", emptySet(), listOf(blank), 1, 10)

        assertContains(prefixedScript, "\"Authorization\":\"Bearer existing\"")
        assertTrue(!blankScript.contains("Authorization"))
        assertContains(prefixedScript, "map=%7B%22active%22%3Atrue%7D")
        assertContains(prefixedScript, "list=%5B%22a%22%2C%22b%22%5D")
        assertContains(prefixedScript, "array=%5B1%2C2%5D")
    }

    @Test
    fun `serializes array boolean number and escaped string request bodies`() {
        val bodyOperation =
            ApiOperation(
                operationId = "escaped\\\"\b\u000c\n\r\t\u0001",
                method = "POST",
                path = "/body",
                summary = "",
                destructive = true,
                parameters = emptyList(),
                requestBodyExample = arrayOf<Any>(1, true, "line\nvalue"),
                hasRequestBody = true,
            )
        val bodySpecification = specification.copy(operations = listOf(bodyOperation))

        val script = generator.generate(bodySpecification, "https://example.test", emptySet(), emptyList(), 1, 10)

        assertContains(script, "JSON.stringify([1,true,\"line\\nvalue\"])")
        assertContains(script, "\\b\\f\\n\\r\\t\\u0001")
    }

    @Test
    fun `supports an explicitly empty optional request body`() {
        val optionalBody =
            ApiOperation("optionalBody", "POST", "/optional", "", true, emptyList(), mapOf("value" to true), hasRequestBody = true)
        val optionalSpecification = specification.copy(operations = listOf(optionalBody))
        val configuration = OperationConfiguration("optionalBody", requestBodyJson = "")

        val script = generator.generate(optionalSpecification, "https://example.test", emptySet(), listOf(configuration), 1, 10)

        assertContains(script, "null")
        assertTrue(!script.contains("Content-Type"))
    }

    @Test
    fun `rejects empty and null required request bodies`() {
        assertFailsWith<IllegalArgumentException> {
            generator.generate(specification, "https://example.test", setOf("createPet"), listOf(OperationConfiguration("createPet", requestBodyJson = "")), 1, 10)
        }
        assertFailsWith<IllegalArgumentException> {
            generator.generate(specification, "https://example.test", setOf("createPet"), listOf(OperationConfiguration("createPet", requestBodyJson = "null")), 1, 10)
        }
    }

    @Test
    fun `rejects invalid target URL`() {
        assertFailsWith<IllegalArgumentException> { generator.generate(specification, "file:///etc/passwd", emptySet(), emptyList(), 1, 10) }
    }

    @Test
    fun `rejects empty selection`() {
        assertFailsWith<IllegalArgumentException> { generator.generate(specification, "https://example.test", setOf("missing"), emptyList(), 1, 10) }
    }

    @Test
    fun `declares one counter per tracked status code plus err and other per selected operation`() {
        val script = generator.generate(specification, "https://example.test", setOf("getPet", "createPet"), emptyList(), 1, 10)

        // 19 tracked codes + err + other = 21 Counter declarations per operation.
        val trackedCodes = listOf(
            200, 201, 202, 204,
            301, 302, 304,
            400, 401, 403, 404, 409, 422, 429,
            500, 502, 503, 504,
        )
        for (operationId in listOf("getPet", "createPet")) {
            for (code in trackedCodes) {
                val metricName = "lt_status_${code}_$operationId"
                assertContains(script, "new Counter('$metricName')")
            }
            assertContains(script, "new Counter('lt_status_err_$operationId')")
            assertContains(script, "new Counter('lt_status_other_$operationId')")
        }
    }

    @Test
    fun `uses a switch statement to dispatch the response status to the right counter`() {
        val script = generator.generate(specification, "https://example.test", setOf("getPet"), emptyList(), 1, 10)

        // The status dispatch must be a switch so the generated code
        // stays linear in the number of codes and so the k6 engine can
        // fast-path consecutive identical status values.
        assertContains(script, "switch (response.status) {")
        assertContains(script, "  case 0: lt_status_err_getPet.add(1); break;")
        assertContains(script, "  case 200: lt_status_200_getPet.add(1); break;")
        assertContains(script, "  case 401: lt_status_401_getPet.add(1); break;")
        assertContains(script, "  case 429: lt_status_429_getPet.add(1); break;")
        assertContains(script, "  case 504: lt_status_504_getPet.add(1); break;")
        assertContains(script, "  default: lt_status_other_getPet.add(1);")
    }

    @Test
    fun `sanitises operation ids with invalid identifier characters in counter names`() {
        val weirdOperation =
            ApiOperation("get-pet:v2", "GET", "/pets", "", false, emptyList(), null)
        val weirdSpecification = specification.copy(operations = listOf(weirdOperation))

        val script = generator.generate(weirdSpecification, "https://example.test", setOf("get-pet:v2"), emptyList(), 1, 10)

        // Hyphens and colons must be replaced with underscores so the
        // metric name stays a valid JavaScript identifier.
        assertContains(script, "new Counter('lt_status_200_get_pet_v2')")
        assertContains(script, "new Counter('lt_status_429_get_pet_v2')")
        assertContains(script, "lt_status_err_get_pet_v2.add(1)")
        assertContains(script, "lt_status_other_get_pet_v2.add(1)")
    }

    @Test
    fun `omits status counters for unselected operations`() {
        val script = generator.generate(specification, "https://example.test", setOf("getPet"), emptyList(), 1, 10)

        // `createPet` and `deletePet` are not in the selected set, so
        // their counters must not be generated.
        assertTrue(!script.contains("lt_status_200_createPet"))
        assertTrue(!script.contains("lt_status_500_deletePet"))
        assertTrue(!script.contains("lt_status_err_createPet"))
        assertTrue(script.contains("lt_status_200_getPet"))
        assertTrue(script.contains("lt_status_err_getPet"))
    }
}

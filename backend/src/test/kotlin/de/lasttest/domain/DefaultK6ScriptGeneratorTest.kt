package de.lasttest.domain

import de.lasttest.api.ApiOperation
import de.lasttest.api.ApiParameter
import de.lasttest.api.AuthRequirement
import de.lasttest.api.ImportedSpecification
import de.lasttest.api.LoadProfile
import de.lasttest.api.LoadProfileType
import de.lasttest.api.LoadStage
import de.lasttest.api.OperationConfiguration
import de.lasttest.api.OperationPayload
import de.lasttest.api.ParameterValue
import de.lasttest.api.PayloadStrategy
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
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
                        authRequirements = listOf(AuthRequirement.Bearer("bearerAuth")),
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
                        authRequirements = listOf(AuthRequirement.Bearer("bearerAuth")),
                    ),
                ),
        )

    @Test
    fun `generates iterations and omits duration when useIterations is true`() {
        val profile = LoadProfile(type = LoadProfileType.SHARED_ITERATIONS, virtualUsers = 250, iterations = 250)
        val script = generator.generateForRun(specification, "https://example.test", "", setOf("getPet"), emptyList(), profile)

        assertTrue(script.contains("vus: 250"))
        assertTrue(script.contains("iterations: 250"))
        assertTrue(!script.contains("duration: '10s'"))
        assertTrue(script.contains("/pets/42?expand=owner"))
    }

    @Test
    fun `defaults useIterations to false and keeps the duration block`() {
        val profile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 2, durationSeconds = 15)
        val script = generator.generateForRun(specification, "https://example.test", "", setOf("getPet"), emptyList(), profile)

        assertTrue(script.contains("duration: '15s'"))
        assertTrue(!script.contains("iterations:"))
    }

    @Test
    fun `wraps load options in a k6 v2 scenario block with the right executor`() {
        val constantVUs = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 2, durationSeconds = 15)
        val sharedIterations = LoadProfile(type = LoadProfileType.SHARED_ITERATIONS, virtualUsers = 250, iterations = 250)
        val durationScript = generator.generateForRun(specification, "https://example.test", "", setOf("getPet"), emptyList(), constantVUs)
        val iterationsScript = generator.generateForRun(specification, "https://example.test", "", setOf("getPet"), emptyList(), sharedIterations)

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
        val profile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 2, durationSeconds = 15)
        val script = generator.generateForRun(specification, "https://example.test", "", setOf("getPet"), emptyList(), profile)

        assertTrue(script.contains("vus: 2"))
        assertTrue(script.contains("duration: '15s'"))
        assertTrue(script.contains("gracefulStop: '0s'"))
        assertTrue(script.contains("/pets/42?expand=owner"))
        assertTrue(script.contains("\"operationId\":\"getPet\""))
        assertTrue(!script.contains("deletePet"))
    }

    @Test
    fun `accepts thirty thousand virtual users`() {
        val profile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 30000, durationSeconds = 10)
        val script = generator.generateForRun(specification, "https://example.test", "", setOf("getPet"), emptyList(), profile)

        assertTrue(script.contains("vus: 30000"))
    }

    @Test
    fun `rejects virtual users above thirty thousand with the documented message`() {
        val profile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 30001, durationSeconds = 10)
        val exception =
            assertFailsWith<IllegalArgumentException> {
                generator.generateForRun(specification, "https://example.test", "", setOf("getPet"), emptyList(), profile)
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
        val profile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 10)

        val script = generator.generateForRun(specification, "https://example.test", "", setOf("getPet"), listOf(configuration), profile)

        assertTrue(script.contains("/pets/7?expand=full%20details"))
        assertTrue(script.contains("\"X-Tenant\":\"customer-a\""))
        assertTrue(script.contains("\"Cookie\":\"session=session%20value\""))
        assertTrue(script.contains("\"Authorization\":\"Bearer secret-token\""))
    }

    @Test
    fun `emits Basic Authorization header when operation declares basic auth and credentials are set`() {
        val basicOperation =
            ApiOperation(
                operationId = "getAdminStats",
                method = "GET",
                path = "/admin/stats",
                summary = "",
                destructive = false,
                parameters = emptyList(),
                requestBodyExample = null,
                authRequirements = listOf(AuthRequirement.Basic("basicAuth")),
            )
        val basicSpec = specification.copy(operations = listOf(basicOperation))
        val configuration =
            OperationConfiguration(
                operationId = "getAdminStats",
                bearerToken = null,
                basicAuthUsername = "alice",
                basicAuthPassword = "s3cret",
            )
        val profile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 10)

        val script = generator.generateForRun(basicSpec, "https://example.test", "", setOf("getAdminStats"), listOf(configuration), profile)

        assertContains(script, "\"Authorization\":\"Basic YWxpY2U6czNjcmV0\"")
    }

    @Test
    fun `omits Authorization header for basic auth operation when both credentials are blank`() {
        val basicOperation =
            ApiOperation(
                operationId = "getAdminStats",
                method = "GET",
                path = "/admin/stats",
                summary = "",
                destructive = false,
                parameters = emptyList(),
                requestBodyExample = null,
                authRequirements = listOf(AuthRequirement.Basic("basicAuth")),
            )
        val basicSpec = specification.copy(operations = listOf(basicOperation))
        val configuration =
            OperationConfiguration(
                operationId = "getAdminStats",
                bearerToken = null,
                basicAuthUsername = "",
                basicAuthPassword = "   ",
            )
        val profile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 10)

        val script = generator.generateForRun(basicSpec, "https://example.test", "", setOf("getAdminStats"), listOf(configuration), profile)

        assertTrue(!script.contains("Authorization"))
    }

    @Test
    fun `picks Basic when operation declares both Basic and Bearer but only Basic credentials are set`() {
        val dualOperation =
            ApiOperation(
                operationId = "whoAmI",
                method = "GET",
                path = "/whoami",
                summary = "",
                destructive = false,
                parameters = emptyList(),
                requestBodyExample = null,
                authRequirements =
                    listOf(
                        AuthRequirement.Basic("basicAuth"),
                        AuthRequirement.Bearer("bearerAuth"),
                    ),
            )
        val dualSpec = specification.copy(operations = listOf(dualOperation))
        val configuration =
            OperationConfiguration(
                operationId = "whoAmI",
                bearerToken = "abc",
                basicAuthUsername = "alice",
                basicAuthPassword = "s3cret",
            )
        val profile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 10)

        val script = generator.generateForRun(dualSpec, "https://example.test", "", setOf("whoAmI"), listOf(configuration), profile)

        assertContains(script, "\"Authorization\":\"Basic YWxpY2U6czNjcmV0\"")
        assertTrue(!script.contains("Bearer abc"))
    }

    @Test
    fun `omits Authorization header entirely when operation declares no auth`() {
        val publicOperation =
            ApiOperation(
                operationId = "publicEndpoint",
                method = "GET",
                path = "/public",
                summary = "",
                destructive = false,
                parameters = emptyList(),
                requestBodyExample = null,
            )
        val publicSpec = specification.copy(operations = listOf(publicOperation))
        val configuration =
            OperationConfiguration(
                operationId = "publicEndpoint",
                bearerToken = "should-be-ignored",
            )
        val profile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 10)

        val script = generator.generateForRun(publicSpec, "https://example.test", "", setOf("publicEndpoint"), listOf(configuration), profile)

        assertTrue(!script.contains("Authorization"))
    }

    @Test
    fun `emits the X-API-Key header when the operation declares an apiKey requirement`() {
        val apiKeyOperation =
            ApiOperation(
                operationId = "lookupProduct",
                method = "GET",
                path = "/lookup",
                summary = "",
                destructive = false,
                parameters = emptyList(),
                requestBodyExample = null,
                authRequirements = listOf(AuthRequirement.ApiKey("apiKeyAuth", "X-API-Key")),
            )
        val apiKeySpec = specification.copy(operations = listOf(apiKeyOperation))
        val configuration =
            OperationConfiguration(
                operationId = "lookupProduct",
                apiKey = "sk-test-abc123",
            )
        val profile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 10)

        val script = generator.generateForRun(apiKeySpec, "https://example.test", "", setOf("lookupProduct"), listOf(configuration), profile)

        assertContains(script, "\"X-API-Key\":\"sk-test-abc123\"")
        // No Authorization header — apiKey auth does not use one.
        assertTrue(!script.contains("Authorization"))
    }

    @Test
    fun `apiKey is not emitted when the user has not configured a value`() {
        val apiKeyOperation =
            ApiOperation(
                operationId = "lookupProduct",
                method = "GET",
                path = "/lookup",
                summary = "",
                destructive = false,
                parameters = emptyList(),
                requestBodyExample = null,
                authRequirements = listOf(AuthRequirement.ApiKey("apiKeyAuth", "X-API-Key")),
            )
        val apiKeySpec = specification.copy(operations = listOf(apiKeyOperation))
        val configuration = OperationConfiguration(operationId = "lookupProduct", apiKey = "")
        val profile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 10)

        val script = generator.generateForRun(apiKeySpec, "https://example.test", "", setOf("lookupProduct"), listOf(configuration), profile)

        assertTrue(!script.contains("X-API-Key"))
    }

    @Test
    fun `emits the Bearer Authorization header when the operation declares an OAuth2 requirement`() {
        val oauth2Operation =
            ApiOperation(
                operationId = "getMe",
                method = "GET",
                path = "/me",
                summary = "",
                destructive = false,
                parameters = emptyList(),
                requestBodyExample = null,
                authRequirements =
                    listOf(
                        AuthRequirement.OAuth2(
                            schemeName = "oauth2",
                            flows =
                                listOf(
                                    AuthRequirement.OAuth2Flow(
                                        type = "clientCredentials",
                                        tokenUrl = "https://example.test/oauth/token",
                                        scopes = listOf("read:products"),
                                    ),
                                ),
                        ),
                    ),
            )
        val oauth2Spec = specification.copy(operations = listOf(oauth2Operation))
        val configuration =
            OperationConfiguration(
                operationId = "getMe",
                oauth2Token = "demo-oauth2-token-12345",
            )
        val profile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 10)

        val script = generator.generateForRun(oauth2Spec, "https://example.test", "", setOf("getMe"), listOf(configuration), profile)

        assertContains(script, "\"Authorization\":\"Bearer demo-oauth2-token-12345\"")
    }

    @Test
    fun `OAuth2 token is not emitted when the user has not configured a value`() {
        val oauth2Operation =
            ApiOperation(
                operationId = "getMe",
                method = "GET",
                path = "/me",
                summary = "",
                destructive = false,
                parameters = emptyList(),
                requestBodyExample = null,
                authRequirements =
                    listOf(
                        AuthRequirement.OAuth2(
                            schemeName = "oauth2",
                            flows = listOf(AuthRequirement.OAuth2Flow(type = "clientCredentials")),
                        ),
                    ),
            )
        val oauth2Spec = specification.copy(operations = listOf(oauth2Operation))
        val configuration = OperationConfiguration(operationId = "getMe", oauth2Token = "")
        val profile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 10)

        val script = generator.generateForRun(oauth2Spec, "https://example.test", "", setOf("getMe"), listOf(configuration), profile)

        assertTrue(!script.contains("Authorization"))
    }

    @Test
    fun `uses an editable JSON request body`() {
        val configuration = OperationConfiguration(operationId = "createPet", requestBodyJson = """{"name":"Luna"}""")
        val profile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 10)

        val script = generator.generateForRun(specification, "https://example.test", "", setOf("createPet"), listOf(configuration), profile)

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
        val profile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 10)

        val script = generator.generateForRun(specification, "https://example.test", "", setOf("getPet"), listOf(configuration), profile)

        assertTrue(!script.contains("expand="))
    }

    @Test
    fun `rejects malformed JSON request body`() {
        val configuration = OperationConfiguration(operationId = "createPet", requestBodyJson = "{invalid}")
        val profile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 10)

        assertFailsWith<IllegalArgumentException> {
            generator.generateForRun(specification, "https://example.test", "", setOf("createPet"), listOf(configuration), profile)
        }
    }

    @Test
    fun `supports http targets empty selections delete calls and documented request bodies`() {
        val profile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 3600)
        val script = generator.generateForRun(specification, "http://example.test", "", emptySet(), emptyList(), profile)

        assertContains(script, "vus: 1")
        assertContains(script, "duration: '3600s'")
        assertContains(script, "http.del")
        assertContains(script, "JSON.stringify({\"name\":\"Fido\"})")
    }

    @Test
    fun `validates lower virtual user and duration boundaries`() {
        val tooFewVUs = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 0, durationSeconds = 10)
        val tooShortDuration = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 0)
        val tooLongDuration = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 3601)

        assertFailsWith<IllegalArgumentException> { generator.generateForRun(specification, "https://example.test", "", setOf("getPet"), emptyList(), tooFewVUs) }
        assertFailsWith<IllegalArgumentException> { generator.generateForRun(specification, "https://example.test", "", setOf("getPet"), emptyList(), tooShortDuration) }
        assertFailsWith<IllegalArgumentException> { generator.generateForRun(specification, "https://example.test", "", setOf("getPet"), emptyList(), tooLongDuration) }
    }

    @Test
    fun `renders ramping-vus with stages and startVUs`() {
        val profile =
            LoadProfile(
                type = LoadProfileType.RAMPING_VUS,
                startVUs = 0,
                stages =
                    listOf(
                        LoadStage(target = 0, durationSeconds = 30),
                        LoadStage(target = 200, durationSeconds = 120),
                        LoadStage(target = 200, durationSeconds = 300),
                        LoadStage(target = 0, durationSeconds = 30),
                    ),
            )
        val script = generator.generateForRun(specification, "https://example.test", "", setOf("getPet"), emptyList(), profile)

        assertTrue(script.contains("executor: 'ramping-vus'"))
        assertTrue(script.contains("startVUs: 0"))
        assertTrue(script.contains("stages: ["))
        assertTrue(script.contains("{ target: 0, duration: '30s' }"))
        assertTrue(script.contains("{ target: 200, duration: '120s' }"))
        assertTrue(script.contains("{ target: 200, duration: '300s' }"))
        assertTrue(!script.contains("vus: "))
        assertTrue(!script.contains("duration: '480s'"))
    }

    @Test
    fun `rejects ramping-vus with empty stages`() {
        val profile = LoadProfile(type = LoadProfileType.RAMPING_VUS, stages = emptyList())
        assertFailsWith<IllegalArgumentException> {
            generator.generateForRun(specification, "https://example.test", "", setOf("getPet"), emptyList(), profile)
        }
    }

    @Test
    fun `renders constant-arrival-rate with preAllocated and maxVUs`() {
        val profile =
            LoadProfile(
                type = LoadProfileType.CONSTANT_ARRIVAL_RATE,
                rate = 50,
                timeUnit = 1,
                durationSeconds = 60,
                preAllocatedVUs = 10,
                maxVUs = 100,
            )
        val script = generator.generateForRun(specification, "https://example.test", "", setOf("getPet"), emptyList(), profile)

        assertTrue(script.contains("executor: 'constant-arrival-rate'"))
        assertTrue(script.contains("rate: 50"))
        assertTrue(script.contains("timeUnit: '1s'"))
        assertTrue(script.contains("duration: '60s'"))
        assertTrue(script.contains("preAllocatedVUs: 10"))
        assertTrue(script.contains("maxVUs: 100"))
    }

    @Test
    fun `rejects constant-arrival-rate with maxVUs below preAllocatedVUs`() {
        val profile =
            LoadProfile(
                type = LoadProfileType.CONSTANT_ARRIVAL_RATE,
                rate = 50,
                timeUnit = 1,
                durationSeconds = 60,
                preAllocatedVUs = 100,
                maxVUs = 50,
            )
        assertFailsWith<IllegalArgumentException> {
            generator.generateForRun(specification, "https://example.test", "", setOf("getPet"), emptyList(), profile)
        }
    }

    @Test
    fun `rejects constant-arrival-rate with an invalid time unit`() {
        val profile =
            LoadProfile(
                type = LoadProfileType.CONSTANT_ARRIVAL_RATE,
                rate = 50,
                timeUnit = 300,
                durationSeconds = 60,
                preAllocatedVUs = 10,
                maxVUs = 100,
            )
        val exception =
            assertFailsWith<IllegalArgumentException> {
                generator.generateForRun(specification, "https://example.test", "", setOf("getPet"), emptyList(), profile)
            }
        assertTrue(exception.message!!.contains("Zeiteinheit"))
    }

    @Test
    fun `rejects constant-vus missing required fields`() {
        val profile = LoadProfile(type = LoadProfileType.CONSTANT_VUS)
        assertFailsWith<IllegalArgumentException> {
            generator.generateForRun(specification, "https://example.test", "", setOf("getPet"), emptyList(), profile)
        }
    }

    @Test
    fun `rejects duplicate and unknown operation configurations`() {
        val configuration = OperationConfiguration("getPet")
        assertFailsWith<IllegalArgumentException> {
            generator.generateForRun(
                specification,
                "https://example.test",
                "",
                setOf("getPet"),
                listOf(configuration, configuration),
                LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 10),
            )
        }
        assertFailsWith<IllegalArgumentException> {
            generator.generateForRun(
                specification,
                "https://example.test",
                "",
                setOf("getPet"),
                listOf(OperationConfiguration("deletePet")),
                LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 10),
            )
        }
        assertFailsWith<IllegalArgumentException> {
            generator.generateForRun(
                specification,
                "https://example.test",
                "",
                setOf("getPet"),
                listOf(OperationConfiguration("missing")),
                LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 10),
            )
        }
    }

    @Test
    fun `rejects duplicate unknown and empty required parameters`() {
        val id = ParameterValue("id", "path", "7")
        val profile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 10)
        assertFailsWith<IllegalArgumentException> {
            generator.generateForRun(specification, "https://example.test", "", setOf("getPet"), listOf(OperationConfiguration("getPet", parameterValues = listOf(id, id))), profile)
        }
        assertFailsWith<IllegalArgumentException> {
            generator.generateForRun(
                specification,
                "https://example.test",
                "",
                setOf("getPet"),
                listOf(OperationConfiguration("getPet", parameterValues = listOf(ParameterValue("unknown", "query", "x")))),
                profile,
            )
        }
        assertFailsWith<IllegalArgumentException> {
            generator.generateForRun(
                specification,
                "https://example.test",
                "",
                setOf("getPet"),
                listOf(OperationConfiguration("getPet", parameterValues = listOf(ParameterValue("id", "PATH", " ")))),
                profile,
            )
        }
    }

    @Test
    fun `uses a default value when a parameter has no example`() {
        val operation = ApiOperation("missingExample", "GET", "/missing", "", false, listOf(ApiParameter("value", "query", false, null)), null)
        val missingExampleSpecification = specification.copy(operations = listOf(operation))
        val profile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 10)

        val script = generator.generateForRun(missingExampleSpecification, "https://example.test", "", emptySet(), emptyList(), profile)

        assertContains(script, "value=test")
    }

    @Test
    fun `serializes JSON nulls and parsed lists`() {
        val operation = ApiOperation("jsonList", "POST", "/json", "", true, emptyList(), null, hasRequestBody = true)
        val jsonSpecification = specification.copy(operations = listOf(operation))
        val configuration = OperationConfiguration("jsonList", requestBodyJson = "{\"nothing\":null,\"items\":[1,true]}")
        val profile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 10)

        val script = generator.generateForRun(jsonSpecification, "https://example.test", "", emptySet(), listOf(configuration), profile)

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
                authRequirements = listOf(AuthRequirement.Bearer("bearerAuth")),
            )
        val collectionSpecification = specification.copy(operations = listOf(collectionOperation))
        val prefixed = OperationConfiguration("collections", bearerToken = "Bearer existing")
        val blank = OperationConfiguration("collections", bearerToken = " ")
        val profile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 10)

        val prefixedScript = generator.generateForRun(collectionSpecification, "https://example.test", "", emptySet(), listOf(prefixed), profile)
        val blankScript = generator.generateForRun(collectionSpecification, "https://example.test", "", emptySet(), listOf(blank), profile)

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
        val profile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 10)

        val script = generator.generateForRun(bodySpecification, "https://example.test", "", emptySet(), emptyList(), profile)

        assertContains(script, "JSON.stringify([1,true,\"line\\nvalue\"])")
        assertContains(script, "\\b\\f\\n\\r\\t\\u0001")
    }

    @Test
    fun `supports an explicitly empty optional request body`() {
        val optionalBody =
            ApiOperation("optionalBody", "POST", "/optional", "", true, emptyList(), mapOf("value" to true), hasRequestBody = true)
        val optionalSpecification = specification.copy(operations = listOf(optionalBody))
        val configuration = OperationConfiguration("optionalBody", requestBodyJson = "")
        val profile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 10)

        val script = generator.generateForRun(optionalSpecification, "https://example.test", "", emptySet(), listOf(configuration), profile)

        assertContains(script, "null")
        assertTrue(!script.contains("Content-Type"))
    }

    @Test
    fun `rejects empty and null required request bodies`() {
        val profile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 10)
        assertFailsWith<IllegalArgumentException> {
            generator.generateForRun(specification, "https://example.test", "", setOf("createPet"), listOf(OperationConfiguration("createPet", requestBodyJson = "")), profile)
        }
        assertFailsWith<IllegalArgumentException> {
            generator.generateForRun(specification, "https://example.test", "", setOf("createPet"), listOf(OperationConfiguration("createPet", requestBodyJson = "null")), profile)
        }
    }

    @Test
    fun `rejects invalid target URL`() {
        val profile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 10)
        assertFailsWith<IllegalArgumentException> { generator.generateForRun(specification, "file:///etc/passwd", "", emptySet(), emptyList(), profile) }
    }

    @Test
    fun `rejects empty selection`() {
        val profile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 10)
        assertFailsWith<IllegalArgumentException> { generator.generateForRun(specification, "https://example.test", "", setOf("missing"), emptyList(), profile) }
    }

    @Test
    fun `declares one counter per tracked status code plus err and other per selected operation`() {
        val profile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 10)
        val script = generator.generateForRun(specification, "https://example.test", "", setOf("getPet", "createPet"), emptyList(), profile)

        val trackedCodes =
            listOf(
                200,
                201,
                202,
                204,
                301,
                302,
                304,
                400,
                401,
                403,
                404,
                409,
                422,
                429,
                500,
                502,
                503,
                504,
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
        val profile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 10)
        val script = generator.generateForRun(specification, "https://example.test", "", setOf("getPet"), emptyList(), profile)

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
        val profile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 10)

        val script = generator.generateForRun(weirdSpecification, "https://example.test", "", setOf("get-pet:v2"), emptyList(), profile)

        assertContains(script, "new Counter('lt_status_200_get_pet_v2')")
        assertContains(script, "new Counter('lt_status_429_get_pet_v2')")
        assertContains(script, "lt_status_err_get_pet_v2.add(1)")
        assertContains(script, "lt_status_other_get_pet_v2.add(1)")
    }

    @Test
    fun `prefixes sanitised operation ids that start with a digit so they stay valid identifiers`() {
        val leadingDigitOperation =
            ApiOperation("1Pet", "GET", "/pets", "", false, emptyList(), null)
        val leadingDigitSpecification = specification.copy(operations = listOf(leadingDigitOperation))
        val profile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 10)

        val script = generator.generateForRun(leadingDigitSpecification, "https://example.test", "", setOf("1Pet"), emptyList(), profile)

        assertContains(script, "new Counter('lt_status_200__1Pet')")
        assertContains(script, "new Counter('lt_status_429__1Pet')")
        assertContains(script, "lt_status_err__1Pet.add(1)")
        assertContains(script, "lt_status_other__1Pet.add(1)")
        // The request line still uses the original operationId in tags.
        assertContains(script, "\"operationId\":\"1Pet\"")
    }

    @Test
    fun `handles an empty operation id by emitting a single-underscore identifier`() {
        val emptyIdOperation =
            ApiOperation("", "GET", "/pets", "", false, emptyList(), null)
        val emptyIdSpecification = specification.copy(operations = listOf(emptyIdOperation))
        val profile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 10)

        val script = generator.generateForRun(emptyIdSpecification, "https://example.test", "", setOf(""), emptyList(), profile)

        assertContains(script, "new Counter('lt_status_200__')")
        assertContains(script, "lt_status_err__.add(1)")
        assertContains(script, "lt_status_other__.add(1)")
    }

    @Test
    fun `omits status counters for unselected operations`() {
        val profile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 10)
        val script = generator.generateForRun(specification, "https://example.test", "", setOf("getPet"), emptyList(), profile)

        assertTrue(!script.contains("lt_status_200_createPet"))
        assertTrue(!script.contains("lt_status_500_deletePet"))
        assertTrue(!script.contains("lt_status_err_createPet"))
        assertTrue(script.contains("lt_status_200_getPet"))
        assertTrue(script.contains("lt_status_err_getPet"))
    }

    @Test
    fun `renderScenario throws when constant-vus is missing virtualUsers`() {
        val profile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, durationSeconds = 30)
        assertFailsWith<IllegalStateException> { generator.renderScenario(profile) }
    }

    @Test
    fun `renderScenario throws when constant-vus is missing durationSeconds`() {
        val profile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 10)
        assertFailsWith<IllegalStateException> { generator.renderScenario(profile) }
    }

    @Test
    fun `renderScenario throws when shared-iterations is missing virtualUsers`() {
        val profile = LoadProfile(type = LoadProfileType.SHARED_ITERATIONS, iterations = 100)
        assertFailsWith<IllegalStateException> { generator.renderScenario(profile) }
    }

    @Test
    fun `renderScenario throws when shared-iterations is missing iterations`() {
        val profile = LoadProfile(type = LoadProfileType.SHARED_ITERATIONS, virtualUsers = 10)
        assertFailsWith<IllegalStateException> { generator.renderScenario(profile) }
    }

    @Test
    fun `renderScenario throws when ramping-vus is missing stages`() {
        val profile = LoadProfile(type = LoadProfileType.RAMPING_VUS, startVUs = 0)
        assertFailsWith<IllegalStateException> { generator.renderScenario(profile) }
    }

    @Test
    fun `renderScenario throws when constant-arrival-rate is missing rate`() {
        val profile =
            LoadProfile(
                type = LoadProfileType.CONSTANT_ARRIVAL_RATE,
                timeUnit = 1,
                durationSeconds = 60,
                preAllocatedVUs = 10,
                maxVUs = 100,
            )
        assertFailsWith<IllegalStateException> { generator.renderScenario(profile) }
    }

    @Test
    fun `renderScenario throws when constant-arrival-rate is missing timeUnit`() {
        val profile =
            LoadProfile(
                type = LoadProfileType.CONSTANT_ARRIVAL_RATE,
                rate = 50,
                durationSeconds = 60,
                preAllocatedVUs = 10,
                maxVUs = 100,
            )
        assertFailsWith<IllegalStateException> { generator.renderScenario(profile) }
    }

    @Test
    fun `renderScenario throws when constant-arrival-rate is missing durationSeconds`() {
        val profile =
            LoadProfile(
                type = LoadProfileType.CONSTANT_ARRIVAL_RATE,
                rate = 50,
                timeUnit = 1,
                preAllocatedVUs = 10,
                maxVUs = 100,
            )
        assertFailsWith<IllegalStateException> { generator.renderScenario(profile) }
    }

    @Test
    fun `renderScenario throws when constant-arrival-rate is missing preAllocatedVUs`() {
        val profile =
            LoadProfile(
                type = LoadProfileType.CONSTANT_ARRIVAL_RATE,
                rate = 50,
                timeUnit = 1,
                durationSeconds = 60,
                maxVUs = 100,
            )
        assertFailsWith<IllegalStateException> { generator.renderScenario(profile) }
    }

    @Test
    fun `renderScenario throws when constant-arrival-rate is missing maxVUs`() {
        val profile =
            LoadProfile(
                type = LoadProfileType.CONSTANT_ARRIVAL_RATE,
                rate = 50,
                timeUnit = 1,
                durationSeconds = 60,
                preAllocatedVUs = 10,
            )
        assertFailsWith<IllegalStateException> { generator.renderScenario(profile) }
    }

    @Test
    fun `validateLoadProfile throws when constant-vus is missing virtualUsers`() {
        val profile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, durationSeconds = 30)
        assertFailsWith<IllegalArgumentException> { generator.validateLoadProfile(profile) }
    }

    @Test
    fun `validateLoadProfile throws when constant-vus is missing durationSeconds`() {
        val profile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 10)
        assertFailsWith<IllegalArgumentException> { generator.validateLoadProfile(profile) }
    }

    @Test
    fun `validateLoadProfile rejects virtualUsers below the lower boundary for constant-vus`() {
        val profile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 0, durationSeconds = 30)
        assertFailsWith<IllegalArgumentException> { generator.validateLoadProfile(profile) }
    }

    @Test
    fun `validateLoadProfile rejects durationSeconds below the lower boundary for constant-vus`() {
        val profile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 10, durationSeconds = 0)
        assertFailsWith<IllegalArgumentException> { generator.validateLoadProfile(profile) }
    }

    @Test
    fun `validateLoadProfile throws when shared-iterations is missing virtualUsers`() {
        val profile = LoadProfile(type = LoadProfileType.SHARED_ITERATIONS, iterations = 100)
        assertFailsWith<IllegalArgumentException> { generator.validateLoadProfile(profile) }
    }

    @Test
    fun `validateLoadProfile throws when shared-iterations is missing iterations`() {
        val profile = LoadProfile(type = LoadProfileType.SHARED_ITERATIONS, virtualUsers = 10)
        assertFailsWith<IllegalArgumentException> { generator.validateLoadProfile(profile) }
    }

    @Test
    fun `validateLoadProfile rejects iterations below the lower boundary for shared-iterations`() {
        val profile = LoadProfile(type = LoadProfileType.SHARED_ITERATIONS, virtualUsers = 10, iterations = 0)
        assertFailsWith<IllegalArgumentException> { generator.validateLoadProfile(profile) }
    }

    @Test
    fun `validateLoadProfile rejects virtualUsers above the upper boundary for shared-iterations`() {
        val profile =
            LoadProfile(
                type = LoadProfileType.SHARED_ITERATIONS,
                virtualUsers = 30_001,
                iterations = 100,
            )
        assertFailsWith<IllegalArgumentException> { generator.validateLoadProfile(profile) }
    }

    @Test
    fun `validateLoadProfile rejects virtualUsers below the lower boundary for shared-iterations`() {
        val profile =
            LoadProfile(
                type = LoadProfileType.SHARED_ITERATIONS,
                virtualUsers = 0,
                iterations = 100,
            )
        assertFailsWith<IllegalArgumentException> { generator.validateLoadProfile(profile) }
    }

    @Test
    fun `validateLoadProfile rejects startVUs below the lower boundary for ramping-vus`() {
        val profile =
            LoadProfile(
                type = LoadProfileType.RAMPING_VUS,
                startVUs = -1,
                stages = listOf(LoadStage(target = 10, durationSeconds = 30)),
            )
        assertFailsWith<IllegalArgumentException> { generator.validateLoadProfile(profile) }
    }

    @Test
    fun `validateLoadProfile rejects durationSeconds below the lower boundary for constant-arrival-rate`() {
        val profile =
            LoadProfile(
                type = LoadProfileType.CONSTANT_ARRIVAL_RATE,
                rate = 50,
                timeUnit = 1,
                durationSeconds = 0,
                preAllocatedVUs = 10,
                maxVUs = 100,
            )
        assertFailsWith<IllegalArgumentException> { generator.validateLoadProfile(profile) }
    }

    @Test
    fun `validateLoadProfile accepts the boundary values for constant-vus`() {
        val profile =
            LoadProfile(
                type = LoadProfileType.CONSTANT_VUS,
                virtualUsers = 1,
                durationSeconds = 1,
            )
        generator.validateLoadProfile(profile)
    }

    @Test
    fun `validateLoadProfile accepts the upper boundary values for shared-iterations`() {
        val profile =
            LoadProfile(
                type = LoadProfileType.SHARED_ITERATIONS,
                virtualUsers = 30_000,
                iterations = 1,
            )
        generator.validateLoadProfile(profile)
    }

    @Test
    fun `validateLoadProfile accepts a ramping-vus plateau with startVUs equal to first stage target`() {
        val profile =
            LoadProfile(
                type = LoadProfileType.RAMPING_VUS,
                startVUs = 10,
                stages =
                    listOf(
                        LoadStage(target = 10, durationSeconds = 30),
                        LoadStage(target = 50, durationSeconds = 60),
                    ),
            )
        generator.validateLoadProfile(profile)
    }

    @Test
    fun `validateLoadProfile rejects startVUs above the upper boundary for ramping-vus`() {
        val profile =
            LoadProfile(
                type = LoadProfileType.RAMPING_VUS,
                startVUs = 30_001,
                stages = listOf(LoadStage(target = 10, durationSeconds = 30)),
            )
        assertFailsWith<IllegalArgumentException> { generator.validateLoadProfile(profile) }
    }

    @Test
    fun `validateLoadProfile rejects durationSeconds above the upper boundary for ramping-vus stages`() {
        val profile =
            LoadProfile(
                type = LoadProfileType.RAMPING_VUS,
                startVUs = 0,
                stages = listOf(LoadStage(target = 10, durationSeconds = 3_601)),
            )
        assertFailsWith<IllegalArgumentException> { generator.validateLoadProfile(profile) }
    }

    @Test
    fun `validateLoadProfile rejects rate above the upper boundary for constant-arrival-rate`() {
        val profile =
            LoadProfile(
                type = LoadProfileType.CONSTANT_ARRIVAL_RATE,
                rate = 100_001,
                timeUnit = 1,
                durationSeconds = 60,
                preAllocatedVUs = 10,
                maxVUs = 100,
            )
        assertFailsWith<IllegalArgumentException> { generator.validateLoadProfile(profile) }
    }

    @Test
    fun `validateLoadProfile rejects timeUnit outside the supported range for constant-arrival-rate`() {
        val profile =
            LoadProfile(
                type = LoadProfileType.CONSTANT_ARRIVAL_RATE,
                rate = 50,
                timeUnit = 61,
                durationSeconds = 60,
                preAllocatedVUs = 10,
                maxVUs = 100,
            )
        assertFailsWith<IllegalArgumentException> { generator.validateLoadProfile(profile) }
    }

    @Test
    fun `validateLoadProfile rejects durationSeconds above the upper boundary for constant-arrival-rate`() {
        val profile =
            LoadProfile(
                type = LoadProfileType.CONSTANT_ARRIVAL_RATE,
                rate = 50,
                timeUnit = 1,
                durationSeconds = 3_601,
                preAllocatedVUs = 10,
                maxVUs = 100,
            )
        assertFailsWith<IllegalArgumentException> { generator.validateLoadProfile(profile) }
    }

    @Test
    fun `validateLoadProfile rejects preAllocatedVUs above the upper boundary for constant-arrival-rate`() {
        val profile =
            LoadProfile(
                type = LoadProfileType.CONSTANT_ARRIVAL_RATE,
                rate = 50,
                timeUnit = 1,
                durationSeconds = 60,
                preAllocatedVUs = 30_001,
                maxVUs = 30_002,
            )
        assertFailsWith<IllegalArgumentException> { generator.validateLoadProfile(profile) }
    }

    @Test
    fun `validateLoadProfile rejects maxVUs above the upper boundary for constant-arrival-rate`() {
        val profile =
            LoadProfile(
                type = LoadProfileType.CONSTANT_ARRIVAL_RATE,
                rate = 50,
                timeUnit = 1,
                durationSeconds = 60,
                preAllocatedVUs = 10,
                maxVUs = 30_001,
            )
        assertFailsWith<IllegalArgumentException> { generator.validateLoadProfile(profile) }
    }

    @Test
    fun `emits a top-level pool selector and an if-else dispatch for multiple payloads in sequential mode`() {
        val configuration =
            OperationConfiguration(
                operationId = "getPet",
                payloads =
                    listOf(
                        OperationPayload(parameterValues = listOf(ParameterValue("id", "path", "42"))),
                        OperationPayload(parameterValues = listOf(ParameterValue("id", "path", "17"))),
                    ),
            )
        val profile =
            LoadProfile(
                type = LoadProfileType.CONSTANT_VUS,
                virtualUsers = 1,
                durationSeconds = 10,
                payloadStrategy = PayloadStrategy.SEQUENTIAL,
            )

        val script = generator.generateForRun(specification, "https://example.test", "", setOf("getPet"), listOf(configuration), profile)

        assertContains(script, "let __lt_idx_getPet = 0;")
        assertContains(script, "function __lt_next_getPet()")
        assertContains(script, "__lt_idx_getPet++")

        assertContains(script, "const __lt_idx_getPet = __lt_next_getPet();")
        assertContains(script, "if (__lt_idx_getPet === 0)")
        assertContains(script, "else if (__lt_idx_getPet === 1)")
        assertContains(script, "/pets/42")
        assertContains(script, "/pets/17")
    }

    @Test
    fun `emits a random-mode pool selector when strategy is RANDOM`() {
        val configuration =
            OperationConfiguration(
                operationId = "getPet",
                payloads =
                    listOf(
                        OperationPayload(parameterValues = listOf(ParameterValue("id", "path", "42"))),
                        OperationPayload(parameterValues = listOf(ParameterValue("id", "path", "17"))),
                    ),
            )
        val profile =
            LoadProfile(
                type = LoadProfileType.CONSTANT_VUS,
                virtualUsers = 1,
                durationSeconds = 10,
                payloadStrategy = PayloadStrategy.RANDOM,
            )

        val script = generator.generateForRun(specification, "https://example.test", "", setOf("getPet"), listOf(configuration), profile)

        assertContains(script, "Math.floor(Math.random() * 2)")
        assertTrue(!script.contains("__lt_idx_getPet++"))
    }

    @Test
    fun `falls back to sequential pool selector when load profile omits payloadStrategy`() {
        val configuration =
            OperationConfiguration(
                operationId = "getPet",
                payloads =
                    listOf(
                        OperationPayload(parameterValues = listOf(ParameterValue("id", "path", "42"))),
                        OperationPayload(parameterValues = listOf(ParameterValue("id", "path", "17"))),
                    ),
            )
        val profile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 10)

        val script = generator.generateForRun(specification, "https://example.test", "", setOf("getPet"), listOf(configuration), profile)

        assertContains(script, "__lt_idx_getPet++")
    }

    @Test
    fun `single-payload pool emits no pool selector or dispatch (legacy behaviour preserved)`() {
        val configuration =
            OperationConfiguration(
                operationId = "getPet",
                payloads = listOf(OperationPayload(parameterValues = listOf(ParameterValue("id", "path", "42")))),
            )
        val profile =
            LoadProfile(
                type = LoadProfileType.CONSTANT_VUS,
                virtualUsers = 1,
                durationSeconds = 10,
                payloadStrategy = PayloadStrategy.SEQUENTIAL,
            )

        val script = generator.generateForRun(specification, "https://example.test", "", setOf("getPet"), listOf(configuration), profile)

        assertTrue(!script.contains("__lt_next_getPet"))
        assertTrue(!script.contains("__lt_idx_getPet"))
        assertContains(script, "/pets/42")
    }

    @Test
    fun `migrates legacy flat fields into a single-pool payload when the pool is empty`() {
        val configuration = OperationConfiguration(operationId = "getPet", parameterValues = listOf(ParameterValue("id", "path", "99")))
        val profile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 10)

        val script = generator.generateForRun(specification, "https://example.test", "", setOf("getPet"), listOf(configuration), profile)

        assertContains(script, "/pets/99")
        assertTrue(!script.contains("__lt_next_getPet"))
    }

    @Test
    fun `multi-payload pool with the legacy body and bearer token is emitted per payload`() {
        val configuration =
            OperationConfiguration(
                operationId = "createPet",
                payloads =
                    listOf(
                        OperationPayload(
                            parameterValues = emptyList(),
                            requestBodyJson = """{"name":"Luna"}""",
                            bearerToken = "t1",
                        ),
                        OperationPayload(
                            parameterValues = emptyList(),
                            requestBodyJson = """{"name":"Rocky"}""",
                            bearerToken = "t2",
                        ),
                    ),
            )
        val profile =
            LoadProfile(
                type = LoadProfileType.CONSTANT_VUS,
                virtualUsers = 1,
                durationSeconds = 10,
                payloadStrategy = PayloadStrategy.SEQUENTIAL,
            )

        val script = generator.generateForRun(specification, "https://example.test", "", setOf("createPet"), listOf(configuration), profile)

        assertContains(script, """JSON.stringify({"name":"Luna"})""")
        assertContains(script, """JSON.stringify({"name":"Rocky"})""")
        assertContains(script, """Bearer t1""")
        assertContains(script, """Bearer t2""")
        assertContains(script, "if (__lt_idx_createPet === 0)")
        assertContains(script, "else if (__lt_idx_createPet === 1)")
    }

    @Test
    fun `pool selector is declared exactly once at module top-level so the per-iteration dispatch does not double-declare the counter`() {
        val configuration =
            OperationConfiguration(
                operationId = "getPet",
                payloads =
                    listOf(
                        OperationPayload(parameterValues = listOf(ParameterValue("id", "path", "42"))),
                        OperationPayload(parameterValues = listOf(ParameterValue("id", "path", "17"))),
                    ),
            )
        val profile =
            LoadProfile(
                type = LoadProfileType.CONSTANT_VUS,
                virtualUsers = 1,
                durationSeconds = 10,
                payloadStrategy = PayloadStrategy.SEQUENTIAL,
            )

        val script = generator.generateForRun(specification, "https://example.test", "", setOf("getPet"), listOf(configuration), profile)

        val functionStart = script.indexOf("export default function ()")
        require(functionStart >= 0) { "default function not found in generated script" }
        val functionBody = script.substring(functionStart)
        assertTrue(!functionBody.contains("let __lt_idx_getPet"), "let must not appear inside the function body")
        assertTrue(!functionBody.contains("var __lt_idx_getPet"), "var must not appear either")
        assertEquals(1, Regex("let __lt_idx_getPet = 0;").findAll(script).count())
        assertContains(script, "const __lt_idx_getPet = __lt_next_getPet();")
    }

    @Test
    fun `random-mode pool selector still lives at module top-level`() {
        val configuration =
            OperationConfiguration(
                operationId = "getPet",
                payloads =
                    listOf(
                        OperationPayload(parameterValues = listOf(ParameterValue("id", "path", "42"))),
                        OperationPayload(parameterValues = listOf(ParameterValue("id", "path", "17"))),
                    ),
            )
        val profile =
            LoadProfile(
                type = LoadProfileType.CONSTANT_VUS,
                virtualUsers = 1,
                durationSeconds = 10,
                payloadStrategy = PayloadStrategy.RANDOM,
            )

        val script = generator.generateForRun(specification, "https://example.test", "", setOf("getPet"), listOf(configuration), profile)

        assertContains(script, "function __lt_next_getPet()")
        assertTrue(script.contains("Math.floor(Math.random() * 2)"))
        assertContains(script, "const __lt_idx_getPet = __lt_next_getPet();")
    }

    @Test
    fun `emits a per-payload counter declaration and increments it inside the dispatch branch`() {
        val configuration =
            OperationConfiguration(
                operationId = "getPet",
                payloads =
                    listOf(
                        OperationPayload(parameterValues = listOf(ParameterValue("id", "path", "42"))),
                        OperationPayload(parameterValues = listOf(ParameterValue("id", "path", "17"))),
                        OperationPayload(parameterValues = listOf(ParameterValue("id", "path", "99"))),
                    ),
            )
        val profile =
            LoadProfile(
                type = LoadProfileType.CONSTANT_VUS,
                virtualUsers = 1,
                durationSeconds = 10,
                payloadStrategy = PayloadStrategy.SEQUENTIAL,
            )

        val script = generator.generateForRun(specification, "https://example.test", "", setOf("getPet"), listOf(configuration), profile)

        assertContains(script, "new Counter('lt_payload_0_getPet')")
        assertContains(script, "new Counter('lt_payload_1_getPet')")
        assertContains(script, "new Counter('lt_payload_2_getPet')")

        assertContains(script, "lt_payload_0_getPet.add(1)")
        assertContains(script, "lt_payload_1_getPet.add(1)")
        assertContains(script, "lt_payload_2_getPet.add(1)")

        val singleProfile =
            LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 10)
        val singleScript = generator.generateForRun(specification, "https://example.test", "", setOf("getPet"), emptyList(), singleProfile)
        assertTrue(!singleScript.contains("lt_payload_0_getPet"))
    }

    @Test
    fun `emits the X-Lasttest-Run-Id header when generateForRun is called with a non-empty runId`() {
        val profile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 10)

        val script = generator.generateForRun(specification, "https://example.test", "run-42", setOf("getPet"), emptyList(), profile)

        assertContains(script, "\"X-Lasttest-Run-Id\":\"run-42\"")
    }

    @Test
    fun `omits the X-Lasttest-Run-Id header when runId is empty`() {
        val profile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 10)

        val script = generator.generateForRun(specification, "https://example.test", "", setOf("getPet"), emptyList(), profile)

        assertTrue(!script.contains("X-Lasttest-Run-Id"))
    }

    @Test
    fun `emits the X-Lasttest-Run-Id header for every selected operation`() {
        val profile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 10)

        val script = generator.generateForRun(specification, "https://example.test", "abc-123", setOf("getPet", "createPet"), emptyList(), profile)

        val matches = Regex("\"X-Lasttest-Run-Id\":\"abc-123\"").findAll(script).count()
        assertEquals(2, matches, "one header per selected operation")
    }

    @Test
    fun `emits the X-Lasttest-Run-Id header for every branch of a multi-payload pool`() {
        val configuration =
            OperationConfiguration(
                operationId = "getPet",
                payloads =
                    listOf(
                        OperationPayload(parameterValues = listOf(ParameterValue("id", "path", "42"))),
                        OperationPayload(parameterValues = listOf(ParameterValue("id", "path", "17"))),
                    ),
            )
        val profile =
            LoadProfile(
                type = LoadProfileType.CONSTANT_VUS,
                virtualUsers = 1,
                durationSeconds = 10,
                payloadStrategy = PayloadStrategy.SEQUENTIAL,
            )

        val script = generator.generateForRun(specification, "https://example.test", "run-x", setOf("getPet"), listOf(configuration), profile)

        val matches = Regex("\"X-Lasttest-Run-Id\":\"run-x\"").findAll(script).count()
        assertEquals(2, matches, "every payload branch must carry the run id")
    }
}

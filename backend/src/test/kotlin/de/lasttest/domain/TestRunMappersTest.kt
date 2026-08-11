package de.lasttest.domain

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.KotlinModule
import de.lasttest.api.CreateTestRunRequest
import de.lasttest.api.LoadProfile
import de.lasttest.api.LoadProfileType
import de.lasttest.api.OperationConfiguration
import de.lasttest.api.OperationPayload
import de.lasttest.api.ParameterValue
import de.lasttest.api.TestRun
import de.lasttest.api.TestRunConfiguration
import de.lasttest.api.TestRunOperationConfiguration
import de.lasttest.api.TestRunStatus
import java.time.Instant
import javax.crypto.spec.SecretKeySpec
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class TestRunMappersTest {
    private val mapper = ObjectMapper().registerModule(KotlinModule.Builder().build())

    @Test
    fun `toTestRunEntity copies every scalar field onto the entity`() {
        val createdAt = Instant.parse("2026-01-01T00:00:00Z")
        val startedAt = Instant.parse("2026-01-01T00:00:01Z")
        val finishedAt = Instant.parse("2026-01-01T00:00:30Z")
        val run =
            TestRun(
                id = "run-1",
                status = TestRunStatus.COMPLETED,
                createdAt = createdAt.toString(),
                startedAt = startedAt.toString(),
                finishedAt = finishedAt.toString(),
                exitCode = 0,
            )

        val entity = run.toTestRunEntity(mapper)

        assertEquals("run-1", entity.id)
        assertEquals(TestRunStatus.COMPLETED, entity.status)
        assertEquals(createdAt, entity.createdAt)
        assertEquals(startedAt, entity.startedAt)
        assertEquals(finishedAt, entity.finishedAt)
        assertEquals(0, entity.exitCode)
    }

    @Test
    fun `toTestRunEntity leaves optional timestamps null when the run has not started yet`() {
        val run = TestRun(id = "run-q", status = TestRunStatus.QUEUED, createdAt = "2026-01-01T00:00:00Z")

        val entity = run.toTestRunEntity(mapper)

        assertNull(entity.startedAt)
        assertNull(entity.finishedAt)
    }

    @Test
    fun `toTestRunEntity serialises configuration and originalRequest as JSON`() {
        val configuration =
            TestRunConfiguration(
                apiTitle = "Pet API",
                apiVersion = "1",
                baseUrl = "https://example.test",
                loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 5, durationSeconds = 10),
                operations =
                    listOf(
                        TestRunOperationConfiguration(
                            operationId = "getPet",
                            method = "GET",
                            path = "/pets/{id}",
                            summary = "Find pet",
                            payloads = emptyList(),
                            parameterValues = listOf(ParameterValue("id", "path", "42")),
                            requestBodyJson = null,
                        ),
                    ),
            )
        val originalRequest =
            CreateTestRunRequest(
                specification = "openapi document",
                baseUrl = "https://target.test",
                operationIds = setOf("getPet"),
                operationConfigurations = listOf(OperationConfiguration(operationId = "getPet", parameterValues = emptyList())),
                loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 5, durationSeconds = 10),
            )
        val run =
            TestRun(
                id = "run-1",
                status = TestRunStatus.QUEUED,
                createdAt = "2026-01-01T00:00:00Z",
                configuration = configuration,
                originalRequest = originalRequest,
            )

        val entity = run.toTestRunEntity(mapper)
        val roundTripped = entity.toTestRun(mapper)

        assertEquals(
            configuration.copy(
                operations =
                    configuration.operations.map { operation ->
                        operation.copy(parameterValues = emptyList())
                    },
            ),
            roundTripped.configuration,
        )
        assertEquals(
            originalRequest.copy(
                operationConfigurations =
                    originalRequest.operationConfigurations.map { configuration ->
                        configuration.copy(
                            payloads = emptyList(),
                            parameterValues = emptyList(),
                            requestBodyJson = null,
                            bearerToken = null,
                            basicAuthUsername = null,
                            basicAuthPassword = null,
                            apiKey = null,
                            oauth2Token = null,
                            oidcIdToken = null,
                        )
                    },
            ),
            roundTripped.originalRequest,
        )
    }

    @Test
    fun `toTestRunEntity copies the first operation as denormalised columns for the badge lookup`() {
        val configuration =
            TestRunConfiguration(
                apiTitle = "Pet API",
                apiVersion = "1",
                baseUrl = "https://example.test",
                loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                operations =
                    listOf(
                        TestRunOperationConfiguration(
                            operationId = "getPet",
                            method = "GET",
                            path = "/pets/{id}",
                            summary = "Find pet",
                            payloads = emptyList(),
                            parameterValues = emptyList(),
                            requestBodyJson = null,
                        ),
                        TestRunOperationConfiguration(
                            operationId = "listPets",
                            method = "GET",
                            path = "/pets",
                            summary = "List pets",
                            payloads = emptyList(),
                            parameterValues = emptyList(),
                            requestBodyJson = null,
                        ),
                    ),
            )
        val run =
            TestRun(
                id = "run-1",
                status = TestRunStatus.QUEUED,
                createdAt = "2026-01-01T00:00:00Z",
                configuration = configuration,
            )

        val entity = run.toTestRunEntity(mapper)

        assertEquals("GET", entity.operationMethod)
        assertEquals("/pets/{id}", entity.operationPath)
        assertEquals("getPet", entity.operationId)
    }

    @Test
    fun `toTestRunEntity leaves the denormalised columns null when the run has no operations`() {
        val configuration =
            TestRunConfiguration(
                apiTitle = "Pet API",
                apiVersion = "1",
                baseUrl = "https://example.test",
                loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                operations = emptyList(),
            )
        val run =
            TestRun(
                id = "run-1",
                status = TestRunStatus.QUEUED,
                createdAt = "2026-01-01T00:00:00Z",
                configuration = configuration,
            )

        val entity = run.toTestRunEntity(mapper)

        assertNull(entity.operationMethod)
        assertNull(entity.operationPath)
        assertNull(entity.operationId)
    }

    @Test
    fun `toTestRunEntity extracts the raw k6 output from the summary map`() {
        val run =
            TestRun(
                id = "run-1",
                status = TestRunStatus.COMPLETED,
                createdAt = "2026-01-01T00:00:00Z",
                summary = mapOf("raw" to "{\"metrics\":{}}"),
            )

        val entity = run.toTestRunEntity(mapper)
        val roundTripped = entity.toTestRun(mapper)

        assertEquals("{\"metrics\":{}}", entity.summaryJson)
        assertNotNull(roundTripped.summary)
        assertEquals("{\"metrics\":{}}", roundTripped.summary["raw"])
    }

    @Test
    fun `toTestRunEntity handles a summary map without a raw key by leaving the column null`() {
        val run =
            TestRun(
                id = "run-1",
                status = TestRunStatus.COMPLETED,
                createdAt = "2026-01-01T00:00:00Z",
                summary = mapOf("other" to "value"),
            )

        val entity = run.toTestRunEntity(mapper)

        assertNull(entity.summaryJson)
    }

    @Test
    fun `full round trip preserves every field used by the dashboard and the rerun endpoint`() {
        val configuration =
            TestRunConfiguration(
                apiTitle = "Demo",
                apiVersion = "1",
                baseUrl = "https://target.test",
                loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 3, durationSeconds = 6),
                operations =
                    listOf(
                        TestRunOperationConfiguration(
                            operationId = "getThing",
                            method = "GET",
                            path = "/things/{id}",
                            summary = "Get thing",
                            payloads = emptyList(),
                            parameterValues = listOf(ParameterValue("id", "path", "7")),
                            requestBodyJson = null,
                            bearerTokenConfigured = true,
                        ),
                    ),
            )
        val originalRequest =
            CreateTestRunRequest(
                specification = "openapi document",
                baseUrl = "https://target.test",
                operationIds = setOf("getThing"),
                operationConfigurations = emptyList(),
                loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 3, durationSeconds = 6),
            )
        val run =
            TestRun(
                id = "run-full",
                status = TestRunStatus.ABORTED,
                createdAt = "2026-01-01T00:00:00Z",
                startedAt = "2026-01-01T00:00:01Z",
                finishedAt = "2026-01-01T00:00:30Z",
                exitCode = 137,
                configuration = configuration,
                summary = mapOf("raw" to "summary"),
                consoleOutput = "captured k6 output",
                error = "captured k6 output",
                cancelledAt = "2026-01-01T00:00:20Z",
                cancelledByForce = true,
                originalRequest = originalRequest,
            )

        val roundTripped = run.toTestRunEntity(mapper).toTestRun(mapper)

        val expectedConfiguration =
            configuration.copy(
                operations =
                    configuration.operations.map { operation ->
                        operation.copy(parameterValues = emptyList())
                    },
            )
        val expectedOriginalRequest =
            originalRequest.copy(
                operationConfigurations =
                    originalRequest.operationConfigurations.map { configuration ->
                        configuration.copy(
                            payloads = emptyList(),
                            parameterValues = emptyList(),
                            requestBodyJson = null,
                            bearerToken = null,
                            basicAuthUsername = null,
                            basicAuthPassword = null,
                            apiKey = null,
                            oauth2Token = null,
                            oidcIdToken = null,
                        )
                    },
            )
        assertEquals(
            run.copy(
                configuration = expectedConfiguration,
                originalRequest = expectedOriginalRequest,
            ),
            roundTripped,
        )
    }

    @Test
    fun `toTestRunEntity encrypts the configuration and originalRequest columns when an encryptor is provided`() {
        val configuration =
            TestRunConfiguration(
                apiTitle = "Demo",
                apiVersion = "1",
                baseUrl = "https://target.test",
                loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                operations =
                    listOf(
                        TestRunOperationConfiguration(
                            operationId = "getThing",
                            method = "GET",
                            path = "/things/{id}",
                            summary = "Get thing",
                            payloads = emptyList(),
                            parameterValues = emptyList(),
                            requestBodyJson = null,
                        ),
                    ),
            )
        val originalRequest =
            CreateTestRunRequest(
                specification = "openapi document",
                baseUrl = "https://target.test",
                operationIds = setOf("getThing"),
                operationConfigurations = emptyList(),
                loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
            )
        val run =
            TestRun(
                id = "run-1",
                status = TestRunStatus.QUEUED,
                createdAt = "2026-01-01T00:00:00Z",
                configuration = configuration,
                originalRequest = originalRequest,
            )
        val encryptor = AesGcmTestRunPayloadEncryptor(randomKey())

        val entity = run.toTestRunEntity(mapper, encryptor)

        val plainConfig = mapper.writeValueAsString(configuration)
        val plainRequest = mapper.writeValueAsString(originalRequest)
        assertNotEquals(plainConfig, entity.configurationJson)
        assertNotEquals(plainRequest, entity.originalRequestJson)
        assertNotNull(entity.configurationJson)
        assertNotNull(entity.originalRequestJson)
        assertTrue(entity.configurationJson!!.startsWith("TEVOQ"), "expected encrypted magic prefix, got: ${entity.configurationJson}")
        assertTrue(entity.originalRequestJson!!.startsWith("TEVOQ"), "expected encrypted magic prefix, got: ${entity.originalRequestJson}")
    }

    @Test
    fun `toTestRun decrypts the configuration and originalRequest columns when an encryptor is provided`() {
        val configuration =
            TestRunConfiguration(
                apiTitle = "Demo",
                apiVersion = "1",
                baseUrl = "https://target.test",
                loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                operations =
                    listOf(
                        TestRunOperationConfiguration(
                            operationId = "getThing",
                            method = "GET",
                            path = "/things/{id}",
                            summary = "Get thing",
                            payloads = emptyList(),
                            parameterValues = emptyList(),
                            requestBodyJson = null,
                        ),
                    ),
            )
        val originalRequest =
            CreateTestRunRequest(
                specification = "openapi document",
                baseUrl = "https://target.test",
                operationIds = setOf("getThing"),
                operationConfigurations = emptyList(),
                loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
            )
        val key = randomKey()
        val writer = AesGcmTestRunPayloadEncryptor(key)
        val reader = AesGcmTestRunPayloadEncryptor(key)
        val run =
            TestRun(
                id = "run-1",
                status = TestRunStatus.QUEUED,
                createdAt = "2026-01-01T00:00:00Z",
                configuration = configuration,
                originalRequest = originalRequest,
            )
        val entity = run.toTestRunEntity(mapper, writer)

        val roundTripped = entity.toTestRun(mapper, reader)

        assertEquals(configuration, roundTripped.configuration)
        assertEquals(originalRequest, roundTripped.originalRequest)
    }

    @Test
    fun `encrypted round trip survives when the configuration or request is missing`() {
        val run =
            TestRun(
                id = "run-1",
                status = TestRunStatus.QUEUED,
                createdAt = "2026-01-01T00:00:00Z",
            )
        val encryptor = AesGcmTestRunPayloadEncryptor(randomKey())

        val entity = run.toTestRunEntity(mapper, encryptor)
        val roundTripped = entity.toTestRun(mapper, encryptor)

        assertNull(entity.configurationJson)
        assertNull(entity.originalRequestJson)
        assertNull(roundTripped.configuration)
        assertNull(roundTripped.originalRequest)
    }

    @Test
    fun `toTestRun returns the configuration as null when the encrypted column was written with a different key`() {
        val configuration =
            TestRunConfiguration(
                apiTitle = "Demo",
                apiVersion = "1",
                baseUrl = "https://target.test",
                loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                operations = emptyList(),
            )
        val run =
            TestRun(
                id = "run-1",
                status = TestRunStatus.QUEUED,
                createdAt = "2026-01-01T00:00:00Z",
                configuration = configuration,
            )
        val writer = AesGcmTestRunPayloadEncryptor(randomKey())
        val reader = AesGcmTestRunPayloadEncryptor(randomKey())
        val entity = run.toTestRunEntity(mapper, writer)

        val roundTripped = entity.toTestRun(mapper, reader)

        assertNull(roundTripped.configuration)
    }

    @Test
    fun `toTestRun reads a plaintext column written by an older build as the original configuration`() {
        val configuration =
            TestRunConfiguration(
                apiTitle = "Demo",
                apiVersion = "1",
                baseUrl = "https://target.test",
                loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                operations =
                    listOf(
                        TestRunOperationConfiguration(
                            operationId = "getThing",
                            method = "GET",
                            path = "/things/{id}",
                            summary = "Get thing",
                            payloads = emptyList(),
                            parameterValues = emptyList(),
                            requestBodyJson = null,
                        ),
                    ),
            )
        val entity =
            TestRunEntity().apply {
                id = "run-legacy"
                status = TestRunStatus.QUEUED
                createdAt = java.time.Instant.parse("2026-01-01T00:00:00Z")
                configurationJson = mapper.writeValueAsString(configuration)
                originalRequestJson = null
            }
        val encryptor = AesGcmTestRunPayloadEncryptor(randomKey())

        val roundTripped = entity.toTestRun(mapper, encryptor)

        assertEquals(configuration, roundTripped.configuration)
    }

    @Test
    fun `toTestRunEntity strips every payload field from the persisted configuration operations`() {
        val configuration =
            TestRunConfiguration(
                apiTitle = "Demo",
                apiVersion = "1",
                baseUrl = "https://target.test",
                loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                operations =
                    listOf(
                        TestRunOperationConfiguration(
                            operationId = "createOrder",
                            method = "POST",
                            path = "/orders",
                            summary = "Create order",
                            payloads =
                                listOf(
                                    OperationPayload(
                                        parameterValues = listOf(ParameterValue("client", "header", "secret-client")),
                                        requestBodyJson = """{"customer":"C-1","items":["a","b"]}""",
                                        bearerToken = "secret-bearer",
                                        basicAuthUsername = "secret-user",
                                        basicAuthPassword = "secret-pass",
                                        apiKey = "secret-key",
                                        oauth2Token = "secret-oauth",
                                        oidcIdToken = "secret-oidc",
                                    ),
                                ),
                            parameterValues = listOf(ParameterValue("client", "header", "secret-client")),
                            requestBodyJson = """{"customer":"C-1","items":["a","b"]}""",
                            bearerTokenConfigured = true,
                            basicAuthConfigured = true,
                            apiKeyConfigured = true,
                            oauth2TokenConfigured = true,
                            oidcIdTokenConfigured = true,
                        ),
                    ),
            )
        val run =
            TestRun(
                id = "run-strip",
                status = TestRunStatus.QUEUED,
                createdAt = "2026-01-01T00:00:00Z",
                configuration = configuration,
            )

        val entity = run.toTestRunEntity(mapper)
        val roundTripped = entity.toTestRun(mapper)
        val roundTrippedOperation = assertNotNull(roundTripped.configuration).operations.single()

        assertEquals(emptyList<OperationPayload>(), roundTrippedOperation.payloads)
        assertEquals(emptyList<ParameterValue>(), roundTrippedOperation.parameterValues)
        assertNull(roundTrippedOperation.requestBodyJson)
        assertEquals(true, roundTrippedOperation.bearerTokenConfigured)
        assertEquals(true, roundTrippedOperation.basicAuthConfigured)
        assertEquals(true, roundTrippedOperation.apiKeyConfigured)
        assertEquals(true, roundTrippedOperation.oauth2TokenConfigured)
        assertEquals(true, roundTrippedOperation.oidcIdTokenConfigured)
        assertEquals("createOrder", roundTrippedOperation.operationId)
        assertEquals("POST", roundTrippedOperation.method)
        assertEquals("/orders", roundTrippedOperation.path)
        assertEquals(1, roundTripped.configuration.loadProfile.virtualUsers)
        assertEquals(1, roundTripped.configuration.loadProfile.durationSeconds)
    }

    @Test
    fun `toTestRunEntity strips every payload field from the persisted originalRequest`() {
        val originalRequest =
            CreateTestRunRequest(
                specification = "openapi document",
                baseUrl = "https://target.test",
                operationIds = setOf("createOrder"),
                operationConfigurations =
                    listOf(
                        OperationConfiguration(
                            operationId = "createOrder",
                            payloads =
                                listOf(
                                    OperationPayload(
                                        parameterValues = listOf(ParameterValue("client", "header", "secret-client")),
                                        requestBodyJson = """{"customer":"C-1"}""",
                                        bearerToken = "secret-bearer",
                                        basicAuthUsername = "secret-user",
                                        basicAuthPassword = "secret-pass",
                                        apiKey = "secret-key",
                                        oauth2Token = "secret-oauth",
                                        oidcIdToken = "secret-oidc",
                                    ),
                                ),
                            parameterValues = listOf(ParameterValue("client", "header", "secret-client")),
                            requestBodyJson = """{"customer":"C-1"}""",
                            bearerToken = "secret-bearer",
                            basicAuthUsername = "secret-user",
                            basicAuthPassword = "secret-pass",
                            apiKey = "secret-key",
                            oauth2Token = "secret-oauth",
                            oidcIdToken = "secret-oidc",
                        ),
                    ),
                loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 2, durationSeconds = 4),
            )
        val run =
            TestRun(
                id = "run-strip-req",
                status = TestRunStatus.QUEUED,
                createdAt = "2026-01-01T00:00:00Z",
                originalRequest = originalRequest,
            )

        val entity = run.toTestRunEntity(mapper)
        val roundTripped = entity.toTestRun(mapper)
        val roundTrippedRequest = assertNotNull(roundTripped.originalRequest)
        val roundTrippedConfiguration = assertNotNull(roundTrippedRequest.operationConfigurations.singleOrNull())

        assertEquals(emptyList<OperationPayload>(), roundTrippedConfiguration.payloads)
        assertEquals(emptyList<ParameterValue>(), roundTrippedConfiguration.parameterValues)
        assertNull(roundTrippedConfiguration.requestBodyJson)
        assertNull(roundTrippedConfiguration.bearerToken)
        assertNull(roundTrippedConfiguration.basicAuthUsername)
        assertNull(roundTrippedConfiguration.basicAuthPassword)
        assertNull(roundTrippedConfiguration.apiKey)
        assertNull(roundTrippedConfiguration.oauth2Token)
        assertNull(roundTrippedConfiguration.oidcIdToken)
        assertEquals("openapi document", roundTrippedRequest.specification)
        assertEquals("https://target.test", roundTrippedRequest.baseUrl)
        assertEquals(setOf("createOrder"), roundTrippedRequest.operationIds)
        assertEquals(2, roundTrippedRequest.loadProfile?.virtualUsers)
        assertEquals(4, roundTrippedRequest.loadProfile?.durationSeconds)
    }

    @Test
    fun `persisted configurationJson never contains the literal request body even without an encryptor`() {
        val requestBody = """{"customer":"C-1","items":["a","b"]}"""
        val configuration =
            TestRunConfiguration(
                apiTitle = "Demo",
                apiVersion = "1",
                baseUrl = "https://target.test",
                loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                operations =
                    listOf(
                        TestRunOperationConfiguration(
                            operationId = "createOrder",
                            method = "POST",
                            path = "/orders",
                            summary = "Create order",
                            payloads = listOf(OperationPayload(requestBodyJson = requestBody)),
                            parameterValues = emptyList(),
                            requestBodyJson = requestBody,
                        ),
                    ),
            )
        val run =
            TestRun(
                id = "run-no-encrypt",
                status = TestRunStatus.QUEUED,
                createdAt = "2026-01-01T00:00:00Z",
                configuration = configuration,
            )

        val entity = run.toTestRunEntity(mapper)
        val column = assertNotNull(entity.configurationJson)

        val unstrippedJson = mapper.writeValueAsString(configuration)
        assertFalse(
            column == unstrippedJson,
            "the persisted column is identical to the unstripped JSON — the strip never ran",
        )
        val roundTripped =
            mapper.readValue(column, TestRunConfiguration::class.java)
        val roundTrippedOperation = roundTripped.operations.single()
        assertEquals(emptyList<OperationPayload>(), roundTrippedOperation.payloads)
        assertNull(roundTrippedOperation.requestBodyJson)
        val bodyWithoutQuotes = requestBody.replace("\"", "")
        assertFalse(
            column.contains(bodyWithoutQuotes),
            "request body content (without JSON quotes) leaked into the persisted configuration column",
        )
    }

    @Test
    fun `persisted configurationJson never contains the literal bearer token even without an encryptor`() {
        val bearer = "eyJhbGciOiJIUzI1NiJ9.dummy.signature"
        val configuration =
            TestRunConfiguration(
                apiTitle = "Demo",
                apiVersion = "1",
                baseUrl = "https://target.test",
                loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                operations =
                    listOf(
                        TestRunOperationConfiguration(
                            operationId = "getMe",
                            method = "GET",
                            path = "/me",
                            summary = "Who am I?",
                            payloads = listOf(OperationPayload(bearerToken = bearer)),
                            parameterValues = emptyList(),
                            requestBodyJson = null,
                            bearerTokenConfigured = true,
                        ),
                    ),
            )
        val run =
            TestRun(
                id = "run-no-encrypt-bearer",
                status = TestRunStatus.QUEUED,
                createdAt = "2026-01-01T00:00:00Z",
                configuration = configuration,
            )

        val entity = run.toTestRunEntity(mapper)

        val column = assertNotNull(entity.configurationJson)
        assertFalse(
            column.contains(bearer),
            "bearer token leaked into the persisted configuration column",
        )
    }

    private companion object {
        fun randomKey(): SecretKeySpec {
            val raw = ByteArray(32)
            java.security.SecureRandom().nextBytes(raw)
            return SecretKeySpec(raw, "AES")
        }
    }
}

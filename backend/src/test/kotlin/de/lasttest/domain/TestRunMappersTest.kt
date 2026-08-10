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

// The mappers are the bridge between the API-facing [TestRun]
// data class and the JPA [TestRunEntity]. Every field that the
// service uses to look up, render, or rerun a run has to survive
// the round trip through H2 — losing the preserved
// [CreateTestRunRequest] in particular would silently break the
// dashboard's "Erneut starten" action for historical runs. These
// tests pin the round-trip shape so a future refactor cannot drop
// a column without the test suite noticing.
class TestRunMappersTest {
    private val mapper = ObjectMapper().registerModule(KotlinModule.Builder().build())

    @Test
    fun `toTestRunEntity copies every scalar field onto the entity`() {
        // The fields that survive the round trip the cleanest:
        // the simple types (id, status, exitCode, the wall-clock
        // timestamps). The mapper must use the same Instant
        // representation the JPA column expects — not a string
        // and not a `null` placeholder.
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
        // A freshly-queued run has no startedAt/finishedAt yet.
        // The mapper must NOT default them to `Instant.now()`
        // (that would freeze the wall-clock time of the save
        // into the row) and must NOT serialise them as empty
        // strings (the read path expects a real `Instant` or
        // null).
        val run = TestRun(id = "run-q", status = TestRunStatus.QUEUED, createdAt = "2026-01-01T00:00:00Z")

        val entity = run.toTestRunEntity(mapper)

        assertNull(entity.startedAt)
        assertNull(entity.finishedAt)
    }

    @Test
    fun `toTestRunEntity serialises configuration and originalRequest as JSON`() {
        // The read path is [toTestRun], which deserialises the
        // two JSON columns. If the write path produces invalid
        // JSON the read path silently returns null — which then
        // 409s the rerun endpoint. The structural round trip
        // (method/path/load-profile/base-url/operation-ids) must
        // come back identical so the dashboard does not see a
        // different run shape across a server restart.
        //
        // Payload data (request body, parameter values, auth
        // tokens) is intentionally stripped before persistence
        // — see the dedicated payload-stripping tests below.
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

        // Endpoint metadata, load profile, base URL and
        // operation ids survive intact. Payload data (the
        // user-supplied `id=42` parameter value) does NOT —
        // the round-tripped operation has empty payload
        // fields, which is the whole point of the timeline
        // payload stripping.
        assertEquals(
            configuration.copy(
                operations =
                    configuration.operations.map { operation ->
                        operation.copy(parameterValues = emptyList())
                    },
            ),
            roundTripped.configuration,
        )
        // The `OperationConfiguration` envelope is preserved
        // (operationId still points at the right endpoint)
        // but every payload-shaped field on it is stripped.
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
        // The × N counter in the dashboard's operation list is
        // implemented as a `GROUP BY` on (operationMethod,
        // operationPath). Populating these flat columns at
        // write time is cheaper than parsing the configuration
        // JSON on every read.
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
        // The × N counter is per-endpoint; a run without any
        // selected operation contributes to no endpoint. The
        // mapper must NOT default the columns to empty strings
        // because the (method, path) primary key on
        // [OperationStatisticsEntity] would then collide with
        // other empty-string rows.
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
        // The `summary` field on the API DTO is a free-form
        // `Map<String, Any?>` with a single `raw` key today.
        // The persistence layer only knows how to read a CLOB
        // of the raw output; the read path re-wraps it as
        // `mapOf("raw" to it)`. Any other shape (or a missing
        // key) is treated as "no summary" — the run is still
        // persisted, just without the k6 summary blob.
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
        assertEquals("{\"metrics\":{}}", roundTripped.summary?.get("raw"))
    }

    @Test
    fun `toTestRunEntity handles a summary map without a raw key by leaving the column null`() {
        // Forward-compat: a future caller that sends a richer
        // summary shape must not break the write path. We
        // silently drop the column rather than serialise
        // something the read path cannot decode.
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
        // Belt-and-braces: combine every field that has a
        // dedicated getter on the read path and assert the
        // round-tripped DTO equals the original — with the
        // explicit exception of the payload data the write
        // path strips (see [toTestRunEntity]'s KDoc and the
        // dedicated payload-stripping tests). The check is a
        // deliberate superset of the per-field tests above —
        // it catches a regression where one column is written
        // but read under a different name, or where the JSON
        // serialisation loses a field that the dashboard
        // expects.
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

        // The round-tripped DTO is equal to the input MINUS
        // the payload data the write path strips. Build the
        // expected payload-free shape directly so the
        // assertion documents exactly which fields are
        // dropped (and which `*Configured` flags survive).
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
        // The at-rest encryption feature: the timeline's
        // sensitive columns (configuration, original request)
        // are stored encrypted, not as plaintext JSON. The
        // mapper must call the encryptor for both columns;
        // a regression that drops either one of the two
        // encrypt calls would silently leave the column
        // readable by anyone with H2 file access.
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

        // The persisted columns must NOT match the plaintext
        // JSON. A regression that drops the encrypt call
        // would store the literal JSON in the column and
        // anyone with the H2 file could read the API
        // credentials. The exact encrypted bytes are not
        // pinned (a fresh IV produces a different blob on
        // every call) — only "is it no longer plaintext?".
        val plainConfig = mapper.writeValueAsString(configuration)
        val plainRequest = mapper.writeValueAsString(originalRequest)
        assertNotEquals(plainConfig, entity.configurationJson)
        assertNotEquals(plainRequest, entity.originalRequestJson)
        // The encrypted blob must carry the LENC magic so
        // the read path can tell it apart from a legacy
        // plaintext row.
        assertNotNull(entity.configurationJson)
        assertNotNull(entity.originalRequestJson)
        assertTrue(entity.configurationJson!!.startsWith("TEVOQ"), "expected encrypted magic prefix, got: ${entity.configurationJson}")
        assertTrue(entity.originalRequestJson!!.startsWith("TEVOQ"), "expected encrypted magic prefix, got: ${entity.originalRequestJson}")
    }

    @Test
    fun `toTestRun decrypts the configuration and originalRequest columns when an encryptor is provided`() {
        // The read path is the inverse of the write path.
        // A row that was encrypted by a previous write must
        // come back to the dashboard as the original DTO,
        // not as the encrypted blob.
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
        // The encryptor must be called with `null` for
        // runs that have no configuration (e.g. synthetic
        // rows in the test suite). A regression that always
        // serialises — even when the input is null — would
        // fail the round trip because `mapper.writeValueAsString(null)`
        // returns the literal string "null", which is a
        // valid DTO that the dashboard would render as an
        // empty configuration.
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
        // Container A encrypts a row with key A, container
        // B reads with key B. The decrypt path must return
        // `null` for both columns so the dashboard sees a
        // row without a configuration (and the user's
        // "Erneut starten" action 409s with a clean error)
        // rather than a 500 from a Jackson parse error
        // against garbage bytes.
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
        // The backward-compat branch: a row written by a
        // build before the encryption feature shipped carries
        // a plain JSON column, not an encrypted blob. The
        // encryptor must detect the absence of the magic
        // prefix and return the column unchanged so the
        // mapper can still parse it. Without this branch a
        // single deploy would make the entire historical
        // timeline unreadable until every row is manually
        // re-encrypted.
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
                // Pre-encryption build wrote the raw JSON straight
                // into the column. No magic prefix, no Base64.
                configurationJson = mapper.writeValueAsString(configuration)
                originalRequestJson = null
            }
        val encryptor = AesGcmTestRunPayloadEncryptor(randomKey())

        val roundTripped = entity.toTestRun(mapper, encryptor)

        assertEquals(configuration, roundTripped.configuration)
    }

    // ---- timeline payload stripping -----------------------------------
    //
    // The timeline is intentionally payload-free: the write
    // path drops every request dataset (request body,
    // parameter values, auth tokens, …) from the
    // [TestRunConfiguration] snapshot AND from the preserved
    // [CreateTestRunRequest] before serialisation. The tests
    // below pin the contract end-to-end (round-trip) and
    // field-by-field so a future regression that re-adds the
    // payload data to the persisted columns fails the build.
    //
    // What survives is documented inline below: endpoint
    // metadata, load profile, the `*Configured` boolean flags
    // (metadata, not credentials) and the structural fields
    // of the [CreateTestRunRequest] envelope (spec, base URL,
    // operation ids).

    @Test
    fun `toTestRunEntity strips every payload field from the persisted configuration operations`() {
        // Build a configuration with a fully populated
        // payload pool so the assertion can check every
        // payload-shaped field by name. Endpoint metadata,
        // load profile and `*Configured` flags survive.
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

        // Every payload-shaped field is gone.
        assertEquals(emptyList<OperationPayload>(), roundTrippedOperation.payloads)
        assertEquals(emptyList<ParameterValue>(), roundTrippedOperation.parameterValues)
        assertNull(roundTrippedOperation.requestBodyJson)
        // The `*Configured` flags are metadata, not
        // credentials, so they survive.
        assertEquals(true, roundTrippedOperation.bearerTokenConfigured)
        assertEquals(true, roundTrippedOperation.basicAuthConfigured)
        assertEquals(true, roundTrippedOperation.apiKeyConfigured)
        assertEquals(true, roundTrippedOperation.oauth2TokenConfigured)
        assertEquals(true, roundTrippedOperation.oidcIdTokenConfigured)
        // Endpoint metadata and the load profile are
        // untouched.
        assertEquals("createOrder", roundTrippedOperation.operationId)
        assertEquals("POST", roundTrippedOperation.method)
        assertEquals("/orders", roundTrippedOperation.path)
        assertEquals(1, roundTripped.configuration?.loadProfile?.virtualUsers)
        assertEquals(1, roundTripped.configuration?.loadProfile?.durationSeconds)
    }

    @Test
    fun `toTestRunEntity strips every payload field from the persisted originalRequest`() {
        // Same contract on the request envelope: every
        // payload field on every [OperationConfiguration] is
        // dropped, every structural field is preserved.
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

        // Every payload-shaped field is gone on both the
        // pool AND the legacy flat fields.
        assertEquals(emptyList<OperationPayload>(), roundTrippedConfiguration.payloads)
        assertEquals(emptyList<ParameterValue>(), roundTrippedConfiguration.parameterValues)
        assertNull(roundTrippedConfiguration.requestBodyJson)
        assertNull(roundTrippedConfiguration.bearerToken)
        assertNull(roundTrippedConfiguration.basicAuthUsername)
        assertNull(roundTrippedConfiguration.basicAuthPassword)
        assertNull(roundTrippedConfiguration.apiKey)
        assertNull(roundTrippedConfiguration.oauth2Token)
        assertNull(roundTrippedConfiguration.oidcIdToken)
        // Structural fields survive so the dashboard's
        // `Erneut starten` action still reproduces a run.
        assertEquals("openapi document", roundTrippedRequest.specification)
        assertEquals("https://target.test", roundTrippedRequest.baseUrl)
        assertEquals(setOf("createOrder"), roundTrippedRequest.operationIds)
        assertEquals(2, roundTrippedRequest.loadProfile?.virtualUsers)
        assertEquals(4, roundTrippedRequest.loadProfile?.durationSeconds)
    }

    @Test
    fun `persisted configurationJson never contains the literal request body even without an encryptor`() {
        // Defence in depth: the strip must happen BEFORE the
        // encryptor (and the encryptor's absence) sees the
        // data. A regression that moved the strip after the
        // serialise call would still leak the body into the
        // column for deployments without an encryption key
        // configured (the no-op encryptor passes the bytes
        // through verbatim). We deserialise the column back
        // to the data class — a substring search on the raw
        // bytes would miss the body because Jackson escapes
        // the embedded quotes, masking the regression.
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

        // The persisted column must NOT equal the
        // unstripped JSON. If the strip is removed entirely
        // this assertion fires — the persisted bytes are
        // byte-for-byte the original configuration.
        val unstrippedJson = mapper.writeValueAsString(configuration)
        assertFalse(
            column == unstrippedJson,
            "the persisted column is identical to the unstripped JSON — the strip never ran",
        )
        // Round-trip back to the data class and assert the
        // payload field is empty. Substring checks against
        // the raw bytes are unreliable because Jackson
        // escapes the embedded quotes, so a regression
        // would still pass such a check.
        val roundTripped =
            mapper.readValue(column, TestRunConfiguration::class.java)
        val roundTrippedOperation = roundTripped.operations.single()
        assertEquals(emptyList<OperationPayload>(), roundTrippedOperation.payloads)
        assertNull(roundTrippedOperation.requestBodyJson)
        // The persisted column must NOT contain the raw
        // request body bytes. Even with the escaping caveat
        // above, a sufficiently large body cannot be fully
        // hidden by quote escaping alone — the body length
        // is preserved. The substring here is the body
        // WITHOUT the JSON quotes so the comparison is
        // stable across Jackson's encoder choice.
        val bodyWithoutQuotes = requestBody.replace("\"", "")
        assertFalse(
            column.contains(bodyWithoutQuotes),
            "request body content (without JSON quotes) leaked into the persisted configuration column",
        )
    }

    @Test
    fun `persisted configurationJson never contains the literal bearer token even without an encryptor`() {
        // Same defence-in-depth check, but for an auth
        // credential rather than a request body. The literal
        // token MUST NOT appear in the column under any
        // configuration.
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
        /**
         * Returns a fresh 32-byte key as a [SecretKeySpec] the
         * encryptor can use directly. A new key per call keeps
         * the encrypted round-trip test independent from the
         * other tests (a shared key would silently mask a
         * regression that re-used a cached blob from a previous
         * test run).
         */
        fun randomKey(): SecretKeySpec {
            val raw = ByteArray(32)
            java.security.SecureRandom().nextBytes(raw)
            return SecretKeySpec(raw, "AES")
        }
    }
}

package de.lasttest.domain

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.KotlinModule
import de.lasttest.api.CreateTestRunRequest
import de.lasttest.api.LoadProfile
import de.lasttest.api.LoadProfileType
import de.lasttest.api.OperationConfiguration
import de.lasttest.api.ParameterValue
import de.lasttest.api.TestRun
import de.lasttest.api.TestRunConfiguration
import de.lasttest.api.TestRunOperationConfiguration
import de.lasttest.api.TestRunStatus
import java.time.Instant
import javax.crypto.spec.SecretKeySpec
import kotlin.test.Test
import kotlin.test.assertEquals
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
        // 409s the rerun endpoint. The round trip has to come
        // back byte-for-byte equal at the data class level so
        // the dashboard does not see a different run shape
        // across a server restart.
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

        assertEquals(configuration, roundTripped.configuration)
        assertEquals(originalRequest, roundTripped.originalRequest)
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
        // round-tripped DTO equals the original. The check is
        // a deliberate superset of the per-field tests above —
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

        assertEquals(run, roundTripped)
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

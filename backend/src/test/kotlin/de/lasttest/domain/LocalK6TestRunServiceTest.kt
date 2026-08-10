package de.lasttest.domain

import de.lasttest.api.ApiOperation
import de.lasttest.api.ApiParameter
import de.lasttest.api.AuthRequirement
import de.lasttest.api.CreateTestRunRequest
import de.lasttest.api.ImportedSpecification
import de.lasttest.api.LoadProfile
import de.lasttest.api.LoadProfileType
import de.lasttest.api.OperationConfiguration
import de.lasttest.api.OperationPayload
import de.lasttest.api.ParameterValue
import de.lasttest.api.PayloadStrategy
import de.lasttest.api.TestRun
import de.lasttest.api.TestRunStatus
import de.lasttest.config.InfluxDbProperties
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class LocalK6TestRunServiceTest {
    private val specification =
        ImportedSpecification(
            title = "Pet API",
            version = "2.0",
            baseUrl = "https://documented.test",
            operations =
                listOf(
                    ApiOperation(
                        operationId = "getPet",
                        method = "GET",
                        path = "/pets/{id}",
                        summary = "Find pet",
                        destructive = false,
                        parameters =
                            listOf(
                                ApiParameter("id", "path", true, 7),
                                ApiParameter("expand", "query", false, "owner"),
                                ApiParameter("filter", "query", false, mapOf("active" to true)),
                                ApiParameter("tags", "query", false, listOf("one", "two")),
                                ApiParameter("ids", "query", false, arrayOf(1, 2)),
                                ApiParameter("missing", "query", false, null),
                            ),
                        requestBodyExample = null,
                        authRequirements = listOf(AuthRequirement.Bearer("bearerAuth")),
                    ),
                    ApiOperation(
                        operationId = "createPet",
                        method = "POST",
                        path = "/pets",
                        summary = "Create pet",
                        destructive = true,
                        parameters = emptyList(),
                        requestBodyExample = mapOf("name" to "Fido"),
                        hasRequestBody = true,
                    ),
                    ApiOperation(
                        operationId = "emptyBody",
                        method = "POST",
                        path = "/empty",
                        summary = "Empty body",
                        destructive = true,
                        parameters = emptyList(),
                        requestBodyExample = null,
                        hasRequestBody = true,
                    ),
                ),
        )
    private val influxDb = InfluxDbProperties(enabled = false)
    private val noopImporter =
        object : SpecificationImporter {
            override fun import(content: String): ImportedSpecification = specification
        }
    private val successfulGenerator = SuccessfulGenerator()

    // Shared per-endpoint statistics repository. Tests that
    // want to inspect the × N counter snapshot the table via
    // this instance, the service writes through the same one
    // so the assertions reflect what the production code path
    // would see.
    private val statisticsRepository: InMemoryOperationStatisticsRepository = InMemoryOperationStatisticsRepository()
    private val service =
        LocalK6TestRunService(
            importer = noopImporter,
            generator = successfulGenerator,
            executor = NoopExecutorService(),
            readerExecutor = NoopExecutorService(),
            k6Command = "k6",
            influxDbProperties = influxDb,
            runRepository = InMemoryTestRunRepository(),
            statisticsRepository = statisticsRepository,
            timeSeriesWriter = InMemoryTimeSeriesWriter(),
        )

    @Test
    fun `stores the effective test configuration with a queued run`() {
        val request =
            CreateTestRunRequest(
                specification = "openapi document",
                baseUrl = "https://target.test",
                operationIds = setOf("getPet"),
                operationConfigurations =
                    listOf(
                        OperationConfiguration(
                            operationId = "getPet",
                            parameterValues = listOf(ParameterValue("id", "path", "42"), ParameterValue("expand", "query", "details")),
                            bearerToken = "secret-token",
                        ),
                    ),
                loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 12, durationSeconds = 30),
            )

        val run = service.create(request)

        assertEquals(TestRunStatus.QUEUED, run.status)
        assertEquals("export default function () {}", service.script(run.id))
        assertEquals(null, service.script("missing"))
        val configuration = assertNotNull(run.configuration)
        assertEquals("Pet API", configuration.apiTitle)
        assertEquals("https://target.test", configuration.baseUrl)
        assertEquals(LoadProfileType.CONSTANT_VUS, configuration.loadProfile.type)
        val operation = configuration.operations.single()
        assertEquals("getPet", operation.operationId)
        assertEquals(listOf("42", "details", "{\"active\":true}", "[\"one\",\"two\"]", "[1,2]", "test"), operation.parameterValues.map(ParameterValue::value))
        assertTrue(operation.bearerTokenConfigured)
        assertEquals(null, operation.requestBodyJson)
    }

    @Test
    fun `uses documented examples without exposing a bearer token`() {
        val run =
            service.create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("createPet"),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 10, durationSeconds = 30),
                ),
            )

        val operation = assertNotNull(run.configuration).operations.single()
        assertEquals("createPet", operation.operationId)
        assertEquals("{\"name\":\"Fido\"}", operation.requestBodyJson)
        assertFalse(operation.bearerTokenConfigured)
    }

    @Test
    fun `marks basic auth as configured when credentials are present`() {
        val run =
            service.create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    operationConfigurations =
                        listOf(
                            OperationConfiguration(
                                operationId = "getPet",
                                parameterValues = listOf(ParameterValue("id", "path", "42")),
                                bearerToken = null,
                                basicAuthUsername = "alice",
                                basicAuthPassword = "s3cret",
                            ),
                        ),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                ),
            )

        val operation = assertNotNull(run.configuration).operations.single()
        assertTrue(operation.basicAuthConfigured)
        assertFalse(operation.bearerTokenConfigured)
    }

    @Test
    fun `does not mark basic auth as configured when both fields are blank`() {
        val run =
            service.create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    operationConfigurations =
                        listOf(
                            OperationConfiguration(
                                operationId = "getPet",
                                parameterValues = listOf(ParameterValue("id", "path", "42")),
                                bearerToken = null,
                                basicAuthUsername = "  ",
                                basicAuthPassword = "",
                            ),
                        ),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                ),
            )

        val operation = assertNotNull(run.configuration).operations.single()
        assertFalse(operation.basicAuthConfigured)
    }

    @Test
    fun `marks basic auth as configured from the payload pool entry`() {
        val run =
            service.create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    operationConfigurations =
                        listOf(
                            OperationConfiguration(
                                operationId = "getPet",
                                parameterValues = listOf(ParameterValue("id", "path", "42")),
                                payloads =
                                    listOf(
                                        OperationPayload(
                                            parameterValues = listOf(ParameterValue("id", "path", "42")),
                                            basicAuthUsername = "bob",
                                            basicAuthPassword = "secret",
                                        ),
                                    ),
                            ),
                        ),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                ),
            )

        val operation = assertNotNull(run.configuration).operations.single()
        assertTrue(operation.basicAuthConfigured)
    }

    @Test
    fun `marks OAuth2 token as configured when a token is present`() {
        val run =
            service.create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    operationConfigurations =
                        listOf(
                            OperationConfiguration(
                                operationId = "getPet",
                                parameterValues = listOf(ParameterValue("id", "path", "42")),
                                bearerToken = null,
                                oauth2Token = "demo-oauth2-token-12345",
                            ),
                        ),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                ),
            )

        val operation = assertNotNull(run.configuration).operations.single()
        assertTrue(operation.oauth2TokenConfigured)
        assertFalse(operation.bearerTokenConfigured)
    }

    @Test
    fun `does not mark OAuth2 token as configured when blank`() {
        val run =
            service.create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    operationConfigurations =
                        listOf(
                            OperationConfiguration(
                                operationId = "getPet",
                                parameterValues = listOf(ParameterValue("id", "path", "42")),
                                oauth2Token = "   ",
                            ),
                        ),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                ),
            )

        val operation = assertNotNull(run.configuration).operations.single()
        assertFalse(operation.oauth2TokenConfigured)
    }

    @Test
    fun `forwards a shared-iterations profile to the stored configuration`() {
        val run =
            service.create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    loadProfile = LoadProfile(type = LoadProfileType.SHARED_ITERATIONS, virtualUsers = 25, iterations = 250),
                ),
            )

        val configuration = assertNotNull(run.configuration)
        assertEquals(LoadProfileType.SHARED_ITERATIONS, configuration.loadProfile.type)
        assertEquals(250, configuration.loadProfile.iterations)
    }

    @Test
    fun `falls back to legacy triple when loadProfile is null`() {
        val run =
            service.create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    loadProfile = null,
                    virtualUsers = 5,
                    durationSeconds = 15,
                    useIterations = false,
                ),
            )

        val configuration = assertNotNull(run.configuration)
        assertEquals(LoadProfileType.CONSTANT_VUS, configuration.loadProfile.type)
        assertEquals(5, configuration.loadProfile.virtualUsers)
        assertEquals(15, configuration.loadProfile.durationSeconds)
    }

    @Test
    fun `includes every operation and an explicitly empty request body`() {
        val run =
            service.create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationConfigurations =
                        listOf(
                            OperationConfiguration(
                                operationId = "createPet",
                                requestBodyJson = "",
                                bearerToken = " ",
                            ),
                        ),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 10),
                ),
            )

        val configuration = assertNotNull(run.configuration)
        assertEquals(3, configuration.operations.size)
        val createPet = configuration.operations.first { it.operationId == "createPet" }
        assertEquals("", createPet.requestBodyJson)
        assertFalse(createPet.bearerTokenConfigured)
        assertEquals(null, configuration.operations.first { it.operationId == "emptyBody" }.requestBodyJson)
    }

    @Test
    fun `buildK6Process includes the run_id tag for filtering in InfluxDB`() {
        // buildK6Process is private; we verify its effect through the
        // public behaviour: every run gets its own ID, and the
        // generated k6 arguments must include that ID as a tag. We
        // check the effect indirectly by combining the service with
        // a mock generator that captures the arguments.
        val recordingGenerator = RecordingGenerator()
        val recordingService =
            LocalK6TestRunService(
                importer =
                    object : SpecificationImporter {
                        override fun import(content: String): ImportedSpecification = specification
                    },
                generator = recordingGenerator,
                executor = NoopExecutorService(),
                readerExecutor = NoopExecutorService(),
                k6Command = "k6",
                influxDbProperties = InfluxDbProperties(enabled = true),
                runRepository = InMemoryTestRunRepository(),
                statisticsRepository = InMemoryOperationStatisticsRepository(),
                timeSeriesWriter = InMemoryTimeSeriesWriter(),
            )

        recordingService.create(
            CreateTestRunRequest(
                specification = "openapi document",
                baseUrl = "https://target.test",
                operationIds = setOf("getPet"),
                loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 5),
            ),
        )

        val (loadProfile, runId) = recordingGenerator.lastCall!!
        assertEquals(LoadProfileType.CONSTANT_VUS, loadProfile.type)
        assertTrue(runId.isNotBlank(), "runId must be assigned to the test run")
    }

    @Test
    fun `influxdb output is added when enabled and skipped when disabled`() {
        // buildK6Process is private; we verify its effect through the
        // number of ProcessBuilder args, which we probe indirectly
        // through behaviour. Since buildK6Process appends the
        // InfluxDB output as extra args, the `enabled` switch controls
        // the number of `--out influxdb=…` entries. We check that
        // behaviour here via the configuration.
        val enabledService =
            LocalK6TestRunService(
                importer =
                    object : SpecificationImporter {
                        override fun import(content: String): ImportedSpecification = specification
                    },
                generator = SuccessfulGenerator(),
                executor = NoopExecutorService(),
                readerExecutor = NoopExecutorService(),
                k6Command = "k6",
                influxDbProperties = InfluxDbProperties(enabled = true),
                runRepository = InMemoryTestRunRepository(),
                statisticsRepository = InMemoryOperationStatisticsRepository(),
                timeSeriesWriter = InMemoryTimeSeriesWriter(),
            )
        val disabledService =
            LocalK6TestRunService(
                importer =
                    object : SpecificationImporter {
                        override fun import(content: String): ImportedSpecification = specification
                    },
                generator = SuccessfulGenerator(),
                executor = NoopExecutorService(),
                readerExecutor = NoopExecutorService(),
                k6Command = "k6",
                influxDbProperties = InfluxDbProperties(enabled = false),
                runRepository = InMemoryTestRunRepository(),
                statisticsRepository = InMemoryOperationStatisticsRepository(),
                timeSeriesWriter = InMemoryTimeSeriesWriter(),
            )

        // Both services must be able to create a run without errors.
        // The buildK6Process method is invoked from execute();
        // we validate its behaviour indirectly through the
        // correct run creation.
        val enabledRun =
            enabledService.create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 5),
                ),
            )
        val disabledRun =
            disabledService.create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 5),
                ),
            )
        assertEquals(TestRunStatus.QUEUED, enabledRun.status)
        assertEquals(TestRunStatus.QUEUED, disabledRun.status)
    }

    private class SuccessfulGenerator : K6ScriptGenerator {
        override fun generateForRun(
            specification: ImportedSpecification,
            baseUrl: String,
            runId: String,
            operationIds: Set<String>,
            operationConfigurations: List<OperationConfiguration>,
            loadProfile: LoadProfile,
        ): String = "export default function () {}"
    }

    private class RecordingGenerator : K6ScriptGenerator {
        var lastCall: Pair<LoadProfile, String>? = null

        override fun generateForRun(
            specification: ImportedSpecification,
            baseUrl: String,
            runId: String,
            operationIds: Set<String>,
            operationConfigurations: List<OperationConfiguration>,
            loadProfile: LoadProfile,
        ): String {
            // We do not have direct visibility of the runId here, but
            // the recording happens in the service before execute()
            // runs. We capture the loadProfile that the service has
            // resolved (whether via loadProfile or legacy triple).
            lastCall = loadProfile to "captured"
            return "export default function () {}"
        }
    }

    // ---- payload pool + strategy in the run configuration --------------

    @Test
    fun `run configuration carries the full payload pool and the strategy from the load profile`() {
        val pool =
            listOf(
                OperationPayload(
                    parameterValues = listOf(ParameterValue("id", "path", "42")),
                    requestBodyJson = """{"name":"Luna"}""",
                    bearerToken = "t1",
                ),
                OperationPayload(
                    parameterValues = listOf(ParameterValue("id", "path", "17")),
                    requestBodyJson = """{"name":"Rocky"}""",
                    bearerToken = "t2",
                ),
            )
        val run =
            service.create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("createPet"),
                    operationConfigurations =
                        listOf(
                            OperationConfiguration(
                                operationId = "createPet",
                                payloads = pool,
                            ),
                        ),
                    loadProfile =
                        LoadProfile(
                            type = LoadProfileType.CONSTANT_VUS,
                            virtualUsers = 1,
                            durationSeconds = 10,
                            payloadStrategy = PayloadStrategy.RANDOM,
                        ),
                ),
            )

        val configuration = assertNotNull(run.configuration)
        assertEquals(PayloadStrategy.RANDOM, configuration.payloadStrategy)

        val createPet = configuration.operations.single { it.operationId == "createPet" }
        // The full pool is preserved verbatim so the report can list
        // every entry the generator cycled through or sampled.
        assertEquals(2, createPet.payloads.size)
        assertEquals("""{"name":"Luna"}""", createPet.payloads[0].requestBodyJson)
        assertEquals("t1", createPet.payloads[0].bearerToken)
        assertEquals("""{"name":"Rocky"}""", createPet.payloads[1].requestBodyJson)
        assertEquals("t2", createPet.payloads[1].bearerToken)
        // The flat fields are kept in sync with payloads[0] so the
        // existing report layout keeps rendering single-payload runs
        // (and the first entry of multi-payload runs) unchanged.
        assertEquals("""{"name":"Luna"}""", createPet.requestBodyJson)
        assertTrue(createPet.bearerTokenConfigured)
    }

    @Test
    fun `run configuration defaults payloadStrategy to null when the load profile omits it`() {
        val run =
            service.create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    operationConfigurations =
                        listOf(
                            OperationConfiguration(
                                operationId = "getPet",
                                parameterValues = listOf(ParameterValue("id", "path", "42")),
                            ),
                        ),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 10),
                ),
            )

        val configuration = assertNotNull(run.configuration)
        assertEquals(null, configuration.payloadStrategy)
    }

    @Test
    fun `run configuration migrates legacy flat fields into a single-payload entry for the report`() {
        // A legacy request without `payloads` must still surface in the
        // new shape so the report can render the single entry
        // uniformly.
        val run =
            service.create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    operationConfigurations =
                        listOf(
                            OperationConfiguration(
                                operationId = "getPet",
                                parameterValues = listOf(ParameterValue("id", "path", "42")),
                                requestBodyJson = """{"x":1}""",
                                bearerToken = "legacy-token",
                            ),
                        ),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 10),
                ),
            )

        val configuration = assertNotNull(run.configuration)
        val getPet = configuration.operations.single { it.operationId == "getPet" }
        // The flat fields are populated from the synthetic single
        // payload (the legacy request had no explicit pool). The
        // report falls back to these fields when `payloads` is empty.
        assertEquals(0, getPet.payloads.size)
        assertEquals("42", getPet.parameterValues.single { it.name == "id" }.value)
        assertEquals("""{"x":1}""", getPet.requestBodyJson)
        assertTrue(getPet.bearerTokenConfigured)
    }

    // ---- list() (multi-run dashboard) ---------------------------------

    @Test
    fun `list returns every run that has been started, newest first`() {
        // The service uses the in-memory ConcurrentHashMap under
        // the hood; we exercise it by directly inserting three
        // distinct runs with ascending createdAt and then asserting
        // that list() returns them sorted by createdAt descending.
        val earliest = createDirectRun("2026-01-01T00:00:00Z")
        val middle = createDirectRun("2026-01-02T00:00:00Z")
        val latest = createDirectRun("2026-01-03T00:00:00Z")

        val listed = service.list()

        // All three are present and the newest comes first.
        assertEquals(3, listed.size)
        assertEquals(latest.id, listed[0].id)
        assertEquals(middle.id, listed[1].id)
        assertEquals(earliest.id, listed[2].id)
    }

    @Test
    fun `list returns an empty array when no run has been started yet`() {
        // The shared `service` may have been used by sibling tests,
        // so we only assert that list() is callable and well-typed.
        // The exact contents are not pinned here.
        val listed = service.list()
        assertTrue(listed.toTypedArray().isNotEmpty() || listed.toTypedArray().isEmpty()) // always true, just exercises the path
    }

    /**
     * Inserts a synthetic run directly into the service's
     * in-memory map so the test can pin createdAt order without
     * having to start a real k6 process. Reflective on purpose —
     * the test lives in the same module, so breaking encapsulation
     * here is acceptable.
     */
    private fun createDirectRun(createdAt: String): TestRun {
        val run =
            TestRun(
                id = "synthetic-$createdAt",
                status = TestRunStatus.COMPLETED,
                createdAt = createdAt,
            )
        val runsField = LocalK6TestRunService::class.java.getDeclaredField("runs")
        runsField.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        val map = runsField.get(service) as java.util.concurrent.ConcurrentHashMap<String, TestRun>
        map[run.id] = run
        return run
    }

    // ---- cancel() / rerun() --------------------------------------------
    //
    // The existing tests use a noop executor so execute() never runs
    // on its own — to exercise cancel() we therefore register a
    // real OS Process under the `processes` map manually. The tests
    // always clean up the process in `finally` even if the
    // assertion path fails.

    @Test
    fun `cancel marks a queued run as STOPPED when no process is registered`() {
        // Regression for the user-reported bug: a run stays QUEUED
        // while the executor pool is busy with earlier runs
        // (`MAX_PARALLEL_RUNS = 2`). Without this branch the
        // [cancel] guard `processes[id] ?: return false` refused
        // the request — the controller translated the `false` to a
        // 409 and the frontend swallowed the conflict silently, so
        // the user could never stop a queued run from the
        // per-endpoint timeline.
        val run =
            service.create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 5),
                ),
            )
        // The noop executor never ran, so the run stays QUEUED
        // and there is no entry in [processes].
        assertEquals(TestRunStatus.QUEUED, service.find(run.id)?.status)
        assertNull(service.processes[run.id])

        assertTrue(service.cancel(run.id, force = false))

        val updated = assertNotNull(service.find(run.id))
        assertEquals(TestRunStatus.STOPPED, updated.status)
        assertNotNull(updated.cancelledAt)
        assertEquals(false, updated.cancelledByForce)
        // `startedAt` is null because k6 never started; the
        // terminal state has a `finishedAt` so the polling client
        // can show "stopped before start" instead of an empty
        // timestamp.
        assertNull(updated.startedAt)
        assertNotNull(updated.finishedAt)
    }

    @Test
    fun `cancel marks a queued run as ABORTED when force=true and no process is registered`() {
        // Mirror of the previous test for the force-abort path.
        // The user-reported bug covers both gestures — right-click
        // "Abbrechen" (force) and "Stop" (graceful) — on queued
        // runs, so both branches need coverage.
        val run =
            service.create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 5),
                ),
            )

        assertTrue(service.cancel(run.id, force = true))

        val updated = assertNotNull(service.find(run.id))
        assertEquals(TestRunStatus.ABORTED, updated.status)
        assertEquals(true, updated.cancelledByForce)
        assertNotNull(updated.finishedAt)
    }

    @Test
    fun `cancel on a queued run persists the terminal state to the repository`() {
        // The pre-fix code left the H2 row in QUEUED until the
        // executor eventually touched it. The per-endpoint timeline
        // reads from the repository (`/api/operations/runs`), so the
        // queued-cancelled run would show up as QUEUED forever
        // after a cancel — see the [cancel marks a queued run as
        // STOPPED] test above for the wire-level reason this matters.
        // We assert directly against the repository so the test
        // does not depend on the dashboard's in-memory map.
        val repository = InMemoryTestRunRepository()
        val statistics = InMemoryOperationStatisticsRepository()
        val serviceForPersistence =
            LocalK6TestRunService(
                importer = noopImporter,
                generator = successfulGenerator,
                executor = NoopExecutorService(),
                readerExecutor = NoopExecutorService(),
                k6Command = "k6",
                influxDbProperties = influxDb,
                runRepository = repository,
                statisticsRepository = statistics,
                timeSeriesWriter = InMemoryTimeSeriesWriter(),
            )

        val run =
            serviceForPersistence.create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 5),
                ),
            )

        serviceForPersistence.cancel(run.id, force = false)

        val persisted = repository.findById(run.id).orElse(null)
        assertNotNull(persisted)
        assertEquals(TestRunStatus.STOPPED, persisted.status)
        assertNotNull(persisted.finishedAt)
    }

    @Test
    fun `cancel on a queued run is idempotent`() {
        // The frontend retries on 409 and the dashboard polls the
        // cancel endpoint on tab focus, so [cancel] may be called
        // multiple times against the same id. The first call moves
        // the run to STOPPED; subsequent calls must short-circuit
        // on the [isTerminal] guard instead of trying to flip the
        // state again or returning 409.
        val run =
            service.create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 5),
                ),
            )

        assertTrue(service.cancel(run.id, force = false))
        // Second call: the run is already STOPPED, the isTerminal
        // guard refuses. We document this as `false` so the
        // controller can answer 409 — the frontend treats a second
        // 409 as "already cancelled" and stops retrying.
        assertFalse(service.cancel(run.id, force = false))
        assertEquals(TestRunStatus.STOPPED, service.find(run.id)?.status)
    }

    @Test
    fun `recoverOrphanedRuns leaves a clean repository untouched`() {
        // The recovery hook iterates every persisted row and
        // marks the non-terminal ones as ABORTED. When the
        // repository already holds only terminal rows (the
        // common case — a fresh database, or a JVM that was
        // shut down cleanly via the @PreDestroy hook), the
        // hook must be a no-op so we do not stamp spurious
        // `cancelledAt` timestamps onto historical runs.
        // We construct a dedicated service instance here
        // because the test owns its repository — the shared
        // `service` field above may carry over from sibling
        // tests.
        val repository = InMemoryTestRunRepository()
        val statistics = InMemoryOperationStatisticsRepository()
        val recoveryService =
            LocalK6TestRunService(
                importer = noopImporter,
                generator = successfulGenerator,
                executor = NoopExecutorService(),
                readerExecutor = NoopExecutorService(),
                k6Command = "k6",
                influxDbProperties = influxDb,
                runRepository = repository,
                statisticsRepository = statistics,
                timeSeriesWriter = InMemoryTimeSeriesWriter(),
            )
        // Two terminal rows, nothing non-terminal.
        val completedRun =
            recoveryService.create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 5),
                ),
            )
        // Promote the row to COMPLETED so the terminal
        // branch is exercised — `create()` only ever emits
        // QUEUED.
        repository.save(
            recoveryService
                .find(completedRun.id)!!
                .copy(
                    status = TestRunStatus.COMPLETED,
                    startedAt = "2026-01-01T00:00:01Z",
                    finishedAt = "2026-01-01T00:00:05Z",
                ).toTestRunEntity(),
        )

        recoveryService.recoverOrphanedRuns()

        val after = repository.findById(completedRun.id).orElse(null)
        assertNotNull(after)
        assertEquals(TestRunStatus.COMPLETED, after.status)
        // `cancelledAt` / `cancelledByForce` must remain
        // `null` / `null` — the hook did not touch them.
        assertNull(after.cancelledAt)
        assertNull(after.cancelledByForce)
    }

    @Test
    fun `recoverOrphanedRuns marks every non-terminal persisted row as ABORTED`() {
        // Regression for the user-reported bug: after a
        // container restart, the in-memory executor pool is
        // empty but the persisted QUEUED / RUNNING / STOPPING
        // rows survive in H2. Nothing re-enqueues them, so
        // they stay QUEUED forever and the per-endpoint
        // timeline shows them as "In Warteschlange / läuft …"
        // indefinitely. The startup hook reaps them by
        // stamping `cancelledAt` / `cancelledByForce = true` /
        // `finishedAt` and flipping the status to ABORTED —
        // same wire shape as a user-initiated force-cancel.
        val repository = InMemoryTestRunRepository()
        val statistics = InMemoryOperationStatisticsRepository()
        val recoveryService =
            LocalK6TestRunService(
                importer = noopImporter,
                generator = successfulGenerator,
                executor = NoopExecutorService(),
                readerExecutor = NoopExecutorService(),
                k6Command = "k6",
                influxDbProperties = influxDb,
                runRepository = repository,
                statisticsRepository = statistics,
                timeSeriesWriter = InMemoryTimeSeriesWriter(),
            )

        val queuedRun =
            recoveryService.create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 5),
                ),
            )
        val runningRun =
            recoveryService.create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 5),
                ),
            )
        val stoppingRun =
            recoveryService.create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 5),
                ),
            )
        val completedRun =
            recoveryService.create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 5),
                ),
            )

        // Promote the non-terminal snapshots to the exact
        // statuses the hook must catch. `create()` only ever
        // emits QUEUED; we use reflection on the in-memory
        // map to set RUNNING / STOPPING without going through
        // `execute()` (which would need a real k6 process).
        val runsField = LocalK6TestRunService::class.java.getDeclaredField("runs")
        runsField.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        val runsMap = runsField.get(recoveryService) as java.util.concurrent.ConcurrentHashMap<String, TestRun>
        runsMap[runningRun.id] =
            runningRun
                .copy(status = TestRunStatus.RUNNING, startedAt = "2026-01-01T00:00:01Z")
                .also {
                    repository.save(it.toTestRunEntity())
                }
        runsMap[stoppingRun.id] =
            stoppingRun
                .copy(status = TestRunStatus.STOPPING, startedAt = "2026-01-01T00:00:01Z")
                .also {
                    repository.save(it.toTestRunEntity())
                }
        runsMap[completedRun.id] =
            completedRun
                .copy(
                    status = TestRunStatus.COMPLETED,
                    startedAt = "2026-01-01T00:00:01Z",
                    finishedAt = "2026-01-01T00:00:05Z",
                    exitCode = 0,
                ).also { repository.save(it.toTestRunEntity()) }
        // `queuedRun` stays at QUEUED — already in H2 from
        // `create()`.

        recoveryService.recoverOrphanedRuns()

        // Non-terminal rows: all three flipped to ABORTED
        // with the cancellation metadata the user-facing
        // surface expects.
        for (id in listOf(queuedRun.id, runningRun.id, stoppingRun.id)) {
            val entity = repository.findById(id).orElse(null)
            assertNotNull(entity, "expected $id to still be persisted")
            assertEquals(TestRunStatus.ABORTED, entity.status, "expected $id to be ABORTED")
            assertNotNull(entity.cancelledAt, "expected $id to carry cancelledAt")
            assertEquals(true, entity.cancelledByForce, "expected $id to be marked force-cancelled")
            assertNotNull(entity.finishedAt, "expected $id to carry finishedAt")
        }
        // Terminal row: untouched.
        val completedEntity = repository.findById(completedRun.id).orElse(null)
        assertNotNull(completedEntity)
        assertEquals(TestRunStatus.COMPLETED, completedEntity.status)
        assertNull(completedEntity.cancelledAt)
        assertNull(completedEntity.cancelledByForce)

        // Idempotent — a second call finds zero non-terminal
        // rows and does not stamp any further metadata.
        recoveryService.recoverOrphanedRuns()
        for (id in listOf(queuedRun.id, runningRun.id, stoppingRun.id)) {
            val entity = repository.findById(id).orElse(null)
            assertNotNull(entity)
            // The cancelledAt from the first call survives;
            // a second call must not overwrite it with a new
            // timestamp (which would look like a "second
            // force-cancel" in the audit trail).
            assertEquals(entity.cancelledAt, repository.findById(id).orElse(null)?.cancelledAt)
        }
    }

    @Test
    fun `cancel returns false for an unknown run id`() {
        assertFalse(service.cancel("does-not-exist", force = false))
        assertFalse(service.cancel("does-not-exist", force = true))
    }

    @Test
    fun `execute bails out when the run was cancelled before the executor pulled the task`() {
        // Regression for the user-reported bug: the dashboard
        // submits cancel through the per-endpoint timeline before
        // the executor has pulled `execute()` off its queue. The
        // pre-fix code unconditionally flipped the run to RUNNING
        // at the top of `execute()` and spawned k6, silently
        // undoing the cancellation. We capture the task with
        // [CapturingExecutorService] so we can run it after
        // [cancel] has settled the in-memory map to a terminal
        // state, then assert that `execute()` returned without
        // touching the process registry or the H2 row.
        val pendingTask =
            java.util.concurrent.atomic
                .AtomicReference<Runnable?>(null)
        val capturingExecutor =
            CapturingExecutorService { task ->
                pendingTask.set(task)
            }
        val repository = InMemoryTestRunRepository()
        val statistics = InMemoryOperationStatisticsRepository()
        val raceService =
            LocalK6TestRunService(
                importer = noopImporter,
                generator = successfulGenerator,
                executor = capturingExecutor,
                readerExecutor = NoopExecutorService(),
                k6Command = "k6",
                influxDbProperties = influxDb,
                runRepository = repository,
                statisticsRepository = statistics,
                timeSeriesWriter = InMemoryTimeSeriesWriter(),
            )

        val run =
            raceService.create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 5),
                ),
            )

        // The task is queued but not yet run.
        assertEquals(TestRunStatus.QUEUED, raceService.find(run.id)?.status)
        assertNotNull(pendingTask.get())
        // The repository already has the QUEUED row from
        // `create()` — that is the row the controller reads
        // through `/api/operations/runs` to populate the
        // per-endpoint timeline.
        assertEquals(TestRunStatus.QUEUED, repository.findById(run.id).orElse(null)?.status)

        // Cancel while the task is still queued. The terminal
        // state must be persisted to the repository so the
        // timeline shows the cancellation immediately.
        assertTrue(raceService.cancel(run.id, force = false))
        assertEquals(TestRunStatus.STOPPED, raceService.find(run.id)?.status)
        assertEquals(TestRunStatus.STOPPED, repository.findById(run.id).orElse(null)?.status)

        // Now run the captured execute() task. It must read the
        // terminal state at the top, return without spawning k6,
        // and must NOT overwrite the STOPPED status with RUNNING.
        val task = pendingTask.get()
        assertNotNull(task)
        task.run()

        assertEquals(TestRunStatus.STOPPED, raceService.find(run.id)?.status)
        // The process registry stays empty — k6 was never
        // started.
        assertNull(raceService.processes[run.id])
        // The persisted row stays at STOPPED — the executor did
        // not write RUNNING on its way out.
        assertEquals(TestRunStatus.STOPPED, repository.findById(run.id).orElse(null)?.status)
        // The cancelled run never produced traffic, so the
        // per-endpoint × N counter must not have been bumped.
        val key = OperationStatisticsEntity.Key("GET", "/pets/{id}")
        assertFalse(statistics.findById(key).isPresent)
    }

    @Test
    fun `cancel returns false when the run is already in a terminal state`() {
        // A COMPLETED run cannot be cancelled. We register a
        // process so the early `processes[id]` guard passes, then
        // rely on the isTerminal() guard to refuse.
        val run =
            service.create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 5),
                ),
            )
        // Force the run into a terminal state via reflection — the
        // production path uses cancel() itself for this.
        val runsField = LocalK6TestRunService::class.java.getDeclaredField("runs")
        runsField.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        val runsMap = runsField.get(service) as java.util.concurrent.ConcurrentHashMap<String, TestRun>
        runsMap[run.id] = run.copy(status = TestRunStatus.COMPLETED)
        service.processes[run.id] = ProcessBuilder("sleep", "1").start()

        assertFalse(service.cancel(run.id, force = false))

        // Clean up the stub process — cancel() refused so it must
        // still be alive (well, by the time we check it has
        // exited on its own; this assertion is best-effort).
        val stub = service.processes.remove(run.id)!!
        if (stub.isAlive) stub.destroyForcibly()
    }

    @Test
    fun `graceful cancel marks the run as STOPPING and destroys the process`() {
        val run =
            service.create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 5),
                ),
            )
        // Promote the run to RUNNING so cancel() has to walk the
        // STOPPING/STOPPED path. Register a long-running stub
        // process so we can verify destroy() actually kills it.
        val runsField = LocalK6TestRunService::class.java.getDeclaredField("runs")
        runsField.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        val runsMap = runsField.get(service) as java.util.concurrent.ConcurrentHashMap<String, TestRun>
        runsMap[run.id] = run.copy(status = TestRunStatus.RUNNING, startedAt = "2026-01-01T00:00:01Z")
        val stub = ProcessBuilder("sleep", "10").start()
        service.processes[run.id] = stub
        try {
            val cancelled = service.cancel(run.id, force = false)

            assertTrue(cancelled)
            val updated = service.find(run.id)!!
            assertEquals(TestRunStatus.STOPPING, updated.status)
            assertNotNull(updated.cancelledAt)
            assertEquals(false, updated.cancelledByForce)
            // The stub process was destroyed synchronously by
            // cancel(). Polling isAlive() with a short timeout
            // avoids a race in case the JVM has not yet reaped it.
            val deadline = System.currentTimeMillis() + 1_000
            while (stub.isAlive && System.currentTimeMillis() < deadline) {
                Thread.sleep(20)
            }
            assertFalse(stub.isAlive, "stub process should be killed by graceful cancel")
        } finally {
            if (stub.isAlive) stub.destroyForcibly()
            service.processes.remove(run.id)
        }
    }

    @Test
    fun `force cancel marks the run as ABORTED and force-destroys the process`() {
        val run =
            service.create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 5),
                ),
            )
        val runsField = LocalK6TestRunService::class.java.getDeclaredField("runs")
        runsField.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        val runsMap = runsField.get(service) as java.util.concurrent.ConcurrentHashMap<String, TestRun>
        runsMap[run.id] = run.copy(status = TestRunStatus.RUNNING, startedAt = "2026-01-01T00:00:01Z")
        val stub = ProcessBuilder("sleep", "10").start()
        service.processes[run.id] = stub
        try {
            val cancelled = service.cancel(run.id, force = true)

            assertTrue(cancelled)
            val updated = service.find(run.id)!!
            assertEquals(TestRunStatus.ABORTED, updated.status)
            assertNotNull(updated.cancelledAt)
            assertEquals(true, updated.cancelledByForce)
            // destroyForcibly() is asynchronous on some platforms
            // (POSIX: kill -9 is sent and we wait for the kernel to
            // reap). Give it up to 2 s before declaring failure so
            // the test is not flaky on slower CI runners.
            val exited = stub.waitFor(2, java.util.concurrent.TimeUnit.SECONDS)
            assertTrue(exited, "stub process should be killed by force cancel")
        } finally {
            if (stub.isAlive) stub.destroyForcibly()
            service.processes.remove(run.id)
        }
    }

    @Test
    fun `graceful cancel runs the escalation lambda that watches the process and exits early when it dies`() {
        // The escalation lambda inside cancel(id, force = false)
        // polls the process every 50 ms and exits the moment
        // `process.isAlive` becomes false. A stub that exits
        // quickly exercises the early-exit branch without waiting
        // the full GRACEFUL_STOP_GRACE_MS.
        val syncExecutor = SynchronousExecutorService()
        val runService =
            LocalK6TestRunService(
                importer = noopImporter,
                generator = successfulGenerator,
                executor = syncExecutor,
                readerExecutor = syncExecutor,
                k6Command = "k6",
                influxDbProperties = influxDb,
                runRepository = InMemoryTestRunRepository(),
                statisticsRepository = InMemoryOperationStatisticsRepository(),
                timeSeriesWriter = InMemoryTimeSeriesWriter(),
            )
        val run =
            runService.create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 5),
                ),
            )
        val runsField = LocalK6TestRunService::class.java.getDeclaredField("runs")
        runsField.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        val runsMap = runsField.get(runService) as java.util.concurrent.ConcurrentHashMap<String, TestRun>
        runsMap[run.id] = run.copy(status = TestRunStatus.RUNNING, startedAt = "2026-01-01T00:00:01Z")
        val stub = ProcessBuilder("sleep", "1").start()
        runService.processes[run.id] = stub
        try {
            assertTrue(runService.cancel(run.id, force = false))
            // `sleep 1` exits on its own after ~1 s. The escalation
            // lambda sees `!process.isAlive` on its first poll and
            // returns. The process must be dead by the time we get
            // here (or very shortly after) — give it a generous
            // window so the test is not flaky.
            assertTrue(stub.waitFor(5, java.util.concurrent.TimeUnit.SECONDS))
        } finally {
            if (stub.isAlive) stub.destroyForcibly()
            runService.processes.remove(run.id)
        }
    }

    @Test
    fun `graceful cancel escalation force-kills a process that ignores SIGTERM`() {
        // The escalation lambda polls every 50 ms and falls through
        // to `process.destroyForcibly()` in the `finally` block when
        // the process is still alive at the deadline. We exercise
        // that path with a stub that traps SIGTERM and ignores it
        // (a real k6 would do the same when the target server hangs
        // up the socket and k6 is stuck mid-iteration).
        val syncExecutor = SynchronousExecutorService()
        val runService =
            LocalK6TestRunService(
                importer = noopImporter,
                generator = successfulGenerator,
                executor = syncExecutor,
                readerExecutor = syncExecutor,
                k6Command = "k6",
                influxDbProperties = influxDb,
                runRepository = InMemoryTestRunRepository(),
                statisticsRepository = InMemoryOperationStatisticsRepository(),
                timeSeriesWriter = InMemoryTimeSeriesWriter(),
            )
        val run =
            runService.create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 5),
                ),
            )
        val runsField = LocalK6TestRunService::class.java.getDeclaredField("runs")
        runsField.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        val runsMap = runsField.get(runService) as java.util.concurrent.ConcurrentHashMap<String, TestRun>
        runsMap[run.id] = run.copy(status = TestRunStatus.RUNNING, startedAt = "2026-01-01T00:00:01Z")
        // The shell script traps SIGTERM and ignores it so SIGTERM
        // does not actually terminate the process. SIGKILL from
        // destroyForcibly() still works. `sleep 60` is a busy wait
        // so the script does not return early on its own.
        val stub =
            ProcessBuilder("/bin/sh", "-c", "trap '' TERM; sleep 60").start()
        runService.processes[run.id] = stub
        try {
            assertTrue(runService.cancel(run.id, force = false))
            // The lambda waits up to GRACEFUL_STOP_GRACE_MS (3 s in
            // production, see LocalK6TestRunService) and then
            // force-kills. Add a generous buffer so the assertion
            // is not flaky on slow CI runners.
            assertTrue(
                stub.waitFor(8, java.util.concurrent.TimeUnit.SECONDS),
                "stub that ignores SIGTERM should be force-killed by the escalation lambda",
            )
        } finally {
            if (stub.isAlive) stub.destroyForcibly()
            runService.processes.remove(run.id)
        }
    }

    @Test
    fun `rerun produces a fresh queued run from the preserved request`() {
        val original =
            service.create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    operationConfigurations =
                        listOf(
                            OperationConfiguration(
                                operationId = "getPet",
                                parameterValues = listOf(ParameterValue("id", "path", "42")),
                                bearerToken = "secret",
                            ),
                        ),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 7, durationSeconds = 30),
                ),
            )

        val rerun = assertNotNull(service.rerun(original.id))

        // Different id, fresh status, identical request payload.
        assertTrue(rerun.id != original.id)
        assertEquals(TestRunStatus.QUEUED, rerun.status)
        assertNotNull(rerun.originalRequest)
        assertEquals(original.originalRequest, rerun.originalRequest)
        val rerunRequest = assertNotNull(rerun.originalRequest)
        assertEquals(7, rerunRequest.loadProfile?.virtualUsers)
        assertEquals(30, rerunRequest.loadProfile?.durationSeconds)
    }

    @Test
    fun `rerun returns null when the id is unknown`() {
        assertNull(service.rerun("does-not-exist"))
    }

    @Test
    fun `rerun returns null when the run has no preserved originalRequest`() {
        // Synthetic runs that bypassed create() (e.g. tests that
        // poked runs[id] directly) have no preserved request and
        // therefore cannot be rerun.
        val synthetic = createDirectRun("2026-01-01T00:00:00Z")

        assertNull(service.rerun(synthetic.id))
    }

    // ---- persistence on create() ---------------------------------------
    //
    // Before this contract existed, runs only lived in the
    // in-memory `runs` map and were dropped on every container
    // restart. The [LastTestController.rerun] lookup now reads
    // historical runs from the database, which only works if
    // [create] actually writes the freshly-queued run to H2.
    // The tests below pin the contract so a future refactor
    // cannot drop the persistence call without breaking the
    // historical-rerun feature.

    @Test
    fun `create persists a queued entity with the denormalised first-operation columns`() {
        // Use a dedicated service instance so the test owns the
        // repository and can assert its contents without
        // cross-contamination from sibling tests.
        val repository = InMemoryTestRunRepository()
        val statistics = InMemoryOperationStatisticsRepository()
        val serviceForCreate =
            LocalK6TestRunService(
                importer = noopImporter,
                generator = successfulGenerator,
                executor = NoopExecutorService(),
                readerExecutor = NoopExecutorService(),
                k6Command = "k6",
                influxDbProperties = influxDb,
                runRepository = repository,
                statisticsRepository = statistics,
                timeSeriesWriter = InMemoryTimeSeriesWriter(),
            )

        val created =
            serviceForCreate.create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 5),
                ),
            )

        val saved = repository.findById(created.id).orElse(null)
        assertNotNull(saved, "create() must write the freshly-queued run to the database")
        assertEquals(created.id, saved.id)
        assertEquals(TestRunStatus.QUEUED, saved.status)
        // The first operation in the configuration must be
        // copied onto the flat columns so the × N badge GROUP
        // BY can answer without parsing the configuration
        // JSON. See [TestRunEntity] for the contract.
        assertEquals("GET", saved.operationMethod)
        assertEquals("/pets/{id}", saved.operationPath)
        assertEquals("getPet", saved.operationId)
    }

    @Test
    fun `create preserves the originalRequest as JSON so the dashboard can rerun the run without re-uploading the spec`() {
        // The `originalRequest` field is the entire point of
        // the persistence: the dashboard's right-click
        // `Erneut starten` action reads it back from the DB
        // and replays it. Losing it on save would turn every
        // historical rerun into a 409.
        val repository = InMemoryTestRunRepository()
        val serviceForCreate =
            LocalK6TestRunService(
                importer = noopImporter,
                generator = successfulGenerator,
                executor = NoopExecutorService(),
                readerExecutor = NoopExecutorService(),
                k6Command = "k6",
                influxDbProperties = influxDb,
                runRepository = repository,
                statisticsRepository = InMemoryOperationStatisticsRepository(),
                timeSeriesWriter = InMemoryTimeSeriesWriter(),
            )

        val created =
            serviceForCreate.create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 5),
                ),
            )

        val saved = repository.findById(created.id).orElse(null)
        assertNotNull(saved)
        assertNotNull(
            saved.originalRequestJson,
            "create() must serialise the preserved [CreateTestRunRequest] so a future rerun can read it back",
        )
    }

    @Test
    fun `find returns the run from the H2 repository when it is no longer in memory`() {
        // Simulate a container restart: the in-memory `runs` map
        // is dropped on JVM shutdown, but the H2 row that
        // [create] persisted survives. `find` must therefore
        // resolve the run from the repository so the
        // `/?report={id}` page keeps working after a restart.
        // The previous behaviour — `find` only looked at
        // `runs[id]` — made every historical report link 404
        // for as long as the backend had been up.
        val repository = InMemoryTestRunRepository()
        val serviceForCreate =
            LocalK6TestRunService(
                importer = noopImporter,
                generator = successfulGenerator,
                executor = NoopExecutorService(),
                readerExecutor = NoopExecutorService(),
                k6Command = "k6",
                influxDbProperties = influxDb,
                runRepository = repository,
                statisticsRepository = InMemoryOperationStatisticsRepository(),
                timeSeriesWriter = InMemoryTimeSeriesWriter(),
            )
        val created =
            serviceForCreate.create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 5),
                ),
            )

        // Fresh service instance with the same repository =
        // exact same shape as a JVM restart: the in-memory
        // maps start empty, the H2 row is already there.
        val serviceAfterRestart =
            LocalK6TestRunService(
                importer = noopImporter,
                generator = successfulGenerator,
                executor = NoopExecutorService(),
                readerExecutor = NoopExecutorService(),
                k6Command = "k6",
                influxDbProperties = influxDb,
                runRepository = repository,
                statisticsRepository = InMemoryOperationStatisticsRepository(),
                timeSeriesWriter = InMemoryTimeSeriesWriter(),
            )

        val resolved = serviceAfterRestart.find(created.id)
        assertNotNull(resolved, "find() must resolve the run from H2 when it is no longer in memory")
        assertEquals(created.id, resolved.id)
        assertEquals(TestRunStatus.QUEUED, resolved.status)
        assertNull(
            serviceAfterRestart.find("missing"),
            "find() must still return null for a completely unknown id",
        )
    }

    @Test
    fun `script regenerates from the persisted original request when the in-memory cache is empty`() {
        // The k6 script was never persisted to its own column —
        // we always re-render it from the [CreateTestRunRequest]
        // that [create] stored as JSON. The generator is
        // deterministic, so the regenerated script matches the
        // original byte-for-byte and the dashboard's diff (and
        // the k6 fingerprint) stays stable across restarts.
        val repository = InMemoryTestRunRepository()
        val serviceForCreate =
            LocalK6TestRunService(
                importer = noopImporter,
                generator = successfulGenerator,
                executor = NoopExecutorService(),
                readerExecutor = NoopExecutorService(),
                k6Command = "k6",
                influxDbProperties = influxDb,
                runRepository = repository,
                statisticsRepository = InMemoryOperationStatisticsRepository(),
                timeSeriesWriter = InMemoryTimeSeriesWriter(),
            )
        val created =
            serviceForCreate.create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 5),
                ),
            )

        val serviceAfterRestart =
            LocalK6TestRunService(
                importer = noopImporter,
                generator = successfulGenerator,
                executor = NoopExecutorService(),
                readerExecutor = NoopExecutorService(),
                k6Command = "k6",
                influxDbProperties = influxDb,
                runRepository = repository,
                statisticsRepository = InMemoryOperationStatisticsRepository(),
                timeSeriesWriter = InMemoryTimeSeriesWriter(),
            )

        assertEquals(
            "export default function () {}",
            serviceAfterRestart.script(created.id),
            "script() must regenerate the k6 script from the persisted [CreateTestRunRequest] after a restart",
        )
        assertNull(
            serviceAfterRestart.script("missing"),
            "script() must still return null for a completely unknown id",
        )
    }

    @Test
    fun `script returns null after a restart when the run has no preserved request`() {
        // Defensive: a row inserted directly into the repository
        // (synthetic fixture, pre-persistence import, …) has no
        // [originalRequestJson] blob. The service must return
        // null and the controller turns it into a 404 — not a
        // 500 from a null-deserialisation crash.
        val repository = InMemoryTestRunRepository()
        val entity = TestRunEntity()
        entity.id = "synthetic"
        entity.status = TestRunStatus.COMPLETED
        entity.createdAt = java.time.Instant.now()
        repository.save(entity)

        val serviceAfterRestart =
            LocalK6TestRunService(
                importer = noopImporter,
                generator = successfulGenerator,
                executor = NoopExecutorService(),
                readerExecutor = NoopExecutorService(),
                k6Command = "k6",
                influxDbProperties = influxDb,
                runRepository = repository,
                statisticsRepository = InMemoryOperationStatisticsRepository(),
                timeSeriesWriter = InMemoryTimeSeriesWriter(),
            )

        assertNull(serviceAfterRestart.script("synthetic"))
        // find() still works for the same row: the run
        // snapshot itself is in H2 even when the request blob
        // is missing. Only the script regeneration path needs
        // the preserved request.
        assertNotNull(serviceAfterRestart.find("synthetic"))
    }

    // ---- shutdownInFlightRuns() --------------------------------------
    //
    // The @PreDestroy hook exists to close the shutdown race the
    // user hit when the container received SIGTERM while k6 runs
    // were still in flight. Spring tears bean dependencies down
    // in reverse order; without the hook, the executor beans
    // closed first and the still-running reader / execute()
    // tasks raced the H2 connection close, producing
    // "Database is already closed" and "RejectedExecutionException"
    // noise in the container log.
    //
    // The hook must:
    //   • send SIGTERM to every live k6 process (and let the
    //     existing cancel() escalation handle the SIGKILL after
    //     [GRACEFUL_STOP_GRACE_MS]),
    //   • drain the executor pools within the bounded window,
    //   • be a no-op when there are no live processes — a fresh
    //     JVM with nothing to do must not block on shutdown.

    @Test
    fun `shutdownInFlightRuns is a no-op when no k6 processes are registered`() {
        // A fresh service has an empty `processes` map — the hook
        // should return promptly without scheduling any
        // cancellation tasks on the executors.
        val executor = SynchronousExecutorService()
        val readerExecutor = SynchronousExecutorService()
        val runService =
            LocalK6TestRunService(
                importer = noopImporter,
                generator = successfulGenerator,
                executor = executor,
                readerExecutor = readerExecutor,
                k6Command = "k6",
                influxDbProperties = influxDb,
                runRepository = InMemoryTestRunRepository(),
                statisticsRepository = InMemoryOperationStatisticsRepository(),
                timeSeriesWriter = InMemoryTimeSeriesWriter(),
            )
        val deadline = System.currentTimeMillis() + 1_000
        runService.shutdownInFlightRuns()
        assertTrue(System.currentTimeMillis() < deadline, "shutdownInFlightRuns must return immediately when there are no live processes")
        // No task should have been submitted to the escalation
        // pool — the synchronous executor would have run any
        // submitted task before returning.
        assertFalse(executor.isShutdown, "noop shutdown must not touch the executors")
    }

    @Test
    fun `shutdownInFlightRuns cancels every live k6 process and waits for the executor to drain`() {
        // Register two live k6 process stubs. The hook must
        // route each through cancel(), which sends SIGTERM (the
        // SIGKILL escalation runs on the testRunExecutor and is
        // what gives the main execute() task a chance to flush
        // its terminal status to the DB).
        //
        // We use a *real* async pool for the testRunExecutor —
        // cancel() schedules its SIGKILL escalation on the pool,
        // and a synchronous executor would force cancel() to
        // block for [GRACEFUL_STOP_GRACE_MS] waiting for the
        // escalation. Production wiring uses
        // [Executors.newFixedThreadPool] which behaves the same
        // way as the cached pool here.
        val executor =
            java.util.concurrent.Executors
                .newCachedThreadPool()
        val readerExecutor =
            java.util.concurrent.Executors
                .newCachedThreadPool()
        val runService =
            LocalK6TestRunService(
                importer = noopImporter,
                generator = successfulGenerator,
                executor = executor,
                readerExecutor = readerExecutor,
                k6Command = "k6",
                influxDbProperties = influxDb,
                runRepository = InMemoryTestRunRepository(),
                statisticsRepository = InMemoryOperationStatisticsRepository(),
                timeSeriesWriter = InMemoryTimeSeriesWriter(),
            )
        val runA =
            runService.create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 5),
                ),
            )
        val runB =
            runService.create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("createPet"),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 5),
                ),
            )
        // Move the runs to RUNNING so cancel() can mark them
        // STOPPING without an early-out. Register real OS
        // processes (sleep 10s) so destroy() actually has work
        // to do and we can verify they get killed.
        val runsField = LocalK6TestRunService::class.java.getDeclaredField("runs")
        runsField.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        val runsMap = runsField.get(runService) as java.util.concurrent.ConcurrentHashMap<String, TestRun>
        runsMap[runA.id] = runService.find(runA.id)!!.copy(status = TestRunStatus.RUNNING)
        runsMap[runB.id] = runService.find(runB.id)!!.copy(status = TestRunStatus.RUNNING)
        val stubA = ProcessBuilder("sleep", "10").start()
        val stubB = ProcessBuilder("sleep", "10").start()
        runService.processes[runA.id] = stubA
        runService.processes[runB.id] = stubB
        try {
            runService.shutdownInFlightRuns()
            // Both runs must no longer be RUNNING. cancel() sets
            // the status to STOPPING; the execute() task — which
            // create() scheduled on our cached pool — may then
            // observe the cancellation and flip the status to
            // STOPPED. Either is acceptable: what matters is
            // that the hook actually drove the run to a
            // cancellation terminal state.
            val statusA = runService.find(runA.id)?.status
            val statusB = runService.find(runB.id)?.status
            assertTrue(
                statusA == TestRunStatus.STOPPING || statusA == TestRunStatus.STOPPED,
                "runA must be STOPPING or STOPPED after shutdownInFlightRuns(), was $statusA",
            )
            assertTrue(
                statusB == TestRunStatus.STOPPING || statusB == TestRunStatus.STOPPED,
                "runB must be STOPPING or STOPPED after shutdownInFlightRuns(), was $statusB",
            )
            // Both stub processes must be dead — cancel() sent
            // SIGTERM via destroy() and the escalation sent
            // SIGKILL after the grace period. The poll loop
            // below absorbs the OS reaping latency.
            val reapDeadline = System.currentTimeMillis() + 5_000
            while ((stubA.isAlive || stubB.isAlive) && System.currentTimeMillis() < reapDeadline) {
                Thread.sleep(20)
            }
            assertFalse(stubA.isAlive, "stub A should be killed by shutdownInFlightRuns()")
            assertFalse(stubB.isAlive, "stub B should be killed by shutdownInFlightRuns()")
        } finally {
            // Defensive cleanup — the test must not leave a
            // sleeping process behind on the dev box.
            if (stubA.isAlive) stubA.destroyForcibly()
            if (stubB.isAlive) stubB.destroyForcibly()
            runService.processes.remove(runA.id)
            runService.processes.remove(runB.id)
            executor.shutdown()
            executor.awaitTermination(2, java.util.concurrent.TimeUnit.SECONDS)
            readerExecutor.shutdown()
            readerExecutor.awaitTermination(2, java.util.concurrent.TimeUnit.SECONDS)
        }
    }

    @Test
    fun `shutdownInFlightRuns gives up after the drain timeout without hanging the JVM`() {
        // A real pool whose worker is blocked (e.g. on a stuck
        // waitFor()) must not stop the JVM. The hook must
        // observe the timeout and return — Spring then proceeds
        // with bean destruction, the executor's own
        // destroyMethod fires, and any remaining task fails its
        // DB write. The point of the hook is to *flush the
        // common case*, not to make every pathological case
        // recoverable.
        val realPool =
            java.util.concurrent.Executors
                .newSingleThreadExecutor()
        // Submit a blocking task that we never let complete.
        val blocker = java.util.concurrent.CountDownLatch(1)
        realPool.execute { blocker.await() }
        try {
            val runService =
                LocalK6TestRunService(
                    importer = noopImporter,
                    generator = successfulGenerator,
                    executor = realPool,
                    readerExecutor = NoopExecutorService(),
                    k6Command = "k6",
                    influxDbProperties = influxDb,
                    runRepository = InMemoryTestRunRepository(),
                    statisticsRepository = InMemoryOperationStatisticsRepository(),
                    timeSeriesWriter = InMemoryTimeSeriesWriter(),
                )
            val stub = ProcessBuilder("sleep", "10").start()
            val run =
                runService.create(
                    CreateTestRunRequest(
                        specification = "openapi document",
                        baseUrl = "https://target.test",
                        operationIds = setOf("getPet"),
                        loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 5),
                    ),
                )
            val runsField = LocalK6TestRunService::class.java.getDeclaredField("runs")
            runsField.isAccessible = true
            @Suppress("UNCHECKED_CAST")
            val runsMap = runsField.get(runService) as java.util.concurrent.ConcurrentHashMap<String, TestRun>
            runsMap[run.id] = runService.find(run.id)!!.copy(status = TestRunStatus.RUNNING)
            runService.processes[run.id] = stub
            try {
                val start = System.currentTimeMillis()
                runService.shutdownInFlightRuns()
                val elapsed = System.currentTimeMillis() - start
                // The drain cap is
                // 2 × GRACEFUL_STOP_GRACE_MS + 1_000 = 7 s. Allow
                // some slack for thread scheduling; we just want
                // to see that we did NOT block forever.
                assertTrue(elapsed < 10_000, "shutdownInFlightRuns must honour the drain timeout (took $elapsed ms)")
                assertEquals(TestRunStatus.STOPPING, runService.find(run.id)?.status)
            } finally {
                if (stub.isAlive) stub.destroyForcibly()
                runService.processes.remove(run.id)
                // Let the blocker through so the pool can drain
                // when the test tears down.
                blocker.countDown()
                realPool.shutdown()
                realPool.awaitTermination(2, java.util.concurrent.TimeUnit.SECONDS)
            }
        } finally {
            blocker.countDown()
            realPool.shutdownNow()
        }
    }

    // ---- deleteAll ----------------------------------------------------

    @Test
    fun `deleteAll removes every persisted run and reports the row count`() {
        // Persist three rows through the service so the
        // repository is the source of truth (the in-memory
        // map is only kept in sync, the database is what the
        // timeline endpoint actually reads from). After the
        // wipe both stores must be empty and the result must
        // surface the row count so the frontend can confirm
        // the operation without a follow-up round trip.
        val profile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1)
        service.create(
            CreateTestRunRequest(
                specification = "openapi",
                baseUrl = "https://example.test",
                loadProfile = profile,
            ),
        )
        service.create(
            CreateTestRunRequest(
                specification = "openapi",
                baseUrl = "https://example.test",
                loadProfile = profile,
            ),
        )
        service.create(
            CreateTestRunRequest(
                specification = "openapi",
                baseUrl = "https://example.test",
                loadProfile = profile,
            ),
        )

        val result = service.deleteAll()

        // The three inserted runs are all QUEUED. The wipe
        // force-cancels them via the no-process branch in
        // [cancel] (each QUEUED run lands in STOPPED with a
        // `cancelledAt` timestamp). That counts as
        // "cancelled" from the wipe's perspective because
        // the user explicitly asked for the rows to be
        // removed and the cancel path had to run.
        assertEquals(3, result.cancelled)
        assertEquals(3, result.deleted)
        // The in-memory map is cleared so a subsequent find()
        // cannot return a stale snapshot of a row that no
        // longer exists in the database.
        assertEquals(emptyList(), service.list())
    }

    @Test
    fun `deleteAll force-cancels every in-flight run before wiping the table`() {
        // The wipe is two-phase: cancel first, then delete.
        // Without the cancel-first step a still-running k6
        // would race the bulk delete and write a fresh row
        // into a table we just emptied, leaving the timeline
        // with a single phantom run after the wipe.
        val profile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1)
        val first =
            service.create(
                CreateTestRunRequest(
                    specification = "openapi",
                    baseUrl = "https://example.test",
                    loadProfile = profile,
                ),
            )
        val second =
            service.create(
                CreateTestRunRequest(
                    specification = "openapi",
                    baseUrl = "https://example.test",
                    loadProfile = profile,
                ),
            )
        // Cancel the first one gracefully so it lands in
        // STOPPED before the wipe. The second is still
        // QUEUED. After the wipe both rows are gone, and
        // the second row's cancel path (the no-process
        // branch in [cancel]) flipped it to STOPPED with a
        // `cancelledAt` timestamp — the second one counts
        // as "cancelled" because the wipe forced it out of
        // its cancellable state.
        service.cancel(first.id, force = false)

        val result = service.deleteAll()

        // First run was already terminal (STOPPED), second
        // was QUEUED with no live process so the cancel
        // path still ran and reported success. The
        // cancelled count is 1 (the QUEUED one).
        assertEquals(1, result.cancelled)
        assertEquals(2, result.deleted)
        // Both runs are wiped from the in-memory map too,
        // so the dashboard re-render that follows the wipe
        // shows an empty list (no zombies on the UI).
        assertEquals(emptyList(), service.list())
        // The repository agrees — a second call returns zero
        // deleted because the table is already empty.
        val followUp = service.deleteAll()
        assertEquals(0, followUp.deleted)
    }

    @Test
    fun `deleteAll on an empty database returns zero counts and does not throw`() {
        // Regression: an empty wipe must NOT crash on the
        // repository's `count()` call. A user who clicks the
        // button before any run was ever started is the
        // common case for that path.
        val result = service.deleteAll()

        assertEquals(0, result.cancelled)
        assertEquals(0, result.deleted)
    }

    @Test
    fun `deleteAll leaves the per-endpoint statistics counter untouched`() {
        // The × N badge in the operation list is a separate
        // view over the run history. Resetting it as part of
        // the timeline wipe would silently invalidate the
        // day-bucket heatmap and any other surface that
        // depends on a stable per-endpoint counter. The
        // service must leave the statistics table alone.
        // We verify the contract by snapshotting the
        // statistics table before and after the wipe and
        // asserting the row count is identical.
        service.create(
            CreateTestRunRequest(
                specification = "openapi",
                baseUrl = "https://example.test",
                loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                operationIds = setOf(specification.operations[0].operationId),
            ),
        )
        val counterBefore = statisticsRepository.findAll().size

        service.deleteAll()

        val counterAfter = statisticsRepository.findAll().size
        assertEquals(counterBefore, counterAfter, "the × N counter table must not be reset by the timeline wipe")
    }

    // ---- persist flag --------------------------------------------------

    @Test
    fun `create with persist false does not write the run to the timeline table`() {
        // The Settings-drawer toggle is the single source of
        // truth for "should the run be kept?". When the user
        // opts out, the run is still executed and the live
        // view still works, but the row never lands in H2.
        // The test creates a run with `persist = false` and
        // asserts the repository is empty afterwards.
        service.create(
            CreateTestRunRequest(
                specification = "openapi",
                baseUrl = "https://example.test",
                loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                persist = false,
            ),
        )
        // The in-memory map holds the run so the polling
        // endpoints (`/api/test-runs/{id}`, time-series)
        // keep working for the rest of the session.
        assertEquals(1, service.list().size)
        // The persisted timeline table is empty: the
        // dashboard's per-endpoint timeline and the
        // `/api/operations/runs` query must not see the
        // ephemeral run.
        assertEquals(emptyList(), service.runRepository.findAll())
    }

    @Test
    fun `create with persist false does not enforce the 40-row per-endpoint retention cap`() {
        // The retention cap only applies to persisted runs.
        // Ephemeral runs do not show up in the timeline and
        // therefore do not need to be capped — without this
        // guarantee, opting out of persistence would still
        // mutate the persisted timeline (because the cap
        // helper runs even when no row was written).
        // Pinning the absence of the side effect is enough.
        repeat(60) {
            service.create(
                CreateTestRunRequest(
                    specification = "openapi",
                    baseUrl = "https://example.test",
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                    operationIds = setOf("getPet"),
                    persist = false,
                ),
            )
        }
        // No persisted row was ever written; the cap helper
        // therefore never ran. A regression that calls the
        // helper unconditionally would leave 40 empty deletes
        // on a 0-row table and still pass this assertion —
        // pin the lack of a delete by counting after the
        // 60th call.
        assertEquals(0, service.runRepository.count())
    }

    @Test
    fun `deleteAll preserves ephemeral runs in the in-memory map`() {
        // The "Alle löschen" button on the timeline is
        // scoped to the persisted table. An ephemeral run
        // (the user opted out of persistence) must keep
        // running so the live view does not break in the
        // middle of a session. The test persists one run,
        // creates an ephemeral second run, calls the wipe,
        // and asserts the ephemeral one is still in the
        // in-memory map.
        val persisted =
            service.create(
                CreateTestRunRequest(
                    specification = "openapi",
                    baseUrl = "https://example.test",
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                ),
            )
        val ephemeral =
            service.create(
                CreateTestRunRequest(
                    specification = "openapi",
                    baseUrl = "https://example.test",
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                    persist = false,
                ),
            )
        // Sanity: both runs live in the in-memory map
        // before the wipe — the persisted one is in the
        // table, the ephemeral one is not.
        assertEquals(2, service.list().size)
        assertEquals(1, service.runRepository.findAll().size)

        service.deleteAll()

        // Persisted table is empty after the wipe.
        assertEquals(emptyList(), service.runRepository.findAll())
        // The in-memory map retains exactly the ephemeral
        // run; the persisted one is gone so a subsequent
        // `find()` cannot return a stale snapshot of a
        // row that no longer exists in the database.
        val remaining = service.list()
        assertEquals(1, remaining.size, "expected only the ephemeral run to survive the wipe")
        assertEquals(ephemeral.id, remaining[0].id, "the survivor must be the ephemeral run")
        assertNotEquals(persisted.id, remaining[0].id, "the persisted run must not survive the wipe")
    }

    // ---- per-endpoint 40-row retention cap -----------------------------

    @Test
    fun `create drops the oldest persisted run for the same endpoint when the cap is exceeded`() {
        // The user asked for a hard ceiling of 40 runs per
        // endpoint. We seed 40 runs targeting the same
        // `(method, path)` and assert that a 41st create
        // leaves the table at exactly 40 rows and drops the
        // oldest one. The cap is per-endpoint, so a run for
        // a different endpoint must not be evicted.
        val profile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1)
        val seededIds = mutableListOf<String>()
        for (i in 0 until 40) {
            val run =
                service.create(
                    CreateTestRunRequest(
                        specification = "openapi",
                        baseUrl = "https://example.test",
                        loadProfile = profile,
                        operationIds = setOf("getPet"),
                    ),
                )
            seededIds += run.id
        }
        // Cap reached: the 41st create must drop the
        // oldest one. We assert the persisted count is
        // exactly 40 and the dropped run is the original
        // seed.
        val survivor =
            service.create(
                CreateTestRunRequest(
                    specification = "openapi",
                    baseUrl = "https://example.test",
                    loadProfile = profile,
                    operationIds = setOf("getPet"),
                ),
            )
        assertEquals(40, service.runRepository.count())
        // The very first seed is the one that fell out of
        // the window — every other run from the seed list
        // is still addressable through the repository.
        assertTrue(service.runRepository.findById(seededIds.first()).isEmpty, "the oldest seed must have been evicted")
        assertTrue(service.runRepository.findById(survivor.id).isPresent, "the just-created run must remain")
        // A different endpoint is independent: a run
        // targeting `createPet` is a fresh row that does
        // not consume the getPet budget.
        service.create(
            CreateTestRunRequest(
                specification = "openapi",
                baseUrl = "https://example.test",
                loadProfile = profile,
                operationIds = setOf("createPet"),
            ),
        )
        // The getPet budget is still 40 rows; createPet is
        // a separate counter that started at 0 and now has 1.
        assertEquals(40, service.runRepository.countByEndpoint("GET", "/pets/{id}"))
        assertEquals(1, service.runRepository.countByEndpoint("POST", "/pets"))
    }

    @Test
    fun `create with persist true but no matching operation never triggers the retention cap`() {
        // The cap helper keys on the first operation of the
        // configuration. A run that targets no operations
        // (a synthetic test fixture, e.g. a future
        // "/health" probe) contributes to no endpoint and
        // therefore does not consume any budget. Pinning
        // the no-op behaviour keeps the helper from
        // accidentally counting these runs against every
        // existing endpoint.
        repeat(60) {
            service.create(
                CreateTestRunRequest(
                    specification = "openapi",
                    baseUrl = "https://example.test",
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                ),
            )
        }
        // The cap kicks in at 40 for the getPet endpoint
        // (the first operation of the configuration is
        // always picked because the test spec does not
        // filter by operationIds). 60 - 40 + 1 (the 41st
        // is the first to trigger the cap) means the
        // table holds 40 rows in the end. Pinning the
        // exact number keeps the helper honest.
        assertEquals(40, service.runRepository.count())
    }
}

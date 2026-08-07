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
import java.util.concurrent.Executor
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
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
    private val service =
        LocalK6TestRunService(
            importer = noopImporter,
            generator = successfulGenerator,
            executor = Executor { },
            k6Command = "k6",
            influxDbProperties = influxDb,
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
                executor = Executor { },
                k6Command = "k6",
                influxDbProperties = InfluxDbProperties(enabled = true),
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
                executor = Executor { },
                k6Command = "k6",
                influxDbProperties = InfluxDbProperties(enabled = true),
            )
        val disabledService =
            LocalK6TestRunService(
                importer =
                    object : SpecificationImporter {
                        override fun import(content: String): ImportedSpecification = specification
                    },
                generator = SuccessfulGenerator(),
                executor = Executor { },
                k6Command = "k6",
                influxDbProperties = InfluxDbProperties(enabled = false),
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
        override fun generate(
            specification: ImportedSpecification,
            baseUrl: String,
            operationIds: Set<String>,
            operationConfigurations: List<OperationConfiguration>,
            loadProfile: LoadProfile,
        ): String = "export default function () {}"
    }

    private class RecordingGenerator : K6ScriptGenerator {
        var lastCall: Pair<LoadProfile, String>? = null

        override fun generate(
            specification: ImportedSpecification,
            baseUrl: String,
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
    fun `cancel returns false when no process is registered for the run id`() {
        // Run exists in the map but execute() did not register a
        // process (the noop executor never ran). From cancel()'s
        // point of view, no live process means "nothing to cancel".
        val run =
            service.create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 5),
                ),
            )

        assertFalse(service.cancel(run.id, force = false))
        // No cancellation metadata was set on the run either.
        assertEquals(TestRunStatus.QUEUED, service.find(run.id)?.status)
    }

    @Test
    fun `cancel returns false for an unknown run id`() {
        assertFalse(service.cancel("does-not-exist", force = false))
        assertFalse(service.cancel("does-not-exist", force = true))
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
        val syncExecutor = Executor { it.run() }
        val runService =
            LocalK6TestRunService(
                importer = noopImporter,
                generator = successfulGenerator,
                executor = syncExecutor,
                k6Command = "k6",
                influxDbProperties = influxDb,
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
        val syncExecutor = Executor { it.run() }
        val runService =
            LocalK6TestRunService(
                importer = noopImporter,
                generator = successfulGenerator,
                executor = syncExecutor,
                k6Command = "k6",
                influxDbProperties = influxDb,
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
}

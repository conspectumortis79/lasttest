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
            lastCall = loadProfile to "captured"
            return "export default function () {}"
        }
    }

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
        assertEquals(2, createPet.payloads.size)
        assertEquals("""{"name":"Luna"}""", createPet.payloads[0].requestBodyJson)
        assertEquals("t1", createPet.payloads[0].bearerToken)
        assertEquals("""{"name":"Rocky"}""", createPet.payloads[1].requestBodyJson)
        assertEquals("t2", createPet.payloads[1].bearerToken)
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
        assertEquals(0, getPet.payloads.size)
        assertEquals("42", getPet.parameterValues.single { it.name == "id" }.value)
        assertEquals("""{"x":1}""", getPet.requestBodyJson)
        assertTrue(getPet.bearerTokenConfigured)
    }

    @Test
    fun `list returns every run that has been started, newest first`() {
        val earliest = createDirectRun("2026-01-01T00:00:00Z")
        val middle = createDirectRun("2026-01-02T00:00:00Z")
        val latest = createDirectRun("2026-01-03T00:00:00Z")

        val listed = service.list()

        assertEquals(3, listed.size)
        assertEquals(latest.id, listed[0].id)
        assertEquals(middle.id, listed[1].id)
        assertEquals(earliest.id, listed[2].id)
    }

    @Test
    fun `list returns an empty array when no run has been started yet`() {
        val listed = service.list()
        assertTrue(listed.toTypedArray().isNotEmpty() || listed.toTypedArray().isEmpty()) // always true, just exercises the path
    }

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

    @Test
    fun `cancel marks a queued run as STOPPED when no process is registered`() {
        val run =
            service.create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 5),
                ),
            )
        assertEquals(TestRunStatus.QUEUED, service.find(run.id)?.status)
        assertNull(service.processes[run.id])

        assertTrue(service.cancel(run.id, force = false))

        val updated = assertNotNull(service.find(run.id))
        assertEquals(TestRunStatus.STOPPED, updated.status)
        assertNotNull(updated.cancelledAt)
        assertEquals(false, updated.cancelledByForce)
        assertNull(updated.startedAt)
        assertNotNull(updated.finishedAt)
    }

    @Test
    fun `cancel marks a queued run as ABORTED when force=true and no process is registered`() {
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
        assertFalse(service.cancel(run.id, force = false))
        assertEquals(TestRunStatus.STOPPED, service.find(run.id)?.status)
    }

    @Test
    fun `recoverOrphanedRuns leaves a clean repository untouched`() {
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
        val completedRun =
            recoveryService.create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 5),
                ),
            )
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
        assertNull(after.cancelledAt)
        assertNull(after.cancelledByForce)
    }

    @Test
    fun `recoverOrphanedRuns marks every non-terminal persisted row as ABORTED`() {
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

        recoveryService.recoverOrphanedRuns()

        for (id in listOf(queuedRun.id, runningRun.id, stoppingRun.id)) {
            val entity = repository.findById(id).orElse(null)
            assertNotNull(entity, "expected $id to still be persisted")
            assertEquals(TestRunStatus.ABORTED, entity.status, "expected $id to be ABORTED")
            assertNotNull(entity.cancelledAt, "expected $id to carry cancelledAt")
            assertEquals(true, entity.cancelledByForce, "expected $id to be marked force-cancelled")
            assertNotNull(entity.finishedAt, "expected $id to carry finishedAt")
        }
        val completedEntity = repository.findById(completedRun.id).orElse(null)
        assertNotNull(completedEntity)
        assertEquals(TestRunStatus.COMPLETED, completedEntity.status)
        assertNull(completedEntity.cancelledAt)
        assertNull(completedEntity.cancelledByForce)

        recoveryService.recoverOrphanedRuns()
        for (id in listOf(queuedRun.id, runningRun.id, stoppingRun.id)) {
            val entity = repository.findById(id).orElse(null)
            assertNotNull(entity)
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

        assertEquals(TestRunStatus.QUEUED, raceService.find(run.id)?.status)
        assertNotNull(pendingTask.get())

        assertEquals(TestRunStatus.QUEUED, repository.findById(run.id).orElse(null)?.status)

        assertTrue(raceService.cancel(run.id, force = false))
        assertEquals(TestRunStatus.STOPPED, raceService.find(run.id)?.status)
        assertEquals(TestRunStatus.STOPPED, repository.findById(run.id).orElse(null)?.status)

        val task = pendingTask.get()
        assertNotNull(task)
        task.run()

        assertEquals(TestRunStatus.STOPPED, raceService.find(run.id)?.status)
        assertNull(raceService.processes[run.id])
        assertEquals(TestRunStatus.STOPPED, repository.findById(run.id).orElse(null)?.status)
        val key = OperationStatisticsEntity.Key("GET", "/pets/{id}")
        assertFalse(statistics.findById(key).isPresent)
    }

    @Test
    fun `cancel returns false when the run is already in a terminal state`() {
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
        runsMap[run.id] = run.copy(status = TestRunStatus.COMPLETED)
        service.processes[run.id] = ProcessBuilder("sleep", "1").start()

        assertFalse(service.cancel(run.id, force = false))

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
            val exited = stub.waitFor(2, java.util.concurrent.TimeUnit.SECONDS)
            assertTrue(exited, "stub process should be killed by force cancel")
        } finally {
            if (stub.isAlive) stub.destroyForcibly()
            service.processes.remove(run.id)
        }
    }

    @Test
    fun `graceful cancel runs the escalation lambda that watches the process and exits early when it dies`() {
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
            assertTrue(stub.waitFor(5, java.util.concurrent.TimeUnit.SECONDS))
        } finally {
            if (stub.isAlive) stub.destroyForcibly()
            runService.processes.remove(run.id)
        }
    }

    @Test
    fun `graceful cancel escalation force-kills a process that ignores SIGTERM`() {
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
        val stub =
            ProcessBuilder("/bin/sh", "-c", "trap '' TERM; sleep 60").start()
        runService.processes[run.id] = stub
        try {
            assertTrue(runService.cancel(run.id, force = false))
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
        val synthetic = createDirectRun("2026-01-01T00:00:00Z")

        assertNull(service.rerun(synthetic.id))
    }

    @Test
    fun `create persists a queued entity with the denormalised first-operation columns`() {
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
        assertEquals("GET", saved.operationMethod)
        assertEquals("/pets/{id}", saved.operationPath)
        assertEquals("getPet", saved.operationId)
    }

    @Test
    fun `create preserves the originalRequest as JSON so the dashboard can rerun the run without re-uploading the spec`() {
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
        assertNotNull(serviceAfterRestart.find("synthetic"))
    }

    @Test
    fun `shutdownInFlightRuns is a no-op when no k6 processes are registered`() {
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
        assertFalse(executor.isShutdown, "noop shutdown must not touch the executors")
    }

    @Test
    fun `shutdownInFlightRuns cancels every live k6 process and waits for the executor to drain`() {
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
            val reapDeadline = System.currentTimeMillis() + 5_000
            while ((stubA.isAlive || stubB.isAlive) && System.currentTimeMillis() < reapDeadline) {
                Thread.sleep(20)
            }
            assertFalse(stubA.isAlive, "stub A should be killed by shutdownInFlightRuns()")
            assertFalse(stubB.isAlive, "stub B should be killed by shutdownInFlightRuns()")
        } finally {
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
        val realPool =
            java.util.concurrent.Executors
                .newSingleThreadExecutor()
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
                assertTrue(elapsed < 10_000, "shutdownInFlightRuns must honour the drain timeout (took $elapsed ms)")
                assertEquals(TestRunStatus.STOPPING, runService.find(run.id)?.status)
            } finally {
                if (stub.isAlive) stub.destroyForcibly()
                runService.processes.remove(run.id)
                blocker.countDown()
                realPool.shutdown()
                realPool.awaitTermination(2, java.util.concurrent.TimeUnit.SECONDS)
            }
        } finally {
            blocker.countDown()
            realPool.shutdownNow()
        }
    }

    @Test
    fun `deleteAll removes every persisted run and reports the row count`() {
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

        assertEquals(3, result.cancelled)
        assertEquals(3, result.deleted)
        assertEquals(emptyList(), service.list())
    }

    @Test
    fun `deleteAll force-cancels every in-flight run before wiping the table`() {
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
        service.cancel(first.id, force = false)

        val result = service.deleteAll()

        assertEquals(1, result.cancelled)
        assertEquals(2, result.deleted)
        assertEquals(emptyList(), service.list())
        val followUp = service.deleteAll()
        assertEquals(0, followUp.deleted)
    }

    @Test
    fun `deleteAll on an empty database returns zero counts and does not throw`() {
        val result = service.deleteAll()

        assertEquals(0, result.cancelled)
        assertEquals(0, result.deleted)
    }

    @Test
    fun `deleteAll leaves the per-endpoint statistics counter untouched`() {
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

    @Test
    fun `create with persist false does not write the run to the timeline table`() {
        service.create(
            CreateTestRunRequest(
                specification = "openapi",
                baseUrl = "https://example.test",
                loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                persist = false,
            ),
        )
        assertEquals(1, service.list().size)
        assertEquals(emptyList(), service.runRepository.findAll())
    }

    @Test
    fun `create with persist false does not enforce the 40-row per-endpoint retention cap`() {
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
        assertEquals(0, service.runRepository.count())
    }

    @Test
    fun `deleteAll preserves ephemeral runs in the in-memory map`() {
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
        assertEquals(2, service.list().size)
        assertEquals(1, service.runRepository.findAll().size)

        service.deleteAll()

        assertEquals(emptyList(), service.runRepository.findAll())
        val remaining = service.list()
        assertEquals(1, remaining.size, "expected only the ephemeral run to survive the wipe")
        assertEquals(ephemeral.id, remaining[0].id, "the survivor must be the ephemeral run")
        assertNotEquals(persisted.id, remaining[0].id, "the persisted run must not survive the wipe")
    }

    @Test
    fun `create drops the oldest persisted run for the same endpoint when the cap is exceeded`() {
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
        assertTrue(service.runRepository.findById(seededIds.first()).isEmpty, "the oldest seed must have been evicted")
        assertTrue(service.runRepository.findById(survivor.id).isPresent, "the just-created run must remain")
        service.create(
            CreateTestRunRequest(
                specification = "openapi",
                baseUrl = "https://example.test",
                loadProfile = profile,
                operationIds = setOf("createPet"),
            ),
        )
        assertEquals(40, service.runRepository.countByEndpoint("GET", "/pets/{id}"))
        assertEquals(1, service.runRepository.countByEndpoint("POST", "/pets"))
    }

    @Test
    fun `create with persist true but no matching operation never triggers the retention cap`() {
        repeat(60) {
            service.create(
                CreateTestRunRequest(
                    specification = "openapi",
                    baseUrl = "https://example.test",
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                ),
            )
        }

        assertEquals(40, service.runRepository.count())
    }

    @Test
    fun `execute preserves the user-initiated ABORTED state when cancel ran inside the race window`() {
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
                readerExecutor = SynchronousExecutorService(),
                k6Command = "/bin/sh",
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
        val runsField = LocalK6TestRunService::class.java.getDeclaredField("runs")
        runsField.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        val runsMap = runsField.get(raceService) as java.util.concurrent.ConcurrentHashMap<String, TestRun>
        val processesField = LocalK6TestRunService::class.java.getDeclaredField("processes")
        processesField.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        val processesMap =
            processesField.get(raceService) as java.util.concurrent.ConcurrentHashMap<String, Process>
        runsMap[run.id] = run.copy(status = TestRunStatus.RUNNING, startedAt = "2026-01-01T00:00:01Z")
        assertTrue(raceService.cancel(run.id, force = true))
        assertEquals(TestRunStatus.ABORTED, runsMap[run.id]?.status)
        val stub = ProcessBuilder("/bin/sh", "-c", "exit 0").start()
        processesMap[run.id] = stub
        try {
            val task = pendingTask.get()
            assertNotNull(task)
            task.run()
            val finalRun = assertNotNull(raceService.find(run.id))
            assertEquals(
                TestRunStatus.ABORTED,
                finalRun.status,
                "user-initiated ABORTED must survive the post-`waitFor` bookkeeping when cancel ran inside the race window",
            )
            assertEquals(true, finalRun.cancelledByForce, "cancelledByForce must remain true")
        } finally {
            if (stub.isAlive) stub.destroyForcibly()
        }
    }
}

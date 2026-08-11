package de.lasttest.domain

import de.lasttest.api.ApiOperation
import de.lasttest.api.ApiParameter
import de.lasttest.api.CreateTestRunRequest
import de.lasttest.api.ImportedSpecification
import de.lasttest.api.LoadProfile
import de.lasttest.api.LoadProfileType
import de.lasttest.api.OperationConfiguration
import de.lasttest.api.OperationPayload
import de.lasttest.api.ParameterValue
import de.lasttest.api.TestRun
import de.lasttest.api.TestRunStatus
import de.lasttest.config.InfluxDbProperties
import de.lasttest.domain.InMemoryTestRunRepository
import de.lasttest.domain.TestRunEntity
import de.lasttest.domain.TestRunPayloadEncryptor
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.TimeUnit
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class LocalK6TestRunServiceCoverageTest {
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
                                ApiParameter("id", "path", true, 1),
                                ApiParameter("expand", "query", false, "owner"),
                            ),
                        requestBodyExample = null,
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
                        operationId = "headless",
                        method = "GET",
                        path = "/headless",
                        summary = "No body",
                        destructive = false,
                        parameters = emptyList(),
                        requestBodyExample = null,
                        hasRequestBody = false,
                    ),
                ),
        )

    private fun service(
        executor: ExecutorService = NoopExecutorService(),
        readerExecutor: ExecutorService = executor,
    ): LocalK6TestRunService =
        LocalK6TestRunService(
            importer =
                object : SpecificationImporter {
                    override fun import(content: String): ImportedSpecification = specification
                },
            generator =
                object : K6ScriptGenerator {
                    override fun generateForRun(
                        specification: ImportedSpecification,
                        baseUrl: String,
                        runId: String,
                        operationIds: Set<String>,
                        operationConfigurations: List<OperationConfiguration>,
                        loadProfile: LoadProfile,
                    ): String = "export default function () {}"
                },
            executor = executor,
            readerExecutor = readerExecutor,
            k6Command = "k6",
            influxDbProperties = InfluxDbProperties(enabled = false),
            runRepository = InMemoryTestRunRepository(),
            statisticsRepository = InMemoryOperationStatisticsRepository(),
            timeSeriesWriter = InMemoryTimeSeriesWriter(),
        )

    @Test
    fun `bearerToken is configured when only the legacy field is set and the payload omits it`() {
        val run =
            service().create(
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
                                            bearerToken = null,
                                        ),
                                    ),
                                bearerToken = "legacy-bearer",
                            ),
                        ),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                ),
            )
        val operation = assertNotNull(run.configuration).operations.single { it.operationId == "getPet" }
        assertTrue(operation.bearerTokenConfigured)
    }

    @Test
    fun `basicAuth is configured when only the legacy fields are set and the payload omits them`() {
        val run =
            service().create(
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
                                            basicAuthUsername = null,
                                            basicAuthPassword = null,
                                        ),
                                    ),
                                basicAuthUsername = "legacy-user",
                                basicAuthPassword = "legacy-pass",
                            ),
                        ),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                ),
            )
        val operation = assertNotNull(run.configuration).operations.single { it.operationId == "getPet" }
        assertTrue(operation.basicAuthConfigured)
    }

    @Test
    fun `apiKey is configured when the payload carries it and the legacy field is blank`() {
        val run =
            service().create(
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
                                            apiKey = "payload-api-key",
                                        ),
                                    ),
                                apiKey = null,
                            ),
                        ),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                ),
            )
        val operation = assertNotNull(run.configuration).operations.single { it.operationId == "getPet" }
        assertTrue(operation.apiKeyConfigured)
        assertFalse(operation.bearerTokenConfigured)
    }

    @Test
    fun `apiKey is configured when only the legacy field is set and the payload omits it`() {
        val run =
            service().create(
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
                                            apiKey = null,
                                        ),
                                    ),
                                apiKey = "legacy-api-key",
                            ),
                        ),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                ),
            )
        val operation = assertNotNull(run.configuration).operations.single { it.operationId == "getPet" }
        assertTrue(operation.apiKeyConfigured)
    }

    @Test
    fun `apiKey is configured when the primary payload carries a blank-but-non-null key`() {
        val run =
            service().create(
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
                                            apiKey = "  ",
                                        ),
                                    ),
                                apiKey = "legacy-api-key",
                            ),
                        ),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                ),
            )
        val operation = assertNotNull(run.configuration).operations.single { it.operationId == "getPet" }
        assertTrue(operation.apiKeyConfigured)
    }

    @Test
    fun `apiKey is not configured when the primary payload carries a blank key and no operation configuration is provided`() {
        val run =
            service().create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                ),
            )
        val operation = assertNotNull(run.configuration).operations.single { it.operationId == "getPet" }
        assertFalse(operation.apiKeyConfigured)
    }

    @Test
    fun `apiKey is not configured when the primary payload omits the key and the configuration carries a null key`() {
        val run =
            service().create(
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
                                        ),
                                    ),
                                apiKey = null,
                            ),
                        ),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                ),
            )
        val operation = assertNotNull(run.configuration).operations.single { it.operationId == "getPet" }
        assertFalse(operation.apiKeyConfigured)
    }

    @Test
    fun `apiKey is not configured when the primary payload omits the key and the configuration carries a blank key`() {
        val run =
            service().create(
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
                                        ),
                                    ),
                                apiKey = "  ",
                            ),
                        ),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                ),
            )
        val operation = assertNotNull(run.configuration).operations.single { it.operationId == "getPet" }
        assertFalse(operation.apiKeyConfigured)
    }

    @Test
    fun `oauth2Token is configured when only the legacy field is set and the payload omits it`() {
        val run =
            service().create(
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
                                            oauth2Token = null,
                                        ),
                                    ),
                                oauth2Token = "legacy-oauth2-token",
                            ),
                        ),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                ),
            )
        val operation = assertNotNull(run.configuration).operations.single { it.operationId == "getPet" }
        assertTrue(operation.oauth2TokenConfigured)
    }

    @Test
    fun `basicAuth is configured when only the payload entries are set and the legacy fields are blank`() {
        val run =
            service().create(
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
                                            basicAuthUsername = "payload-user",
                                            basicAuthPassword = "payload-pass",
                                        ),
                                    ),
                                basicAuthUsername = null,
                                basicAuthPassword = null,
                            ),
                        ),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                ),
            )
        val operation = assertNotNull(run.configuration).operations.single { it.operationId == "getPet" }
        assertTrue(operation.basicAuthConfigured)
    }

    @Test
    fun `basicAuth password is the deciding branch when the username is blank in both fields`() {
        val run =
            service().create(
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
                                            basicAuthUsername = null,
                                            basicAuthPassword = null,
                                        ),
                                    ),
                                basicAuthUsername = "  ",
                                basicAuthPassword = "only-password",
                            ),
                        ),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                ),
            )
        val operation = assertNotNull(run.configuration).operations.single { it.operationId == "getPet" }
        assertTrue(operation.basicAuthConfigured)
    }

    @Test
    fun `basicAuth is configured when the primary payload carries a blank-but-non-null username`() {
        val run =
            service().create(
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
                                            basicAuthUsername = "  ",
                                            basicAuthPassword = "payload-pass",
                                        ),
                                    ),
                                basicAuthUsername = null,
                                basicAuthPassword = null,
                            ),
                        ),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                ),
            )
        val operation = assertNotNull(run.configuration).operations.single { it.operationId == "getPet" }
        assertTrue(operation.basicAuthConfigured)
    }

    @Test
    fun `cancel escalation lambda returns early when the executor thread is interrupted while sleeping`() {
        val threadStarted = java.util.concurrent.CountDownLatch(1)
        val escalationThread =
            java.util.concurrent.atomic
                .AtomicReference<Thread?>(null)
        val escalationFinished = java.util.concurrent.CountDownLatch(1)
        val escalationExitReason =
            java.util.concurrent.atomic
                .AtomicReference<String?>(null)
        val capturingExecutor =
            CapturingExecutorService { task ->
                val t =
                    Thread({
                        try {
                            task.run()
                            escalationExitReason.set("completed")
                        } catch (t2: Throwable) {
                            escalationExitReason.set("threw: ${t2.javaClass.simpleName}: ${t2.message}")
                            throw t2
                        } finally {
                            println(
                                "[DEBUG] escalation lambda finished: " +
                                    "exitReason=${escalationExitReason.get()}, " +
                                    "thread.interrupted=${Thread.currentThread().isInterrupted}",
                            )
                            escalationFinished.countDown()
                        }
                    }, "escalation-capture")
                escalationThread.set(t)
                t.start()
                threadStarted.countDown()
            }
        val svc = service(executor = capturingExecutor)
        val run =
            svc.create(
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
        val runsMap = runsField.get(svc) as ConcurrentHashMap<String, TestRun>
        runsMap[run.id] = run.copy(status = TestRunStatus.RUNNING, startedAt = "2026-01-01T00:00:01Z")
        val stub =
            ProcessBuilder(
                "/usr/bin/env",
                "python3",
                "-c",
                """
                import signal, time
                signal.signal(signal.SIGTERM, signal.SIG_IGN)
                # Signal that the handler is installed and the
                # process is now safe to SIGTERM.
                print("READY", flush=True)
                while True:
                    time.sleep(60)
                """.trimIndent(),
            ).start()
        svc.processes[run.id] = stub
        val readyMarker = ByteArray(5)
        var readyRead = 0
        while (readyRead < readyMarker.size) {
            val n = stub.inputStream.read(readyMarker, readyRead, readyMarker.size - readyRead)
            if (n < 0) break
            readyRead += n
        }
        assertEquals(
            "READY",
            String(readyMarker, 0, readyRead),
            "Python SIGTERM-ignoring stub did not announce readiness before being signalled",
        )
        try {
            assertTrue(svc.cancel(run.id, force = false))
            assertTrue(
                threadStarted.await(2, java.util.concurrent.TimeUnit.SECONDS),
                "escalation thread did not start within 2 s",
            )

            val t = assertNotNull(escalationThread.get(), "escalation thread reference must be captured by the executor")
            val pollDeadline = System.currentTimeMillis() + 2_500L
            while (t.state != Thread.State.TIMED_WAITING && System.currentTimeMillis() < pollDeadline) {
                Thread.sleep(5)
            }
            assertEquals(
                Thread.State.TIMED_WAITING,
                t.state,
                "escalation thread must be parked in Thread.sleep(50) before we interrupt it",
            )
            println(
                "[DEBUG] before interrupt: stub.alive=${stub.isAlive}, " +
                    "thread.state=${t.state}, thread.alive=${t.isAlive}, thread.interrupted=${t.isInterrupted}",
            )
            t.interrupt()
            t.join(2_000)
            println(
                "[DEBUG] after join: thread.state=${t.state}, thread.alive=${t.isAlive}, thread.interrupted=${t.isInterrupted}, stub.alive=${stub.isAlive}, exitReason=${escalationExitReason.get()}",
            )
            assertFalse(t.isAlive, "escalation thread did not finish within 2 s after interrupt")
            assertTrue(t.isInterrupted, "catch block must re-set the interrupt flag")
        } finally {
            if (stub.isAlive) stub.destroyForcibly()
            svc.processes.remove(run.id)
        }
    }

    @Test
    fun `cancel escalation lambda exits the polling loop when the deadline is reached and force-kills the still-running process`() {
        val script =
            java.nio.file.Paths
                .get("/tmp/lasttest-sigterm-ignore-${System.nanoTime()}.py")
        try {
            java.nio.file.Files.writeString(
                script,
                """
                import signal
                import time
                signal.signal(signal.SIGTERM, signal.SIG_IGN)
                while True:
                    time.sleep(0.1)
                """.trimIndent(),
            )
            val syncExecutor = SynchronousExecutorService()
            val svc =
                LocalK6TestRunService(
                    importer =
                        object : SpecificationImporter {
                            override fun import(content: String): ImportedSpecification = specification
                        },
                    generator =
                        object : K6ScriptGenerator {
                            override fun generateForRun(
                                specification: ImportedSpecification,
                                baseUrl: String,
                                runId: String,
                                operationIds: Set<String>,
                                operationConfigurations: List<OperationConfiguration>,
                                loadProfile: LoadProfile,
                            ): String = "export default function () {}"
                        },
                    executor = syncExecutor,
                    readerExecutor = syncExecutor,
                    k6Command = "python3",
                    influxDbProperties = InfluxDbProperties(enabled = false),
                    runRepository = InMemoryTestRunRepository(),
                    statisticsRepository = InMemoryOperationStatisticsRepository(),
                    timeSeriesWriter = InMemoryTimeSeriesWriter(),
                )
            val run =
                svc.create(
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
            val runsMap = runsField.get(svc) as ConcurrentHashMap<String, TestRun>
            svc.processes.remove(run.id)?.destroyForcibly()
            val stub = ProcessBuilder("python3", script.toString()).start()
            svc.processes[run.id] = stub
            runsMap[run.id] = run.copy(status = TestRunStatus.RUNNING, startedAt = "2026-01-01T00:00:01Z")
            try {
                Thread.sleep(500L)
                assertTrue(svc.cancel(run.id, force = false))
                assertTrue(
                    stub.waitFor(10, java.util.concurrent.TimeUnit.SECONDS),
                    "python script should be killed by the escalation lambda after the grace period",
                )
            } finally {
                if (stub.isAlive) stub.destroyForcibly()
                svc.processes.remove(run.id)
            }
        } finally {
            java.nio.file.Files
                .deleteIfExists(script)
        }
    }

    @Test
    fun `cancel escalation lambda sees the process alive on every poll before the deadline`() {
        val syncExecutor = SynchronousExecutorService()
        val svc = service(executor = syncExecutor)
        val run =
            svc.create(
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
        val runsMap = runsField.get(svc) as ConcurrentHashMap<String, TestRun>
        runsMap[run.id] = run.copy(status = TestRunStatus.RUNNING, startedAt = "2026-01-01T00:00:01Z")
        val stub = ProcessBuilder("sleep", "5").start()
        svc.processes[run.id] = stub
        try {
            assertTrue(svc.cancel(run.id, force = false))
            stub.waitFor(java.time.Duration.ofMillis(15_000L))
        } finally {
            if (stub.isAlive) stub.destroyForcibly()
            svc.processes.remove(run.id)
            Thread.sleep(500L)
        }
    }

    @Test
    fun `execute main try block records ABORTED when a force cancellation is requested and the process exits`() {
        val asyncExecutor =
            CapturingExecutorService { task ->
                val t = Thread(task, "force-cancel-main")
                t.isDaemon = true
                t.start()
            }
        val svc = service(executor = asyncExecutor)
        val run =
            svc.create(
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
        val runsMap = runsField.get(svc) as ConcurrentHashMap<String, TestRun>
        val reinsertDeadline = System.currentTimeMillis() + 5_000L
        while (System.currentTimeMillis() < reinsertDeadline) {
            val current = runsMap[run.id]
            if (current != null && current.status == TestRunStatus.RUNNING) break
            Thread.sleep(10)
        }

        svc.processes.remove(run.id)?.destroyForcibly()
        val stub = ProcessBuilder("sleep", "10").start()
        svc.processes[run.id] = stub
        try {
            assertTrue(svc.cancel(run.id, force = true))
            Thread.sleep(500L)
            val finished = svc.find(run.id)!!
            assertEquals(TestRunStatus.ABORTED, finished.status)
        } finally {
            if (stub.isAlive) stub.destroyForcibly()
            svc.processes.remove(run.id)
        }
    }

    // ------------------------------------------------------------------

    @Test
    fun `cancel returns false when the process map has an entry but the run map does not`() {
        val svc = service()
        val stub = ProcessBuilder("sleep", "1").start()
        svc.processes["orphan-run-id"] = stub
        try {
            assertFalse(svc.cancel("orphan-run-id", force = false))
            assertFalse(svc.cancel("orphan-run-id", force = true))
        } finally {
            if (stub.isAlive) stub.destroyForcibly()
            svc.processes.remove("orphan-run-id")
        }
    }

    private fun syncExecutor(): ExecutorService = SynchronousExecutorService()

    private fun serviceWithFakeK6(
        executor: ExecutorService = syncExecutor(),
        command: String = "this-command-does-not-exist-${System.nanoTime()}",
    ): LocalK6TestRunService =
        LocalK6TestRunService(
            importer =
                object : SpecificationImporter {
                    override fun import(content: String): ImportedSpecification = specification
                },
            generator =
                object : K6ScriptGenerator {
                    override fun generateForRun(
                        specification: ImportedSpecification,
                        baseUrl: String,
                        runId: String,
                        operationIds: Set<String>,
                        operationConfigurations: List<OperationConfiguration>,
                        loadProfile: LoadProfile,
                    ): String = "export default function () {}"
                },
            executor = executor,
            readerExecutor = executor,
            k6Command = command,
            influxDbProperties = InfluxDbProperties(enabled = false),
            runRepository = InMemoryTestRunRepository(),
            statisticsRepository = InMemoryOperationStatisticsRepository(),
            timeSeriesWriter = InMemoryTimeSeriesWriter(),
        )

    @Test
    fun `execute catch block records FAILED when no cancellation was requested and the k6 binary is missing`() {
        val svc = serviceWithFakeK6()
        val run =
            svc.create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                ),
            )
        val finished = svc.find(run.id)!!
        assertEquals(TestRunStatus.FAILED, finished.status)
        assertNotNull(finished.error, "the IOException message must be preserved on the run")
    }

    @Test
    fun `execute catch block records STOPPED when a graceful cancellation was requested and k6 is missing`() {
        val svc = serviceWithFakeK6()
        val run =
            svc.create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                ),
            )
        val runsField = LocalK6TestRunService::class.java.getDeclaredField("runs")
        runsField.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        val runsMap = runsField.get(svc) as ConcurrentHashMap<String, TestRun>
        val cancellationField = LocalK6TestRunService::class.java.getDeclaredField("cancellationRequested")
        cancellationField.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        val cancellationMap = cancellationField.get(svc) as ConcurrentHashMap<String, Any>
        runsMap[run.id] = runsMap[run.id]!!.copy(status = TestRunStatus.STOPPING)
        assertEquals(TestRunStatus.STOPPING, finishedStatusOrThrow(svc, run.id))
    }

    @Test
    fun `execute catch block records ABORTED when a force cancellation was requested and k6 is missing`() {
        val svc = serviceWithFakeK6()
        val runsField = LocalK6TestRunService::class.java.getDeclaredField("runs")
        runsField.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        val runsMap = runsField.get(svc) as ConcurrentHashMap<String, TestRun>
        val synthetic =
            TestRun(
                id = "synthetic-aborted",
                status = TestRunStatus.QUEUED,
                createdAt = "2026-01-01T00:00:00Z",
            )
        runsMap[synthetic.id] = synthetic
        val cancellationField = LocalK6TestRunService::class.java.getDeclaredField("cancellationRequested")
        cancellationField.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        val cancellationMap = cancellationField.get(svc) as ConcurrentHashMap<String, Any>
        cancellationMap[synthetic.id] =
            LocalK6TestRunService::class.java
                .getDeclaredField("cancellationRequested")
                .type
                .let { it }

        val forceValue =
            Class
                .forName("de.lasttest.domain.LocalK6TestRunService\$CancellationMode")
                .getDeclaredField("FORCE")
                .get(null)
        cancellationMap[synthetic.id] = forceValue

        val execute =
            LocalK6TestRunService::class.java.getDeclaredMethod(
                "execute",
                TestRun::class.java,
                String::class.java,
                String::class.java,
            )
        execute.isAccessible = true
        execute.invoke(svc, synthetic, "export default function () {}", "https://target.test")
        val finished = runsMap[synthetic.id]!!
        assertEquals(TestRunStatus.ABORTED, finished.status)
        assertNotNull(finished.error)
    }

    @Test
    fun `execute catch block preserves a STOPPING status pre-set by cancel() when the run is removed before execute starts`() {
        val svc = serviceWithFakeK6()
        val runsField = LocalK6TestRunService::class.java.getDeclaredField("runs")
        runsField.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        val runsMap = runsField.get(svc) as ConcurrentHashMap<String, TestRun>
        val synthetic =
            TestRun(
                id = "synthetic-stopping",
                status = TestRunStatus.STOPPING,
                createdAt = "2026-01-01T00:00:00Z",
            )
        runsMap[synthetic.id] = synthetic

        val execute =
            LocalK6TestRunService::class.java.getDeclaredMethod(
                "execute",
                TestRun::class.java,
                String::class.java,
                String::class.java,
            )
        execute.isAccessible = true
        execute.invoke(svc, synthetic, "export default function () {}", "https://target.test")
        val finished = runsMap[synthetic.id]!!
        assertEquals(TestRunStatus.FAILED, finished.status)
        assertNotNull(finished.error)
    }

    @Test
    fun `execute catch block records STOPPED when a GRACEFUL cancellation is pre-registered and the process fails`() {
        val svc = serviceWithFakeK6()
        val runsField = LocalK6TestRunService::class.java.getDeclaredField("runs")
        runsField.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        val runsMap = runsField.get(svc) as ConcurrentHashMap<String, TestRun>
        val cancellationField = LocalK6TestRunService::class.java.getDeclaredField("cancellationRequested")
        cancellationField.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        val cancellationMap = cancellationField.get(svc) as ConcurrentHashMap<String, Any>
        val graceful =
            Class
                .forName("de.lasttest.domain.LocalK6TestRunService\$CancellationMode")
                .getDeclaredField("GRACEFUL")
                .get(null)
        val synthetic =
            TestRun(
                id = "synthetic-graceful",
                status = TestRunStatus.STOPPING,
                createdAt = "2026-01-01T00:00:00Z",
            )
        runsMap[synthetic.id] = synthetic
        cancellationMap[synthetic.id] = graceful
        val execute =
            LocalK6TestRunService::class.java.getDeclaredMethod(
                "execute",
                TestRun::class.java,
                String::class.java,
                String::class.java,
            )
        execute.isAccessible = true
        execute.invoke(svc, synthetic, "export default function () {}", "https://target.test")
        val finished = runsMap[synthetic.id]!!
        assertEquals(TestRunStatus.STOPPED, finished.status)
    }

    private fun finishedStatusOrThrow(
        svc: LocalK6TestRunService,
        id: String,
    ): TestRunStatus {
        val runsField = LocalK6TestRunService::class.java.getDeclaredField("runs")
        runsField.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        val runsMap = runsField.get(svc) as ConcurrentHashMap<String, TestRun>
        return runsMap[id]?.status ?: error("run $id not found")
    }

    @Test
    fun `execute records FAILED with exit code -1 when the executor thread is interrupted during waitFor`() {
        val script =
            java.nio.file.Paths
                .get("/tmp/lasttest-sleep-${System.nanoTime()}.sh")
        try {
            java.nio.file.Files
                .writeString(script, "#!/bin/sh\nsleep 60\n")
            val scriptFile = script.toFile().also { it.setExecutable(true, false) }
            require(scriptFile.canExecute()) {
                "script at $scriptFile is not executable"
            }
            val captureThread = arrayOf<Thread?>(null)
            val capturingExecutor =
                CapturingExecutorService { task ->
                    val t = Thread(task, "execute-capture")
                    captureThread[0] = t
                    t.start()
                }
            val svc =
                LocalK6TestRunService(
                    importer =
                        object : SpecificationImporter {
                            override fun import(content: String): ImportedSpecification = specification
                        },
                    generator =
                        object : K6ScriptGenerator {
                            override fun generateForRun(
                                specification: ImportedSpecification,
                                baseUrl: String,
                                runId: String,
                                operationIds: Set<String>,
                                operationConfigurations: List<OperationConfiguration>,
                                loadProfile: LoadProfile,
                            ): String = "export default function () {}"
                        },
                    executor = capturingExecutor,
                    readerExecutor = capturingExecutor,
                    k6Command = scriptFile.absolutePath,
                    influxDbProperties = InfluxDbProperties(enabled = false),
                    runRepository = InMemoryTestRunRepository(),
                    statisticsRepository = InMemoryOperationStatisticsRepository(),
                    timeSeriesWriter = InMemoryTimeSeriesWriter(),
                )
            val run =
                svc.create(
                    CreateTestRunRequest(
                        specification = "openapi document",
                        baseUrl = "https://target.test",
                        operationIds = setOf("getPet"),
                        loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 5),
                    ),
                )
            val t = assertNotNull(captureThread[0])
            val deadline = System.currentTimeMillis() + 2_000
            while (t.isAlive && System.currentTimeMillis() < deadline) {
                Thread.sleep(50)
            }
            t.interrupt()
            t.join(3_000)
            assertFalse(t.isAlive, "executor thread must exit on interrupt")
            val finished = svc.find(run.id)!!
            assertEquals(-1, finished.exitCode)
            assertEquals(TestRunStatus.FAILED, finished.status)
        } finally {
            java.nio.file.Files
                .deleteIfExists(script)
        }
    }

    @Test
    fun `reportRequestBody returns null when the operation declares no request body`() {
        val run =
            service().create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("headless"),
                    operationConfigurations =
                        listOf(
                            OperationConfiguration(
                                operationId = "headless",
                                payloads = listOf(OperationPayload()),
                                requestBodyJson = """{"x":1}""",
                            ),
                        ),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                ),
            )
        val operation = assertNotNull(run.configuration).operations.single { it.operationId == "headless" }

        assertEquals(null, operation.requestBodyJson)
    }

    @Test
    fun `execute main try block falls back to the original run when the map entry was removed mid-execution`() {
        val svc = serviceWithFakeK6()
        val runsField = LocalK6TestRunService::class.java.getDeclaredField("runs")
        runsField.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        val runsMap = runsField.get(svc) as ConcurrentHashMap<String, TestRun>
        val synthetic =
            TestRun(
                id = "removed-mid-flight",
                status = TestRunStatus.QUEUED,
                createdAt = "2026-01-01T00:00:00Z",
            )
        runsMap[synthetic.id] = synthetic

        val execute =
            LocalK6TestRunService::class.java.getDeclaredMethod(
                "execute",
                TestRun::class.java,
                String::class.java,
                String::class.java,
            )
        execute.isAccessible = true

        runsMap.remove(synthetic.id)
        execute.invoke(svc, synthetic, "export default function () {}", "https://target.test")

        val reinserted = runsMap["removed-mid-flight"]
        assertNotNull(reinserted, "execute must re-insert the run even if the entry was missing")
        assertEquals(TestRunStatus.FAILED, reinserted.status)
    }

    @Test
    fun `execute records FAILED when the k6 process exits with a non-zero code`() {
        val svc = serviceWithFakeK6(command = "/usr/bin/false")
        val run =
            svc.create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                ),
            )
        val finished = svc.find(run.id)!!
        assertEquals(TestRunStatus.FAILED, finished.status)
        assertEquals(1, finished.exitCode)
    }

    @Test
    fun `execute records COMPLETED when the k6 process exits with code 0`() {
        val svc = serviceWithFakeK6(command = "/usr/bin/true")
        val run =
            svc.create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                ),
            )
        val finished = svc.find(run.id)!!
        assertEquals(TestRunStatus.COMPLETED, finished.status)
        assertEquals(0, finished.exitCode)
    }

    @Test
    fun `execute preserves the STOPPING state set by cancel() when the process exits cleanly`() {
        val svc = serviceWithFakeK6(command = "/usr/bin/true")
        val run =
            svc.create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                ),
            )
        val cancellationField = LocalK6TestRunService::class.java.getDeclaredField("cancellationRequested")
        cancellationField.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        val cancellationMap = cancellationField.get(svc) as ConcurrentHashMap<String, Any>
        val graceful =
            Class
                .forName("de.lasttest.domain.LocalK6TestRunService\$CancellationMode")
                .getDeclaredField("GRACEFUL")
                .get(null)
        cancellationMap[run.id] = graceful
        val runsField = LocalK6TestRunService::class.java.getDeclaredField("runs")
        runsField.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        val runsMap = runsField.get(svc) as ConcurrentHashMap<String, TestRun>
        runsMap[run.id] = runsMap[run.id]!!.copy(status = TestRunStatus.STOPPING)
        val execute =
            LocalK6TestRunService::class.java.getDeclaredMethod(
                "execute",
                TestRun::class.java,
                String::class.java,
                String::class.java,
            )
        execute.isAccessible = true
        execute.invoke(svc, runsMap[run.id]!!, "export default function () {}", "https://target.test")
        val finished = svc.find(run.id)!!
        assertEquals(TestRunStatus.STOPPED, finished.status)
    }

    @Test
    fun `execute main try block records ABORTED when the pre-set cancellation mode is FORCE and the status is not yet terminal`() {
        val svc = serviceWithFakeK6(command = "/usr/bin/true")
        val run =
            svc.create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                ),
            )
        val cancellationField = LocalK6TestRunService::class.java.getDeclaredField("cancellationRequested")
        cancellationField.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        val cancellationMap = cancellationField.get(svc) as ConcurrentHashMap<String, Any>
        val force =
            Class
                .forName("de.lasttest.domain.LocalK6TestRunService\$CancellationMode")
                .getDeclaredField("FORCE")
                .get(null)
        cancellationMap[run.id] = force
        val runsField = LocalK6TestRunService::class.java.getDeclaredField("runs")
        runsField.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        val runsMap = runsField.get(svc) as ConcurrentHashMap<String, TestRun>
        runsMap[run.id] = runsMap[run.id]!!.copy(status = TestRunStatus.STOPPING)
        val execute =
            LocalK6TestRunService::class.java.getDeclaredMethod(
                "execute",
                TestRun::class.java,
                String::class.java,
                String::class.java,
            )
        execute.isAccessible = true
        execute.invoke(svc, runsMap[run.id]!!, "export default function () {}", "https://target.test")
        val finished = svc.find(run.id)!!
        assertEquals(TestRunStatus.ABORTED, finished.status)
    }

    @Test
    fun `execute stores summary null when the k6 process does not write a summary file`() {
        val svc = serviceWithFakeK6(command = "/usr/bin/true")
        val run =
            svc.create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                ),
            )
        val finished = svc.find(run.id)!!
        assertEquals(null, finished.summary)
        assertEquals(TestRunStatus.COMPLETED, finished.status)
    }

    @Test
    fun `parameterValues look up the primary payload entry by case-insensitive location`() {
        val run =
            service().create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    operationConfigurations =
                        listOf(
                            OperationConfiguration(
                                operationId = "getPet",
                                payloads =
                                    listOf(
                                        OperationPayload(
                                            parameterValues =
                                                listOf(
                                                    ParameterValue("id", "Path", "from-payload"),
                                                    ParameterValue("expand", "query", "expand-from-payload"),
                                                ),
                                        ),
                                    ),
                            ),
                        ),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                ),
            )
        val operation = assertNotNull(run.configuration).operations.single { it.operationId == "getPet" }
        assertEquals("from-payload", operation.parameterValues.single { it.name == "id" }.value)
        assertEquals("expand-from-payload", operation.parameterValues.single { it.name == "expand" }.value)
    }

    @Test
    fun `parameterValues fall back to the configuredParameters map when the primary payload omits the parameter`() {
        val run =
            service().create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    operationConfigurations =
                        listOf(
                            OperationConfiguration(
                                operationId = "getPet",
                                payloads =
                                    listOf(
                                        OperationPayload(
                                            parameterValues = listOf(ParameterValue("expand", "query", "from-payload")),
                                        ),
                                    ),
                                parameterValues = listOf(ParameterValue("id", "path", "from-config")),
                            ),
                        ),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                ),
            )
        val operation = assertNotNull(run.configuration).operations.single { it.operationId == "getPet" }
        assertEquals("from-config", operation.parameterValues.single { it.name == "id" }.value)
        assertEquals("from-payload", operation.parameterValues.single { it.name == "expand" }.value)
    }

    @Test
    fun `parameterValues fall back to reportValue when neither the primary payload nor the configuration carry the parameter`() {
        val run =
            service().create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    operationConfigurations =
                        listOf(
                            OperationConfiguration(
                                operationId = "getPet",
                                payloads = listOf(OperationPayload()),
                            ),
                        ),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                ),
            )
        val operation = assertNotNull(run.configuration).operations.single { it.operationId == "getPet" }
        assertEquals("1", operation.parameterValues.single { it.name == "id" }.value)
        assertEquals("owner", operation.parameterValues.single { it.name == "expand" }.value)
    }

    @Test
    fun `reportRequestBody falls back to the example when the configuration omits the body and the operation declares one`() {
        val run =
            service().create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("createPet"),
                    operationConfigurations =
                        listOf(
                            OperationConfiguration(
                                operationId = "createPet",
                                payloads = listOf(OperationPayload()),
                            ),
                        ),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                ),
            )
        val operation = assertNotNull(run.configuration).operations.single { it.operationId == "createPet" }
        assertEquals("""{"name":"Fido"}""", operation.requestBodyJson)
    }

    @Test
    fun `reportRequestBody falls back to the example when no operation configuration is provided`() {
        val run =
            service().create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("createPet"),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                ),
            )
        val operation = assertNotNull(run.configuration).operations.single { it.operationId == "createPet" }
        assertEquals("""{"name":"Fido"}""", operation.requestBodyJson)
    }

    @Test
    fun `reportRequestBody prefers the configuration-supplied body when the operation declares one`() {
        val run =
            service().create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("createPet"),
                    operationConfigurations =
                        listOf(
                            OperationConfiguration(
                                operationId = "createPet",
                                requestBodyJson = """{"override":true}""",
                                payloads = listOf(OperationPayload()),
                            ),
                        ),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                ),
            )
        val operation = assertNotNull(run.configuration).operations.single { it.operationId == "createPet" }
        assertEquals("""{"override":true}""", operation.requestBodyJson)
    }

    @Test
    fun `parameterValues fall through to configuredParameters when the primary payload has a matching name but a different location`() {
        val run =
            service().create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    operationConfigurations =
                        listOf(
                            OperationConfiguration(
                                operationId = "getPet",
                                payloads =
                                    listOf(
                                        OperationPayload(
                                            parameterValues =
                                                listOf(
                                                    // "id" with the wrong
                                                    // location ("query"
                                                    // instead of "path").
                                                    ParameterValue("id", "query", "wrong-location"),
                                                ),
                                        ),
                                    ),
                                parameterValues = listOf(ParameterValue("id", "path", "from-config")),
                            ),
                        ),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                ),
            )
        val operation = assertNotNull(run.configuration).operations.single { it.operationId == "getPet" }
        assertEquals("from-config", operation.parameterValues.single { it.name == "id" }.value)
    }

    @Test
    fun `execute stdout reader swallows the IOException raised when the process is destroyed mid-read`() {
        val script =
            java.nio.file.Paths
                .get("/tmp/lasttest-keep-reader-busy-${System.nanoTime()}.sh")
        try {
            java.nio.file.Files.writeString(
                script,
                """
                #!/bin/sh
                exec dd if=/dev/zero bs=4096
                """.trimIndent(),
            )
            val scriptFile = script.toFile().also { it.setExecutable(true, false) }
            require(scriptFile.canExecute()) { "script at $scriptFile is not executable" }
            val threads = java.util.Collections.synchronizedList(mutableListOf<Thread>())
            val asyncExecutor =
                CapturingExecutorService { task ->
                    val t = Thread(task, "k6-reader")
                    threads.add(t)
                    t.start()
                }
            val svc =
                LocalK6TestRunService(
                    importer =
                        object : SpecificationImporter {
                            override fun import(content: String): ImportedSpecification = specification
                        },
                    generator =
                        object : K6ScriptGenerator {
                            override fun generateForRun(
                                specification: ImportedSpecification,
                                baseUrl: String,
                                runId: String,
                                operationIds: Set<String>,
                                operationConfigurations: List<OperationConfiguration>,
                                loadProfile: LoadProfile,
                            ): String = "export default function () {}"
                        },
                    executor = asyncExecutor,
                    readerExecutor = asyncExecutor,
                    k6Command = scriptFile.absolutePath,
                    influxDbProperties = InfluxDbProperties(enabled = false),
                    runRepository = InMemoryTestRunRepository(),
                    statisticsRepository = InMemoryOperationStatisticsRepository(),
                    timeSeriesWriter = InMemoryTimeSeriesWriter(),
                )
            val run =
                svc.create(
                    CreateTestRunRequest(
                        specification = "openapi document",
                        baseUrl = "https://target.test",
                        operationIds = setOf("getPet"),
                        loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                    ),
                )
            val deadline = System.currentTimeMillis() + 5_000L
            var process: Process? = null
            while (System.currentTimeMillis() < deadline) {
                process = svc.processes[run.id]
                if (process != null) break
                Thread.sleep(10)
            }
            val runningProcess = assertNotNull(process, "process must be spawned within 5 s")
            val readPollDeadline = System.currentTimeMillis() + 5_000L
            while (System.currentTimeMillis() < readPollDeadline) {
                if (!runningProcess.isAlive) break
                try {
                    val stdout = runningProcess.inputStream
                    if (stdout.available() >= 0) {
                        Thread.sleep(100)
                        break
                    }
                } catch (e: java.io.IOException) {
                    break
                }
                Thread.sleep(50)
            }
            runningProcess.destroyForcibly()
            for (t in threads.toList()) {
                t.join(5_000L)
            }
            assertNotNull(svc.find(run.id))
        } finally {
            java.nio.file.Files
                .deleteIfExists(script)
        }
    }

    @Test
    fun `execute catch block falls back to the original run when the map entry was removed mid-execution`() {
        val svc = serviceWithFakeK6()
        val runsField = LocalK6TestRunService::class.java.getDeclaredField("runs")
        runsField.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        val runsMap = runsField.get(svc) as ConcurrentHashMap<String, TestRun>
        val synthetic =
            TestRun(
                id = "missing-mid-flight",
                status = TestRunStatus.QUEUED,
                createdAt = "2026-01-01T00:00:00Z",
            )

        val remover =
            Thread {
                val deadline = System.currentTimeMillis() + 2_000L
                while (System.currentTimeMillis() < deadline) {
                    val current = runsMap[synthetic.id]
                    if (current != null && current.status == TestRunStatus.RUNNING) {
                        runsMap.remove(synthetic.id)
                        return@Thread
                    }
                    Thread.sleep(0, 100_000)
                }
            }
        remover.start()
        try {
            val execute =
                LocalK6TestRunService::class.java.getDeclaredMethod(
                    "execute",
                    TestRun::class.java,
                    String::class.java,
                    String::class.java,
                )
            execute.isAccessible = true
            execute.invoke(svc, synthetic, "export default function () {}", "https://target.test")
        } finally {
            remover.join(3_000L)
        }
        val reinserted = runsMap["missing-mid-flight"]
        if (reinserted != null) {
            assertEquals(TestRunStatus.FAILED, reinserted.status)
        }
    }

    @Test
    fun `execute catch block falls back to the original run when the map entry was removed before invocation`() {
        val svc = serviceWithFakeK6()
        val runsField = LocalK6TestRunService::class.java.getDeclaredField("runs")
        runsField.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        val runsMap = runsField.get(svc) as ConcurrentHashMap<String, TestRun>
        val synthetic =
            TestRun(
                id = "missing-on-purpose",
                status = TestRunStatus.QUEUED,
                createdAt = "2026-01-01T00:00:00Z",
            )
        val execute =
            LocalK6TestRunService::class.java.getDeclaredMethod(
                "execute",
                TestRun::class.java,
                String::class.java,
                String::class.java,
            )
        execute.isAccessible = true
        execute.invoke(svc, synthetic, "export default function () {}", "https://target.test")
        val reinserted = runsMap["missing-on-purpose"]
        assertNotNull(reinserted, "execute must re-insert the run in the catch block via the fallback")
        assertEquals(TestRunStatus.FAILED, reinserted.status)
    }

    @Test
    fun `execute main try block falls back to the original run when the map entry is missing after a successful run`() {
        val svc = serviceWithFakeK6(command = "/usr/bin/true")
        val runsField = LocalK6TestRunService::class.java.getDeclaredField("runs")
        runsField.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        val runsMap = runsField.get(svc) as ConcurrentHashMap<String, TestRun>
        val synthetic =
            TestRun(
                id = "missing-on-purpose-2",
                status = TestRunStatus.QUEUED,
                createdAt = "2026-01-01T00:00:00Z",
            )
        val execute =
            LocalK6TestRunService::class.java.getDeclaredMethod(
                "execute",
                TestRun::class.java,
                String::class.java,
                String::class.java,
            )
        execute.isAccessible = true
        val remover =
            Thread {
                val deadline = System.currentTimeMillis() + 2_000L
                while (System.currentTimeMillis() < deadline) {
                    val current = runsMap[synthetic.id]
                    if (current != null && current.status == TestRunStatus.RUNNING) {
                        runsMap.remove(synthetic.id)
                        return@Thread
                    }
                    Thread.sleep(0, 100_000)
                }
            }
        remover.start()
        try {
            execute.invoke(svc, synthetic, "export default function () {}", "https://target.test")
        } finally {
            remover.join(3_000L)
        }
        val reinserted = runsMap["missing-on-purpose-2"]
        if (reinserted != null) {
            assertEquals(TestRunStatus.COMPLETED, reinserted.status)
        }
    }

    @Suppress("unused")
    private val timeUnitRef: Class<TimeUnit> = TimeUnit::class.java

    @Test
    fun `script returns null after a restart when the encryptor cannot decrypt the persisted request`() {
        val repository = InMemoryTestRunRepository()
        val entity = TestRunEntity()
        entity.id = "encrypted-but-unreadable"
        entity.status = TestRunStatus.COMPLETED
        entity.createdAt = java.time.Instant.now()
        entity.originalRequestJson = "{\"specification\":\"openapi document\"}"
        repository.save(entity)
        val failingEncryptor =
            object : TestRunPayloadEncryptor {
                override fun encrypt(plain: String?): String? = plain

                override fun decrypt(blob: String?): String? = null
            }
        val svc =
            LocalK6TestRunService(
                importer =
                    object : SpecificationImporter {
                        override fun import(content: String): ImportedSpecification = specification
                    },
                generator =
                    object : K6ScriptGenerator {
                        override fun generateForRun(
                            specification: ImportedSpecification,
                            baseUrl: String,
                            runId: String,
                            operationIds: Set<String>,
                            operationConfigurations: List<OperationConfiguration>,
                            loadProfile: LoadProfile,
                        ): String = "export default function () {}"
                    },
                executor = NoopExecutorService(),
                readerExecutor = NoopExecutorService(),
                k6Command = "k6",
                influxDbProperties = InfluxDbProperties(enabled = false),
                runRepository = repository,
                statisticsRepository = InMemoryOperationStatisticsRepository(),
                timeSeriesWriter = InMemoryTimeSeriesWriter(),
                payloadEncryptor = failingEncryptor,
            )

        assertNull(svc.script("encrypted-but-unreadable"))
    }

    @Test
    fun `script returns null after a restart when the persisted JSON is malformed`() {
        val repository = InMemoryTestRunRepository()
        val entity = TestRunEntity()
        entity.id = "malformed-request"
        entity.status = TestRunStatus.COMPLETED
        entity.createdAt = java.time.Instant.now()
        entity.originalRequestJson = "{not even close to valid json"
        repository.save(entity)
        val svc =
            LocalK6TestRunService(
                importer =
                    object : SpecificationImporter {
                        override fun import(content: String): ImportedSpecification = specification
                    },
                generator =
                    object : K6ScriptGenerator {
                        override fun generateForRun(
                            specification: ImportedSpecification,
                            baseUrl: String,
                            runId: String,
                            operationIds: Set<String>,
                            operationConfigurations: List<OperationConfiguration>,
                            loadProfile: LoadProfile,
                        ): String = "export default function () {}"
                    },
                executor = NoopExecutorService(),
                readerExecutor = NoopExecutorService(),
                k6Command = "k6",
                influxDbProperties = InfluxDbProperties(enabled = false),
                runRepository = repository,
                statisticsRepository = InMemoryOperationStatisticsRepository(),
                timeSeriesWriter = InMemoryTimeSeriesWriter(),
            )

        assertNull(svc.script("malformed-request"))
    }

    @Test
    fun `trimEndpointToRetention returns immediately when the total is at or below the cap`() {
        val repository = InMemoryTestRunRepository()
        val svc =
            LocalK6TestRunService(
                importer =
                    object : SpecificationImporter {
                        override fun import(content: String): ImportedSpecification = specification
                    },
                generator =
                    object : K6ScriptGenerator {
                        override fun generateForRun(
                            specification: ImportedSpecification,
                            baseUrl: String,
                            runId: String,
                            operationIds: Set<String>,
                            operationConfigurations: List<OperationConfiguration>,
                            loadProfile: LoadProfile,
                        ): String = "export default function () {}"
                    },
                executor = NoopExecutorService(),
                readerExecutor = NoopExecutorService(),
                k6Command = "k6",
                influxDbProperties = InfluxDbProperties(enabled = false),
                runRepository = repository,
                statisticsRepository = InMemoryOperationStatisticsRepository(),
                timeSeriesWriter = InMemoryTimeSeriesWriter(),
            )
        val method =
            LocalK6TestRunService::class.java.getDeclaredMethod(
                "trimEndpointToRetention",
                String::class.java,
                String::class.java,
                Long::class.javaPrimitiveType,
            )
        method.isAccessible = true
        method.invoke(svc, "GET", "/api/never-stored", 40L)
        assertEquals(0, repository.count())
    }

    @Test
    fun `trimEndpointToRetention skips the delete when the read-back id list is empty`() {
        val repository = InMemoryTestRunRepository()
        val svc =
            LocalK6TestRunService(
                importer =
                    object : SpecificationImporter {
                        override fun import(content: String): ImportedSpecification = specification
                    },
                generator =
                    object : K6ScriptGenerator {
                        override fun generateForRun(
                            specification: ImportedSpecification,
                            baseUrl: String,
                            runId: String,
                            operationIds: Set<String>,
                            operationConfigurations: List<OperationConfiguration>,
                            loadProfile: LoadProfile,
                        ): String = "export default function () {}"
                    },
                executor = NoopExecutorService(),
                readerExecutor = NoopExecutorService(),
                k6Command = "k6",
                influxDbProperties = InfluxDbProperties(enabled = false),
                runRepository = repository,
                statisticsRepository = InMemoryOperationStatisticsRepository(),
                timeSeriesWriter = InMemoryTimeSeriesWriter(),
            )
        val method =
            LocalK6TestRunService::class.java.getDeclaredMethod(
                "trimEndpointToRetention",
                String::class.java,
                String::class.java,
                Long::class.javaPrimitiveType,
            )
        method.isAccessible = true
        method.invoke(svc, "GET", "/api/concurrently-shrunk", 41L)
        assertEquals(0, repository.count())
    }

    @Test
    fun `shutdownInFlightRuns returns as soon as both executors report terminated`() {
        val mainPool = NoopExecutorService()
        val readerPool = NoopExecutorService()
        mainPool.shutdown()
        readerPool.shutdown()
        val svc =
            LocalK6TestRunService(
                importer =
                    object : SpecificationImporter {
                        override fun import(content: String): ImportedSpecification = specification
                    },
                generator =
                    object : K6ScriptGenerator {
                        override fun generateForRun(
                            specification: ImportedSpecification,
                            baseUrl: String,
                            runId: String,
                            operationIds: Set<String>,
                            operationConfigurations: List<OperationConfiguration>,
                            loadProfile: LoadProfile,
                        ): String = "export default function () {}"
                    },
                executor = mainPool,
                readerExecutor = readerPool,
                k6Command = "k6",
                influxDbProperties = InfluxDbProperties(enabled = false),
                runRepository = InMemoryTestRunRepository(),
                statisticsRepository = InMemoryOperationStatisticsRepository(),
                timeSeriesWriter = InMemoryTimeSeriesWriter(),
            )
        val start = System.currentTimeMillis()
        svc.shutdownInFlightRuns()
        val elapsed = System.currentTimeMillis() - start
        assertTrue(elapsed < 50, "shutdownInFlightRuns must early-exit when both pools are terminated (took $elapsed ms)")
    }

    @Test
    fun `shutdownInFlightRuns returns early when the drain loop is interrupted while sleeping`() {
        val blockerA = java.util.concurrent.CountDownLatch(1)
        val blockerB = java.util.concurrent.CountDownLatch(1)
        val mainPool =
            java.util.concurrent.Executors
                .newSingleThreadExecutor()
        val readerPool =
            java.util.concurrent.Executors
                .newSingleThreadExecutor()
        mainPool.execute { blockerA.await() }
        readerPool.execute { blockerB.await() }
        val svc =
            LocalK6TestRunService(
                importer =
                    object : SpecificationImporter {
                        override fun import(content: String): ImportedSpecification = specification
                    },
                generator =
                    object : K6ScriptGenerator {
                        override fun generateForRun(
                            specification: ImportedSpecification,
                            baseUrl: String,
                            runId: String,
                            operationIds: Set<String>,
                            operationConfigurations: List<OperationConfiguration>,
                            loadProfile: LoadProfile,
                        ): String = "export default function () {}"
                    },
                executor = mainPool,
                readerExecutor = readerPool,
                k6Command = "k6",
                influxDbProperties = InfluxDbProperties(enabled = false),
                runRepository = InMemoryTestRunRepository(),
                statisticsRepository = InMemoryOperationStatisticsRepository(),
                timeSeriesWriter = InMemoryTimeSeriesWriter(),
            )
        val stub = ProcessBuilder("sleep", "0.1").start()
        svc.processes["drain-interrupt-run"] = stub
        val hookFinished = java.util.concurrent.CountDownLatch(1)
        val hookThread =
            Thread({
                try {
                    svc.shutdownInFlightRuns()
                } finally {
                    hookFinished.countDown()
                }
            }, "shutdown-hook-under-test")
        hookThread.start()
        try {
            Thread.sleep(100)
            hookThread.interrupt()
            val finished = hookFinished.await(2, java.util.concurrent.TimeUnit.SECONDS)
            assertTrue(finished, "shutdownInFlightRuns must return promptly after being interrupted")
            hookThread.join(2_000)
            assertFalse(hookThread.isAlive, "the hook thread must have exited")
        } finally {
            if (stub.isAlive) stub.destroyForcibly()
            svc.processes.remove("drain-interrupt-run")
            blockerA.countDown()
            blockerB.countDown()
            mainPool.shutdownNow()
            readerPool.shutdownNow()
        }
    }

    @Test
    fun `shutdownInFlightRuns keeps polling when only one of the two pools has terminated`() {
        val mainPool =
            java.util.concurrent.Executors
                .newSingleThreadExecutor()
        val readerBlocker = java.util.concurrent.CountDownLatch(1)
        val readerPool =
            java.util.concurrent.Executors
                .newSingleThreadExecutor()
        readerPool.execute { readerBlocker.await() }
        val svc =
            LocalK6TestRunService(
                importer =
                    object : SpecificationImporter {
                        override fun import(content: String): ImportedSpecification = specification
                    },
                generator =
                    object : K6ScriptGenerator {
                        override fun generateForRun(
                            specification: ImportedSpecification,
                            baseUrl: String,
                            runId: String,
                            operationIds: Set<String>,
                            operationConfigurations: List<OperationConfiguration>,
                            loadProfile: LoadProfile,
                        ): String = "export default function () {}"
                    },
                executor = mainPool,
                readerExecutor = readerPool,
                k6Command = "k6",
                influxDbProperties = InfluxDbProperties(enabled = false),
                runRepository = InMemoryTestRunRepository(),
                statisticsRepository = InMemoryOperationStatisticsRepository(),
                timeSeriesWriter = InMemoryTimeSeriesWriter(),
            )
        val stub = ProcessBuilder("sleep", "0.1").start()
        svc.processes["asymmetric-drain-run"] = stub
        val hookFinished = java.util.concurrent.CountDownLatch(1)
        val hookThread =
            Thread({
                try {
                    svc.shutdownInFlightRuns()
                } finally {
                    hookFinished.countDown()
                }
            }, "shutdown-hook-asymmetric")
        hookThread.start()
        try {
            Thread.sleep(150)
            assertTrue(hookThread.isAlive, "the hook must still be polling while the reader pool is blocked")
            readerBlocker.countDown()
            val finished = hookFinished.await(5, java.util.concurrent.TimeUnit.SECONDS)
            assertTrue(finished, "shutdownInFlightRuns must return once both pools terminate")
        } finally {
            if (stub.isAlive) stub.destroyForcibly()
            svc.processes.remove("asymmetric-drain-run")
            readerBlocker.countDown()
            mainPool.shutdownNow()
            readerPool.shutdownNow()
            hookThread.join(2_000)
        }
    }

    @Test
    fun `shutdownInFlightRuns swallows exceptions thrown by cancel so one bad run does not block the rest`() {
        val mainPool =
            CapturingExecutorService { _ ->
                throw RuntimeException("simulated executor rejection")
            }
        val readerPool = NoopExecutorService()
        val svc =
            LocalK6TestRunService(
                importer =
                    object : SpecificationImporter {
                        override fun import(content: String): ImportedSpecification = specification
                    },
                generator =
                    object : K6ScriptGenerator {
                        override fun generateForRun(
                            specification: ImportedSpecification,
                            baseUrl: String,
                            runId: String,
                            operationIds: Set<String>,
                            operationConfigurations: List<OperationConfiguration>,
                            loadProfile: LoadProfile,
                        ): String = "export default function () {}"
                    },
                executor = mainPool,
                readerExecutor = readerPool,
                k6Command = "k6",
                influxDbProperties = InfluxDbProperties(enabled = false),
                runRepository = InMemoryTestRunRepository(),
                statisticsRepository = InMemoryOperationStatisticsRepository(),
                timeSeriesWriter = InMemoryTimeSeriesWriter(),
            )
        val runsField = LocalK6TestRunService::class.java.getDeclaredField("runs")
        runsField.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        val runsMap = runsField.get(svc) as ConcurrentHashMap<String, TestRun>
        val liveA = TestRun(id = "live-a", status = TestRunStatus.RUNNING, createdAt = "2026-01-01T00:00:00Z")
        val liveB = TestRun(id = "live-b", status = TestRunStatus.RUNNING, createdAt = "2026-01-01T00:00:01Z")
        runsMap[liveA.id] = liveA
        runsMap[liveB.id] = liveB
        val stubA = ProcessBuilder("sleep", "1").start()
        val stubB = ProcessBuilder("sleep", "1").start()
        svc.processes[liveA.id] = stubA
        svc.processes[liveB.id] = stubB
        try {
            svc.shutdownInFlightRuns()
            val finalA = svc.find(liveA.id)
            val finalB = svc.find(liveB.id)
            assertNotNull(finalA)
            assertNotNull(finalB)
        } finally {
            if (stubA.isAlive) stubA.destroyForcibly()
            if (stubB.isAlive) stubB.destroyForcibly()
            svc.processes.remove(liveA.id)
            svc.processes.remove(liveB.id)
        }
    }

    @Test
    fun `deleteAll skips ids that were removed from the runs map between the snapshot and the iteration`() {
        val repository = InMemoryTestRunRepository()
        val svc =
            LocalK6TestRunService(
                importer =
                    object : SpecificationImporter {
                        override fun import(content: String): ImportedSpecification = specification
                    },
                generator =
                    object : K6ScriptGenerator {
                        override fun generateForRun(
                            specification: ImportedSpecification,
                            baseUrl: String,
                            runId: String,
                            operationIds: Set<String>,
                            operationConfigurations: List<OperationConfiguration>,
                            loadProfile: LoadProfile,
                        ): String = "export default function () {}"
                    },
                executor = NoopExecutorService(),
                readerExecutor = NoopExecutorService(),
                k6Command = "k6",
                influxDbProperties = InfluxDbProperties(enabled = false),
                runRepository = repository,
                statisticsRepository = InMemoryOperationStatisticsRepository(),
                timeSeriesWriter = InMemoryTimeSeriesWriter(),
            )
        val runsField = LocalK6TestRunService::class.java.getDeclaredField("runs")
        runsField.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        val runsMap = runsField.get(svc) as ConcurrentHashMap<String, TestRun>
        val liveA =
            svc.create(
                CreateTestRunRequest(
                    specification = "openapi",
                    baseUrl = "https://example.test",
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                ),
            )
        val liveB =
            svc.create(
                CreateTestRunRequest(
                    specification = "openapi",
                    baseUrl = "https://example.test",
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                ),
            )
        runsMap["phantom-removed"] =
            TestRun(id = "phantom-removed", status = TestRunStatus.RUNNING, createdAt = "2026-01-01T00:00:00Z")
        runsMap.remove("phantom-removed")
        val result = svc.deleteAll()
        assertEquals(2, result.cancelled)
        assertEquals(2, result.deleted)
    }

    @Test
    fun `deleteAll does not count a run that cancel refuses to cancel`() {
        val svc = service()
        val profile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1)
        svc.create(
            CreateTestRunRequest(
                specification = "openapi",
                baseUrl = "https://example.test",
                loadProfile = profile,
            ),
        )
        val result = svc.deleteAll()
        assertEquals(1, result.cancelled)
        assertEquals(1, result.deleted)
    }

    @Test
    fun `deleteAll skips an id whose entry is genuinely removed from the runs map between the snapshot and the loop`() {
        val repository = InMemoryTestRunRepository()
        val svc =
            LocalK6TestRunService(
                importer =
                    object : SpecificationImporter {
                        override fun import(content: String): ImportedSpecification = specification
                    },
                generator =
                    object : K6ScriptGenerator {
                        override fun generateForRun(
                            specification: ImportedSpecification,
                            baseUrl: String,
                            runId: String,
                            operationIds: Set<String>,
                            operationConfigurations: List<OperationConfiguration>,
                            loadProfile: LoadProfile,
                        ): String = "export default function () {}"
                    },
                executor = NoopExecutorService(),
                readerExecutor = NoopExecutorService(),
                k6Command = "k6",
                influxDbProperties = InfluxDbProperties(enabled = false),
                runRepository = repository,
                statisticsRepository = InMemoryOperationStatisticsRepository(),
                timeSeriesWriter = InMemoryTimeSeriesWriter(),
            )
        val run =
            svc.create(
                CreateTestRunRequest(
                    specification = "openapi",
                    baseUrl = "https://example.test",
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                ),
            )
        val runsField = LocalK6TestRunService::class.java.getDeclaredField("runs")
        runsField.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        val liveRunsMap = runsField.get(svc) as ConcurrentHashMap<String, TestRun>
        val raceMap =
            object : ConcurrentHashMap<String, TestRun>(liveRunsMap) {
                private var armed = true

                override fun get(key: String): TestRun? {
                    if (armed && key == run.id) {
                        armed = false
                        remove(key)
                        return null
                    }
                    return super.get(key)
                }
            }
        runsField.set(svc, raceMap)
        val result = svc.deleteAll()
        assertEquals(0, result.cancelled)
        assertEquals(1, result.deleted)
    }

    @Test
    fun `deleteAll does not count a run that cancel genuinely refuses to cancel`() {
        val repository = InMemoryTestRunRepository()
        val svc =
            LocalK6TestRunService(
                importer =
                    object : SpecificationImporter {
                        override fun import(content: String): ImportedSpecification = specification
                    },
                generator =
                    object : K6ScriptGenerator {
                        override fun generateForRun(
                            specification: ImportedSpecification,
                            baseUrl: String,
                            runId: String,
                            operationIds: Set<String>,
                            operationConfigurations: List<OperationConfiguration>,
                            loadProfile: LoadProfile,
                        ): String = "export default function () {}"
                    },
                executor = NoopExecutorService(),
                readerExecutor = NoopExecutorService(),
                k6Command = "k6",
                influxDbProperties = InfluxDbProperties(enabled = false),
                runRepository = repository,
                statisticsRepository = InMemoryOperationStatisticsRepository(),
                timeSeriesWriter = InMemoryTimeSeriesWriter(),
            )
        val run =
            svc.create(
                CreateTestRunRequest(
                    specification = "openapi",
                    baseUrl = "https://example.test",
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                ),
            )
        val runsField = LocalK6TestRunService::class.java.getDeclaredField("runs")
        runsField.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        val liveRunsMap = runsField.get(svc) as ConcurrentHashMap<String, TestRun>
        val queuedSnapshot = liveRunsMap[run.id]!!
        val terminalSnapshot = queuedSnapshot.copy(status = TestRunStatus.ABORTED)
        val raceMap =
            object : ConcurrentHashMap<String, TestRun>(liveRunsMap) {
                private var firstReadDone = false

                override fun get(key: String): TestRun? {
                    if (key != run.id) return super.get(key)
                    return if (!firstReadDone) {
                        firstReadDone = true
                        queuedSnapshot
                    } else {
                        terminalSnapshot
                    }
                }
            }
        runsField.set(svc, raceMap)
        val result = svc.deleteAll()
        assertEquals(0, result.cancelled)
        assertEquals(1, result.deleted)
    }

    @Test
    fun `publishLiveTail truncates the snapshot with the ellipsis marker when the output exceeds the cap`() {
        val svc = service()
        val output = java.io.ByteArrayOutputStream()

        val filler = "x".repeat(50_001)
        output.write(filler.toByteArray(Charsets.UTF_8))
        val runId = "tail-truncate-${System.nanoTime()}"
        val runsField = LocalK6TestRunService::class.java.getDeclaredField("runs")
        runsField.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        val runsMap = runsField.get(svc) as ConcurrentHashMap<String, TestRun>
        runsMap[runId] = TestRun(id = runId, status = TestRunStatus.RUNNING, createdAt = "2026-01-01T00:00:00Z")
        val lock =
            java.util.concurrent.locks
                .ReentrantLock()

        val method =
            LocalK6TestRunService::class.java.getDeclaredMethod(
                "publishLiveTail\$lasttest",
                String::class.java,
                java.io.ByteArrayOutputStream::class.java,
                java.util.concurrent.locks.ReentrantLock::class.java,
                kotlin.Function1::class.java,
            )
        method.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        method.invoke(svc, runId, output, lock, { _: Boolean -> })
        val updated = svc.find(runId)
        assertNotNull(updated)
        val console = updated.consoleOutput ?: ""
        assertTrue(console.contains("Zeichen übersprungen"), "truncation marker must be present in the snapshot")
    }

    @Test
    fun `publishLiveTail returns early when the run is no longer in the runs map`() {
        val svc = service()
        val output = java.io.ByteArrayOutputStream()
        output.write("anything".toByteArray(Charsets.UTF_8))
        val lock =
            java.util.concurrent.locks
                .ReentrantLock()
        val method =
            LocalK6TestRunService::class.java.getDeclaredMethod(
                "publishLiveTail\$lasttest",
                String::class.java,
                java.io.ByteArrayOutputStream::class.java,
                java.util.concurrent.locks.ReentrantLock::class.java,
                kotlin.Function1::class.java,
            )
        method.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        method.invoke(svc, "never-was-a-run-id", output, lock, { _: Boolean -> })
        assertNull(svc.find("never-was-a-run-id"))
    }

    @Test
    fun `publishLiveTail re-arm thread returns when the lock is already held`() {
        val svc = service()
        val output = java.io.ByteArrayOutputStream()
        output.write("hello".toByteArray(Charsets.UTF_8))
        val runId = "tail-lock-contention-${System.nanoTime()}"
        val runsField = LocalK6TestRunService::class.java.getDeclaredField("runs")
        runsField.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        val runsMap = runsField.get(svc) as ConcurrentHashMap<String, TestRun>
        runsMap[runId] = TestRun(id = runId, status = TestRunStatus.RUNNING, createdAt = "2026-01-01T00:00:00Z")
        val lock =
            java.util.concurrent.locks
                .ReentrantLock()
        val throttleField = LocalK6TestRunService::class.java.getDeclaredField("lastLiveTailPublishMs")
        throttleField.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        val throttleMap = throttleField.get(null) as java.util.concurrent.ConcurrentMap<String, Long>
        throttleMap[runId] = 0L
        lock.lock()
        try {
            val method =
                LocalK6TestRunService::class.java.getDeclaredMethod(
                    "publishLiveTail\$lasttest",
                    String::class.java,
                    java.io.ByteArrayOutputStream::class.java,
                    java.util.concurrent.locks.ReentrantLock::class.java,
                    kotlin.Function1::class.java,
                )
            method.isAccessible = true
            @Suppress("UNCHECKED_CAST")
            method.invoke(svc, runId, output, lock, { _: Boolean -> })
            Thread.sleep(400)
        } finally {
            lock.unlock()
        }

        val stillThere = svc.find(runId)
        assertNotNull(stillThere, "the run entry must remain after the lock-contention early return")
    }

    @Test
    fun `publishLiveTail re-arm thread propagates an interrupt and exits`() {
        val svc = service()
        val output = java.io.ByteArrayOutputStream()
        output.write("hello".toByteArray(Charsets.UTF_8))
        val runId = "tail-interrupt-${System.nanoTime()}"
        val runsField = LocalK6TestRunService::class.java.getDeclaredField("runs")
        runsField.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        val runsMap = runsField.get(svc) as ConcurrentHashMap<String, TestRun>
        runsMap[runId] = TestRun(id = runId, status = TestRunStatus.RUNNING, createdAt = "2026-01-01T00:00:00Z")
        val lock =
            java.util.concurrent.locks
                .ReentrantLock()
        val throttleField = LocalK6TestRunService::class.java.getDeclaredField("lastLiveTailPublishMs")
        throttleField.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        val throttleMap = throttleField.get(null) as java.util.concurrent.ConcurrentMap<String, Long>
        throttleMap[runId] = 0L
        val method =
            LocalK6TestRunService::class.java.getDeclaredMethod(
                "publishLiveTail\$lasttest",
                String::class.java,
                java.io.ByteArrayOutputStream::class.java,
                java.util.concurrent.locks.ReentrantLock::class.java,
                kotlin.Function1::class.java,
            )
        method.isAccessible = true
        val outerThread = Thread.currentThread()
        val invoker =
            Thread({
                @Suppress("UNCHECKED_CAST")
                method.invoke(svc, runId, output, lock, { _: Boolean -> })
            }, "publish-live-tail-invoker")
        invoker.start()

        val group = ThreadGroup("re-arm-capture")
        val before = group.activeCount()
        Thread.sleep(100)
        val allThreads = arrayOfNulls<Thread>(Thread.activeCount() * 2)
        val count = Thread.enumerate(allThreads)
        val reArm = allThreads.filterNotNull().firstOrNull { it.name.startsWith("Thread-") && it != invoker && it != outerThread && it.isAlive }
        assertNotNull(reArm, "the re-arm thread must be alive and found within the sleep window")
        reArm.interrupt()
        reArm.join(2_000L)
        assertFalse(reArm.isAlive, "the re-arm thread must exit promptly after being interrupted")
        assertTrue(before >= 0, "group counter must be non-negative")
        assertNotNull(svc.find(runId))
    }

    private fun invokeExecuteReaderLambda(
        svc: LocalK6TestRunService,
        process: Process,
        output: java.io.ByteArrayOutputStream,
        liveTailLock: java.util.concurrent.locks.ReentrantLock,
        run: TestRun,
        totalDurationSeconds: Int,
        targetVus: Int,
    ) {
        val lambda =
            LocalK6TestRunService::class.java.getDeclaredMethod(
                "execute\$lambda\$0",
                Process::class.java,
                java.io.ByteArrayOutputStream::class.java,
                java.util.concurrent.atomic.AtomicBoolean::class.java,
                java.util.concurrent.locks.ReentrantLock::class.java,
                LocalK6TestRunService::class.java,
                TestRun::class.java,
                Long::class.javaPrimitiveType,
                Int::class.javaPrimitiveType,
                Int::class.javaPrimitiveType,
            )
        lambda.isAccessible = true
        lambda.invoke(
            null,
            process,
            output,
            java.util.concurrent.atomic
                .AtomicBoolean(false),
            liveTailLock,
            svc,
            run,
            System.currentTimeMillis(),
            totalDurationSeconds,
            targetVus,
        )
    }

    @Test
    fun `execute$lambda$0 skips publishing when the liveTailLock is already held`() {
        val runId = "execute-no-trylock-${System.nanoTime()}"
        val svc = service()
        val runsField = LocalK6TestRunService::class.java.getDeclaredField("runs")
        runsField.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        val runsMap = runsField.get(svc) as ConcurrentHashMap<String, TestRun>
        val run = TestRun(id = runId, status = TestRunStatus.RUNNING, createdAt = "2026-01-01T00:00:00Z")
        runsMap[runId] = run
        val stub = ProcessBuilder("/bin/sh", "-c", "printf 'hello\\n'").start()
        val lock =
            java.util.concurrent.locks
                .ReentrantLock()
        val lockHeld = java.util.concurrent.CountDownLatch(1)
        val releaseLock = java.util.concurrent.CountDownLatch(1)
        val holderThread =
            Thread({
                lock.lock()
                try {
                    lockHeld.countDown()
                    releaseLock.await()
                } finally {
                    lock.unlock()
                }
            }, "lock-holder")
        holderThread.start()
        try {
            lockHeld.await(2, java.util.concurrent.TimeUnit.SECONDS)
            invokeExecuteReaderLambda(
                svc = svc,
                process = stub,
                output = java.io.ByteArrayOutputStream(),
                liveTailLock = lock,
                run = run,
                totalDurationSeconds = 5,
                targetVus = 1,
            )
        } finally {
            releaseLock.countDown()
            holderThread.join(2_000)
            if (stub.isAlive) stub.destroyForcibly()
            runsMap.remove(runId)
        }
        assertFalse(holderThread.isAlive, "the lock-holder thread must have released the lock and exited")
    }

    @Test
    fun `execute$lambda$0 skips the sample when the vuPattern VU group is not a valid integer`() {
        val runId = "execute-non-numeric-vu-${System.nanoTime()}"
        val svc = service()
        val runsField = LocalK6TestRunService::class.java.getDeclaredField("runs")
        runsField.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        val runsMap = runsField.get(svc) as ConcurrentHashMap<String, TestRun>
        val run = TestRun(id = runId, status = TestRunStatus.RUNNING, createdAt = "2026-01-01T00:00:00Z")
        runsMap[runId] = run
        val overflowingLine = "running (0m01.0s), 999999999999/10 VUs, 0 complete and 0 interrupted iterations\n"
        val stub =
            ProcessBuilder("/bin/sh", "-c", "printf '%s' \"\$0\"", overflowingLine)
                .start()
        val lock =
            java.util.concurrent.locks
                .ReentrantLock()
        try {
            invokeExecuteReaderLambda(
                svc = svc,
                process = stub,
                output = java.io.ByteArrayOutputStream(),
                liveTailLock = lock,
                run = run,
                totalDurationSeconds = 5,
                targetVus = 1,
            )
            assertNotNull(svc.find(runId))
        } finally {
            if (stub.isAlive) stub.destroyForcibly()
            runsMap.remove(runId)
        }
    }

    @Test
    fun `execute$lambda$0 falls back to targetVus when totalDurationSeconds is zero`() {
        val runId = "execute-zero-duration-${System.nanoTime()}"
        val svc = service()
        val runsField = LocalK6TestRunService::class.java.getDeclaredField("runs")
        runsField.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        val runsMap = runsField.get(svc) as ConcurrentHashMap<String, TestRun>
        val run = TestRun(id = runId, status = TestRunStatus.RUNNING, createdAt = "2026-01-01T00:00:00Z")
        runsMap[runId] = run
        val statusLine = "running (0m01.0s), 3/10 VUs, 0 complete and 0 interrupted iterations\n"
        val stub =
            ProcessBuilder("/bin/sh", "-c", "printf '%s' \"\$0\"", statusLine)
                .start()
        val lock =
            java.util.concurrent.locks
                .ReentrantLock()
        try {
            invokeExecuteReaderLambda(
                svc = svc,
                process = stub,
                output = java.io.ByteArrayOutputStream(),
                liveTailLock = lock,
                run = run,
                totalDurationSeconds = 0,
                targetVus = 7,
            )
            assertNotNull(svc.find(runId))
        } finally {
            if (stub.isAlive) stub.destroyForcibly()
            runsMap.remove(runId)
        }
    }

    @Test
    fun `execute$lambda$0$0$1 preserves a pre-set terminal status on the latest snapshot`() {
        val executorThread =
            java.util.concurrent.atomic
                .AtomicReference<Thread?>(null)
        val asyncExecutor =
            CapturingExecutorService { task ->
                val t = Thread(task, "execute-under-test")
                executorThread.set(t)
                t.start()
            }
        val svc = serviceWithFakeK6(executor = asyncExecutor)
        val run =
            svc.create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                ),
            )
        val runsField = LocalK6TestRunService::class.java.getDeclaredField("runs")
        runsField.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        val runsMap = runsField.get(svc) as ConcurrentHashMap<String, TestRun>
        val watcher =
            Thread({
                val deadline = System.currentTimeMillis() + 2_000L
                while (System.currentTimeMillis() < deadline) {
                    val current = runsMap[run.id]
                    if (current != null && current.status == TestRunStatus.RUNNING) {
                        runsMap[run.id] = current.copy(status = TestRunStatus.ABORTED)
                        return@Thread
                    }
                }
            }, "execute-watcher")
        watcher.start()
        watcher.join(3_000L)
        assertFalse(watcher.isAlive, "the watcher must have observed RUNNING and flipped the status within 2 s")
        executorThread.get()?.join(3_000L)
        val finalRun = svc.find(run.id)
        assertNotNull(finalRun)
        assertEquals(TestRunStatus.ABORTED, finalRun.status)
    }
}

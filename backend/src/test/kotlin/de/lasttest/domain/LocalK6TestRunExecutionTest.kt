package de.lasttest.domain

import de.lasttest.api.ApiOperation
import de.lasttest.api.CreateTestRunRequest
import de.lasttest.api.ImportedSpecification
import de.lasttest.api.OperationConfiguration
import de.lasttest.api.TestRun
import de.lasttest.api.TestRunStatus
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class LocalK6TestRunExecutionTest {
    @TempDir
    lateinit var temporaryDirectory: Path

    @Test
    fun `executes k6 and stores a successful summary`() {
        val command =
            executable(
                "success.sh",
                """
                #!/bin/sh
                summary=""
                while [ "${'$'}#" -gt 0 ]; do
                  if [ "${'$'}1" = "--summary-export" ]; then summary="${'$'}2"; shift; fi
                  shift
                done
                printf '{"metrics":{"checks":{"passes":1,"fails":0}}}' > "${'$'}summary"
                printf 'successful k6 output'
                exit 0
                """.trimIndent(),
            )
        val service = service(command)

        val created = service.create(request())
        val completed = assertNotNull(service.find(created.id))

        assertEquals(TestRunStatus.COMPLETED, completed.status)
        assertEquals(0, completed.exitCode)
        assertContains(completed.summary?.get("raw").toString(), "checks")
        assertNull(completed.error)
        assertEquals("successful k6 output", completed.consoleOutput)
        assertNotNull(completed.startedAt)
        assertNotNull(completed.finishedAt)
        assertNull(service.find("missing"))
    }

    @Test
    fun `stores failed process output without a summary`() {
        val command =
            executable(
                "failure.sh",
                """
                #!/bin/sh
                printf 'k6 failed'
                exit 7
                """.trimIndent(),
            )
        val service = service(command)

        val failed = assertNotNull(service.find(service.create(request()).id))

        assertEquals(TestRunStatus.FAILED, failed.status)
        assertEquals(7, failed.exitCode)
        assertEquals("k6 failed", failed.error)
        assertEquals("k6 failed", failed.consoleOutput)
        assertNull(failed.summary)
    }

    @Test
    fun `stores no error for successful blank process output`() {
        val command = executable("blank.sh", "#!/bin/sh\nexit 0")
        val service = service(command)

        val completed = assertNotNull(service.find(service.create(request()).id))

        assertEquals(TestRunStatus.COMPLETED, completed.status)
        assertNull(completed.error)
        assertNull(completed.consoleOutput)
        assertNull(completed.summary)
    }

    @Test
    fun `stores an io error when k6 cannot be started`() {
        val service = service(temporaryDirectory.resolve("missing-k6").toString())

        val failed = assertNotNull(service.find(service.create(request()).id))

        assertEquals(TestRunStatus.FAILED, failed.status)
        assertNotNull(failed.error)
        assertNull(failed.consoleOutput)
        assertNotNull(failed.finishedAt)
    }

    @Test
    fun `stores no error when a failed run produces only blank output`() {
        val command =
            executable(
                "blank-failure.sh",
                """
                #!/bin/sh
                printf '   '
                exit 1
                """.trimIndent(),
            )
        val service = service(command)

        val failed = assertNotNull(service.find(service.create(request()).id))

        assertEquals(TestRunStatus.FAILED, failed.status)
        assertEquals(1, failed.exitCode)
        assertNull(failed.error)
    }

    @Test
    fun `truncates failed run output that exceeds the maximum error length`() {
        val length = 5_000
        val expectedPrefix = "…[${length - MAX_ERROR_LENGTH} Zeichen übersprungen]…\n"
        val command =
            executable(
                "long-failure.sh",
                """
                #!/bin/sh
                head -c $length /dev/zero | tr '\0' 'x'
                exit 1
                """.trimIndent(),
            )
        val service = service(command)

        val failed = assertNotNull(service.find(service.create(request()).id))

        assertEquals(TestRunStatus.FAILED, failed.status)
        val error = assertNotNull(failed.error)
        assertTrue(
            error.startsWith(expectedPrefix),
            "truncated output must announce the skipped prefix",
        )
        assertEquals(MAX_ERROR_LENGTH + expectedPrefix.length, error.length)
        assertEquals('x', error.last())
    }

    private companion object {
        const val MAX_ERROR_LENGTH: Int = 4_000
    }

    @Test
    fun `two runs are in flight at the same time because the reader no longer pins a main-pool slot`() {
        val command =
            executable(
                "sleep-then-succeed.sh",
                """
                #!/bin/sh
                summary=""
                while [ "${'$'}#" -gt 0 ]; do
                  if [ "${'$'}1" = "--summary-export" ]; then summary="${'$'}2"; shift; fi
                  shift
                done
                sleep 0.8
                printf '{"metrics":{"checks":{"passes":1,"fails":0}}}' > "${'$'}summary"
                printf 'k6 ran'
                exit 0
                """.trimIndent(),
            )
        val executor = Executors.newFixedThreadPool(2)
        val readerExecutor = Executors.newCachedThreadPool()
        val service =
            LocalK6TestRunService(
                importer =
                    object : SpecificationImporter {
                        override fun import(content: String): ImportedSpecification = specification()
                    },
                generator =
                    object : K6ScriptGenerator {
                        override fun generateForRun(
                            specification: ImportedSpecification,
                            baseUrl: String,
                            runId: String,
                            operationIds: Set<String>,
                            operationConfigurations: List<OperationConfiguration>,
                            loadProfile: de.lasttest.api.LoadProfile,
                        ): String = "export default function () {}"
                    },
                executor = executor,
                readerExecutor = readerExecutor,
                k6Command = command,
                influxDbProperties = de.lasttest.config.InfluxDbProperties(enabled = false),
                runRepository = InMemoryTestRunRepository(),
                statisticsRepository = InMemoryOperationStatisticsRepository(),
                timeSeriesWriter = InMemoryTimeSeriesWriter(),
            )

        try {
            val first = service.create(request())
            val firstRunningDeadline = System.currentTimeMillis() + 3_000L
            while (System.currentTimeMillis() < firstRunningDeadline) {
                if (service.find(first.id)?.status == TestRunStatus.RUNNING) break
                Thread.sleep(20)
            }
            assertEquals(
                TestRunStatus.RUNNING,
                service.find(first.id)?.status,
                "first run must reach RUNNING before the second one is created",
            )

            val second = service.create(request())
            val secondRunningDeadline = System.currentTimeMillis() + 3_000L
            while (System.currentTimeMillis() < secondRunningDeadline) {
                if (service.find(second.id)?.status == TestRunStatus.RUNNING) break
                Thread.sleep(20)
            }
            assertEquals(
                TestRunStatus.RUNNING,
                service.find(second.id)?.status,
                "second run must reach RUNNING while the first is still in flight — a " +
                    "regression that re-pins the reader on the main pool would leave the " +
                    "second run in QUEUED until the first run's waitFor() returns",
            )

            val settleDeadline = System.currentTimeMillis() + 5_000L
            var firstTerminal: TestRun? = null
            var secondTerminal: TestRun? = null
            while (System.currentTimeMillis() < settleDeadline && (firstTerminal == null || secondTerminal == null)) {
                firstTerminal = service.find(first.id)?.takeIf { it.status.isTerminal() }
                secondTerminal = service.find(second.id)?.takeIf { it.status.isTerminal() }
                Thread.sleep(20)
            }
            assertNotNull(firstTerminal, "first run must reach a terminal state within 5 s")
            assertNotNull(secondTerminal, "second run must reach a terminal state within 5 s")
            assertEquals(TestRunStatus.COMPLETED, firstTerminal.status)
            assertEquals(TestRunStatus.COMPLETED, secondTerminal.status)
        } finally {
            executor.shutdownNow()
            executor.awaitTermination(2, TimeUnit.SECONDS)
            readerExecutor.shutdown()
            readerExecutor.awaitTermination(2, TimeUnit.SECONDS)
        }
    }

    private fun request(): CreateTestRunRequest =
        CreateTestRunRequest(
            specification = "openapi document",
            baseUrl = "https://example.test",
            operationIds = setOf("listPets"),
            loadProfile =
                de.lasttest.api.LoadProfile(
                    type = de.lasttest.api.LoadProfileType.CONSTANT_VUS,
                    virtualUsers = 1,
                    durationSeconds = 1,
                ),
        )

    private fun specification(): ImportedSpecification =
        ImportedSpecification(
            title = "Pet API",
            version = "1",
            baseUrl = "https://example.test",
            operations = listOf(ApiOperation("listPets", "GET", "/pets", "", false, emptyList(), null)),
        )

    private fun executable(
        name: String,
        content: String,
    ): String {
        val file = temporaryDirectory.resolve(name)
        Files.writeString(file, content)
        check(file.toFile().setExecutable(true))
        return file.toString()
    }

    @Test
    fun `execute overwrites the persisted row with the terminal status when k6 finishes successfully`() {
        val command =
            executable(
                "ok.sh",
                """
                #!/bin/sh
                exit 0
                """.trimIndent(),
            )
        val repository = InMemoryTestRunRepository()
        val statistics = InMemoryOperationStatisticsRepository()
        val service = service(command, repository = repository, statistics = statistics)

        val created = service.create(request())
        val completed = assertNotNull(service.find(created.id))
        assertEquals(TestRunStatus.COMPLETED, completed.status)

        val saved = repository.findById(created.id).orElse(null)
        assertNotNull(saved)
        assertEquals(TestRunStatus.COMPLETED, saved.status)
        assertNotNull(saved.finishedAt, "terminal entity must carry the finishedAt timestamp")
        assertEquals(0, saved.exitCode)
    }

    @Test
    fun `execute overwrites the persisted row when k6 fails and writes the error to the entity`() {
        val command =
            executable(
                "bad.sh",
                """
                #!/bin/sh
                printf 'k6 failed'
                exit 7
                """.trimIndent(),
            )
        val repository = InMemoryTestRunRepository()
        val statistics = InMemoryOperationStatisticsRepository()
        val service = service(command, repository = repository, statistics = statistics)

        val created = service.create(request())
        val failed = assertNotNull(service.find(created.id))
        assertEquals(TestRunStatus.FAILED, failed.status)

        val saved = repository.findById(created.id).orElse(null)
        assertNotNull(saved)
        assertEquals(TestRunStatus.FAILED, saved.status)
        assertEquals(7, saved.exitCode)
    }

    @Test
    fun `execute ticks the per-endpoint counter up by one on a successful run`() {
        val command =
            executable(
                "ok.sh",
                """
                #!/bin/sh
                exit 0
                """.trimIndent(),
            )
        val repository = InMemoryTestRunRepository()
        val statistics = InMemoryOperationStatisticsRepository()
        val service = service(command, repository = repository, statistics = statistics)

        val created = service.create(request())

        assertEquals(TestRunStatus.COMPLETED, service.find(created.id)?.status)

        val counter = statistics.findById(OperationStatisticsEntity.Key("GET", "/pets")).orElse(null)
        assertNotNull(counter, "execute() must insert a per-endpoint counter row on terminal state")
        assertEquals(1L, counter.testCount)
        assertEquals(created.id, counter.lastRunId)
        assertEquals(TestRunStatus.COMPLETED, counter.lastStatus)
    }

    @Test
    fun `execute increments the per-endpoint counter on every run instead of overwriting it`() {
        val command =
            executable(
                "ok.sh",
                """
                #!/bin/sh
                exit 0
                """.trimIndent(),
            )
        val repository = InMemoryTestRunRepository()
        val statistics = InMemoryOperationStatisticsRepository()
        val service = service(command, repository = repository, statistics = statistics)

        val first = service.create(request())
        assertEquals(TestRunStatus.COMPLETED, service.find(first.id)?.status)
        val second = service.create(request())
        assertEquals(TestRunStatus.COMPLETED, service.find(second.id)?.status)

        val counter = statistics.findById(OperationStatisticsEntity.Key("GET", "/pets")).orElse(null)
        assertNotNull(counter)
        assertEquals(2L, counter.testCount, "the second run must increment the counter, not overwrite it")
        assertEquals(second.id, counter.lastRunId)
    }

    @Test
    fun `execute does not crash when the run has no operations and skips the counter update`() {
        val command =
            executable(
                "ok.sh",
                """
                #!/bin/sh
                exit 0
                """.trimIndent(),
            )
        val repository = InMemoryTestRunRepository()
        val statistics = InMemoryOperationStatisticsRepository()
        val service = service(command, repository = repository, statistics = statistics)
        val emptyRequest =
            de.lasttest.api.CreateTestRunRequest(
                specification = "openapi document",
                baseUrl = "https://example.test",
                operationIds = setOf("does-not-exist"),
                loadProfile =
                    de.lasttest.api.LoadProfile(
                        type = de.lasttest.api.LoadProfileType.CONSTANT_VUS,
                        virtualUsers = 1,
                        durationSeconds = 1,
                    ),
            )

        val created = service.create(emptyRequest)
        assertEquals(TestRunStatus.COMPLETED, service.find(created.id)?.status)

        assertNotNull(repository.findById(created.id).orElse(null))
        assertEquals(0, statistics.count(), "a run with no operations must not insert a counter row")
    }

    private fun service(
        command: String,
        repository: TestRunRepository = InMemoryTestRunRepository(),
        statistics: OperationStatisticsRepository = InMemoryOperationStatisticsRepository(),
    ): LocalK6TestRunService =
        LocalK6TestRunService(
            importer =
                object : SpecificationImporter {
                    override fun import(content: String): ImportedSpecification = specification()
                },
            generator =
                object : K6ScriptGenerator {
                    override fun generateForRun(
                        specification: ImportedSpecification,
                        baseUrl: String,
                        runId: String,
                        operationIds: Set<String>,
                        operationConfigurations: List<de.lasttest.api.OperationConfiguration>,
                        loadProfile: de.lasttest.api.LoadProfile,
                    ): String = "export default function () {}"
                },
            executor = SynchronousExecutorService(),
            readerExecutor = SynchronousExecutorService(),
            k6Command = command,
            influxDbProperties = de.lasttest.config.InfluxDbProperties(enabled = false),
            runRepository = repository,
            statisticsRepository = statistics,
            timeSeriesWriter = InMemoryTimeSeriesWriter(),
        )
}

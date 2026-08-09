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
        // On a successful run, error is null because there is nothing
        // to report. This is a deliberate design decision
        // (see LocalK6TestRunService.execute).
        assertNull(completed.error)
        // The k6 console output is also persisted on success so the
        // UI can display it.
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
        // On threshold/process failures `error` and
        // `consoleOutput` carry the same k6 output.
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
        // When the k6 output is completely empty, the console is also
        // empty — no "k6 console output" block in the UI.
        assertNull(completed.consoleOutput)
        assertNull(completed.summary)
    }

    @Test
    fun `stores an io error when k6 cannot be started`() {
        val service = service(temporaryDirectory.resolve("missing-k6").toString())

        val failed = assertNotNull(service.find(service.create(request()).id))

        assertEquals(TestRunStatus.FAILED, failed.status)
        assertNotNull(failed.error)
        // If k6 could not start at all, there is no console
        // output — only the error message.
        assertNull(failed.consoleOutput)
        assertNotNull(failed.finishedAt)
    }

    @Test
    fun `stores no error when a failed run produces only blank output`() {
        // A run that exits non-zero but writes no usable output must
        // surface an empty error — otherwise the UI would render an
        // empty „k6-Konsolenausgabe" box. truncateForError returns null
        // for blank input and execute() copies that null into the run.
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
        // MAX_ERROR_LENGTH is 4_000. We emit 5_000 chars so the tail
        // truncation branch of truncateForError is exercised; the
        // head-of-output branch is unreachable for any captured k6 run.
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
        // The retained tail is the LAST `MAX_ERROR_LENGTH` characters of
        // the captured k6 output, so the final byte of `error` must be
        // 'x' (the padding character emitted by the stub script).
        assertEquals('x', error.last())
    }

    private companion object {
        const val MAX_ERROR_LENGTH: Int = 4_000
    }

    // -----------------------------------------------------------------
    // Concurrency contract between create() and execute()
    //
    // The service runs each k6 process on a 2-thread executor
    // (see [de.lasttest.config.AsyncConfiguration.testRunExecutor]).
    // The reader lives on a separate cached pool
    // ([AsyncConfiguration.k6ReaderExecutor]) so each run
    // consumes only ONE slot on the main pool — the blocking
    // `process.waitFor()` task. `MAX_PARALLEL_RUNS = 2` is
    // therefore a real "up to 2 parallel runs" cap again,
    // unlike the pre-fix design where each run used 2 slots
    // and only 1 run could actually be in flight at a time.
    //
    // The test starts two runs back-to-back and asserts that
    // both reach `RUNNING` while the other is still in flight
    // (true parallel execution) before both settle. A
    // regression that re-merges the two executors — so the
    // reader once again takes a slot on the main pool —
    // would push the second run to `QUEUED` while the first is
    // running, and the assertion at the centre of this test
    // would fire. The test deliberately uses a fake k6 that
    // sleeps so the timing window is wide enough to be
    // deterministic, and a fresh 2-thread main executor to
    // mirror the production cap.
    @Test
    fun `two runs are in flight at the same time because the reader no longer pins a main-pool slot`() {
        // Fake k6: sleeps 800 ms then exits 0 with a one-line
        // summary so execute()'s happy path runs. 800 ms is
        // short enough to keep the test fast and long enough
        // that the 2nd run is observable as RUNNING in parallel
        // with the 1st.
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
        // 2-thread pool mirrors AsyncConfiguration.MAX_PARALLEL_RUNS.
        // The reader is given its own cached pool so the main
        // pool's slots are only consumed by the blocking
        // `waitFor()` task. Both pools are shut down in the
        // `finally` block.
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
                statusCodeTimeSeriesWriter = InMemoryStatusCodeTimeSeriesWriter(),
            )

        try {
            // ---- 1st run: starts on the executor right away ----
            val first = service.create(request())
            // Wait until the main task picked up the run and
            // promoted it to RUNNING.
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

            // ---- 2nd run: submitted while the 1st is still RUNNING ----
            // The 1st run is blocked in `process.waitFor()` on a
            // main-pool worker, and the 1st run's reader is on
            // the cached pool (so the main pool still has one
            // free slot). The 2nd run's main task is therefore
            // picked up immediately and reaches RUNNING without
            // sitting in the QUEUED state.
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

            // ---- Both runs settle ----
            // Bound the wait at 5 s each. The first run's
            // `waitFor()` plus 50 ms cleanup plus 800 ms k6
            // sleep fits comfortably; a regression that leaks
            // a thread (or runs them sequentially) would push
            // the total well over 5 s and the test would fail.
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
            // Best-effort cleanup. We use a hard shutdown so any
            // reader task that is somehow still alive is stopped
            // and the JVM can exit cleanly. The fake k6 also
            // exits on its own — but the executor's queued tasks
            // need an explicit stop or the pool's threads will
            // keep the JVM alive past the test runner.
            executor.shutdownNow()
            executor.awaitTermination(2, TimeUnit.SECONDS)
            readerExecutor.shutdown()
            readerExecutor.awaitTermination(2, TimeUnit.SECONDS)
        }
    }

    private fun TestRunStatus.isTerminal(): Boolean =
        this == TestRunStatus.COMPLETED ||
            this == TestRunStatus.FAILED ||
            this == TestRunStatus.STOPPED ||
            this == TestRunStatus.ABORTED

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

    // ---- terminal-state persistence ------------------------------------
    //
    // The dashboard's "Erneut starten" action on a historical
    // run reads back from H2. For that to work, the service must
    // overwrite the initial QUEUED row with the terminal state
    // (status, exitCode, finishedAt) when the k6 process ends —
    // otherwise a container restart would resurrect the row in
    // its QUEUED state and the timeline would show the wrong
    // badge. The per-endpoint × N counter must also tick up so
    // the dashboard's badge does not freeze.

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
        // The × N counter in the operation list is a
        // denormalised [OperationStatisticsEntity] that the
        // service updates on every terminal transition. A
        // regression where the service forgets to call
        // [updateOperationStatistics] would freeze the badge
        // at its initial value (0 or whatever the test setup
        // seeded) and the dashboard would silently lie about
        // how many tests the user has run.
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

        // The terminal transition has to complete before we
        // assert on the counter. The synchronous executor
        // used by [service] makes this race-free, but a
        // belt-and-braces find() guards against a future
        // refactor that switches to an async pool.
        assertEquals(TestRunStatus.COMPLETED, service.find(created.id)?.status)

        val counter = statistics.findById(OperationStatisticsEntity.Key("GET", "/pets")).orElse(null)
        assertNotNull(counter, "execute() must insert a per-endpoint counter row on terminal state")
        assertEquals(1L, counter.testCount)
        assertEquals(created.id, counter.lastRunId)
        assertEquals(TestRunStatus.COMPLETED, counter.lastStatus)
    }

    @Test
    fun `execute increments the per-endpoint counter on every run instead of overwriting it`() {
        // Two runs against the same (method, path) must
        // produce a counter of 2, not 1. The upsert reads the
        // previous row before writing the new one — a
        // regression that swaps findById for a hard
        // `testCount = 1L` would silently break the badge.
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
        // The most-recent-run fields must follow the second
        // run — a regression that forgets to overwrite them
        // would leave the badge pointing at a stale run.
        assertEquals(second.id, counter.lastRunId)
    }

    @Test
    fun `execute does not crash when the run has no operations and skips the counter update`() {
        // The [OperationStatisticsEntity] rows are keyed by
        // (method, path) of the first operation. A run
        // without any selected operation cannot contribute
        // to the counter, so the helper must skip the update
        // instead of throwing on a missing key. We
        // exercise this by passing an `operationIds` set
        // that does not match any operation in the spec —
        // an empty set is treated as "all" by
        // [LocalK6TestRunService.buildRunConfiguration], so
        // a non-matching id is the right way to force the
        // operations list to be empty.
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

        // The run is still persisted even without a counter
        // row — the operations list is per-run, the
        // statistics are per-endpoint, and a run with no
        // target endpoint simply does not contribute.
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
            statusCodeTimeSeriesWriter = InMemoryStatusCodeTimeSeriesWriter(),
        )
}

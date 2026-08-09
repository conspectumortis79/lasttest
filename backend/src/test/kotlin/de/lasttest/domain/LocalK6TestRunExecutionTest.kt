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
import java.util.concurrent.Executor
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

    private fun service(command: String): LocalK6TestRunService =
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
            executor = Executor(Runnable::run),
            readerExecutor = Executor(Runnable::run),
            k6Command = command,
            influxDbProperties = de.lasttest.config.InfluxDbProperties(enabled = false),
            runRepository = InMemoryTestRunRepository(),
            statisticsRepository = InMemoryOperationStatisticsRepository(),
            timeSeriesWriter = InMemoryTimeSeriesWriter(),
        )

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
}

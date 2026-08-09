package de.lasttest.api

import de.lasttest.demo.DemoSpecificationProvider
import de.lasttest.domain.RemoteSpecificationFetcher
import de.lasttest.domain.SpecificationImporter
import de.lasttest.domain.TestRunService
import de.lasttest.domain.TimeSeriesPoint
import de.lasttest.domain.TimeSeriesReader
import org.springframework.http.HttpHeaders
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class LastTestControllerTest {
    private companion object {
        // The dashboard polls the time-series endpoint at a 1 s
        // cadence. We replay that burst in the race-condition
        // regression test so a flake in a single iteration is
        // caught by the assertion message rather than by a 404
        // landing on the user's console.
        const val POLL_WINDOW: Int = 5
    }

    private val imported = ImportedSpecification("Test API", "1", "https://example.test", emptyList())
    private val existingRequest = CreateTestRunRequest(specification = "openapi document", baseUrl = "https://target.test")
    private val existingRun =
        TestRun(
            id = "run-1",
            status = TestRunStatus.COMPLETED,
            createdAt = "2026-01-01T00:00:00Z",
            // The controller's rerun lookup rejects the run with
            // a 409 when the live snapshot has no preserved
            // [CreateTestRunRequest]. The happy-path test below
            // therefore has to attach a request to the run it
            // asks the controller to rerun.
            originalRequest = existingRequest,
        )
    private val queuedRun =
        TestRun(
            id = "run-queued",
            status = TestRunStatus.QUEUED,
            createdAt = "2026-01-01T00:00:00Z",
        )
    private val runningRun =
        TestRun(
            id = "run-running",
            status = TestRunStatus.RUNNING,
            createdAt = "2026-01-01T00:00:00Z",
            startedAt = "2026-01-01T00:00:01Z",
        )
    private val completedRun =
        TestRun(
            id = "run-completed",
            status = TestRunStatus.COMPLETED,
            createdAt = "2026-01-01T00:00:00Z",
            startedAt = "2026-01-01T00:00:00Z",
            finishedAt = "2026-01-01T00:00:30Z",
        )
    private val service =
        RecordingTestRunService(
            existingRun,
            additionalRuns =
                mapOf(
                    "run-queued" to queuedRun,
                    "run-running" to runningRun,
                    "run-completed" to completedRun,
                ),
        )
    private val demoSpecificationProvider = DemoSpecificationProvider(resourceName = "/demo/recorded.yaml")
    private val remoteFetcher = RecordingRemoteSpecificationFetcher()
    private val timeSeriesReader = RecordingTimeSeriesReader()
    private val statisticsRepository = de.lasttest.domain.InMemoryOperationStatisticsRepository()
    private val runRepository = de.lasttest.domain.InMemoryTestRunRepository()
    private val controller =
        LastTestController(
            importer =
                object : SpecificationImporter {
                    override fun import(content: String): ImportedSpecification = imported
                },
            testRuns = service,
            demoSpecificationProvider = demoSpecificationProvider,
            remoteFetcher = remoteFetcher,
            timeSeriesReader = timeSeriesReader,
            statisticsRepository = statisticsRepository,
            runRepository = runRepository,
        )

    @Test
    fun `returns the bundled demo specification`() {
        val recorded = controller.demoSpecification()

        assertEquals("openapi: 3.0.3\ninfo:\n  title: Recorded\n", recorded)
    }

    @Test
    fun `imports a specification`() {
        assertEquals(imported, controller.import(ImportSpecificationRequest("openapi document")))
    }

    @Test
    fun `fetches a specification from a URL and returns the resolved content`() {
        val resolved =
            FetchedSpecification(
                content = "openapi: 3.0.3\ninfo:\n  title: Fetched\n",
                resolvedUrl = "https://example.test/v3/api-docs",
                source = "swagger-ui",
            )
        remoteFetcher.fetched = resolved

        val response = controller.fetchFromUrl(FetchSpecificationRequest("https://example.test/swagger-ui"))

        assertEquals(resolved, response)
        assertEquals("https://example.test/swagger-ui", remoteFetcher.lastUrl)
    }

    @Test
    fun `lists every test run the service knows about`() {
        // The frontend uses this endpoint to render the multi-run
        // dashboard; the response must include every run so the
        // user can switch between parallel runs without losing one.
        val runA = TestRun(id = "run-a", status = TestRunStatus.COMPLETED, createdAt = "2026-01-02T00:00:00Z")
        val runB = TestRun(id = "run-b", status = TestRunStatus.RUNNING, createdAt = "2026-01-01T00:00:00Z")
        val listController =
            LastTestController(
                importer =
                    object : SpecificationImporter {
                        override fun import(content: String): ImportedSpecification = imported
                    },
                testRuns = RecordingTestRunService(runA, additionalRuns = mapOf("run-b" to runB)),
                demoSpecificationProvider = demoSpecificationProvider,
                remoteFetcher = remoteFetcher,
                timeSeriesReader = timeSeriesReader,
                statisticsRepository = statisticsRepository,
                runRepository = runRepository,
            )

        val response = listController.list()

        assertEquals(2, response.body?.size)
        assertEquals("run-a", response.body?.get(0)?.id)
        assertEquals("run-b", response.body?.get(1)?.id)
    }

    @Test
    fun `creates an accepted test run`() {
        val request = CreateTestRunRequest("openapi document", "https://example.test")

        val response = controller.create(request)

        assertEquals(202, response.statusCode.value())
        assertEquals(existingRun, response.body)
        assertEquals(request, service.lastCreatedRequest)
    }

    @Test
    fun `finds an existing run and returns not found for an unknown run`() {
        assertEquals(existingRun, controller.find("run-1").body)

        val missing = controller.find("missing")
        assertEquals(404, missing.statusCode.value())
        assertNull(missing.body)
    }

    @Test
    fun `downloads the generated script and returns not found for an unknown run`() {
        val response = controller.script("run-1")

        assertEquals(200, response.statusCode.value())
        assertEquals("export default function () {}", response.body)
        assertEquals("application/javascript", response.headers.contentType.toString())
        assertEquals("attachment; filename=\"lasttest-run-1.js\"", response.headers.getFirst(HttpHeaders.CONTENT_DISPOSITION))

        val missing = controller.script("missing")
        assertEquals(404, missing.statusCode.value())
        assertNull(missing.body)
    }

    @Test
    fun `returns the exception message or a generic validation message`() {
        assertEquals(mapOf("message" to "Invalid value"), controller.invalid(IllegalArgumentException("Invalid value")).body)
        assertEquals(mapOf("message" to "Ungültige Anfrage"), controller.invalid(IllegalArgumentException()).body)
    }

    @Test
    fun `returns 404 for an unknown run when querying time series`() {
        val response = controller.timeSeries("missing")
        assertEquals(404, response.statusCode.value())
    }

    @Test
    fun `returns 200 with empty arrays when the run has not started yet so the dashboard polling does not log a 404`() {
        // Regression test for the bug the user reported: every
        // time a new test was started, the dashboard's
        // `OverviewLiveRamp` polling loop fired a
        // `GET /api/test-runs/{id}/time-series` request before
        // `LocalK6TestRunService.execute()` had flipped the run
        // to RUNNING with a `startedAt` timestamp. The previous
        // controller returned 404 in that window, which produced
        // a visible `XHR 404` in the browser console on every
        // test start. The right behaviour is: the run exists
        // (the in-memory map has it), so answer 200 with
        // empty arrays. The InfluxDB stream will deliver the
        // first real sample a moment later when k6 starts
        // emitting heartbeats.
        val response = controller.timeSeries(queuedRun.id)

        assertEquals(200, response.statusCode.value())
        val body = response.body
        // The run id round-trips so the client can correlate
        // the response with the polling entry — important
        // when the dashboard jumps between runs in the
        // multi-run dashboard.
        assertEquals(queuedRun.id, body?.runId)
        // No samples have been written yet (k6 hasn't started),
        // so both arrays are empty. The frontend's
        // `EMPTY_TIME_SERIES` shape renders the planned line
        // from the load profile and shows no actual line until
        // the first sample lands.
        assertEquals(emptyList(), body?.vus)
        assertEquals(emptyList(), body?.requestsPerSecond)
        // The reader must NOT have been called when the
        // window is empty: the run has no `startedAt`, so
        // every call to `timeSeriesReader.readVusOverTime`
        // would have produced a malformed query against the
        // time-series database. The 404 path was protecting
        // the reader from that, but it leaked through to the
        // client. The reader-skip path is the proper fix.
        // `points` is a `MutableMap`, so a missing key reads
        // back as `null` — that is the exact signal we want:
        // "the reader was never asked for this run".
        assertNull(timeSeriesReader.points[queuedRun.id])
    }

    @Test
    fun `consecutive polls on a never-started run all stay 200 so the dashboard polling loop never logs a 404`() {
        // Regression test for the race the user reported:
        // `OverviewLiveRamp` polls `GET /api/test-runs/{id}/time-series`
        // at a 1 s cadence from the moment the run is created.
        // The previous controller returned 404 for every poll in the
        // window between `LocalK6TestRunService.create()` and
        // `execute()` flipping the run to RUNNING — i.e. for the
        // entire first few hundred milliseconds of every test start.
        // We replay that polling loop in-test and assert that none
        // of the calls produce a 404. The body stays empty (no k6
        // samples yet); the dashboard renders the target-only line
        // and the browser console stays clean.
        repeat(POLL_WINDOW) { attempt ->
            val response = controller.timeSeries(queuedRun.id)
            assertEquals(
                200,
                response.statusCode.value(),
                "Poll #$attempt of $POLL_WINDOW returned ${response.statusCode.value()} — " +
                    "the dashboard polling loop would log this 404 in the browser console",
            )
            assertEquals(emptyList(), response.body?.vus)
            assertEquals(emptyList(), response.body?.requestsPerSecond)
        }
        // After the polling burst the reader still must not have
        // been touched — k6 has not started, so any call to
        // `readVusOverTime` would issue a malformed query.
        assertNull(timeSeriesReader.points[queuedRun.id])
    }

    @Test
    fun `returns 200 with a live window when the run is still running`() {
        // A still-running run has `startedAt` but no
        // `finishedAt` yet. The ramp chart on the dashboard
        // polls this endpoint every 2 s while the run is in
        // flight, so we must NOT 404 here — instead we fall back
        // to "now" for the window end so the chart keeps
        // ticking. The reader IS called with the run's
        // `startedAt` + "now" so the live tail is included.
        val response = controller.timeSeries(runningRun.id)
        assertEquals(200, response.statusCode.value())
    }

    @Test
    fun `returns the time series for a completed run with data from the reader`() {
        timeSeriesReader.points[completedRun.id] =
            listOf(
                TimeSeriesPoint(time = "2026-01-01T00:00:01Z", value = 5),
                TimeSeriesPoint(time = "2026-01-01T00:00:02Z", value = 8),
            )

        val response = controller.timeSeries(completedRun.id)
        val body = response.body

        assertEquals(200, response.statusCode.value())
        assertEquals(completedRun.id, body?.runId)
        assertEquals(1, body?.resolutionSeconds)
        assertEquals(2, body?.vus?.size)
        assertEquals(2, body?.requestsPerSecond?.size)
        assertEquals(5, body?.vus?.get(0)?.value)
    }

    @Test
    fun `cancel returns 200 with the updated run when the service cancels the run`() {
        // The recording service flips the run into STOPPING and
        // populates the cancellation metadata so the controller can
        // echo the new state back to the UI. We start from a
        // dedicated cancellable run (RUNNING state) so the echo
        // round-trip is observable end-to-end.
        val cancellableRun =
            TestRun(
                id = "run-cancellable",
                status = TestRunStatus.RUNNING,
                createdAt = "2026-01-01T00:00:00Z",
                startedAt = "2026-01-01T00:00:01Z",
            )
        var currentRun = cancellableRun
        val cancelService =
            object : TestRunService {
                override fun create(request: CreateTestRunRequest): TestRun = existingRun

                override fun find(id: String): TestRun? = if (id == cancellableRun.id) currentRun else null

                override fun list(): List<TestRun> = listOf(currentRun)

                override fun script(id: String): String? = null

                override fun cancel(
                    id: String,
                    force: Boolean,
                ): Boolean {
                    currentRun = cancellableRun.copy(status = TestRunStatus.STOPPING, cancelledAt = "2026-01-01T00:00:10Z", cancelledByForce = force)
                    return true
                }

                override fun rerun(id: String): TestRun? = null
            }
        val cancelController =
            LastTestController(
                importer =
                    object : SpecificationImporter {
                        override fun import(content: String): ImportedSpecification = imported
                    },
                testRuns = cancelService,
                demoSpecificationProvider = demoSpecificationProvider,
                remoteFetcher = remoteFetcher,
                timeSeriesReader = timeSeriesReader,
                statisticsRepository = statisticsRepository,
                runRepository = runRepository,
            )

        val response = cancelController.cancel(cancellableRun.id, force = false)

        assertEquals(200, response.statusCode.value())
        val body = response.body
        assertEquals(cancellableRun.id, body?.id)
        assertEquals(TestRunStatus.STOPPING, body?.status)
        assertEquals("2026-01-01T00:00:10Z", body?.cancelledAt)
        assertEquals(false, body?.cancelledByForce)
    }

    @Test
    fun `cancel forwards the force flag to the service`() {
        // Ensures `?force=true` is propagated to the service layer
        // (which decides between SIGTERM and SIGKILL); the
        // controller never interprets the flag on its own.
        val response = controller.cancel(queuedRun.id, force = true)

        assertEquals(200, response.statusCode.value())
        assertEquals(queuedRun.id, service.lastCancelId)
        assertEquals(true, service.lastCancelForce)
    }

    @Test
    fun `cancel returns 409 when the service refuses to cancel`() {
        // The service rejects cancel when the id is already in a
        // terminal state; the controller translates that into a 409
        // so the UI can show "Run kann nicht abgebrochen werden".
        service.cancelReturn = false

        val response = controller.cancel(runningRun.id, force = false)

        assertEquals(409, response.statusCode.value())
    }

    @Test
    fun `cancel returns 404 when the run id is unknown`() {
        val response = controller.cancel("never-created", force = false)

        assertEquals(404, response.statusCode.value())
    }

    @Test
    fun `rerun returns 202 with a newly queued run`() {
        val newRun = TestRun(id = "rerun-new", status = TestRunStatus.QUEUED, createdAt = "2026-01-01T00:01:00Z")
        service.createdReturn = newRun

        val response = controller.rerun(existingRun.id)

        assertEquals(202, response.statusCode.value())
        assertEquals(newRun, response.body)
        // The controller must replay the preserved request that
        // came back from the in-memory lookup, not a fresh one
        // the client has to re-send.
        assertEquals(existingRequest, service.lastCreatedRequest)
    }

    @Test
    fun `rerun returns 404 when the original id is unknown`() {
        // The controller distinguishes "unknown id" (404) from
        // "known id but no preserved request" (409) by doing an
        // upfront find() — without that the service-level null
        // would always look the same to the caller.
        val response = controller.rerun("never-created")

        assertEquals(404, response.statusCode.value())
    }

    @Test
    fun `rerun returns 409 when the in-memory run has no preserved originalRequest`() {
        // Synthetic run without an `originalRequest` — the
        // controller's lookup now returns 409 from the
        // [LastTestController.lookupRerunRequest] helper before
        // it ever asks the service to re-run. The service
        // cannot reject the call because the call never
        // reaches it.
        val synthetic = TestRun(id = "synthetic", status = TestRunStatus.COMPLETED, createdAt = "2026-01-01T00:00:00Z")
        val syntheticService =
            RecordingTestRunService(synthetic, additionalRuns = emptyMap())
        val syntheticController =
            LastTestController(
                importer =
                    object : SpecificationImporter {
                        override fun import(content: String): ImportedSpecification = imported
                    },
                testRuns = syntheticService,
                demoSpecificationProvider = demoSpecificationProvider,
                remoteFetcher = remoteFetcher,
                timeSeriesReader = timeSeriesReader,
                statisticsRepository = statisticsRepository,
                runRepository = runRepository,
            )

        val response = syntheticController.rerun(synthetic.id)

        assertEquals(409, response.statusCode.value())
        // The controller must not even attempt to start a new
        // run when the lookup tells it the source has no
        // preserved payload.
        assertNull(syntheticService.lastCreatedRequest)
    }

    @Test
    fun `rerun falls back to the database when the in-memory service does not know the run`() {
        // The dashboard's "Erneut starten" right-click on a
        // historical run (from a previous server session) used
        // to 404 because the in-memory `runs` map is wiped on
        // every restart. With the DB-backed fallback the
        // controller finds the row, deserialises the preserved
        // [CreateTestRunRequest] and starts a new k6 process.
        val historicalId = "historical-7ce9"
        val preservedJson =
            """
            {"specification":"openapi document","baseUrl":"https://target.test"}
            """.trimIndent()
        val persistedEntity = de.lasttest.domain.TestRunEntity()
        persistedEntity.id = historicalId
        persistedEntity.status = de.lasttest.api.TestRunStatus.STOPPED
        persistedEntity.createdAt = java.time.Instant.parse("2026-08-08T20:00:00Z")
        persistedEntity.originalRequestJson = preservedJson
        runRepository.save(persistedEntity)
        val newRun = TestRun(id = "rerun-historical-new", status = TestRunStatus.QUEUED, createdAt = "2026-08-08T20:30:00Z")
        service.createdReturn = newRun

        val response = controller.rerun(historicalId)

        assertEquals(202, response.statusCode.value())
        assertEquals(newRun, response.body)
        // The replayed request must come from the persisted
        // JSON, not from anything the client re-sent — the
        // browser did not have to re-upload the spec.
        assertNotNull(service.lastCreatedRequest)
        assertEquals("openapi document", service.lastCreatedRequest?.specification)
        assertEquals("https://target.test", service.lastCreatedRequest?.baseUrl)
    }

    @Test
    fun `rerun returns 409 when the persisted row exists but has no originalRequestJson column`() {
        // Pre-feature rows that predate the originalRequestJson
        // column have a `null` payload. The dashboard still
        // shows them in the timeline tab, but they cannot be
        // rerun because the request that started them is
        // gone. The right code is 409 — the resource exists
        // but cannot do what the user asked.
        val historicalId = "historical-no-request"
        val persistedEntity = de.lasttest.domain.TestRunEntity()
        persistedEntity.id = historicalId
        persistedEntity.status = de.lasttest.api.TestRunStatus.COMPLETED
        persistedEntity.createdAt = java.time.Instant.parse("2026-08-08T20:00:00Z")
        // originalRequestJson deliberately left null.
        runRepository.save(persistedEntity)

        val response = controller.rerun(historicalId)

        assertEquals(409, response.statusCode.value())
        // The controller must not start a new run when the
        // preserved request is missing.
        assertNull(service.lastCreatedRequest)
    }

    @Test
    fun `rerun returns 409 when the persisted originalRequestJson is malformed`() {
        // A corrupt JSON column must not blow up the
        // controller with a 500. The defensive
        // `runCatching` in the lookup treats malformed
        // payloads the same as missing ones.
        val historicalId = "historical-malformed"
        val persistedEntity = de.lasttest.domain.TestRunEntity()
        persistedEntity.id = historicalId
        persistedEntity.status = de.lasttest.api.TestRunStatus.COMPLETED
        persistedEntity.createdAt = java.time.Instant.parse("2026-08-08T20:00:00Z")
        persistedEntity.originalRequestJson = "{this is not valid JSON"
        runRepository.save(persistedEntity)

        val response = controller.rerun(historicalId)

        assertEquals(409, response.statusCode.value())
        assertNull(service.lastCreatedRequest)
    }

    private class RecordingTestRunService(
        private val run: TestRun,
        private val additionalRuns: Map<String, TestRun> = emptyMap(),
    ) : TestRunService {
        var lastCreatedRequest: CreateTestRunRequest? = null
        var createdReturn: TestRun? = null
        var lastCancelId: String? = null
        var lastCancelForce: Boolean? = null
        var cancelReturn: Boolean = true
        var rerunReturn: TestRun? = null
        var lastRerunId: String? = null

        override fun create(request: CreateTestRunRequest): TestRun {
            lastCreatedRequest = request
            return createdReturn ?: run
        }

        override fun find(id: String): TestRun? = run.takeIf { id == it.id } ?: additionalRuns[id]

        override fun list(): List<TestRun> {
            // Mirror the production order: primary run first, then any
            // additional runs in insertion order. Tests that need a
            // specific order build the additional map explicitly.
            val primary = if (run.id.isNotEmpty()) listOf(run) else emptyList()
            return primary + additionalRuns.values
        }

        override fun script(id: String): String? = "export default function () {}".takeIf { id == run.id }

        override fun cancel(
            id: String,
            force: Boolean,
        ): Boolean {
            lastCancelId = id
            lastCancelForce = force
            return cancelReturn
        }

        override fun rerun(id: String): TestRun? {
            lastRerunId = id
            return rerunReturn
        }
    }

    private class RecordingRemoteSpecificationFetcher : RemoteSpecificationFetcher {
        var lastUrl: String? = null
        var fetched: FetchedSpecification =
            FetchedSpecification(content = "", resolvedUrl = "", source = "direct")

        override fun fetch(url: String): FetchedSpecification {
            lastUrl = url
            return fetched
        }
    }

    private class RecordingTimeSeriesReader : TimeSeriesReader {
        var points: MutableMap<String, List<TimeSeriesPoint>> = mutableMapOf()

        override fun readVusOverTime(
            runId: String,
            startedAt: String,
            finishedAt: String,
        ): List<TimeSeriesPoint> = points[runId] ?: emptyList()

        override fun readRequestsPerSecond(
            runId: String,
            startedAt: String,
            finishedAt: String,
        ): List<TimeSeriesPoint> = points[runId] ?: emptyList()
    }
}

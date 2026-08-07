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
import kotlin.test.assertNull

class LastTestControllerTest {
    private val imported = ImportedSpecification("Test API", "1", "https://example.test", emptyList())
    private val existingRun = TestRun("run-1", TestRunStatus.COMPLETED, "2026-01-01T00:00:00Z")
    private val queuedRun = TestRun("run-queued", TestRunStatus.QUEUED, "2026-01-01T00:00:00Z")
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
        assertEquals(request, service.createdRequest)
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
    fun `returns 404 when the run has not started yet`() {
        val response = controller.timeSeries(queuedRun.id)
        assertEquals(404, response.statusCode.value())
    }

    @Test
    fun `returns 404 when the run has not finished yet`() {
        val response = controller.timeSeries(runningRun.id)
        assertEquals(404, response.statusCode.value())
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
        service.rerunReturn = newRun

        val response = controller.rerun(existingRun.id)

        assertEquals(202, response.statusCode.value())
        assertEquals(newRun, response.body)
        assertEquals(existingRun.id, service.lastRerunId)
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
    fun `rerun returns 409 when the service cannot rerun the run`() {
        // The run exists (we have a recording for it) but the
        // service rejected the rerun because no originalRequest was
        // preserved — the right contract code is 409.
        service.rerunReturn = null

        val response = controller.rerun(existingRun.id)

        assertEquals(409, response.statusCode.value())
    }

    private class RecordingTestRunService(
        private val run: TestRun,
        private val additionalRuns: Map<String, TestRun> = emptyMap(),
    ) : TestRunService {
        var createdRequest: CreateTestRunRequest? = null
        var lastCancelId: String? = null
        var lastCancelForce: Boolean? = null
        var cancelReturn: Boolean = true
        var rerunReturn: TestRun? = null
        var lastRerunId: String? = null

        override fun create(request: CreateTestRunRequest): TestRun {
            createdRequest = request
            return run
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

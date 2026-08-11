package de.lasttest.api

import de.lasttest.demo.DemoSpecificationProvider
import de.lasttest.domain.RemoteSpecificationFetcher
import de.lasttest.domain.SpecificationImporter
import de.lasttest.domain.TestRunPayloadEncryptor
import de.lasttest.domain.TestRunService
import de.lasttest.domain.TimeSeriesPoint
import de.lasttest.domain.TimeSeriesReader
import org.springframework.http.HttpHeaders
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class LastTestControllerTest {
    private companion object {
        const val POLL_WINDOW: Int = 5
    }

    private val imported = ImportedSpecification("Test API", "1", "https://example.test", emptyList())
    private val existingRequest = CreateTestRunRequest(specification = "openapi document", baseUrl = "https://target.test")
    private val existingRun =
        TestRun(
            id = "run-1",
            status = TestRunStatus.COMPLETED,
            createdAt = "2026-01-01T00:00:00Z",
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
        val response = controller.timeSeries(queuedRun.id)

        assertEquals(200, response.statusCode.value())
        val body = response.body
        assertEquals(queuedRun.id, body?.runId)
        assertEquals(emptyList(), body?.vus)
        assertEquals(emptyList(), body?.requestsPerSecond)
        assertNull(timeSeriesReader.points[queuedRun.id])
    }

    @Test
    fun `consecutive polls on a never-started run all stay 200 so the dashboard polling loop never logs a 404`() {
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
        assertNull(timeSeriesReader.points[queuedRun.id])
    }

    @Test
    fun `returns 200 with a live window when the run is still running`() {
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

                override fun deleteAll(): de.lasttest.domain.TimelineDeleteResult = de.lasttest.domain.TimelineDeleteResult(cancelled = 0, deleted = 0)
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
        val response = controller.cancel(queuedRun.id, force = true)

        assertEquals(200, response.statusCode.value())
        assertEquals(queuedRun.id, service.lastCancelId)
        assertEquals(true, service.lastCancelForce)
    }

    @Test
    fun `cancel returns 409 when the service refuses to cancel`() {
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
        assertEquals(existingRequest, service.lastCreatedRequest)
    }

    @Test
    fun `rerun returns 404 when the original id is unknown`() {
        val response = controller.rerun("never-created")

        assertEquals(404, response.statusCode.value())
    }

    @Test
    fun `rerun returns 409 when the in-memory run has no preserved originalRequest`() {
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
        assertNull(syntheticService.lastCreatedRequest)
    }

    @Test
    fun `rerun falls back to the database when the in-memory service does not know the run`() {
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
        assertNotNull(service.lastCreatedRequest)
        assertEquals("openapi document", service.lastCreatedRequest?.specification)
        assertEquals("https://target.test", service.lastCreatedRequest?.baseUrl)
    }

    @Test
    fun `rerun returns 409 when the persisted row exists but has no originalRequestJson column`() {
        val historicalId = "historical-no-request"
        val persistedEntity = de.lasttest.domain.TestRunEntity()
        persistedEntity.id = historicalId
        persistedEntity.status = de.lasttest.api.TestRunStatus.COMPLETED
        persistedEntity.createdAt = java.time.Instant.parse("2026-08-08T20:00:00Z")
        runRepository.save(persistedEntity)

        val response = controller.rerun(historicalId)

        assertEquals(409, response.statusCode.value())
        assertNull(service.lastCreatedRequest)
    }

    @Test
    fun `rerun returns 409 when the persisted originalRequestJson is malformed`() {
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

    @Test
    fun `deleteAll returns the service result and a 200 status code`() {
        service.deleteAllReturn = de.lasttest.domain.TimelineDeleteResult(cancelled = 2, deleted = 2229)

        val response = controller.deleteAll()

        assertEquals(200, response.statusCode.value())
        val body = assertNotNull(response.body)
        assertEquals(2, body.cancelled)
        assertEquals(2229, body.deleted)
    }

    @Test
    fun `operationStats returns the rows from the statistics repository in testCount desc order`() {
        val hotRow =
            de.lasttest.domain.OperationStatisticsEntity().apply {
                method = "GET"
                path = "/api/products"
                testCount = 42L
                lastTestAt = java.time.Instant.parse("2026-08-08T20:00:00Z")
                lastStatus = TestRunStatus.COMPLETED
                lastRunId = "run-hot"
            }
        val coldRow =
            de.lasttest.domain.OperationStatisticsEntity().apply {
                method = "POST"
                path = "/api/orders"
                testCount = 3L
                lastTestAt = java.time.Instant.parse("2026-08-08T19:00:00Z")
                lastStatus = TestRunStatus.FAILED
                lastRunId = "run-cold"
            }
        statisticsRepository.save(hotRow)
        statisticsRepository.save(coldRow)

        val response = controller.operationStats()

        assertEquals(200, response.statusCode.value())
        val body = assertNotNull(response.body)
        assertEquals(2, body.size)
        assertEquals("GET", body[0].method)
        assertEquals("/api/products", body[0].path)
        assertEquals(42L, body[0].testCount)
        assertEquals(TestRunStatus.COMPLETED, body[0].lastStatus)
        assertEquals("run-hot", body[0].lastRunId)
        assertEquals("2026-08-08T20:00:00Z", body[0].lastTestAt)
        assertEquals("POST", body[1].method)
        assertEquals("/api/orders", body[1].path)
        assertEquals(3L, body[1].testCount)
    }

    @Test
    fun `operationStats returns an empty list when the statistics repository is empty`() {
        val response = controller.operationStats()

        assertEquals(200, response.statusCode.value())
        assertEquals(emptyList(), response.body)
    }

    @Test
    fun `runsForOperation returns the persisted runs for the requested method and path`() {
        val matchingA = de.lasttest.domain.TestRunEntity()
        matchingA.id = "run-match-a"
        matchingA.status = TestRunStatus.COMPLETED
        matchingA.createdAt = java.time.Instant.parse("2026-08-08T20:00:00Z")
        matchingA.operationMethod = "GET"
        matchingA.operationPath = "/api/products"
        val matchingB = de.lasttest.domain.TestRunEntity()
        matchingB.id = "run-match-b"
        matchingB.status = TestRunStatus.FAILED
        matchingB.createdAt = java.time.Instant.parse("2026-08-08T20:30:00Z")
        matchingB.operationMethod = "GET"
        matchingB.operationPath = "/api/products"
        val unrelated = de.lasttest.domain.TestRunEntity()
        unrelated.id = "run-unrelated"
        unrelated.status = TestRunStatus.COMPLETED
        unrelated.createdAt = java.time.Instant.parse("2026-08-08T20:15:00Z")
        unrelated.operationMethod = "POST"
        unrelated.operationPath = "/api/orders"
        runRepository.save(matchingA)
        runRepository.save(matchingB)
        runRepository.save(unrelated)

        val response = controller.runsForOperation("GET", "/api/products")

        assertEquals(200, response.statusCode.value())
        val body = assertNotNull(response.body)
        assertEquals(2, body.size)
        assertEquals("run-match-b", body[0].id)
        assertEquals("run-match-a", body[1].id)
        assertEquals(TestRunStatus.COMPLETED, body[1].status)
    }

    @Test
    fun `runsForOperation returns an empty list when no runs target the requested endpoint`() {
        val response = controller.runsForOperation("DELETE", "/api/never-tested")

        assertEquals(200, response.statusCode.value())
        assertEquals(emptyList(), response.body)
    }

    @Test
    fun `reportLink returns 200 with the deep-link and isComplete true for a completed run`() {
        val response = controller.reportLink(completedRun.id)

        assertEquals(200, response.statusCode.value())
        val body = assertNotNull(response.body)
        assertEquals(completedRun.id, body.runId)
        assertEquals("/?report=${java.net.URLEncoder.encode(completedRun.id, Charsets.UTF_8)}", body.url)
        assertTrue(body.isComplete, "a COMPLETED run must report isComplete=true")
    }

    @Test
    fun `reportLink returns 200 with isComplete false for a non-completed run`() {
        val response = controller.reportLink(runningRun.id)

        assertEquals(200, response.statusCode.value())
        val body = assertNotNull(response.body)
        assertEquals(runningRun.id, body.runId)
        assertEquals(false, body.isComplete)
    }

    @Test
    fun `reportLink returns 404 when the id is unknown`() {
        val response = controller.reportLink("never-created")

        assertEquals(404, response.statusCode.value())
        assertNull(response.body)
    }

    @Test
    fun `rerun returns 409 when the payloadEncryptor cannot decrypt the persisted originalRequestJson`() {
        val nullingEncryptor =
            object : TestRunPayloadEncryptor {
                override fun encrypt(plain: String?): String? = plain

                override fun decrypt(blob: String?): String? = null
            }
        val encryptedController =
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
                payloadEncryptor = nullingEncryptor,
            )
        val historicalId = "historical-encrypted-but-unreadable"
        val persistedEntity = de.lasttest.domain.TestRunEntity()
        persistedEntity.id = historicalId
        persistedEntity.status = de.lasttest.api.TestRunStatus.COMPLETED
        persistedEntity.createdAt = java.time.Instant.parse("2026-08-08T20:00:00Z")
        persistedEntity.originalRequestJson = "{\"specification\":\"openapi document\"}"
        runRepository.save(persistedEntity)

        val response = encryptedController.rerun(historicalId)

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
        var deleteAllReturn: de.lasttest.domain.TimelineDeleteResult =
            de.lasttest.domain.TimelineDeleteResult(cancelled = 0, deleted = 0)

        override fun create(request: CreateTestRunRequest): TestRun {
            lastCreatedRequest = request
            return createdReturn ?: run
        }

        override fun find(id: String): TestRun? = run.takeIf { id == it.id } ?: additionalRuns[id]

        override fun list(): List<TestRun> {
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

        override fun deleteAll(): de.lasttest.domain.TimelineDeleteResult = deleteAllReturn
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

package de.lasttest.api

import de.lasttest.demo.DemoSpecificationProvider
import de.lasttest.domain.InvalidSpecificationException
import de.lasttest.domain.OperationStatisticsRepository
import de.lasttest.domain.RemoteSpecificationFetcher
import de.lasttest.domain.SpecificationImporter
import de.lasttest.domain.TestRunRepository
import de.lasttest.domain.TestRunService
import de.lasttest.domain.TimeSeriesReader
import de.lasttest.domain.toTestRun
import jakarta.validation.Valid
import org.springframework.http.ContentDisposition
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.CrossOrigin
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController

@RestController
@RequestMapping("/api")
@CrossOrigin(origins = ["http://localhost:5173"])
class LastTestController(
    private val importer: SpecificationImporter,
    private val testRuns: TestRunService,
    private val demoSpecificationProvider: DemoSpecificationProvider,
    private val remoteFetcher: RemoteSpecificationFetcher,
    private val timeSeriesReader: TimeSeriesReader,
    private val statisticsRepository: OperationStatisticsRepository,
    private val runRepository: TestRunRepository,
) {
    @GetMapping("/demo-specification", produces = [DEMO_SPECIFICATION_MEDIA_TYPE])
    fun demoSpecification(): String = demoSpecificationProvider.load()

    @PostMapping("/specifications/import")
    fun import(
        @RequestBody request: ImportSpecificationRequest,
    ): ImportedSpecification = importer.import(request.specification)

    @PostMapping("/specifications/fetch-url")
    fun fetchFromUrl(
        @RequestBody request: FetchSpecificationRequest,
    ): FetchedSpecification = remoteFetcher.fetch(request.url)

    @PostMapping("/test-runs")
    fun create(
        @Valid @RequestBody request: CreateTestRunRequest,
    ): ResponseEntity<TestRun> = ResponseEntity.status(HttpStatus.ACCEPTED).body(testRuns.create(request))

    @GetMapping("/test-runs")
    fun list(): ResponseEntity<List<TestRun>> = ResponseEntity.ok(testRuns.list())

    @GetMapping("/test-runs/{id}")
    fun find(
        @PathVariable id: String,
    ): ResponseEntity<TestRun> = testRuns.find(id)?.let(ResponseEntity<TestRun>::ok) ?: ResponseEntity.notFound().build()

    @GetMapping("/test-runs/{id}/script", produces = [K6_SCRIPT_MEDIA_TYPE])
    fun script(
        @PathVariable id: String,
    ): ResponseEntity<String> {
        val script = testRuns.script(id) ?: return ResponseEntity.notFound().build()
        val disposition = ContentDisposition.attachment().filename("lasttest-$id.js").build()
        return ResponseEntity
            .ok()
            .contentType(k6ScriptMediaType)
            .header(HttpHeaders.CONTENT_DISPOSITION, disposition.toString())
            .body(script)
    }

    /**
     * Returns time-series data (VUs + RPS) for the ramp chart in the
     * report. Reads from InfluxDB; on errors, empty arrays are returned
     * so the report can still render the target line. Returns 404 if
     * the run is unknown or still running (startedAt/finishedAt
     * missing).
     */
    @GetMapping("/test-runs/{id}/time-series")
    fun timeSeries(
        @PathVariable id: String,
    ): ResponseEntity<TimeSeriesResponse> {
        val run = testRuns.find(id) ?: return ResponseEntity.notFound().build()
        val started = run.startedAt ?: return ResponseEntity.notFound().build()
        // The dashboard's ramp chart needs live samples *while*
        // the run is still going, so falling back to "now" when
        // [finishedAt] is missing is what makes the chart tick
        // instead of returning 404 to the polling client. Only an
        // unknown id (or a never-started run) yields 404.
        val finished =
            run.finishedAt ?: java.time.Instant
                .now()
                .toString()
        val vus =
            timeSeriesReader
                .readVusOverTime(id, started, finished)
                .map { TimeSeriesPoint(time = it.time, value = it.value) }
        val rps =
            timeSeriesReader
                .readRequestsPerSecond(id, started, finished)
                .map { TimeSeriesPoint(time = it.time, value = it.value) }
        return ResponseEntity.ok(
            TimeSeriesResponse(
                runId = id,
                resolutionSeconds = 1,
                vus = vus,
                requestsPerSecond = rps,
            ),
        )
    }

    /**
     * Requests cancellation of an in-flight test run. Returns 200
     * with the refreshed [TestRun] snapshot so the UI does not need
     * an additional `/api/test-runs/{id}` round-trip. 404 when the
     * id is unknown, 409 when the run is already in a terminal
     * state (completed / failed / aborted / stopped).
     *
     * `?force=true` escalates immediately to SIGKILL (status
     * ABORTED); `?force=false` (the default) sends SIGTERM and the
     * service marks the run as STOPPING.
     */
    @PostMapping("/test-runs/{id}/cancel")
    fun cancel(
        @PathVariable id: String,
        @RequestParam(name = "force", defaultValue = "false") force: Boolean,
    ): ResponseEntity<TestRun> {
        // Cheap existence check first so callers get a clean 404
        // instead of a 409 for runs they have never heard of.
        if (testRuns.find(id) == null) return ResponseEntity.notFound().build()
        return if (testRuns.cancel(id, force)) {
            ResponseEntity.ok(testRuns.find(id)!!)
        } else {
            ResponseEntity.status(HttpStatus.CONFLICT).build()
        }
    }

    /**
     * Re-runs an existing test from the [CreateTestRunRequest] that
     * was preserved when the original run was started. The new run
     * gets a fresh id and is queued like any other. Returns 404
     * when the id is unknown, 409 when the run cannot be rerun
     * (e.g. it was a synthetic run without a preserved request).
     */
    @PostMapping("/test-runs/{id}/rerun")
    fun rerun(
        @PathVariable id: String,
    ): ResponseEntity<TestRun> {
        // Existence check first — `rerun()` returns null both for
        // unknown ids and for unknown-but-synthetic runs; without
        // the upfront find() we could not distinguish the two and
        // would always return 404.
        if (testRuns.find(id) == null) return ResponseEntity.notFound().build()
        val newRun =
            testRuns.rerun(id)
                ?: return ResponseEntity.status(HttpStatus.CONFLICT).build()
        // 202 Accepted so the caller knows the k6 process has not
        // finished spawning yet.
        return ResponseEntity.status(HttpStatus.ACCEPTED).body(newRun)
    }

    /**
     * Returns the denormalised "× N" counter for every endpoint the
     * server has seen. The dashboard polls this endpoint on the same
     * cadence as `/api/test-runs` and renders the result next to
     * each operation card in the left list. The list is ordered by
     * total test count descending so the most-tested endpoints are
     * at the top.
     */
    @GetMapping("/operations/stats")
    fun operationStats(): ResponseEntity<List<OperationStatsResponse>> =
        ResponseEntity.ok(
            statisticsRepository.findAllByOrderByTestCountDesc().map { entity ->
                OperationStatsResponse(
                    method = entity.method,
                    path = entity.path,
                    testCount = entity.testCount,
                    lastStatus = entity.lastStatus,
                    lastTestAt = entity.lastTestAt.toString(),
                    lastRunId = entity.lastRunId,
                )
            },
        )

    /**
     * Returns the most recent runs of a single endpoint, ordered by
     * `createdAt` descending. The per-endpoint timeline tab on the
     * right panel calls this when the user clicks a different
     * endpoint so it can re-render its Gantt chart against the
     * freshest data.
     *
     * The endpoint is keyed by query parameters rather than path
     * variables because Spring's path-variable matcher refuses to
     * decode `%2F` sequences in `{path:.*}` placeholders (a
     * 400 Bad Request from Tomcat) — endpoints like
     * `/api/products/{id}` would otherwise need to be URL-encoded
     * in a way that the dashboard cannot do reliably. Query
     * parameters side-step the issue without changing the
     * `TestRunRepository` signature.
     */
    @GetMapping("/operations/runs")
    fun runsForOperation(
        @RequestParam(name = "method", required = true) method: String,
        @RequestParam(name = "path", required = true) path: String,
    ): ResponseEntity<List<TestRun>> =
        ResponseEntity.ok(
            runRepository
                .findByOperationMethodAndOperationPathOrderByCreatedAtDesc(method, path)
                .map { it.toTestRun() },
        )

    /**
     * Returns a deep-link to the full k6 report for a given run.
     * The dashboard renders a button next to "Im neuen Tab öffnen"
     * that points at this URL; the button is hidden on the
     * dashboard itself (the report link duplicates the same tab
     * the user is already on) and shown on the multi-run list view
     * where the user has to switch contexts to see the details.
     */
    @GetMapping("/test-runs/{id}/report-link")
    fun reportLink(
        @PathVariable id: String,
    ): ResponseEntity<ReportLinkResponse> {
        val run = testRuns.find(id) ?: return ResponseEntity.notFound().build()
        return ResponseEntity.ok(
            ReportLinkResponse(
                runId = run.id,
                url = "/?report=${java.net.URLEncoder.encode(run.id, Charsets.UTF_8)}",
                isComplete = run.status == de.lasttest.api.TestRunStatus.COMPLETED,
            ),
        )
    }

    @ExceptionHandler(InvalidSpecificationException::class, IllegalArgumentException::class)
    fun invalid(exception: IllegalArgumentException): ResponseEntity<Map<String, Any>> = ResponseEntity.badRequest().body(mapOf("message" to (exception.message ?: "Ungültige Anfrage")))

    private companion object {
        const val K6_SCRIPT_MEDIA_TYPE: String = "application/javascript"
        const val DEMO_SPECIFICATION_MEDIA_TYPE: String = "application/yaml"
        val k6ScriptMediaType: MediaType = MediaType.parseMediaType(K6_SCRIPT_MEDIA_TYPE)
    }
}

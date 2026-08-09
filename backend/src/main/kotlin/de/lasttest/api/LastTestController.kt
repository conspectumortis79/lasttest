package de.lasttest.api

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.KotlinModule
import de.lasttest.demo.DemoSpecificationProvider
import de.lasttest.domain.InvalidSpecificationException
import de.lasttest.domain.OperationStatisticsRepository
import de.lasttest.domain.RemoteSpecificationFetcher
import de.lasttest.domain.SpecificationImporter
import de.lasttest.domain.StatusCodeTimeSeriesReader
import de.lasttest.domain.TestRunEntity
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
    private val statusCodeTimeSeriesReader: StatusCodeTimeSeriesReader,
    private val statisticsRepository: OperationStatisticsRepository,
    private val runRepository: TestRunRepository,
    // Shared mapper for deserialising `originalRequestJson` from
    // a persisted [TestRunEntity] on rerun. The Kotlin module is
    // required because [CreateTestRunRequest] is a Kotlin data
    // class — without it Jackson cannot find a constructor and
    // silently returns `null` for the whole object, which would
    // turn every historical rerun into a 409 instead of a 202.
    // [TestRun.toTestRunEntity] is the write side; it does not
    // need the module because Jackson can serialise Kotlin data
    // classes via reflection without it.
    private val objectMapper: ObjectMapper = ObjectMapper().registerModule(KotlinModule.Builder().build()),
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
     * so the report can still render the target line.
     *
     * The endpoint is `200 OK` whenever the run id is known, even
     * before k6 has started (`startedAt == null`) and even after
     * it has finished (`finishedAt` falls back to "now" so the
     * polling client keeps getting a useful response). The previous
     * version returned 404 when `startedAt` was null, which
     * manifests as a visible `XHR 404` in the browser console
     * every time the user starts a new test: the dashboard
     * immediately sets the freshly-created run as active and
     * `OverviewLiveRamp` polls the endpoint at a 1 s cadence, but
     * the backend's `execute()` task is still inside the executor
     * pool and has not yet flipped the run to RUNNING with a
     * `startedAt` timestamp. `testRuns.find()` already returns the
     * row (in-memory or H2), so the client is asking about a real
     * resource — the only thing missing is the time-series data
     * itself, which we model as an empty array. The frontend
     * already collapses empty arrays to the target-only line via
     * [EMPTY_TIME_SERIES], so the user sees the planned ramp
     * chart with no false 404 in the console.
     *
     * The only remaining 404 is when the id is unknown to both
     * the in-memory map and the H2 table — i.e. the run does
     * not exist on the server.
     */
    @GetMapping("/test-runs/{id}/time-series")
    fun timeSeries(
        @PathVariable id: String,
    ): ResponseEntity<TimeSeriesResponse> {
        val run = testRuns.find(id) ?: return ResponseEntity.notFound().build()
        // `startedAt` is null in the brief window between
        // [LocalK6TestRunService.create] and the [execute] task
        // flipping the run to RUNNING. The dashboard polls the
        // endpoint as soon as the run is created, so without
        // this fallback the user would see a 404 on every
        // single start. Empty arrays are the correct response:
        // the ramp chart renders the planned line from the
        // load profile and the measured line shows up as soon
        // as the first sample lands in InfluxDB.
        val started = run.startedAt
        // Symmetric fallback for [finishedAt]: keep the polling
        // window open for in-flight runs so the client gets a
        // live tail instead of a 404 right when it is most
        // useful.
        val finished =
            run.finishedAt ?: java.time.Instant
                .now()
                .toString()
        val vus =
            started?.let {
                timeSeriesReader
                    .readVusOverTime(id, it, finished)
                    .map { TimeSeriesPoint(time = it.time, value = it.value) }
            } ?: emptyList()
        val rps =
            started?.let {
                timeSeriesReader
                    .readRequestsPerSecond(id, it, finished)
                    .map { TimeSeriesPoint(time = it.time, value = it.value) }
            } ?: emptyList()
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
     * Returns the per-second status-code timeline for the run.
     * Read by the dashboard's "Status-Codes über Zeit" sparkline
     * list so the user sees the cumulative code counts *during*
     * the run, not just after k6 writes the summary at the end.
     *
     * The endpoint is `200 OK` even when the run is still QUEUED
     * (no stamps yet) or has no samples yet — the dashboard
     * polls the same URL throughout the run's lifetime and a
     * 404 would be louder than a useful empty array. The only
     * 404 is when the run id is unknown to both the in-memory
     * map and the H2 table.
     *
     * The reader is intentionally separate from the time-series
     * reader so the two endpoints can stay loosely coupled: the
     * ramp chart polls VUs/RPS, the sparkline list polls
     * status-codes, and a slow status-code table does not slow
     * down the ramp chart's polling cadence.
     */
    @GetMapping("/test-runs/{id}/status-code-timeline")
    fun statusCodeTimeline(
        @PathVariable id: String,
    ): ResponseEntity<StatusCodeTimelineResponse> {
        val run = testRuns.find(id) ?: return ResponseEntity.notFound().build()
        val samples =
            if (run.startedAt == null) {
                emptyList()
            } else {
                statusCodeTimeSeriesReader
                    .readStatusCodesOverTime(id)
                    .map { StatusCodeTimelinePoint(epochSecond = it.epochSecond, code = it.code, count = it.count) }
            }
        return ResponseEntity.ok(
            StatusCodeTimelineResponse(
                runId = id,
                resolutionSeconds = 1,
                samples = samples,
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
    ): ResponseEntity<TestRun> =
        when (val lookup = lookupRerunRequest(id)) {
            // In-memory and DB both miss — the user is asking for
            // a run we have never heard of. 404 is the right code
            // regardless of which store we tried last.
            RerunLookup.NotFound -> ResponseEntity.notFound().build()
            // The run exists but has no preserved
            // [CreateTestRunRequest]. This happens for synthetic
            // rows (e.g. fixtures) and for rows persisted before
            // the [TestRunEntity.originalRequestJson] column was
            // added. 409 signals "this resource cannot do what
            // you asked" without leaking the missing payload.
            RerunLookup.NoPreservedRequest -> ResponseEntity.status(HttpStatus.CONFLICT).build()
            is RerunLookup.Ready ->
                // 202 Accepted so the caller knows the k6 process
                // has not finished spawning yet.
                ResponseEntity
                    .status(HttpStatus.ACCEPTED)
                    .body(testRuns.create(lookup.request))
        }

    /**
     * Resolves a rerun target by id, checking the in-memory
     * service first and falling back to the persisted
     * [TestRunEntity] table. Returns a [RerunLookup] that the
     * controller turns into the right HTTP status; the actual
     * work (queueing a new k6 run) only happens for [Ready].
     *
     * Why a sealed type instead of `requestOrNull`? "Not found"
     * (404) and "found but no preserved request" (409) are two
     * different failure modes; the controller must distinguish
     * them to return the right status. A nullable return value
     * would have to be paired with a second probe of the stores,
     * which is wasteful and racy.
     */
    private fun lookupRerunRequest(id: String): RerunLookup {
        // 1. In-memory service first — the common case for runs
        // the user just started or has been watching. This
        // preserves the original behaviour (and the
        // `TestRunService.rerun` contract) for the in-memory path.
        testRuns.find(id)?.let { live ->
            return live.originalRequest
                ?.let(RerunLookup::Ready)
                ?: RerunLookup.NoPreservedRequest
        }
        // 2. Persisted entity — historical runs from previous
        // server sessions live only in the database. The
        // originalRequest column is JSON-serialised
        // CreateTestRunRequest; we deserialise lazily so a
        // malformed blob is treated the same as a missing blob
        // (the user gets a clean 409 instead of a 500).
        val persisted =
            runRepository.findById(id).orElse(null)
                ?: return RerunLookup.NotFound
        val json =
            persisted.originalRequestJson
                ?: return RerunLookup.NoPreservedRequest
        val request =
            runCatching { objectMapper.readValue(json, CreateTestRunRequest::class.java) }
                .getOrNull()
                ?: return RerunLookup.NoPreservedRequest
        return RerunLookup.Ready(request)
    }

    /**
     * Result of [lookupRerunRequest]. The three cases map 1:1 to
     * the three HTTP responses the rerun endpoint can return.
     */
    private sealed class RerunLookup {
        /** The run exists and the preserved request is usable. */
        data class Ready(
            val request: CreateTestRunRequest,
        ) : RerunLookup()

        /** The run exists but has no preserved [CreateTestRunRequest]. */
        data object NoPreservedRequest : RerunLookup()

        /** The id is unknown to both the service and the database. */
        data object NotFound : RerunLookup()
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

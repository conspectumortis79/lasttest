package de.lasttest.api

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.KotlinModule
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
import org.springframework.web.bind.annotation.DeleteMapping
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
    private val objectMapper: ObjectMapper = ObjectMapper().registerModule(KotlinModule.Builder().build()),
    private val payloadEncryptor: de.lasttest.domain.TestRunPayloadEncryptor = de.lasttest.domain.NoOpTestRunPayloadEncryptor,
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

    @DeleteMapping("/test-runs")
    fun deleteAll(): ResponseEntity<de.lasttest.domain.TimelineDeleteResult> = ResponseEntity.ok(testRuns.deleteAll())

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

    @GetMapping("/test-runs/{id}/time-series")
    fun timeSeries(
        @PathVariable id: String,
    ): ResponseEntity<TimeSeriesResponse> {
        val run = testRuns.find(id) ?: return ResponseEntity.notFound().build()

        val started = run.startedAt

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

    @PostMapping("/test-runs/{id}/cancel")
    fun cancel(
        @PathVariable id: String,
        @RequestParam(name = "force", defaultValue = "false") force: Boolean,
    ): ResponseEntity<TestRun> {
        if (testRuns.find(id) == null) return ResponseEntity.notFound().build()
        return if (testRuns.cancel(id, force)) {
            ResponseEntity.ok(testRuns.find(id)!!)
        } else {
            ResponseEntity.status(HttpStatus.CONFLICT).build()
        }
    }

    @PostMapping("/test-runs/{id}/rerun")
    fun rerun(
        @PathVariable id: String,
    ): ResponseEntity<TestRun> =
        when (val lookup = lookupRerunRequest(id)) {
            RerunLookup.NotFound -> ResponseEntity.notFound().build()
            RerunLookup.NoPreservedRequest -> ResponseEntity.status(HttpStatus.CONFLICT).build()
            is RerunLookup.Ready ->
                ResponseEntity
                    .status(HttpStatus.ACCEPTED)
                    .body(testRuns.create(lookup.request))
        }

    private fun lookupRerunRequest(id: String): RerunLookup {
        testRuns.find(id)?.let { live ->
            return live.originalRequest
                ?.let(RerunLookup::Ready)
                ?: RerunLookup.NoPreservedRequest
        }

        val persisted =
            runRepository.findById(id).orElse(null)
                ?: return RerunLookup.NotFound
        val json =
            persisted.originalRequestJson
                ?: return RerunLookup.NoPreservedRequest
        val decrypted = payloadEncryptor.decrypt(json) ?: return RerunLookup.NoPreservedRequest
        val request =
            runCatching { objectMapper.readValue(decrypted, CreateTestRunRequest::class.java) }
                .getOrNull()
                ?: return RerunLookup.NoPreservedRequest
        return RerunLookup.Ready(request)
    }

    private sealed class RerunLookup {
        data class Ready(
            val request: CreateTestRunRequest,
        ) : RerunLookup()

        data object NoPreservedRequest : RerunLookup()

        data object NotFound : RerunLookup()
    }

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

    @GetMapping("/operations/runs")
    fun runsForOperation(
        @RequestParam(name = "method", required = true) method: String,
        @RequestParam(name = "path", required = true) path: String,
    ): ResponseEntity<List<TestRun>> =
        ResponseEntity.ok(
            runRepository
                .findByOperationMethodAndOperationPathOrderByCreatedAtDesc(method, path)
                .map { it.toTestRun(objectMapper, payloadEncryptor) },
        )

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

package de.lasttest.api

import de.lasttest.demo.DemoSpecificationProvider
import de.lasttest.domain.InvalidSpecificationException
import de.lasttest.domain.RemoteSpecificationFetcher
import de.lasttest.domain.SpecificationImporter
import de.lasttest.domain.TestRunService
import de.lasttest.domain.TimeSeriesReader
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
     * Liefert Time-Series-Daten (VUs + RPS) für die Ramp-Grafik im
     * Report. Liest aus InfluxDB; bei Fehlern werden leere Arrays
     * zurückgegeben, damit der Report zumindest die Soll-Linie
     * rendert. Liefert 404, wenn der Run unbekannt ist oder noch
     * läuft (startedAt/finishedAt fehlen).
     */
    @GetMapping("/test-runs/{id}/time-series")
    fun timeSeries(
        @PathVariable id: String,
    ): ResponseEntity<TimeSeriesResponse> {
        val run = testRuns.find(id) ?: return ResponseEntity.notFound().build()
        val started = run.startedAt ?: return ResponseEntity.notFound().build()
        val finished = run.finishedAt ?: return ResponseEntity.notFound().build()
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

    @ExceptionHandler(InvalidSpecificationException::class, IllegalArgumentException::class)
    fun invalid(exception: IllegalArgumentException): ResponseEntity<Map<String, Any>> = ResponseEntity.badRequest().body(mapOf("message" to (exception.message ?: "Ungültige Anfrage")))

    private companion object {
        const val K6_SCRIPT_MEDIA_TYPE: String = "application/javascript"
        const val DEMO_SPECIFICATION_MEDIA_TYPE: String = "application/yaml"
        val k6ScriptMediaType: MediaType = MediaType.parseMediaType(K6_SCRIPT_MEDIA_TYPE)
    }
}

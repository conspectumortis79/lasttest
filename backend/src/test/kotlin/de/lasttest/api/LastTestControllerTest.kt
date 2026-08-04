package de.lasttest.api

import de.lasttest.demo.DemoSpecificationProvider
import de.lasttest.domain.SpecificationImporter
import de.lasttest.domain.TestRunService
import org.springframework.http.HttpHeaders
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class LastTestControllerTest {
    private val imported = ImportedSpecification("Test API", "1", "https://example.test", emptyList())
    private val existingRun = TestRun("run-1", TestRunStatus.COMPLETED, "2026-01-01T00:00:00Z")
    private val service = RecordingTestRunService(existingRun)
    private val demoSpecificationProvider = DemoSpecificationProvider(resourceName = "/demo/recorded.yaml")
    private val controller =
        LastTestController(
            importer =
                object : SpecificationImporter {
                    override fun import(content: String): ImportedSpecification = imported
                },
            testRuns = service,
            demoSpecificationProvider = demoSpecificationProvider,
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

    private class RecordingTestRunService(
        private val run: TestRun,
    ) : TestRunService {
        var createdRequest: CreateTestRunRequest? = null

        override fun create(request: CreateTestRunRequest): TestRun {
            createdRequest = request
            return run
        }

        override fun find(id: String): TestRun? = run.takeIf { id == it.id }

        override fun script(id: String): String? = "export default function () {}".takeIf { id == run.id }
    }
}

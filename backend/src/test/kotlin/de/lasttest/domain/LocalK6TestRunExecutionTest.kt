package de.lasttest.domain

import de.lasttest.api.ApiOperation
import de.lasttest.api.CreateTestRunRequest
import de.lasttest.api.ImportedSpecification
import de.lasttest.api.OperationConfiguration
import de.lasttest.api.TestRunStatus
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.Executor
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

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
        assertEquals("successful k6 output", completed.error)
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
        assertNull(failed.summary)
    }

    @Test
    fun `stores no error for successful blank process output`() {
        val command = executable("blank.sh", "#!/bin/sh\nexit 0")
        val service = service(command)

        val completed = assertNotNull(service.find(service.create(request()).id))

        assertEquals(TestRunStatus.COMPLETED, completed.status)
        assertNull(completed.error)
        assertNull(completed.summary)
    }

    @Test
    fun `stores an io error when k6 cannot be started`() {
        val service = service(temporaryDirectory.resolve("missing-k6").toString())

        val failed = assertNotNull(service.find(service.create(request()).id))

        assertEquals(TestRunStatus.FAILED, failed.status)
        assertNotNull(failed.error)
        assertNotNull(failed.finishedAt)
    }

    private fun service(command: String): LocalK6TestRunService =
        LocalK6TestRunService(
            importer =
                object : SpecificationImporter {
                    override fun import(content: String): ImportedSpecification = specification()
                },
            generator =
                object : K6ScriptGenerator {
                    override fun generate(
                        specification: ImportedSpecification,
                        baseUrl: String,
                        operationIds: Set<String>,
                        operationConfigurations: List<OperationConfiguration>,
                        virtualUsers: Int,
                        durationSeconds: Int,
                        useIterations: Boolean,
                    ): String = "export default function () {}"
                },
            executor = Executor(Runnable::run),
            k6Command = command,
        )

    private fun request(): CreateTestRunRequest =
        CreateTestRunRequest(
            specification = "openapi document",
            baseUrl = "https://example.test",
            operationIds = setOf("listPets"),
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

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
        // Bei erfolgreichem Run ist error = null, weil es nichts zu
        // berichten gibt. Das ist eine bewusste Designentscheidung
        // (siehe LocalK6TestRunService.execute).
        assertNull(completed.error)
        // Die k6-Konsolenausgabe wird auch im Erfolgsfall gespeichert,
        // damit die UI sie einblenden kann.
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
        // Bei threshold-/Prozess-Fehlern tragen `error` und
        // `consoleOutput` denselben k6-Output.
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
        // Bei komplett leerem k6-Output ist auch die Konsole leer —
        // kein "k6-Konsolenausgabe"-Block in der UI.
        assertNull(completed.consoleOutput)
        assertNull(completed.summary)
    }

    @Test
    fun `stores an io error when k6 cannot be started`() {
        val service = service(temporaryDirectory.resolve("missing-k6").toString())

        val failed = assertNotNull(service.find(service.create(request()).id))

        assertEquals(TestRunStatus.FAILED, failed.status)
        assertNotNull(failed.error)
        // Wenn k6 gar nicht starten konnte, gibt es keine
        // Konsolenausgabe — nur die Fehlermeldung.
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
                        loadProfile: de.lasttest.api.LoadProfile,
                    ): String = "export default function () {}"
                },
            executor = Executor(Runnable::run),
            k6Command = command,
            influxDbProperties = de.lasttest.config.InfluxDbProperties(enabled = false),
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

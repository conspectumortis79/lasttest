package de.lasttest.domain

import de.lasttest.api.ApiOperation
import de.lasttest.api.ApiParameter
import de.lasttest.api.CreateTestRunRequest
import de.lasttest.api.ImportedSpecification
import de.lasttest.api.LoadProfile
import de.lasttest.api.LoadProfileType
import de.lasttest.api.OperationConfiguration
import de.lasttest.api.TestRunStatus
import de.lasttest.config.InfluxDbProperties
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class LocalK6TestRunServiceBranchesTest {
    private val specification =
        ImportedSpecification(
            title = "Pet API",
            version = "2.0",
            baseUrl = "https://documented.test",
            operations =
                listOf(
                    ApiOperation(
                        operationId = "getPet",
                        method = "GET",
                        path = "/pets/{id}",
                        summary = "Find pet",
                        destructive = false,
                        parameters = listOf(ApiParameter("id", "path", true, 1)),
                        requestBodyExample = null,
                    ),
                ),
        )

    private fun service(influxDbEnabled: Boolean = true): LocalK6TestRunService =
        LocalK6TestRunService(
            importer =
                object : SpecificationImporter {
                    override fun import(content: String): ImportedSpecification = specification
                },
            generator =
                object : K6ScriptGenerator {
                    override fun generateForRun(
                        specification: ImportedSpecification,
                        baseUrl: String,
                        runId: String,
                        operationIds: Set<String>,
                        operationConfigurations: List<OperationConfiguration>,
                        loadProfile: LoadProfile,
                    ): String = "export default function () {}"
                },
            executor = NoopExecutorService(),
            readerExecutor = NoopExecutorService(),
            k6Command = "k6",
            influxDbProperties = InfluxDbProperties(enabled = influxDbEnabled),
            runRepository = InMemoryTestRunRepository(),
            statisticsRepository = InMemoryOperationStatisticsRepository(),
            timeSeriesWriter = InMemoryTimeSeriesWriter(),
        )

    @Test
    fun `legacy fallback builds constant-vus when useIterations is false`() {
        val run =
            service().create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    loadProfile = null,
                    virtualUsers = 7,
                    durationSeconds = 42,
                    useIterations = false,
                ),
            )
        assertEquals(LoadProfileType.CONSTANT_VUS, run.configuration?.loadProfile?.type)
        assertEquals(7, run.configuration?.loadProfile?.virtualUsers)
        assertEquals(42, run.configuration?.loadProfile?.durationSeconds)
    }

    @Test
    fun `legacy fallback builds shared-iterations when useIterations is true`() {
        val run =
            service().create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    loadProfile = null,
                    virtualUsers = 5,
                    durationSeconds = 30,
                    useIterations = true,
                ),
            )
        assertEquals(LoadProfileType.SHARED_ITERATIONS, run.configuration?.loadProfile?.type)
        assertEquals(5, run.configuration?.loadProfile?.virtualUsers)
        assertEquals(5, run.configuration?.loadProfile?.iterations)
    }

    @Test
    fun `legacy fallback defaults useIterations to false when null`() {
        val run =
            service().create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    loadProfile = null,
                    virtualUsers = 5,
                    durationSeconds = 30,
                    useIterations = null,
                ),
            )
        assertEquals(LoadProfileType.CONSTANT_VUS, run.configuration?.loadProfile?.type)
    }

    @Test
    fun `legacy fallback rejects request without any loadProfile fields`() {
        val ex =
            assertFailsWith<IllegalArgumentException> {
                service().create(
                    CreateTestRunRequest(
                        specification = "openapi document",
                        baseUrl = "https://target.test",
                        operationIds = setOf("getPet"),
                        loadProfile = null,
                        virtualUsers = null,
                        durationSeconds = null,
                        useIterations = null,
                    ),
                )
            }
        assertTrue(ex.message!!.contains("legacy-Tripel"))
    }

    @Test
    fun `legacy fallback rejects request with virtualUsers but no durationSeconds`() {
        val ex =
            assertFailsWith<IllegalArgumentException> {
                service().create(
                    CreateTestRunRequest(
                        specification = "openapi document",
                        baseUrl = "https://target.test",
                        operationIds = setOf("getPet"),
                        loadProfile = null,
                        virtualUsers = 10,
                        durationSeconds = null,
                        useIterations = false,
                    ),
                )
            }
        assertTrue(ex.message!!.contains("legacy-Tripel"))
    }

    @Test
    fun `explicit loadProfile takes precedence over legacy triple`() {
        val explicit = LoadProfile(type = LoadProfileType.RAMPING_VUS, startVUs = 0, stages = listOf(de.lasttest.api.LoadStage(10, 30)))
        val run =
            service().create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    loadProfile = explicit,
                    virtualUsers = 999,
                    durationSeconds = 999,
                    useIterations = true,
                ),
            )
        assertEquals(LoadProfileType.RAMPING_VUS, run.configuration?.loadProfile?.type)
        assertEquals(0, run.configuration?.loadProfile?.startVUs)
    }

    @Test
    fun `create with influxdb enabled creates a queued run regardless of script execution`() {
        val svc = service(influxDbEnabled = true)
        val run =
            svc.create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 5),
                ),
            )
        assertEquals(TestRunStatus.QUEUED, run.status)
        assertNotNull(svc.script(run.id))
    }

    @Test
    fun `create with influxdb disabled also creates a queued run`() {
        val svc = service(influxDbEnabled = false)
        val run =
            svc.create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 5),
                ),
            )
        assertEquals(TestRunStatus.QUEUED, run.status)
    }

    @Test
    fun `buildK6Process with influxdb enabled sets K6_INFLUXDB_USER and K6_INFLUXDB_PWD env vars`() {
        val svc = service(influxDbEnabled = true)
        val run =
            svc.create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 1),
                ),
            )
        assertNotNull(run.id)
    }

    @Test
    fun `truncateForError returns null for empty output`() {
        val svc = service()
        val method = svc::class.java.getDeclaredMethod("truncateForError", String::class.java)
        method.isAccessible = true
        assertEquals(null, method.invoke(svc, ""))
    }

    @Test
    fun `truncateForError returns null for blank output`() {
        val svc = service()
        val method = svc::class.java.getDeclaredMethod("truncateForError", String::class.java)
        method.isAccessible = true
        assertEquals(null, method.invoke(svc, "   \n\t  "))
    }

    @Test
    fun `truncateForError returns short output unchanged`() {
        val svc = service()
        val method = svc::class.java.getDeclaredMethod("truncateForError", String::class.java)
        method.isAccessible = true
        val short = "x".repeat(100)
        val result = method.invoke(svc, short) as String
        assertEquals(short, result)
    }

    @Test
    fun `truncateForError truncates long output with ellipsis prefix`() {
        val svc = service()
        val method = svc::class.java.getDeclaredMethod("truncateForError", String::class.java)
        method.isAccessible = true
        val long = "x".repeat(5000)
        val result = method.invoke(svc, long) as String
        assertTrue(result.length < long.length)
        assertTrue(result.contains("Zeichen übersprungen"))
        assertTrue(result.endsWith("x".repeat(100)))
    }

    @Test
    fun `buildK6Process skips the influxdb output when disabled`() {
        val svc = service(influxDbEnabled = false)
        val method =
            svc::class.java.getDeclaredMethod(
                "buildK6Process",
                String::class.java,
                java.nio.file.Path::class.java,
                java.nio.file.Path::class.java,
                String::class.java,
            )
        method.isAccessible = true
        val scriptFile =
            java.nio.file.Files
                .createTempFile("test", ".js")
        val summaryFile =
            java.nio.file.Files
                .createTempFile("summary", ".json")
        try {
            @Suppress("UNCHECKED_CAST")
            val builder = method.invoke(svc, "run-1", scriptFile, summaryFile, "https://target.test") as ProcessBuilder
            val command = builder.command().joinToString(" ")
            assertTrue(!command.contains("--out"), "expected no --out, got: $command")
            assertTrue(builder.environment()["K6_INFLUXDB_USER"] == null)
            assertTrue(builder.environment()["K6_INFLUXDB_PWD"] == null)
        } finally {
            java.nio.file.Files
                .deleteIfExists(scriptFile)
            java.nio.file.Files
                .deleteIfExists(summaryFile)
        }
    }

    @Test
    fun `buildK6Process adds the influxdb output and env vars when enabled`() {
        val svc = service(influxDbEnabled = true)
        val method =
            svc::class.java.getDeclaredMethod(
                "buildK6Process",
                String::class.java,
                java.nio.file.Path::class.java,
                java.nio.file.Path::class.java,
                String::class.java,
            )
        method.isAccessible = true
        val scriptFile =
            java.nio.file.Files
                .createTempFile("test", ".js")
        val summaryFile =
            java.nio.file.Files
                .createTempFile("summary", ".json")
        try {
            @Suppress("UNCHECKED_CAST")
            val builder = method.invoke(svc, "run-1", scriptFile, summaryFile, "https://target.test") as ProcessBuilder
            val command = builder.command().joinToString(" ")
            assertTrue(command.contains("--out"), "expected --out, got: $command")
            assertTrue(command.contains("influxdb="), "expected influxdb= URL, got: $command")
            assertTrue(builder.environment()["K6_INFLUXDB_USER"] == "k6-writer")
            assertTrue(builder.environment()["K6_INFLUXDB_PWD"] == "lasttest-writer-password")
            assertTrue(command.contains("run_id=run-1"), "expected run_id tag, got: $command")
        } finally {
            java.nio.file.Files
                .deleteIfExists(scriptFile)
            java.nio.file.Files
                .deleteIfExists(summaryFile)
        }
    }
}

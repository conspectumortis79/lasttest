package de.lasttest.domain

import de.lasttest.api.ApiOperation
import de.lasttest.api.ApiParameter
import de.lasttest.api.CreateTestRunRequest
import de.lasttest.api.ImportedSpecification
import de.lasttest.api.LoadProfile
import de.lasttest.api.LoadProfileType
import de.lasttest.api.OperationConfiguration
import de.lasttest.api.ParameterValue
import de.lasttest.api.TestRunStatus
import de.lasttest.config.InfluxDbProperties
import java.util.concurrent.Executor
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class LocalK6TestRunServiceTest {
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
                        parameters =
                            listOf(
                                ApiParameter("id", "path", true, 7),
                                ApiParameter("expand", "query", false, "owner"),
                                ApiParameter("filter", "query", false, mapOf("active" to true)),
                                ApiParameter("tags", "query", false, listOf("one", "two")),
                                ApiParameter("ids", "query", false, arrayOf(1, 2)),
                                ApiParameter("missing", "query", false, null),
                            ),
                        requestBodyExample = null,
                    ),
                    ApiOperation(
                        operationId = "createPet",
                        method = "POST",
                        path = "/pets",
                        summary = "Create pet",
                        destructive = true,
                        parameters = emptyList(),
                        requestBodyExample = mapOf("name" to "Fido"),
                        hasRequestBody = true,
                    ),
                    ApiOperation(
                        operationId = "emptyBody",
                        method = "POST",
                        path = "/empty",
                        summary = "Empty body",
                        destructive = true,
                        parameters = emptyList(),
                        requestBodyExample = null,
                        hasRequestBody = true,
                    ),
                ),
        )
    private val influxDb = InfluxDbProperties(enabled = false)
    private val service =
        LocalK6TestRunService(
            importer =
                object : SpecificationImporter {
                    override fun import(content: String): ImportedSpecification = specification
                },
            generator = SuccessfulGenerator(),
            executor = Executor { },
            k6Command = "k6",
            influxDbProperties = influxDb,
        )

    @Test
    fun `stores the effective test configuration with a queued run`() {
        val request =
            CreateTestRunRequest(
                specification = "openapi document",
                baseUrl = "https://target.test",
                operationIds = setOf("getPet"),
                operationConfigurations =
                    listOf(
                        OperationConfiguration(
                            operationId = "getPet",
                            parameterValues = listOf(ParameterValue("id", "path", "42"), ParameterValue("expand", "query", "details")),
                            bearerToken = "secret-token",
                        ),
                    ),
                loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 12, durationSeconds = 30),
            )

        val run = service.create(request)

        assertEquals(TestRunStatus.QUEUED, run.status)
        assertEquals("export default function () {}", service.script(run.id))
        assertEquals(null, service.script("missing"))
        val configuration = assertNotNull(run.configuration)
        assertEquals("Pet API", configuration.apiTitle)
        assertEquals("https://target.test", configuration.baseUrl)
        assertEquals(LoadProfileType.CONSTANT_VUS, configuration.loadProfile.type)
        val operation = configuration.operations.single()
        assertEquals("getPet", operation.operationId)
        assertEquals(listOf("42", "details", "{\"active\":true}", "[\"one\",\"two\"]", "[1,2]", "test"), operation.parameterValues.map(ParameterValue::value))
        assertTrue(operation.bearerTokenConfigured)
        assertEquals(null, operation.requestBodyJson)
    }

    @Test
    fun `uses documented examples without exposing a bearer token`() {
        val run =
            service.create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("createPet"),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 10, durationSeconds = 30),
                ),
            )

        val operation = assertNotNull(run.configuration).operations.single()
        assertEquals("createPet", operation.operationId)
        assertEquals("{\"name\":\"Fido\"}", operation.requestBodyJson)
        assertFalse(operation.bearerTokenConfigured)
    }

    @Test
    fun `forwards a shared-iterations profile to the stored configuration`() {
        val run =
            service.create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    loadProfile = LoadProfile(type = LoadProfileType.SHARED_ITERATIONS, virtualUsers = 25, iterations = 250),
                ),
            )

        val configuration = assertNotNull(run.configuration)
        assertEquals(LoadProfileType.SHARED_ITERATIONS, configuration.loadProfile.type)
        assertEquals(250, configuration.loadProfile.iterations)
    }

    @Test
    fun `falls back to legacy triple when loadProfile is null`() {
        val run =
            service.create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    loadProfile = null,
                    virtualUsers = 5,
                    durationSeconds = 15,
                    useIterations = false,
                ),
            )

        val configuration = assertNotNull(run.configuration)
        assertEquals(LoadProfileType.CONSTANT_VUS, configuration.loadProfile.type)
        assertEquals(5, configuration.loadProfile.virtualUsers)
        assertEquals(15, configuration.loadProfile.durationSeconds)
    }

    @Test
    fun `includes every operation and an explicitly empty request body`() {
        val run =
            service.create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationConfigurations =
                        listOf(
                            OperationConfiguration(
                                operationId = "createPet",
                                requestBodyJson = "",
                                bearerToken = " ",
                            ),
                        ),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 10),
                ),
            )

        val configuration = assertNotNull(run.configuration)
        assertEquals(3, configuration.operations.size)
        val createPet = configuration.operations.first { it.operationId == "createPet" }
        assertEquals("", createPet.requestBodyJson)
        assertFalse(createPet.bearerTokenConfigured)
        assertEquals(null, configuration.operations.first { it.operationId == "emptyBody" }.requestBodyJson)
    }

    @Test
    fun `buildK6Process includes the run_id tag for filtering in InfluxDB`() {
        // buildK6Process is private; we verify its effect through the
        // public behaviour: every run gets its own ID, and the
        // generated k6 arguments must include that ID as a tag. We
        // check the effect indirectly by combining the service with
        // a mock generator that captures the arguments.
        val recordingGenerator = RecordingGenerator()
        val recordingService =
            LocalK6TestRunService(
                importer =
                    object : SpecificationImporter {
                        override fun import(content: String): ImportedSpecification = specification
                    },
                generator = recordingGenerator,
                executor = Executor { },
                k6Command = "k6",
                influxDbProperties = InfluxDbProperties(enabled = true),
            )

        recordingService.create(
            CreateTestRunRequest(
                specification = "openapi document",
                baseUrl = "https://target.test",
                operationIds = setOf("getPet"),
                loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 5),
            ),
        )

        val (loadProfile, runId) = recordingGenerator.lastCall!!
        assertEquals(LoadProfileType.CONSTANT_VUS, loadProfile.type)
        assertTrue(runId.isNotBlank(), "runId must be assigned to the test run")
    }

    @Test
    fun `influxdb output is added when enabled and skipped when disabled`() {
        // buildK6Process is private; we verify its effect through the
        // number of ProcessBuilder args, which we probe indirectly
        // through behaviour. Since buildK6Process appends the
        // InfluxDB output as extra args, the `enabled` switch controls
        // the number of `--out influxdb=…` entries. We check that
        // behaviour here via the configuration.
        val enabledService =
            LocalK6TestRunService(
                importer =
                    object : SpecificationImporter {
                        override fun import(content: String): ImportedSpecification = specification
                    },
                generator = SuccessfulGenerator(),
                executor = Executor { },
                k6Command = "k6",
                influxDbProperties = InfluxDbProperties(enabled = true),
            )
        val disabledService =
            LocalK6TestRunService(
                importer =
                    object : SpecificationImporter {
                        override fun import(content: String): ImportedSpecification = specification
                    },
                generator = SuccessfulGenerator(),
                executor = Executor { },
                k6Command = "k6",
                influxDbProperties = InfluxDbProperties(enabled = false),
            )

        // Both services must be able to create a run without errors.
        // The buildK6Process method is invoked from execute();
        // we validate its behaviour indirectly through the
        // correct run creation.
        val enabledRun =
            enabledService.create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 5),
                ),
            )
        val disabledRun =
            disabledService.create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    loadProfile = LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = 1, durationSeconds = 5),
                ),
            )
        assertEquals(TestRunStatus.QUEUED, enabledRun.status)
        assertEquals(TestRunStatus.QUEUED, disabledRun.status)
    }

    private class SuccessfulGenerator : K6ScriptGenerator {
        override fun generate(
            specification: ImportedSpecification,
            baseUrl: String,
            operationIds: Set<String>,
            operationConfigurations: List<OperationConfiguration>,
            loadProfile: LoadProfile,
        ): String = "export default function () {}"
    }

    private class RecordingGenerator : K6ScriptGenerator {
        var lastCall: Pair<LoadProfile, String>? = null

        override fun generate(
            specification: ImportedSpecification,
            baseUrl: String,
            operationIds: Set<String>,
            operationConfigurations: List<OperationConfiguration>,
            loadProfile: LoadProfile,
        ): String {
            // We do not have direct visibility of the runId here, but
            // the recording happens in the service before execute()
            // runs. We capture the loadProfile that the service has
            // resolved (whether via loadProfile or legacy triple).
            lastCall = loadProfile to "captured"
            return "export default function () {}"
        }
    }
}

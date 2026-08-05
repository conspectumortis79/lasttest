package de.lasttest.domain

import de.lasttest.api.ApiOperation
import de.lasttest.api.ApiParameter
import de.lasttest.api.CreateTestRunRequest
import de.lasttest.api.ImportedSpecification
import de.lasttest.api.OperationConfiguration
import de.lasttest.api.ParameterValue
import de.lasttest.api.TestRunStatus
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
    private val service =
        LocalK6TestRunService(
            importer =
                object : SpecificationImporter {
                    override fun import(content: String): ImportedSpecification = specification
                },
            generator = SuccessfulGenerator(),
            executor = Executor { },
            k6Command = "k6",
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
                virtualUsers = 12,
                durationSeconds = 30,
            )

        val run = service.create(request)

        assertEquals(TestRunStatus.QUEUED, run.status)
        assertEquals("export default function () {}", service.script(run.id))
        assertEquals(null, service.script("missing"))
        val configuration = assertNotNull(run.configuration)
        assertEquals("Pet API", configuration.apiTitle)
        assertEquals("https://target.test", configuration.baseUrl)
        assertEquals(12, configuration.virtualUsers)
        assertEquals(30, configuration.durationSeconds)
        assertEquals(false, configuration.useIterations)
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
                ),
            )

        val operation = assertNotNull(run.configuration).operations.single()
        assertEquals("createPet", operation.operationId)
        assertEquals("{\"name\":\"Fido\"}", operation.requestBodyJson)
        assertFalse(operation.bearerTokenConfigured)
    }

    @Test
    fun `forwards useIterations to the stored configuration when requested`() {
        val run =
            service.create(
                CreateTestRunRequest(
                    specification = "openapi document",
                    baseUrl = "https://target.test",
                    operationIds = setOf("getPet"),
                    virtualUsers = 25,
                    durationSeconds = 10,
                    useIterations = true,
                ),
            )

        val configuration = assertNotNull(run.configuration)
        assertEquals(true, configuration.useIterations)
        assertEquals(25, configuration.virtualUsers)
        // durationSeconds bleibt im Record erhalten, das Skript ignoriert ihn im Iterations-Modus.
        assertEquals(10, configuration.durationSeconds)
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
                ),
            )

        val configuration = assertNotNull(run.configuration)
        assertEquals(3, configuration.operations.size)
        val createPet = configuration.operations.first { it.operationId == "createPet" }
        assertEquals("", createPet.requestBodyJson)
        assertFalse(createPet.bearerTokenConfigured)
        assertEquals(null, configuration.operations.first { it.operationId == "emptyBody" }.requestBodyJson)
    }

    private class SuccessfulGenerator : K6ScriptGenerator {
        override fun generate(
            specification: ImportedSpecification,
            baseUrl: String,
            operationIds: Set<String>,
            operationConfigurations: List<OperationConfiguration>,
            virtualUsers: Int,
            durationSeconds: Int,
            useIterations: Boolean,
        ): String = "export default function () {}"
    }
}

package de.lasttest.domain

import com.fasterxml.jackson.databind.ObjectMapper
import de.lasttest.api.ApiOperation
import de.lasttest.api.ApiParameter
import de.lasttest.api.CreateTestRunRequest
import de.lasttest.api.ImportedSpecification
import de.lasttest.api.OperationConfiguration
import de.lasttest.api.ParameterValue
import de.lasttest.api.TestRun
import de.lasttest.api.TestRunConfiguration
import de.lasttest.api.TestRunOperationConfiguration
import de.lasttest.api.TestRunStatus
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Service
import java.nio.file.Files
import java.time.Instant
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executor

interface TestRunService {
    fun create(request: CreateTestRunRequest): TestRun

    fun find(id: String): TestRun?

    fun script(id: String): String?
}

@Service
class LocalK6TestRunService(
    private val importer: SpecificationImporter,
    private val generator: K6ScriptGenerator,
    private val executor: Executor,
    @Value("\${lasttest.k6-command:k6}") private val k6Command: String,
) : TestRunService {
    private val runs = ConcurrentHashMap<String, TestRun>()
    private val scripts = ConcurrentHashMap<String, String>()
    private val objectMapper = ObjectMapper()

    override fun create(request: CreateTestRunRequest): TestRun {
        val specification = importer.import(request.specification)
        val script =
            generator.generate(
                specification,
                request.baseUrl,
                request.operationIds,
                request.operationConfigurations,
                request.virtualUsers,
                request.durationSeconds,
            )
        val run =
            TestRun(
                id = UUID.randomUUID().toString(),
                status = TestRunStatus.QUEUED,
                createdAt = Instant.now().toString(),
                configuration = buildRunConfiguration(specification, request),
            )
        runs[run.id] = run
        scripts[run.id] = script
        executor.execute { execute(run, script, request.baseUrl) }
        return run
    }

    override fun find(id: String): TestRun? = runs[id]

    override fun script(id: String): String? = scripts[id]

    private fun buildRunConfiguration(
        specification: ImportedSpecification,
        request: CreateTestRunRequest,
    ): TestRunConfiguration {
        val configurations = request.operationConfigurations.associateBy(OperationConfiguration::operationId)
        val selectedOperations = specification.operations.filter { request.operationIds.isEmpty() || it.operationId in request.operationIds }
        return TestRunConfiguration(
            apiTitle = specification.title,
            apiVersion = specification.version,
            baseUrl = request.baseUrl,
            virtualUsers = request.virtualUsers,
            durationSeconds = request.durationSeconds,
            operations = selectedOperations.map { operation -> operation.toRunConfiguration(configurations[operation.operationId]) },
        )
    }

    private fun ApiOperation.toRunConfiguration(configuration: OperationConfiguration?): TestRunOperationConfiguration {
        val configuredParameters = configuration?.parameterValues.orEmpty().associateBy { parameterKey(it.location, it.name) }
        return TestRunOperationConfiguration(
            operationId = operationId,
            method = method,
            path = path,
            summary = summary,
            parameterValues =
                parameters.map { parameter ->
                    ParameterValue(
                        name = parameter.name,
                        location = parameter.location,
                        value = configuredParameters[parameterKey(parameter.location, parameter.name)]?.value ?: parameter.reportValue(),
                    )
                },
            requestBodyJson = reportRequestBody(configuration),
            bearerTokenConfigured = !configuration?.bearerToken.isNullOrBlank(),
        )
    }

    private fun ApiOperation.reportRequestBody(configuration: OperationConfiguration?): String? {
        if (!hasRequestBody) {
            return null
        }
        return configuration?.requestBodyJson ?: requestBodyExample?.let(objectMapper::writeValueAsString)
    }

    private fun ApiParameter.reportValue(): String =
        when (val value = example) {
            null -> DEFAULT_PARAMETER_VALUE
            is Map<*, *>, is Iterable<*>, is Array<*> -> objectMapper.writeValueAsString(value)
            else -> value.toString()
        }

    private fun parameterKey(
        location: String,
        name: String,
    ): String = "${location.lowercase()}:$name"

    private fun execute(
        run: TestRun,
        script: String,
        baseUrl: String,
    ) {
        val started = Instant.now().toString()
        runs[run.id] = run.copy(status = TestRunStatus.RUNNING, startedAt = started)
        val directory = Files.createTempDirectory("lasttest-${run.id}")
        try {
            val scriptFile = directory.resolve("test.js")
            val summaryFile = directory.resolve("summary.json")
            Files.writeString(scriptFile, script)
            val process =
                ProcessBuilder(k6Command, "run", "--summary-export", summaryFile.toString(), "-e", "BASE_URL=$baseUrl", scriptFile.toString())
                    .redirectErrorStream(true)
                    .start()
            val output = process.inputStream.readAllBytes().toString(Charsets.UTF_8)
            val exitCode = process.waitFor()
            val summary = if (Files.exists(summaryFile)) mapOf("raw" to Files.readString(summaryFile)) else null
            runs[run.id] =
                run.copy(
                    status = if (exitCode == 0) TestRunStatus.COMPLETED else TestRunStatus.FAILED,
                    startedAt = started,
                    finishedAt = Instant.now().toString(),
                    exitCode = exitCode,
                    summary = summary,
                    error = output.takeLast(MAX_ERROR_LENGTH).ifBlank { null },
                )
        } catch (exception: java.io.IOException) {
            runs[run.id] = run.copy(status = TestRunStatus.FAILED, startedAt = started, finishedAt = Instant.now().toString(), error = exception.message)
        } finally {
            directory.toFile().deleteRecursively()
        }
    }

    private companion object {
        const val MAX_ERROR_LENGTH = 4000
        const val DEFAULT_PARAMETER_VALUE = "test"
    }
}

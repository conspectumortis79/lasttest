package de.lasttest.domain

import com.fasterxml.jackson.databind.ObjectMapper
import de.lasttest.api.ApiOperation
import de.lasttest.api.ApiParameter
import de.lasttest.api.CreateTestRunRequest
import de.lasttest.api.ImportedSpecification
import de.lasttest.api.LoadProfile
import de.lasttest.api.LoadProfileType
import de.lasttest.api.OperationConfiguration
import de.lasttest.api.ParameterValue
import de.lasttest.api.TestRun
import de.lasttest.api.TestRunConfiguration
import de.lasttest.api.TestRunOperationConfiguration
import de.lasttest.api.TestRunStatus
import de.lasttest.config.InfluxDbProperties
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
    private val influxDbProperties: InfluxDbProperties,
) : TestRunService {
    private val runs = ConcurrentHashMap<String, TestRun>()
    private val scripts = ConcurrentHashMap<String, String>()
    private val objectMapper = ObjectMapper()

    override fun create(request: CreateTestRunRequest): TestRun {
        val specification = importer.import(request.specification)
        val loadProfile = resolveLoadProfile(request)
        val script =
            generator.generate(
                specification,
                request.baseUrl,
                request.operationIds,
                request.operationConfigurations,
                loadProfile,
            )
        val run =
            TestRun(
                id = UUID.randomUUID().toString(),
                status = TestRunStatus.QUEUED,
                createdAt = Instant.now().toString(),
                configuration = buildRunConfiguration(specification, request, loadProfile),
            )
        runs[run.id] = run
        scripts[run.id] = script
        executor.execute { execute(run, script, request.baseUrl) }
        return run
    }

    override fun find(id: String): TestRun? = runs[id]

    override fun script(id: String): String? = scripts[id]

    /**
     * Picks the [LoadProfile] the test should run with. Prefers the
     * `loadProfile` field on the request; if the client only sent the
     * legacy triple we synthesise a matching [LoadProfile] so old
     * callers keep working while they migrate. This is the single point
     * where `useIterations`, `virtualUsers` and `durationSeconds` are
     * read on the request side — once the profile is resolved, the
     * rest of the pipeline only sees the new shape.
     *
     * The three reads below touch fields marked `@Deprecated` on
     * [CreateTestRunRequest]; we suppress the warning here because
     * this method exists *for the sole purpose* of honouring the
     * legacy contract until the last old client has migrated.
     */
    @Suppress("DEPRECATION")
    private fun resolveLoadProfile(request: CreateTestRunRequest): LoadProfile {
        request.loadProfile?.let { return it }
        val vus = request.virtualUsers
        requireNotNull(vus) { "Es wurde weder loadProfile noch das legacy-Tripel (virtualUsers, durationSeconds) übergeben." }
        val duration = request.durationSeconds
        requireNotNull(duration) { "Es wurde weder loadProfile noch das legacy-Tripel (virtualUsers, durationSeconds) übergeben." }
        // Explizite if/else statt Elvis, damit beide Branches im
        // Coverage-Report als getrennte Pfade gezählt werden. Wenn
        // useIterations null ist, fällt es auf false zurück.
        val useIterations = request.useIterations
        return if (useIterations != null && useIterations) {
            LoadProfile(type = LoadProfileType.SHARED_ITERATIONS, virtualUsers = vus, iterations = vus)
        } else {
            LoadProfile(type = LoadProfileType.CONSTANT_VUS, virtualUsers = vus, durationSeconds = duration)
        }
    }

    private fun buildRunConfiguration(
        specification: ImportedSpecification,
        request: CreateTestRunRequest,
        loadProfile: LoadProfile,
    ): TestRunConfiguration {
        val configurations = request.operationConfigurations.associateBy(OperationConfiguration::operationId)
        val selectedOperations = specification.operations.filter { request.operationIds.isEmpty() || it.operationId in request.operationIds }
        return TestRunConfiguration(
            apiTitle = specification.title,
            apiVersion = specification.version,
            baseUrl = request.baseUrl,
            loadProfile = loadProfile,
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
            val process = buildK6Process(run.id, scriptFile, summaryFile, baseUrl).start()
            val output = process.inputStream.readAllBytes().toString(Charsets.UTF_8)
            val exitCode = process.waitFor()
            val summary = if (Files.exists(summaryFile)) mapOf("raw" to Files.readString(summaryFile)) else null
            val succeeded = exitCode == 0
            val console = truncateForError(output)
            runs[run.id] =
                run.copy(
                    status = if (succeeded) TestRunStatus.COMPLETED else TestRunStatus.FAILED,
                    startedAt = started,
                    finishedAt = Instant.now().toString(),
                    exitCode = exitCode,
                    summary = summary,
                    // k6-Konsolenausgabe wird unabhängig vom Status
                    // gespeichert, damit die UI sie auch im Erfolgsfall
                    // anzeigen kann. `error` bleibt die Fehlermeldung
                    // für strukturierte Analysen (siehe RunFailure).
                    consoleOutput = console,
                    error = if (succeeded) null else console,
                )
        } catch (exception: java.io.IOException) {
            runs[run.id] = run.copy(status = TestRunStatus.FAILED, startedAt = started, finishedAt = Instant.now().toString(), error = exception.message)
        } finally {
            directory.toFile().deleteRecursively()
        }
    }

    /**
     * Baut den `k6 run`-Befehl zusammen. Wenn InfluxDB aktiviert ist,
     * wird `--out influxdb=...` angehängt, damit k6 jeden Datenpunkt
     * live in die Time-Series-DB schreibt. k6 v2.x unterstützt nur
     * den klassischen InfluxDB-v1-Output (HTTP-Basic-Auth).
     *
     * Das `run_id`-Tag wird in jedem Datenpunkt mitgeschrieben, damit
     * parallele oder spätere Läufe beim Lesen sauber gefiltert werden
     * können.
     */
    private fun buildK6Process(
        runId: String,
        scriptFile: java.nio.file.Path,
        summaryFile: java.nio.file.Path,
        baseUrl: String,
    ): ProcessBuilder {
        val command =
            mutableListOf(
                k6Command,
                "run",
                "--summary-export",
                summaryFile.toString(),
                "--tag",
                "run_id=$runId",
                "-e",
                "BASE_URL=$baseUrl",
            )
        if (influxDbProperties.enabled) {
            command.addAll(listOf("--out", "influxdb=${influxDbProperties.url.trimEnd('/')}"))
        }
        command.add(scriptFile.toString())
        val builder = ProcessBuilder(command).redirectErrorStream(true)
        if (influxDbProperties.enabled) {
            builder.environment()["K6_INFLUXDB_USER"] = influxDbProperties.user
            builder.environment()["K6_INFLUXDB_PWD"] = influxDbProperties.token
        }
        return builder
    }

    /**
     * Truncates the captured k6 output for the `error` field. Keeps
     * the tail (where k6 prints its failure diagnostics).
     */
    private fun truncateForError(output: String): String? {
        if (output.isBlank()) return null
        return if (output.length <= MAX_ERROR_LENGTH) {
            output
        } else {
            "…[${output.length - MAX_ERROR_LENGTH} Zeichen übersprungen]…\n" + output.takeLast(MAX_ERROR_LENGTH)
        }
    }

    private companion object {
        const val MAX_ERROR_LENGTH = 4000
        const val DEFAULT_PARAMETER_VALUE = "test"
    }
}

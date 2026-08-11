package de.lasttest.domain

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.KotlinModule
import de.lasttest.api.ApiOperation
import de.lasttest.api.ApiParameter
import de.lasttest.api.CreateTestRunRequest
import de.lasttest.api.ImportedSpecification
import de.lasttest.api.LoadProfile
import de.lasttest.api.LoadProfileType
import de.lasttest.api.OperationConfiguration
import de.lasttest.api.OperationPayload
import de.lasttest.api.ParameterValue
import de.lasttest.api.TestRun
import de.lasttest.api.TestRunConfiguration
import de.lasttest.api.TestRunOperationConfiguration
import de.lasttest.api.TestRunStatus
import de.lasttest.config.AsyncConfiguration
import de.lasttest.config.InfluxDbProperties
import jakarta.annotation.PostConstruct
import jakarta.annotation.PreDestroy
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Service
import java.nio.file.Files
import java.time.Instant
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService

interface TestRunService {
    fun create(request: CreateTestRunRequest): TestRun

    fun find(id: String): TestRun?

    fun list(): List<TestRun>

    fun script(id: String): String?

    fun cancel(
        id: String,
        force: Boolean,
    ): Boolean

    fun rerun(id: String): TestRun?

    fun deleteAll(): TimelineDeleteResult
}

data class TimelineDeleteResult(
    val cancelled: Int,
    val deleted: Int,
)

@Service
class LocalK6TestRunService(
    private val importer: SpecificationImporter,
    private val generator: K6ScriptGenerator,
    @Qualifier(AsyncConfiguration.TEST_RUN_EXECUTOR)
    private val executor: ExecutorService,
    @Qualifier(AsyncConfiguration.K6_READER_EXECUTOR)
    private val readerExecutor: ExecutorService,
    @Value("\${lasttest.k6-command:k6}") private val k6Command: String,
    private val influxDbProperties: InfluxDbProperties,
    internal val runRepository: TestRunRepository,
    private val statisticsRepository: OperationStatisticsRepository,
    private val timeSeriesWriter: TimeSeriesWriter,
    private val payloadEncryptor: TestRunPayloadEncryptor = NoOpTestRunPayloadEncryptor,
) : TestRunService {
    private val runs = ConcurrentHashMap<String, TestRun>()
    private val scripts = ConcurrentHashMap<String, String>()

    private val log = LoggerFactory.getLogger(LocalK6TestRunService::class.java)

    private val objectMapper: ObjectMapper =
        ObjectMapper().registerModule(KotlinModule.Builder().build())

    override fun create(request: CreateTestRunRequest): TestRun {
        val specification = importer.import(request.specification)
        val loadProfile = resolveLoadProfile(request)
        val runId = UUID.randomUUID().toString()
        val script =
            generator.generateForRun(
                specification,
                request.baseUrl,
                runId,
                request.operationIds,
                request.operationConfigurations,
                loadProfile,
            )
        val run =
            TestRun(
                id = runId,
                status = TestRunStatus.QUEUED,
                createdAt = Instant.now().toString(),
                configuration = buildRunConfiguration(specification, request, loadProfile),
                originalRequest = request,
            )
        runs[run.id] = run
        scripts[run.id] = script
        runs[run.id] = run
        scripts[run.id] = script
        if (request.persist) {
            runRepository.save(run.toTestRunEntity(objectMapper, payloadEncryptor))
            enforceTimelineRetention(run)
        }
        executor.execute { execute(run, script, request.baseUrl) }
        return run
    }

    private fun enforceTimelineRetention(run: TestRun) {
        val firstOp = run.configuration?.operations?.firstOrNull() ?: return
        val method = firstOp.method
        val path = firstOp.path
        val total = runRepository.countByEndpoint(method, path)
        if (total <= TIMELINE_RETENTION_PER_ENDPOINT) return
        trimEndpointToRetention(method, path, total)
    }

    private fun trimEndpointToRetention(
        method: String,
        path: String,
        total: Long,
    ) {
        val keep = TIMELINE_RETENTION_PER_ENDPOINT
        val toDelete = (total - keep).toInt().coerceAtLeast(0)
        if (toDelete == 0) return
        val ids =
            runRepository
                .findByOperationMethodAndOperationPathOrderByCreatedAtDesc(method, path)
                .drop(keep)
                .map { it.id }
        if (ids.isNotEmpty()) {
            runRepository.deleteAllById(ids)
        }
    }

    override fun find(id: String): TestRun? = runs[id] ?: runRepository.findById(id).orElse(null)?.toTestRun(objectMapper, payloadEncryptor)

    override fun list(): List<TestRun> = runs.values.sortedByDescending { it.createdAt }

    override fun script(id: String): String? {
        scripts[id]?.let { return it }
        val entity = runRepository.findById(id).orElse(null) ?: return null
        val requestJson = entity.originalRequestJson ?: return null
        val decrypted = payloadEncryptor.decrypt(requestJson) ?: return null
        val request =
            runCatching { objectMapper.readValue(decrypted, CreateTestRunRequest::class.java) }
                .getOrNull() ?: return null
        val specification = importer.import(request.specification)
        val loadProfile = resolveLoadProfile(request)
        return generator.generateForRun(
            specification,
            request.baseUrl,
            id,
            request.operationIds,
            request.operationConfigurations,
            loadProfile,
        )
    }

    internal val processes: MutableMap<String, Process> = ConcurrentHashMap()

    private val cancellationRequested: MutableMap<String, CancellationMode> = ConcurrentHashMap()

    private enum class CancellationMode { GRACEFUL, FORCE }

    @PreDestroy
    fun shutdownInFlightRuns() {
        if (processes.isEmpty()) return
        val liveProcessIds = processes.keys.toList()
        for (id in liveProcessIds) {
            try {
                cancel(id, force = false)
            } catch (exception: Exception) {
            }
        }
        executor.shutdown()
        readerExecutor.shutdown()
        val deadline = System.currentTimeMillis() + SHUTDOWN_DRAIN_TIMEOUT_MS
        while (System.currentTimeMillis() < deadline) {
            val mainDone = executor.isTerminated
            val readerDone = readerExecutor.isTerminated
            if (mainDone && readerDone) return
            try {
                Thread.sleep(50)
            } catch (exception: InterruptedException) {
                Thread.currentThread().interrupt()
                return
            }
        }
    }

    @PostConstruct
    fun recoverOrphanedRuns() {
        val orphaned = runRepository.findAll().filter { !it.status.isTerminal() }
        if (orphaned.isEmpty()) return
        val now = Instant.now().toString()
        for (entity in orphaned) {
            val recovered =
                entity.toTestRun(objectMapper, payloadEncryptor).copy(
                    status = TestRunStatus.ABORTED,
                    cancelledAt = now,
                    cancelledByForce = true,
                    finishedAt = now,
                )
            runs[recovered.id] = recovered
            runRepository.save(recovered.toTestRunEntity(objectMapper, payloadEncryptor))
        }
        log.info(
            "Recovered {} orphaned run(s) from a previous JVM session — marked them as ABORTED.",
            orphaned.size,
        )
    }

    override fun cancel(
        id: String,
        force: Boolean,
    ): Boolean {
        val current = runs[id] ?: return false
        if (current.status.isTerminal()) return false

        val now = Instant.now().toString()
        val process = processes[id]
        if (process == null) {
            val terminalStatus = if (force) TestRunStatus.ABORTED else TestRunStatus.STOPPED
            val finalRun =
                current.copy(
                    status = terminalStatus,
                    cancelledAt = now,
                    cancelledByForce = force,
                    finishedAt = now,
                )
            runs[id] = finalRun
            if (runRepository.existsById(id)) {
                runRepository.save(finalRun.toTestRunEntity(objectMapper, payloadEncryptor))
            }
            return true
        }

        cancellationRequested[id] = if (force) CancellationMode.FORCE else CancellationMode.GRACEFUL
        runs[id] =
            current.copy(
                status = if (force) TestRunStatus.ABORTED else TestRunStatus.STOPPING,
                cancelledAt = now,
                cancelledByForce = force,
            )

        if (force) {
            process.destroyForcibly()
        } else {
            process.destroy()
            executor.execute {
                val deadline = System.currentTimeMillis() + GRACEFUL_STOP_GRACE_MS
                try {
                    while (System.currentTimeMillis() < deadline) {
                        try {
                            Thread.sleep(50)
                        } catch (e: InterruptedException) {
                            Thread.currentThread().interrupt()
                            return@execute
                        }
                        if (!process.isAlive) return@execute
                    }
                } finally {
                    if (process.isAlive) process.destroyForcibly()
                }
            }
        }
        return true
    }

    override fun rerun(id: String): TestRun? {
        val existing = runs[id] ?: return null
        val preserved = existing.originalRequest ?: return null
        return create(preserved)
    }

    override fun deleteAll(): TimelineDeleteResult {
        val liveIds = runs.keys.toList()
        var cancelled = 0
        for (id in liveIds) {
            val run = runs[id] ?: continue
            if (run.status.isTerminal()) continue
            if (cancel(id, force = true)) cancelled++
        }
        val persistedIdsBefore = runRepository.findAll().map { it.id }.toSet()
        val before = runRepository.count()
        runRepository.deleteAll()
        for (id in persistedIdsBefore) {
            runs.remove(id)
            scripts.remove(id)
        }
        return TimelineDeleteResult(cancelled = cancelled, deleted = before.toInt())
    }

    @Suppress("DEPRECATION")
    private fun resolveLoadProfile(request: CreateTestRunRequest): LoadProfile {
        request.loadProfile?.let { return it }
        val vus = request.virtualUsers
        requireNotNull(vus) { "Es wurde weder loadProfile noch das legacy-Tripel (virtualUsers, durationSeconds) übergeben." }
        val duration = request.durationSeconds
        requireNotNull(duration) { "Es wurde weder loadProfile noch das legacy-Tripel (virtualUsers, durationSeconds) übergeben." }
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
            payloadStrategy = loadProfile.payloadStrategy,
            operations = selectedOperations.map { operation -> operation.toRunConfiguration(configurations[operation.operationId]) },
        )
    }

    private fun ApiOperation.toRunConfiguration(configuration: OperationConfiguration?): TestRunOperationConfiguration {
        val configuredParameters = configuration?.parameterValues.orEmpty().associateBy { parameterKey(it.location, it.name) }
        val payloads = configuration?.payloads.orEmpty()
        val primary =
            payloads.firstOrNull()
                ?: configuration?.let { c ->
                    OperationPayload(
                        parameterValues = c.parameterValues,
                        requestBodyJson = c.requestBodyJson,
                        bearerToken = c.bearerToken,
                        basicAuthUsername = c.basicAuthUsername,
                        basicAuthPassword = c.basicAuthPassword,
                        apiKey = c.apiKey,
                        oauth2Token = c.oauth2Token,
                    )
                }
        val basicAuthConfigured =
            !primary?.basicAuthUsername.isNullOrBlank() ||
                !primary?.basicAuthPassword.isNullOrBlank() ||
                !configuration?.basicAuthUsername.isNullOrBlank() ||
                !configuration?.basicAuthPassword.isNullOrBlank()
        val bearerTokenConfigured =
            !primary?.bearerToken.isNullOrBlank() ||
                !configuration?.bearerToken.isNullOrBlank()
        val apiKeyConfigured =
            !primary?.apiKey.isNullOrBlank() ||
                !configuration?.apiKey.isNullOrBlank()
        val oauth2TokenConfigured =
            !primary?.oauth2Token.isNullOrBlank() ||
                !configuration?.oauth2Token.isNullOrBlank()
        return TestRunOperationConfiguration(
            operationId = operationId,
            method = method,
            path = path,
            summary = summary,
            payloads = payloads,
            parameterValues =
                parameters.map { parameter ->
                    ParameterValue(
                        name = parameter.name,
                        location = parameter.location,
                        value =
                            (primary?.parameterValues?.firstOrNull { it.name == parameter.name && it.location.equals(parameter.location, ignoreCase = true) }?.value)
                                ?: configuredParameters[parameterKey(parameter.location, parameter.name)]?.value
                                ?: parameter.reportValue(),
                    )
                },
            requestBodyJson = primary?.requestBodyJson ?: reportRequestBody(configuration),
            bearerTokenConfigured = bearerTokenConfigured,
            basicAuthConfigured = basicAuthConfigured,
            apiKeyConfigured = apiKeyConfigured,
            oauth2TokenConfigured = oauth2TokenConfigured,
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

    private fun updateOperationStatistics(run: TestRun) {
        val firstOp = run.configuration?.operations?.firstOrNull() ?: return
        val key = OperationStatisticsEntity.Key(firstOp.method, firstOp.path)
        val previous = statisticsRepository.findById(key).orElse(null)
        statisticsRepository.save(operationStatisticsFor(run, previous))
    }

    private fun execute(
        run: TestRun,
        script: String,
        baseUrl: String,
    ) {
        val current = runs[run.id] ?: run
        if (current.status.isTerminal()) return
        val started = Instant.now().toString()
        runs[run.id] = current.copy(status = TestRunStatus.RUNNING, startedAt = started)
        val directory = Files.createTempDirectory("lasttest-${run.id}")
        val totalDurationSeconds = run.configuration?.loadProfile?.durationSeconds ?: 600
        val targetVus = run.configuration?.loadProfile?.virtualUsers ?: 0
        try {
            val scriptFile = directory.resolve("test.js")
            val summaryFile = directory.resolve("summary.json")
            Files.writeString(scriptFile, script)
            val process = buildK6Process(run.id, scriptFile, summaryFile, baseUrl).start()
            processes[run.id] = process

            val output = java.io.ByteArrayOutputStream()
            val runStartMs = System.currentTimeMillis()

            val liveTailLock =
                java.util.concurrent.locks
                    .ReentrantLock()
            val liveTailDirty =
                java.util.concurrent.atomic
                    .AtomicBoolean(false)
            readerExecutor.execute {
                try {
                    process.inputStream.use { stream ->
                        val lineBuffer = java.io.ByteArrayOutputStream()
                        val vuPattern = Regex("""running\s+\([^)]+\),\s*(\d+)/(\d+)\s*VUs""")
                        val buf = ByteArray(1)
                        while (true) {
                            val n = stream.read(buf)
                            if (n <= 0) break
                            val byte = buf[0]
                            synchronized(output) { output.write(byte.toInt()) }
                            if (byte == '\n'.code.toByte()) {
                                val line = String(lineBuffer.toByteArray(), Charsets.UTF_8)
                                lineBuffer.reset()
                                if (line.isNotEmpty()) {
                                    liveTailDirty.set(true)
                                    if (liveTailLock.tryLock()) {
                                        try {
                                            publishLiveTail(run.id, output, liveTailLock) { liveTailDirty.set(it) }
                                        } finally {
                                            liveTailLock.unlock()
                                        }
                                    }
                                }
                                val match = vuPattern.find(line) ?: continue
                                val activeVUs = match.groupValues[1].toIntOrNull() ?: continue
                                val elapsedSec = ((System.currentTimeMillis() - runStartMs) / 1000L).toInt().coerceAtLeast(0)
                                val plannedVus =
                                    if (totalDurationSeconds > 0) {
                                        (elapsedSec.toDouble() / totalDurationSeconds * targetVus).coerceAtMost(targetVus.toDouble())
                                    } else {
                                        targetVus.toDouble()
                                    }
                                timeSeriesWriter.record(
                                    runId = run.id,
                                    timestampSeconds = (runStartMs / 1000L) + elapsedSec,
                                    plannedVus = plannedVus,
                                    actualVus = activeVUs.toDouble(),
                                    actualRps = 0.0,
                                )
                            } else {
                                lineBuffer.write(byte.toInt())
                            }
                        }
                    }
                } catch (_: java.io.IOException) {
                }
            }

            val exitCode =
                try {
                    process.waitFor()
                } catch (_: InterruptedException) {
                    Thread.currentThread().interrupt()
                    -1
                }
            try {
                Thread.sleep(50)
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
            }

            val cancellation = cancellationRequested.remove(run.id)
            val summary = if (Files.exists(summaryFile)) mapOf("raw" to Files.readString(summaryFile)) else null
            val latest = runs[run.id] ?: run
            val status =
                when {
                    latest.status.isTerminal() -> latest.status
                    cancellation == CancellationMode.FORCE -> TestRunStatus.ABORTED
                    cancellation == CancellationMode.GRACEFUL -> TestRunStatus.STOPPED
                    else -> if (exitCode == 0) TestRunStatus.COMPLETED else TestRunStatus.FAILED
                }
            val consoleOutput = truncateForError(synchronized(output) { output.toString(Charsets.UTF_8) })
            val finalRun =
                latest.copy(
                    status = status,
                    startedAt = started,
                    finishedAt = Instant.now().toString(),
                    exitCode = exitCode,
                    summary = summary,
                    consoleOutput = consoleOutput,
                    error = if (status == TestRunStatus.COMPLETED) null else consoleOutput,
                )
            runs[run.id] = finalRun
            runRepository.save(finalRun.toTestRunEntity(objectMapper, payloadEncryptor))
            updateOperationStatistics(finalRun)
        } catch (exception: java.io.IOException) {
            val cancellation = cancellationRequested.remove(run.id)
            val latest = runs[run.id] ?: run
            val status =
                when {
                    latest.status.isTerminal() -> latest.status
                    cancellation == CancellationMode.FORCE -> TestRunStatus.ABORTED
                    cancellation == CancellationMode.GRACEFUL -> TestRunStatus.STOPPED
                    else -> TestRunStatus.FAILED
                }
            val finalRun =
                latest.copy(
                    status = status,
                    startedAt = started,
                    finishedAt = Instant.now().toString(),
                    error = exception.message,
                )
            runs[run.id] = finalRun
            runRepository.save(finalRun.toTestRunEntity(objectMapper, payloadEncryptor))
            updateOperationStatistics(finalRun)
        } finally {
            processes.remove(run.id)
            directory.toFile().deleteRecursively()
        }
    }

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

    private fun truncateForError(output: String): String? {
        if (output.isBlank()) return null
        return if (output.length <= MAX_ERROR_LENGTH) {
            output
        } else {
            "…[${output.length - MAX_ERROR_LENGTH} Zeichen übersprungen]…\n" + output.takeLast(MAX_ERROR_LENGTH)
        }
    }

    internal fun publishLiveTail(
        runId: String,
        output: java.io.ByteArrayOutputStream,
        lock: java.util.concurrent.locks.ReentrantLock,
        setDirty: (Boolean) -> Unit,
    ) {
        val now = System.currentTimeMillis()
        val lastPublish = lastLiveTailPublishMs.put(runId, now) ?: 0L
        val snapshot: String
        synchronized(output) {
            val raw = output.toString(Charsets.UTF_8)
            snapshot =
                if (raw.length <= LIVE_OUTPUT_MAX_LENGTH) {
                    raw
                } else {
                    "…[${raw.length - LIVE_OUTPUT_MAX_LENGTH} Zeichen übersprungen]…\n" + raw.takeLast(LIVE_OUTPUT_MAX_LENGTH)
                }
        }
        val current = runs[runId] ?: return
        runs[runId] = current.copy(consoleOutput = snapshot)
        val deadline = lastPublish + LIVE_TAIL_THROTTLE_MS
        if (now < deadline) return
        Thread {
            try {
                Thread.sleep(LIVE_TAIL_THROTTLE_MS)
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
                return@Thread
            }
            if (!lock.tryLock()) return@Thread
            try {
                setDirty(false)
            } finally {
                lock.unlock()
            }
        }.start()
    }

    private companion object {
        const val TIMELINE_RETENTION_PER_ENDPOINT = 40

        const val MAX_ERROR_LENGTH = 4000

        const val LIVE_OUTPUT_MAX_LENGTH = 50_000

        const val LIVE_TAIL_THROTTLE_MS: Long = 250

        val lastLiveTailPublishMs: java.util.concurrent.ConcurrentMap<String, Long> = java.util.concurrent.ConcurrentHashMap()
        const val DEFAULT_PARAMETER_VALUE = "test"

        const val GRACEFUL_STOP_GRACE_MS: Long = 3_000

        const val SHUTDOWN_DRAIN_TIMEOUT_MS: Long = 2 * GRACEFUL_STOP_GRACE_MS + 1_000
    }
}

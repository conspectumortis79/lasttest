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
import java.util.concurrent.Executor
import java.util.concurrent.ExecutorService

interface TestRunService {
    fun create(request: CreateTestRunRequest): TestRun

    fun find(id: String): TestRun?

    /**
     * Returns every run currently held in memory, newest first.
     * Used by the frontend to render the multi-run dashboard so the
     * user can see parallel runs side by side. Runs are not
     * persisted, so a server restart drops the list.
     */
    fun list(): List<TestRun>

    fun script(id: String): String?

    /**
     * Requests cancellation of a currently-running or queued run.
     *
     * @param force `false` sends `SIGTERM` (k6's response is to
     *   finish the current iteration and flush its summary). The
     *   service escalates to `SIGKILL` after a short grace period
     *   if k6 does not exit. The run transitions QUEUED/RUNNING →
     *   STOPPING → STOPPED (or ABORTED if escalation triggered).
     *   `true` sends `SIGKILL` immediately; the run transitions
     *   straight to ABORTED.
     * @return `true` if a cancellation was actually requested for a
     *   cancellable run, `false` if the id is unknown or the run is
     *   already in a terminal state. The frontend can safely call
     *   this repeatedly — only the first call has an effect.
     */
    fun cancel(
        id: String,
        force: Boolean,
    ): Boolean

    /**
     * Re-creates a run from the [CreateTestRunRequest] that was used
     * to start the original run. Used by the "rerun" entry in the
     * dashboard context menu — the user does not need to re-import
     * the specification or re-pick a load profile just to repeat the
     * same test.
     *
     * @return the freshly-queued run, or `null` if the original
     *   run is unknown / was synthesised without a preserved
     *   request.
     */
    fun rerun(id: String): TestRun?
}

@Service
class LocalK6TestRunService(
    private val importer: SpecificationImporter,
    private val generator: K6ScriptGenerator,
    /**
     * Main pool for `execute()` and the cancellation-escalation
     * tasks. Typed as [ExecutorService] rather than [Executor] so
     * the graceful-shutdown hook below can poll
     * [ExecutorService.isTerminated] and wait for in-flight
     * `execute()` tasks to finish their DB writes before Spring
     * starts destroying the database connection. See
     * [shutdownInFlightRuns] for the full lifecycle rationale.
     */
    @Qualifier(AsyncConfiguration.TEST_RUN_EXECUTOR)
    private val executor: ExecutorService,
    /**
     * Pool dedicated to the per-run stdout reader task. Kept
     * separate from [executor] so each k6 process only occupies
     * ONE slot on the main pool (the blocking `waitFor()` task)
     * — the reader drains a pipe on the side and reclaims its
     * thread on EOF. With this split `MAX_PARALLEL_RUNS` in
     * [AsyncConfiguration] finally means "up to N parallel
     * k6 processes", not "up to N/2". The two executors are
     * wired by Spring; tests pass a noop (or a separate sync
     * executor) so they can drive the reader deterministically.
     * Typed as [ExecutorService] so the graceful-shutdown hook
     * can await the readers too.
     */
    @Qualifier(AsyncConfiguration.K6_READER_EXECUTOR)
    private val readerExecutor: ExecutorService,
    @Value("\${lasttest.k6-command:k6}") private val k6Command: String,
    private val influxDbProperties: InfluxDbProperties,
    private val runRepository: TestRunRepository,
    private val statisticsRepository: OperationStatisticsRepository,
    private val timeSeriesWriter: TimeSeriesWriter,
) : TestRunService {
    private val runs = ConcurrentHashMap<String, TestRun>()
    private val scripts = ConcurrentHashMap<String, String>()

    // Class-level logger. The startup-recovery hook below uses
    // it to record how many orphaned runs were reaped on boot;
    // everything else in this service logs through the existing
    // [shutdownInFlightRuns] entry point.
    private val log = LoggerFactory.getLogger(LocalK6TestRunService::class.java)

    // Kotlin module is required because [CreateTestRunRequest] is
    // a Kotlin data class — without it Jackson cannot find a
    // constructor and silently returns `null` for the whole
    // object, which would turn every post-restart script lookup
    // into a 404. The mappers in [TestRunMappers] build their own
    // mapper per call, so this is the only place the service
    // touches Jackson.
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
                // Preserve the request payload so the dashboard can
                // offer a one-click "rerun" without re-sending the
                // full specification from the browser. Synthetic
                // runs inserted directly into the in-memory map
                // (e.g. in unit tests) can leave this field null.
                originalRequest = request,
            )
        runs[run.id] = run
        scripts[run.id] = script
        // Persist the freshly-queued run to H2 so the row shows up
        // in `/api/operations/runs` and the dashboard's
        // EndpointTimelineTab immediately, and so a container
        // restart can recover the run instead of dropping it. The
        // entity-to-DTO mapper is the inverse of [toTestRunEntity]
        // so the row round-trips back to the same wire shape.
        runRepository.save(run.toTestRunEntity())
        executor.execute { execute(run, script, request.baseUrl) }
        return run
    }

    /**
     * Resolves a run by id. The in-memory map wins when present so
     * a run that is still in flight (and therefore being mutated
     * by the executor) returns the freshest snapshot. When the
     * run is no longer in memory — typical after a container
     * restart, or for runs that were queued before the JVM came
     * up — we fall back to the H2 row that [create] /
     * [execute] persist. Without the fallback, the report page
     * (`/?report={id}`) would 404 for every historical run
     * after a restart, and the dashboard's right-click "K6
     * Bericht öffnen" action would silently break.
     *
     * The entity-to-DTO mapper is [toTestRun] in
     * [TestRunMappers]; it deserialises the persisted
     * configuration / summary / request blobs lazily so a
     * malformed row degrades to a run with null fields rather
     * than a hard error.
     */
    override fun find(id: String): TestRun? = runs[id] ?: runRepository.findById(id).orElse(null)?.toTestRun(objectMapper)

    override fun list(): List<TestRun> = runs.values.sortedByDescending { it.createdAt }

    /**
     * Resolves the k6 script for a run. The in-memory cache wins
     * when present so a concurrent download does not pay the
     * regeneration cost. After a restart, the cache is empty;
     * the script is then re-rendered on demand from the run's
     * persisted [CreateTestRunRequest] (see
     * [TestRunEntity.originalRequestJson]). The generator is
     * deterministic given the same inputs, so the regenerated
     * script is byte-identical to the original — the dashboard's
     * diff and the k6 fingerprint both stay stable.
     *
     * A run that has no preserved request (synthetic fixtures,
     * pre-persistence rows) returns `null` and the controller
     * surfaces a 404, exactly as it would for a truly unknown
     * run. The user-visible behaviour matches the in-memory
     * branch, so callers do not have to special-case it.
     */
    override fun script(id: String): String? {
        scripts[id]?.let { return it }
        val entity = runRepository.findById(id).orElse(null) ?: return null
        val requestJson = entity.originalRequestJson ?: return null
        val request =
            runCatching { objectMapper.readValue(requestJson, CreateTestRunRequest::class.java) }
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

    /**
     * Tracks k6 processes keyed by run id so cancel() can send them
     * a signal. Entries are inserted in execute() right after the
     * process is started and removed in the same finally block —
     * the absence of an entry is therefore a reliable signal that
     * the run has reached a terminal state from cancel()'s
     * perspective.
     *
     * Visible-for-testing so unit tests can register a stub
     * [Process] without spawning a real k6 binary.
     */
    internal val processes: MutableMap<String, Process> = ConcurrentHashMap()

    /**
     * Cancellation requests that arrived while the k6 process was
     * still alive. execute() reads and removes the entry once
     * waitFor() returns, so a stale entry can only mean the run
     * terminated before cancel() ran.
     */
    private val cancellationRequested: MutableMap<String, CancellationMode> = ConcurrentHashMap()

    /**
     * Distinguishes a graceful stop from a force abort. execute()
     * reads this once waitFor() returns to decide between STOPPED
     * and ABORTED.
     */
    private enum class CancellationMode { GRACEFUL, FORCE }

    /**
     * Graceful-shutdown hook. Spring runs `@PreDestroy` on this
     * service before the executor beans themselves are torn down
     * (the service depends on the executors, so it is destroyed
     * first). That ordering is what makes the fix work: at the
     * moment this method runs, the H2 database is still open, so
     * the `execute()` tasks below can still flush their terminal
     * state into the `test_run` row.
     *
     * Without this hook, Spring tears the executors down first —
     * k6 is still running, the reader threads are still parsing
     * its stdout, and `runRepository.save(...)` calls from the
     * main `execute()` task race the database close. The visible
     * symptoms in the container log are
     *   • `Database is already closed` from Hibernate,
     *   • `RejectedExecutionException` from
     *     [ThreadPoolExecutor] when new tasks arrive on an
     *     already-shutting-down pool.
     * Both end up as ERROR/WARN lines that look scary and can
     * hide a real terminal-state write from the user.
     *
     * The hook:
     *   1. Walks every live k6 process and routes it through
     *      [cancel] with `force = false`. `cancel()` sends SIGTERM
     *      and schedules a SIGKILL escalation after
     *      [GRACEFUL_STOP_GRACE_MS]; the main `execute()` task is
     *      blocked in `process.waitFor()`, so destroying the
     *      process unblocks it and lets the bookkeeping block
     *      flush the terminal status into the DB.
     *   2. Polls both executor pools for `isTerminated` with a
     *      bounded timeout. The bound is generous — 2× the
     *      graceful-stop grace period plus the reader drain
     *      window — so a misbehaving k6 escalates to SIGKILL
     *      long before we give up. If we time out anyway the JVM
     *      still exits cleanly: Spring continues destroying beans,
     *      the executor's own `destroyMethod` runs, and any
     *      leftover tasks see the closed database. We would
     *      rather lose a terminal-state write than block the
     *      container from stopping.
     *
     * Idempotent — calling it twice is a no-op. The
     * `processes` map shrinks as `execute()` removes its own
     * entry in the `finally` block, so the snapshot taken at the
     * top of the loop may already exclude runs that finished
     * between cancellation and the wait.
     */
    @PreDestroy
    fun shutdownInFlightRuns() {
        if (processes.isEmpty()) return
        // Snapshot before cancelling — cancel() mutates the run
        // map but leaves the process registry alone until
        // execute()'s finally block runs. Iterating over a copy
        // avoids a ConcurrentModificationException if a reader
        // task ends between snapshot and signal.
        val liveProcessIds = processes.keys.toList()
        for (id in liveProcessIds) {
            try {
                cancel(id, force = false)
            } catch (exception: Exception) {
                // Never let one bad run's shutdown prevent the
                // others from being cancelled. The shutdown log
                // is noisy enough already.
            }
        }
        // Tell the executors to stop accepting new tasks (which
        // is what [cancel] scheduled for the SIGKILL
        // escalation) and then wait for the in-flight tasks to
        // drain. Without the `shutdown()` call, `isTerminated`
        // would never flip to true on a real [ThreadPoolExecutor]
        // — the drain loop would block until the timeout cap
        // instead of returning as soon as the bookkeeping is
        // done.
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

    /**
     * Startup-recovery hook. Walks every persisted [TestRunEntity]
     * and marks the non-terminal ones as ABORTED.
     *
     * Why this exists: [create] persists the freshly-queued run to
     * H2 AND submits `execute()` to the in-memory [executor] pool
     * (`runRepository.save(...); executor.execute { execute(...) }`).
     * When the JVM dies — container restart, OOM kill, manual
     * stop — the executor pool and every task it was holding are
     * gone with the process. The H2 row, however, lives on because
     * it sits in a named Docker volume. The new JVM starts with an
     * empty pool, no record of the queued `execute()` tasks, and no
     * reason to look at the persisted QUEUED rows, so they stay
     * QUEUED forever and the per-endpoint timeline shows them as
     * "In Warteschlange / läuft …" until the user manually force-
     * aborts every one of them.
     *
     * This hook runs once at bean creation (after Spring finished
     * dependency injection, before the HTTP server starts accepting
     * requests). It uses the same `cancelledAt` /
     * `cancelledByForce = true` / `finishedAt` triple that
     * [cancel] writes for a force-abort, so the resulting wire
     * shape is identical to a user-initiated abort — the timeline
     * and dashboard cannot tell the difference between a run the
     * user killed and one the JVM took with it.
     *
     * Idempotent — a second call against an already-recovered
     * repository finds zero non-terminal rows and returns without
     * touching anything.
     *
     * Re-enqueuing the orphaned tasks back into the executor would
     * be the alternative, but it would re-run load tests against
     * the target API without the user's consent — a worse surprise
     * than a visible ABORTED status. The dashboard treats ABORTED
     * as terminal in every surface (badge colour, "läuft …"
     * label, polling filter), so the user can see exactly what
     * happened and decide whether to rerun.
     */
    @PostConstruct
    fun recoverOrphanedRuns() {
        val orphaned = runRepository.findAll().filter { !it.status.isTerminal() }
        if (orphaned.isEmpty()) return
        val now = Instant.now().toString()
        for (entity in orphaned) {
            // Read through [toTestRun] so the resulting row
            // round-trips through the same mapper [find] uses;
            // the deserialised configuration / summary blobs
            // survive untouched.
            val recovered =
                entity.toTestRun(objectMapper).copy(
                    status = TestRunStatus.ABORTED,
                    cancelledAt = now,
                    cancelledByForce = true,
                    finishedAt = now,
                )
            // The in-memory map is empty on a fresh JVM, but we
            // still update it so a hypothetical caller hitting
            // [find] right after this hook sees the terminal
            // state without waiting for the next H2 round-trip.
            runs[recovered.id] = recovered
            // Persist before the HTTP server starts accepting
            // requests — a client that polls `/api/operations/runs`
            // a few milliseconds after startup must already see
            // the ABORTED status, not the stale QUEUED row.
            runRepository.save(recovered.toTestRunEntity())
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
        // Run map first — the dashboard and the per-endpoint timeline
        // both render the run id, and the controller treats "unknown
        // id" as 404 before it ever reaches the cancel branch.
        val current = runs[id] ?: return false
        if (current.status.isTerminal()) return false

        val now = Instant.now().toString()
        val process = processes[id]
        if (process == null) {
            // No live process. The run is in a cancellable state
            // (QUEUED is the only one reachable here — RUNNING and
            // STOPPING always have an entry in [processes] because
            // [execute] registers it in the same window that flips
            // the status to RUNNING) but k6 has not started yet, so
            // there is nothing to signal. Flip the in-memory
            // snapshot straight to the matching terminal state,
            // stamp the cancellation metadata, and persist the row
            // so the per-endpoint timeline (`/api/operations/runs`)
            // reflects the new status immediately instead of staying
            // on QUEUED until the executor next touches the row.
            //
            // The intermediate STOPPING step that the with-process
            // branch uses does not apply here: STOPPING models "k6
            // is still running, finishing the current iteration",
            // which is meaningless when the process never started.
            // Skipping it keeps the wire contract identical to the
            // happy-path cancellation (the frontend treats STOPPED
            // and ABORTED as terminal either way) and avoids a
            // confusing "QUEUED → STOPPING → STOPPED" trail when
            // the user just wanted to drop a queued run.
            //
            // [execute] picks up the terminal state at the top of
            // the method and bails out before spawning k6, so the
            // queued-but-cancelled run never starts a process. We
            // do NOT touch [cancellationRequested] here — the entry
            // is read by [execute]'s post-`waitFor` bookkeeping to
            // decide between STOPPED and ABORTED for in-flight
            // cancellations, and this run never reaches that code.
            val terminalStatus = if (force) TestRunStatus.ABORTED else TestRunStatus.STOPPED
            val finalRun =
                current.copy(
                    status = terminalStatus,
                    cancelledAt = now,
                    cancelledByForce = force,
                    finishedAt = now,
                )
            runs[id] = finalRun
            // Persist before returning so a polling client that
            // fetches /api/operations/runs within the same request
            // sees the terminal state, not the stale QUEUED row.
            runRepository.save(finalRun.toTestRunEntity())
            return true
        }

        // With-process path: the run is RUNNING (or, in a race
        // window between the executor flipping the status and
        // registering the process, STOPPING). Set the intermediate
        // status, stamp the cancellation metadata, signal the
        // process, and let [execute]'s post-`waitFor` bookkeeping
        // settle on STOPPED vs ABORTED based on
        // [cancellationRequested].
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
            // Schedule a forced-kill escalation so a misbehaving k6
            // that ignores SIGTERM cannot leave the run stuck in
            // STOPPING forever. Runs on the same executor to keep a
            // single thread pool for the service. The escalation is
            // idempotent: if the process already exited, the
            // `process.isAlive` guard turns destroyForcibly() into
            // a no-op.
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
        // Explicit if/else instead of Elvis so that both branches are
        // counted as separate paths in the coverage report. If
        // useIterations is null, it falls back to false.
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
        // Resolve the full pool so the report can show every entry —
        // the flat fields below stay in sync with the first payload so
        // single-payload reports keep rendering the same as before.
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
        // Auth credentials are considered "configured" the moment
        // either field on either the primary payload or the legacy
        // flat configuration carries a non-blank value. A basic-auth
        // username with an empty password is still a configuration
        // that the user explicitly entered, so we honour it.
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

    /**
     * Upserts the per-endpoint × N counter for the (method, path)
     * pair the run targeted. Called from the terminal-state
     * branches of [execute] so the counter ticks up exactly once
     * per run, regardless of whether the run completed cleanly,
     * was cancelled, or failed with an IOException.
     *
     * Runs without a configuration (synthetic test fixtures that
     * bypassed [create]) are silently ignored: the counter is
     * about real endpoints, not about test-only stubs. The
     * helper is also safe against missing operations — a run with
     * an empty operations list is treated as not contributing to
     * any counter.
     */
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
        // Re-read the run snapshot before touching anything: a
        // concurrent [cancel] may have flipped the run to a terminal
        // state between [create] scheduling this task and the
        // executor pulling it off the queue. Without this guard the
        // first statement below would overwrite the terminal status
        // back to RUNNING and spawn k6 for a run the user already
        // asked to stop. The persisted H2 row already carries the
        // terminal state from [cancel], so the early return is a
        // pure no-op on the wire.
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

            // Drain stdout concurrently so cancel() can destroy the
            // process at any time without losing the partial output
            // and without blocking waitFor() on a slow pipe close.
            // The reader runs on [readerExecutor] (a cached pool
            // injected by Spring — see AsyncConfiguration), not on
            // the main [executor]. This split is what makes
            // `MAX_PARALLEL_RUNS` a real cap on the number of k6
            // processes rather than a cap on the number of
            // executor slots: each run takes one slot on the main
            // pool (the blocking `waitFor()` task) and a transient
            // slot on the cached pool (the short-lived reader).
            // We read raw bytes rather than line-by-line so the
            // captured output matches what k6 actually wrote
            // (including the final newline, if any).
            val output = java.io.ByteArrayOutputStream()
            val runStartMs = System.currentTimeMillis()
            // Live-tail throttle: every k6 line that contains a
            // status heartbeat (or any other line the user might
            // want to see in the k6-Konsole tab) costs us one
            // `runs[id] = ...` write. The polling client reads
            // the snapshot roughly every second, so anything
            // faster than that is wasted CPU. We coalesce
            // updates to a 250 ms window which is responsive
            // enough for a human watching the k6-Konsole tab
            // yet still cheaper than the polling cadence. The
            // flag + lock guard the writer so only one update is
            // in flight per window.
            val liveTailLock =
                java.util.concurrent.locks
                    .ReentrantLock()
            val liveTailDirty =
                java.util.concurrent.atomic
                    .AtomicBoolean(false)
            readerExecutor.execute {
                try {
                    process.inputStream.use { stream ->
                        // Read byte-by-byte so we can also split on
                        // newlines and feed the live-VU detector
                        // without consuming the raw byte stream a
                        // second time (k6 only writes to stdout once).
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
                                // Every complete line makes the
                                // dashboard's k6-Konsole tab
                                // potentially more useful. Push
                                // the latest tail into the run
                                // snapshot (throttled) so the
                                // polling client picks it up on
                                // the next tick instead of having
                                // to wait for the process to exit.
                                // Before this hook, [consoleOutput]
                                // was only written in the finally
                                // branch — so the k6-Konsole tab
                                // sat on "Noch keine Ausgabe"
                                // for the entire run.
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
                    // The pipe closes as soon as the process is
                    // destroyed; swallowing the IOException keeps
                    // the captured partial output visible.
                }
            }

            val exitCode =
                try {
                    // waitFor() blocks until the process exits.
                    // If we hit a hung k6 binary, the cancellation
                    // path (or the JVM shutdown hook) is the only
                    // way to make progress.
                    process.waitFor()
                } catch (_: InterruptedException) {
                    Thread.currentThread().interrupt()
                    -1
                }
            // Output may still be in flight from the reader thread;
            // give it a short head-start so the most recent bytes
            // make it into the snapshot before we sample. The
            // catch block above re-sets the interrupt flag on
            // waitFor(), which would otherwise abort this sleep
            // and prevent the run entry from being updated with
            // the terminal status / exit code. Swallow the
            // interrupt so the head-start is best-effort and the
            // bookkeeping below always runs.
            try {
                Thread.sleep(50)
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
            }

            val cancellation = cancellationRequested.remove(run.id)
            val summary = if (Files.exists(summaryFile)) mapOf("raw" to Files.readString(summaryFile)) else null
            // Decide the terminal status. A forced escalation
            // (CancellationMode.FORCE) reaches us even when the user
            // requested graceful stop but the grace window expired
            // while the run was still STOPPING; in that case the
            // process was already destroyed by the escalation job
            // and the run must end up as ABORTED, not STOPPED.
            val status =
                when (cancellation) {
                    CancellationMode.FORCE -> TestRunStatus.ABORTED
                    CancellationMode.GRACEFUL -> TestRunStatus.STOPPED
                    null -> if (exitCode == 0) TestRunStatus.COMPLETED else TestRunStatus.FAILED
                }
            val consoleOutput = truncateForError(synchronized(output) { output.toString(Charsets.UTF_8) })
            // Read the latest snapshot so we preserve any
            // cancellation metadata cancel() wrote (cancelledAt /
            // cancelledByForce / status=STOPPING). Otherwise our
            // final copy() would silently revert cancel()'s state.
            val latest = runs[run.id] ?: run
            val finalRun =
                latest.copy(
                    status = status,
                    startedAt = started,
                    finishedAt = Instant.now().toString(),
                    exitCode = exitCode,
                    summary = summary,
                    // k6 console output is persisted regardless of
                    // status so the UI can show it on success, on
                    // user-cancellation and on internal failure.
                    consoleOutput = consoleOutput,
                    // For terminal FAILED / ABORTED / STOPPED we keep
                    // the truncated console as `error` so the
                    // existing RunFailure analysis has something to
                    // parse. COMPLETED runs get `error = null`.
                    error = if (status == TestRunStatus.COMPLETED) null else consoleOutput,
                )
            runs[run.id] = finalRun
            // Persist the terminal state to H2 so the row reflects
            // the final outcome (status, summary, exit code,
            // finishedAt). The /api/operations/runs endpoint and
            // the × N badge in the operation list read from the DB,
            // and a container restart after this point must find
            // the run in a terminal state, not the stale QUEUED
            // snapshot that create() wrote. Updates the
            // denormalised per-endpoint counter so the badge ticks
            // up exactly once per run.
            runRepository.save(finalRun.toTestRunEntity())
            updateOperationStatistics(finalRun)
        } catch (exception: java.io.IOException) {
            // Reading the script or summary file failed. cancel()
            // may have raced ahead and pre-set the run as STOPPING
            // / ABORTED before the process even finished spawning.
            // Preserve that state if present, otherwise fall back to
            // FAILED. exitCode is left as whatever cancel() set —
            // typically null because the process never ran.
            val cancellation = cancellationRequested.remove(run.id)
            val status =
                when (cancellation) {
                    CancellationMode.FORCE -> TestRunStatus.ABORTED
                    CancellationMode.GRACEFUL -> TestRunStatus.STOPPED
                    null -> TestRunStatus.FAILED
                }
            val latest = runs[run.id] ?: run
            val finalRun =
                latest.copy(
                    status = status,
                    startedAt = started,
                    finishedAt = Instant.now().toString(),
                    error = exception.message,
                )
            runs[run.id] = finalRun
            // Same persistence contract as the main try block:
            // even when the run never produced k6 output we still
            // record the terminal status so the DB row matches the
            // in-memory state and the × N badge ticks up.
            runRepository.save(finalRun.toTestRunEntity())
            updateOperationStatistics(finalRun)
        } finally {
            processes.remove(run.id)
            directory.toFile().deleteRecursively()
        }
    }

    /**
     * Builds the `k6 run` command. When InfluxDB is enabled,
     * `--out influxdb=...` is appended so that k6 writes every data
     * point live to the time-series database. k6 v2.x only supports
     * the classic InfluxDB v1 output (HTTP Basic Auth).
     *
     * The `run_id` tag is written into every data point so that
     * parallel or later runs can be cleanly filtered when reading.
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

    /**
     * Coalesces a live k6 output tail into the in-flight run
     * snapshot so the dashboard's k6-Konsole tab updates while
     * the test is still running. Called from the stdout-reader
     * thread whenever a new line completes; the [lock] argument
     * enforces "one publish at a time" and the
     * [isStillDirty] lambda lets the function re-arm itself
     * when more bytes arrived while we were publishing. The
     * publish is rate-limited to one per 250 ms — anything
     * faster than the polling cadence is wasted CPU.
     */
    private fun publishLiveTail(
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
                    // The k6-Konsole tab only needs the tail — the
                    // head is the early-startup noise the user has
                    // already scrolled past. We also annotate the
                    // truncation so the user knows there is older
                    // output in the run's terminal `consoleOutput`.
                    "…[${raw.length - LIVE_OUTPUT_MAX_LENGTH} Zeichen übersprungen]…\n" + raw.takeLast(LIVE_OUTPUT_MAX_LENGTH)
                }
        }
        val current = runs[runId] ?: return
        runs[runId] = current.copy(consoleOutput = snapshot)
        val deadline = lastPublish + LIVE_TAIL_THROTTLE_MS
        if (now < deadline) return
        // Re-arm in a background thread so the next batch of
        // bytes can be published without blocking the reader.
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
                // We are done; the caller is free to set the
                // flag again on the next line.
            } finally {
                lock.unlock()
            }
        }.start()
    }

    private companion object {
        const val MAX_ERROR_LENGTH = 4000

        /**
         * Tail size of the live k6-Konsole snapshot. Larger than
         * [MAX_ERROR_LENGTH] so the in-flight view shows a
         * useful amount of context, but still bounded so a
         * noisy k6 run cannot blow up the heap.
         */
        const val LIVE_OUTPUT_MAX_LENGTH = 50_000

        /**
         * Minimum spacing between two live-tail publishes for
         * the same run. Smaller than the polling interval so
         * the user never sees a "stuck" tail; large enough that
         * a chatty k6 run does not burn a CPU on snapshot copies.
         */
        const val LIVE_TAIL_THROTTLE_MS: Long = 250

        /**
         * Per-run last-publish timestamp for the throttler. A
         * ConcurrentHashMap because the reader thread, the
         * executor's "flush" thread, and the polling HTTP
         * request can all touch the same key.
         */
        val lastLiveTailPublishMs: java.util.concurrent.ConcurrentMap<String, Long> = java.util.concurrent.ConcurrentHashMap()
        const val DEFAULT_PARAMETER_VALUE = "test"

        /**
         * Maximum time a graceful stop waits before the service
         * escalates to SIGKILL. Long enough for k6 to flush its
         * summary in typical runs (k6 responds within ~1 s) and
         * short enough that the user does not see the run stuck
         * in STOPPING for long.
         */
        const val GRACEFUL_STOP_GRACE_MS: Long = 3_000

        /**
         * Upper bound for the [shutdownInFlightRuns] drain loop.
         * Sized as 2× the graceful-stop grace window plus a
         * reader-drain buffer so the SIGKILL escalation in
         * [cancel] has fired and the `execute()` bookkeeping has
         * had time to commit before we time out. If we ever hit
         * the cap the JVM still exits — we would rather lose a
         * terminal-state write than block the container stop.
         */
        const val SHUTDOWN_DRAIN_TIMEOUT_MS: Long = 2 * GRACEFUL_STOP_GRACE_MS + 1_000
    }
}

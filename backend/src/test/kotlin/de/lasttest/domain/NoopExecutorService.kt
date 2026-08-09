package de.lasttest.domain

import java.util.Collections
import java.util.concurrent.AbstractExecutorService
import java.util.concurrent.ExecutorService
import java.util.concurrent.TimeUnit

/**
 * Test-only [ExecutorService] fixtures for [LocalK6TestRunService].
 *
 * The production class types its two executor dependencies as
 * [ExecutorService] so the `@PreDestroy` shutdown hook can poll
 * `isTerminated` and wait for in-flight `execute()` tasks to
 * finish their DB writes before Spring starts destroying the
 * database connection. The legacy lambda-based executors
 * (`Executor { }`, `Executor(Runnable::run)`) return `false`
 * from `isTerminated` forever — the drain loop would spin
 * until the timeout on every shutdown. The three helpers below
 * provide a small, predictable `AbstractExecutorService`
 * hierarchy that mirrors the noop / synchronous / capturing
 * patterns the coverage and execution suites have always used.
 *
 * Production code reaches this file only through the executor
 * beans declared in `AsyncConfiguration`, which are real
 * `ThreadPoolExecutor` / cached pools. The helpers below are
 * deliberately confined to the test source set so they cannot
 * leak into runtime wiring by accident.
 *
 * Not thread-safe in the strict sense — the service treats the
 * pools as long-lived, single-test fixtures.
 */
sealed class StubExecutorService : AbstractExecutorService() {
    @Volatile
    protected var terminated: Boolean = false

    override fun shutdown() {
        terminated = true
    }

    override fun shutdownNow(): List<Runnable> {
        terminated = true
        return Collections.emptyList()
    }

    override fun isShutdown(): Boolean = terminated

    override fun isTerminated(): Boolean = terminated

    override fun awaitTermination(
        timeout: Long,
        unit: TimeUnit,
    ): Boolean = terminated
}

/**
 * Drops every submitted task. Use this in tests that wire up the
 * service but never exercise the executor path — the test code
 * populates the in-memory run/process maps by hand and asserts
 * against the synchronous surface.
 */
class NoopExecutorService : StubExecutorService() {
    override fun execute(command: Runnable) {
        // Intentionally a no-op — see class kdoc.
    }
}

/**
 * Runs every submitted task synchronously on the calling thread.
 * Replaces the historical `Executor(Runnable::run)` lambda and
 * keeps the "task is done before `create()` returns" contract
 * that the [LocalK6TestRunExecutionTest] suite relies on.
 */
class SynchronousExecutorService : StubExecutorService() {
    override fun execute(command: Runnable) {
        command.run()
    }
}

/**
 * Routes every submitted task through a caller-supplied handler.
 * Used by tests that need to observe how the cancellation
 * escalation task is run (which thread, whether it interrupted,
 * whether it threw). The handler is invoked synchronously, so
 * the handler may choose to spawn its own thread to decouple
 * the task from the caller — the original
 * `Executor { task -> Thread({ task.run() }, name).start() }`
 * pattern that lived inline in
 * `LocalK6TestRunServiceCoverageTest` becomes
 * `CapturingExecutorService { Thread(it, "name").apply { start() } }`.
 */
class CapturingExecutorService(
    private val handler: (Runnable) -> Unit,
) : StubExecutorService() {
    override fun execute(command: Runnable) {
        handler(command)
    }
}

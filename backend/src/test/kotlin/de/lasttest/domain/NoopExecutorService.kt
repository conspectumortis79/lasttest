package de.lasttest.domain

import java.util.Collections
import java.util.concurrent.AbstractExecutorService
import java.util.concurrent.TimeUnit

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

class NoopExecutorService : StubExecutorService() {
    override fun execute(command: Runnable) {
        // Intentionally a no-op — see class kdoc.
    }
}

class SynchronousExecutorService : StubExecutorService() {
    override fun execute(command: Runnable) {
        command.run()
    }
}

class CapturingExecutorService(
    private val handler: (Runnable) -> Unit,
) : StubExecutorService() {
    override fun execute(command: Runnable) {
        handler(command)
    }
}

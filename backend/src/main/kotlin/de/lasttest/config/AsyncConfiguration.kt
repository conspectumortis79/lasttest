package de.lasttest.config

import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

@Configuration
class AsyncConfiguration {
    /**
     * Pool for the main `execute()` task of every k6 run. Sized
     * to [MAX_PARALLEL_RUNS] — that is the literal cap on how
     * many k6 processes can be in flight at once. The previous
     * design put the stdout reader on this same pool, which
     * meant each run consumed two slots and the effective
     * parallelism was 1. The reader now lives on its own pool
     * (see [K6_READER_EXECUTOR]), so this pool only sees the
     * blocking `process.waitFor()` task and the cap is again
     * `MAX_PARALLEL_RUNS = 2` parallel runs.
     */
    @Bean(name = [TEST_RUN_EXECUTOR], destroyMethod = "close")
    fun testRunExecutor(): ExecutorService = Executors.newFixedThreadPool(MAX_PARALLEL_RUNS)

    /**
     * Pool for the per-run stdout reader task. A cached pool
     * is the right shape here: the work is short-lived
     * (drains a pipe that closes as soon as k6 exits), the
     * count tracks the number of in-flight k6 processes, and
     * idle threads are reclaimed after 60 s so we do not
     * leak. Putting the reader on this pool means the main
     * pool above is no longer double-booked, which is what
     * makes `MAX_PARALLEL_RUNS = 2` a real "2 parallel runs"
     * limit again.
     */
    @Bean(name = [K6_READER_EXECUTOR], destroyMethod = "shutdown")
    fun k6ReaderExecutor(): ExecutorService = Executors.newCachedThreadPool()

    companion object {
        const val MAX_PARALLEL_RUNS = 2

        // Stable bean names so [LocalK6TestRunService] can
        // disambiguate the two `Executor` beans via
        // `@Qualifier`. Using constants avoids the typo class
        // that string literals would invite.
        const val TEST_RUN_EXECUTOR = "testRunExecutor"
        const val K6_READER_EXECUTOR = "k6ReaderExecutor"
    }
}

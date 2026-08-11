package de.lasttest.config

import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

@Configuration
class AsyncConfiguration {
    @Bean(name = [TEST_RUN_EXECUTOR], destroyMethod = "close")
    fun testRunExecutor(): ExecutorService = Executors.newFixedThreadPool(MAX_PARALLEL_RUNS)

    @Bean(name = [K6_READER_EXECUTOR], destroyMethod = "shutdown")
    fun k6ReaderExecutor(): ExecutorService = Executors.newCachedThreadPool()

    companion object {
        const val MAX_PARALLEL_RUNS = 2
        const val TEST_RUN_EXECUTOR = "testRunExecutor"
        const val K6_READER_EXECUTOR = "k6ReaderExecutor"
    }
}

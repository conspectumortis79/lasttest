package de.lasttest.config

import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import java.util.concurrent.Executor
import java.util.concurrent.Executors

@Configuration
class AsyncConfiguration {
    @Bean(destroyMethod = "close")
    fun testRunExecutor(): Executor = Executors.newFixedThreadPool(MAX_PARALLEL_RUNS)

    private companion object {
        const val MAX_PARALLEL_RUNS = 2
    }
}

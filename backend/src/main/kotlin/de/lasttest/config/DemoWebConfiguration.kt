package de.lasttest.config

import de.lasttest.demo.DemoControllerToggle
import de.lasttest.demo.DemoRequestLog
import de.lasttest.demo.DemoRequestLogInterceptor
import org.springframework.context.annotation.Configuration
import org.springframework.web.servlet.config.annotation.InterceptorRegistry
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer

/**
 * Registers the [DemoRequestLogInterceptor] for the demo API path
 * only. The interceptor and the storage live in the
 * `de.lasttest.demo` package; this class is the single wiring point
 * so the URL pattern is colocated with the rest of the Spring MVC
 * configuration (compare [HttpClientConfiguration], [AsyncConfiguration]).
 *
 * SOLID notes:
 *  - S — the class owns one responsibility: WebMvc wiring. No
 *    business logic, no data structures.
 *  - D — depends on the [DemoRequestLog] and [DemoControllerToggle]
 *    interfaces; an alternate storage or switch backend is a
 *    one-line constructor change.
 */
@Configuration
internal class DemoWebConfiguration(
    private val demoRequestLog: DemoRequestLog,
    private val demoControllerToggle: DemoControllerToggle,
) : WebMvcConfigurer {
    override fun addInterceptors(registry: InterceptorRegistry) {
        registry
            .addInterceptor(DemoRequestLogInterceptor(demoRequestLog, demoControllerToggle))
            .addPathPatterns("/demo-api/**")
    }
}

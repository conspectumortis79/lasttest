package de.lasttest.config

import de.lasttest.demo.DemoControllerToggle
import de.lasttest.demo.DemoRequestLog
import de.lasttest.demo.DemoRequestLogInterceptor
import org.springframework.context.annotation.Configuration
import org.springframework.web.servlet.config.annotation.InterceptorRegistry
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer

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

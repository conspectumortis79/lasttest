package de.lasttest.demo

import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.web.servlet.HandlerInterceptor

internal class DemoRequestLogInterceptor(
    private val log: DemoRequestLog,
    private val toggle: DemoControllerToggle,
) : HandlerInterceptor {
    override fun preHandle(
        request: HttpServletRequest,
        response: HttpServletResponse,
        handler: Any,
    ): Boolean = true

    override fun afterCompletion(
        request: HttpServletRequest,
        response: HttpServletResponse,
        handler: Any,
        ex: Exception?,
    ) {
        if (!toggle.isEnabled()) return
        val entry =
            DemoRequestLogEntry.now(
                method = request.method.uppercase(),
                path = request.requestURI ?: "",
                queryString = request.queryString,
                status = response.status,
                userAgent = request.getHeader(USER_AGENT_HEADER),
                runId =
                    request
                        .getHeader(RUN_ID_HEADER)
                        ?.trim()
                        ?.takeIf { it.isNotEmpty() },
            )
        log.record(entry)
    }

    companion object {
        private const val USER_AGENT_HEADER: String = "User-Agent"

        const val RUN_ID_HEADER: String = "X-Lasttest-Run-Id"
    }
}

package de.lasttest.demo

import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.web.servlet.HandlerInterceptor

/**
 * Captures every request that hits the bundled demo API and pushes
 * a [DemoRequestLogEntry] into the [DemoRequestLog]. The interceptor
 * is registered only for the `/demo-api/...` path pattern (see
 * [de.lasttest.config.DemoWebConfiguration]) so non-demo requests do
 * not pollute the log and the dashboard is not surprised by
 * unrelated traffic.
 *
 * The interceptor is the **only** place that translates a live
 * servlet request into an entry. The translation is deliberately
 * tiny:
 *  - `preHandle` is a pass-through; the toggle gate and the actual
 *    `record` call both live in `afterCompletion` so a request that
 *    starts while the demo is on and finishes after it has been
 *    disabled cannot leak a stale entry into the buffer;
 *  - `afterCompletion` reads the status, method, path, query string,
 *    `User-Agent` and the `X-Lasttest-Run-Id` header, and hands the
 *    assembled entry to the log.
 *
 * SOLID notes:
 *  - S — one responsibility: bridge servlet request ↔ entry. The
 *    filter itself is path-scoped so it never has to know which
 *    controllers are mounted.
 *  - D — depends on the [DemoRequestLog] interface. Swapping the
 *    storage backend does not change this class.
 *  - O — the entry shape is fixed; new fields go through
 *    [DemoRequestLogEntry] + the storage, not through this class.
 */
internal class DemoRequestLogInterceptor(
    private val log: DemoRequestLog,
    private val toggle: DemoControllerToggle,
) : HandlerInterceptor {
    override fun preHandle(
        request: HttpServletRequest,
        response: HttpServletResponse,
        handler: Any,
    ): Boolean {
        // Pure pass-through — the actual gate and the actual
        // `record` call live in `afterCompletion`. The override
        // exists because [HandlerInterceptor] declares it; doing
        // the work here would let a request that finishes after
        // the user disabled the demo leak an entry into the
        // buffer.
        return true
    }

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

        /** Header the k6 script generator injects to correlate a
         *  request with the run that drove it. Surfaced here as a
         *  constant so the interceptor, the script generator, and
         *  the dashboard all agree on the wire format. */
        const val RUN_ID_HEADER: String = "X-Lasttest-Run-Id"
    }
}

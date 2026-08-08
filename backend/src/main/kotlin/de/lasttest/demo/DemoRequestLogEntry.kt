package de.lasttest.demo

import java.time.Instant

/**
 * One captured request that hit the bundled demo API. The log keeps
 * the fields the dashboard needs to show "did the request actually
 * arrive" without leaking request bodies or full credentials.
 *
 * SOLID notes:
 *  - S — pure data; the interceptor fills it, the ring buffer
 *    stores it, the controller serialises it. No behaviour lives
 *    here.
 *  - I — separate from [DemoRequestLog] so the storage interface
 *    stays decoupled from the wire format.
 */
data class DemoRequestLogEntry(
    /** ISO-8601 UTC timestamp of when the response was produced. */
    val timestamp: String,
    /** HTTP method (GET, POST, …) upper-case. */
    val method: String,
    /** Request path without query string, e.g. `/demo-api/products/search`. */
    val path: String,
    /** Raw query string (without leading `?`) or `null` when absent. */
    val queryString: String?,
    /** Response status code. `0` for the few cases where Spring has
     *  not produced a real status (the interceptor never sees that
     *  in practice, but the field stays defensive). */
    val status: Int,
    /** `User-Agent` header value or `null` when the client did not send one. */
    val userAgent: String?,
    /** Value of the `X-Lasttest-Run-Id` header or `null` when the
     *  request was not driven by a known k6 run. The dashboard uses
     *  this to filter the stream to a single run. */
    val runId: String?,
) {
    companion object {
        /**
         * Builds an entry for the current instant. Centralised so the
         * timestamp format stays a single source of truth.
         */
        fun now(
            method: String,
            path: String,
            queryString: String?,
            status: Int,
            userAgent: String?,
            runId: String?,
        ): DemoRequestLogEntry =
            DemoRequestLogEntry(
                timestamp = Instant.now().toString(),
                method = method,
                path = path,
                queryString = queryString,
                status = status,
                userAgent = userAgent,
                runId = runId,
            )
    }
}

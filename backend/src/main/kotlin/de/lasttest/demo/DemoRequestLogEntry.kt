package de.lasttest.demo

import java.time.Instant

data class DemoRequestLogEntry(
    val timestamp: String,
    val method: String,
    val path: String,
    val queryString: String?,
    val status: Int,
    val userAgent: String?,
    val runId: String?,
) {
    companion object {
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

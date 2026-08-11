package de.lasttest.api

import de.lasttest.demo.DemoControllerToggle
import de.lasttest.demo.DemoRequestLog
import de.lasttest.demo.DemoRequestLogEntry
import de.lasttest.demo.RingBufferDemoRequestLog
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController

@RestController
@RequestMapping("/api/demo-traffic")
internal class DemoTrafficController(
    private val demoRequestLog: DemoRequestLog,
    private val demoControllerToggle: DemoControllerToggle,
) {
    @GetMapping("/status")
    fun status(): DemoStatusResponse = DemoStatusResponse(enabled = demoControllerToggle.isEnabled())

    @PostMapping("/enabled")
    fun setEnabled(
        @RequestBody body: DemoEnabledRequest,
    ): DemoStatusResponse {
        if (body.enabled) {
            demoControllerToggle.enable()
        } else {
            demoControllerToggle.disable()
        }
        return DemoStatusResponse(enabled = demoControllerToggle.isEnabled())
    }

    @GetMapping("/requests")
    fun requests(
        @RequestParam(name = "runId", required = false) runId: String?,
        @RequestParam(name = "limit", required = false) limit: Int?,
    ): DemoTrafficResponse {
        val effectiveLimit = clampLimit(limit)
        val entries =
            demoRequestLog.snapshot(
                runId = runId?.trim()?.takeIf { it.isNotEmpty() },
                limit = effectiveLimit,
            )
        return DemoTrafficResponse(
            runId = runId,
            limit = effectiveLimit,
            count = entries.size,
            entries = entries.map(::toResponse),
        )
    }

    @DeleteMapping("/requests")
    fun clearRequests(): DemoTrafficResponse {
        demoRequestLog.clear()
        return EMPTY_TRAFFIC
    }

    private fun clampLimit(limit: Int?): Int {
        if (limit == null) return DEFAULT_LIMIT
        if (limit <= 0) return DEFAULT_LIMIT
        return limit.coerceAtMost(RingBufferDemoRequestLog.MAX_ENTRIES)
    }

    private fun toResponse(entry: DemoRequestLogEntry): DemoTrafficEntryResponse =
        DemoTrafficEntryResponse(
            timestamp = entry.timestamp,
            method = entry.method,
            path = entry.path,
            queryString = entry.queryString,
            status = entry.status,
            userAgent = entry.userAgent,
            runId = entry.runId,
        )

    private companion object {
        const val DEFAULT_LIMIT: Int = 500

        val EMPTY_TRAFFIC: DemoTrafficResponse =
            DemoTrafficResponse(
                runId = null,
                limit = DEFAULT_LIMIT,
                count = 0,
                entries = emptyList(),
            )
    }
}

data class DemoTrafficResponse(
    val runId: String?,
    val limit: Int,
    val count: Int,
    val entries: List<DemoTrafficEntryResponse>,
)

data class DemoTrafficEntryResponse(
    val timestamp: String,
    val method: String,
    val path: String,
    val queryString: String?,
    val status: Int,
    val userAgent: String?,
    val runId: String?,
)

data class DemoStatusResponse(
    val enabled: Boolean,
)

data class DemoEnabledRequest(
    val enabled: Boolean,
)

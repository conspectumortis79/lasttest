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

/**
 * Exposes the most recent demo-API requests as JSON so the bundled
 * dashboard (`?demo-traffic=<runId>`) can confirm that a k6 run is
 * actually hitting the in-process demo. The endpoint is read-only;
 * the interceptor populates the storage, this controller only reads
 * snapshots.
 *
 * Query parameters:
 *  - `runId` (optional) — when set, only entries with that run id
 *    are returned. When omitted, the latest entries across all
 *    runs are returned. Unknown run ids yield an empty list, not
 *    a 404 — the dashboard polls while the run is in-flight and
 *    the id is always valid in that context.
 *  - `limit` (optional, default [DEFAULT_LIMIT]) — maximum number
 *    of entries to return. Values larger than the buffer capacity
 *    are clamped silently. Values ≤ 0 fall back to the default so
 *    a malformed query never breaks the UI.
 *
 * SOLID notes:
 *  - S — thin HTTP layer. The translation request → snapshot
 *    happens in the storage; the controller only validates inputs
 *    and serialises the response.
 *  - D — depends on [DemoRequestLog]. The in-memory ring buffer is
 *    the default wiring but is not a hardcoded dependency.
 */
@RestController
@RequestMapping("/api/demo-traffic")
internal class DemoTrafficController(
    private val demoRequestLog: DemoRequestLog,
    private val demoControllerToggle: DemoControllerToggle,
) {
    /**
     * Reports whether the bundled demo API is currently enabled.
     * The frontend reads this on mount to decide whether to show
     * the "Demo-API" toolbar entry, the "active" badge next to
     * it, and whether the traffic dashboard should render an
     * empty state or a "demo is off" banner. The endpoint is
     * cheap (single volatile read) so the frontend may poll it
     * freely.
     */
    @GetMapping("/status")
    fun status(): DemoStatusResponse = DemoStatusResponse(enabled = demoControllerToggle.isEnabled())

    /**
     * Flips the demo on or off. The frontend calls this when the
     * user toggles the "Demo API" switch in the Settings drawer.
     * Returns the new state so the frontend does not have to
     * issue a follow-up `GET /status` round-trip.
     *
     * The toggle is a process-wide switch; there is no per-user
     * state. Two browsers opening the same backend would share
     * the same toggle — acceptable for lasttest's single-user
     * design.
     */
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

    /**
     * Drops every captured entry so the dashboard can be reset to
     * a pristine "as if the demo API was never started" state.
     * Both the in-memory ring buffer and the H2 persistent copy
     * are cleared; the response mirrors the [EMPTY_TRAFFIC]
     * sentinel so the client can replace its local state without
     * a follow-up `GET /requests` round-trip.
     *
     * The endpoint is a single-process call; there is no per-user
     * state. Two browsers sharing the same backend would also
     * share the reset — acceptable for lasttest's single-user
     * design, same as the demo toggle.
     */
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

        // Wire-format envelope returned by `DELETE /requests` so the
        // dashboard can replace its local state without a follow-up
        // `GET /requests`. Matches the empty state the server would
        // emit on a freshly booted instance.
        val EMPTY_TRAFFIC: DemoTrafficResponse =
            DemoTrafficResponse(
                runId = null,
                limit = DEFAULT_LIMIT,
                count = 0,
                entries = emptyList(),
            )
    }
}

/**
 * Wire-format wrapper for the demo traffic endpoint. The shape
 * carries the `runId` filter and the `limit` that was actually
 * applied (post-clamp) so the dashboard can show "showing 500 of
 * 500" without an extra round-trip.
 */
data class DemoTrafficResponse(
    val runId: String?,
    val limit: Int,
    val count: Int,
    val entries: List<DemoTrafficEntryResponse>,
)

/**
 * Wire-format DTO for a single request entry. Mirrors
 * [DemoRequestLogEntry] field-for-field so the frontend can adopt
 * a stricter shape later without a server change.
 */
data class DemoTrafficEntryResponse(
    val timestamp: String,
    val method: String,
    val path: String,
    val queryString: String?,
    val status: Int,
    val userAgent: String?,
    val runId: String?,
)

/**
 * Wire-format DTO for `GET /api/demo-traffic/status`. The shape
 * is a single `enabled` flag so the frontend does not have to
 * inspect a more complex envelope.
 */
data class DemoStatusResponse(
    val enabled: Boolean,
)

/**
 * Request body for `POST /api/demo-traffic/enabled`. Kept as a
 * dedicated DTO (rather than reading the boolean straight off
 * the [RequestBody]) so future fields (e.g. an "remember this
 * choice" persistence flag) can be added without breaking the
 * wire format.
 */
data class DemoEnabledRequest(
    val enabled: Boolean,
)

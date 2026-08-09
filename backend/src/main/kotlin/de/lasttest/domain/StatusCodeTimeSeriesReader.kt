package de.lasttest.domain

/**
 * Reads status-code time series from the store. The interface
 * is intentionally tiny because the dashboard contract is
 * small: per-code, per-second cumulative counts. The H2-backed
 * implementation in [H2StatusCodeTimeSeriesReader] is the
 * primary; the store can be swapped (e.g. an InfluxDB-backed
 * fall-back) without touching the controller.
 */
interface StatusCodeTimeSeriesReader {
    /**
     * Returns every status-code sample the store has for the
     * run, ordered by `epoch_second` then by `code`. The
     * returned list is empty when the run either has no
     * startedAt stamp yet, or has not produced a single
     * per-second stamp yet (e.g. the run is still queued).
     *
     * The endpoint is `200 OK` even for the empty case so the
     * dashboard can poll the same URL throughout the run's
     * lifetime without 404 surprises.
     */
    fun readStatusCodesOverTime(runId: String): List<StatusCodeTimeSeriesPoint>
}

/**
 * One sample of the per-second status-code timeline. `count` is
 * the cumulative total at this second — the k6 script always
 * emits the counter's `.count` (not the delta), so the field
 * is monotonically non-decreasing for a given (runId, code).
 * The dashboard's `accumulate` transform in the frontend is a
 * no-op against this data, but the field shape is kept
 * conservative so future readers that emit deltas can plug in
 * without changing the wire contract.
 */
data class StatusCodeTimeSeriesPoint(
    val epochSecond: Long,
    val code: String,
    val count: Long,
)

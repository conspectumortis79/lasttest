package de.lasttest.api

/**
 * Time-series response for the ramp chart in the report. Returned by
 * the `GET /api/test-runs/{id}/time-series` endpoint; contains the
 * actual measured values from InfluxDB that the SVG renderer draws
 * in addition to the target line derived from the stages.
 *
 * `vus` and `requestsPerSecond` are separate arrays so that the
 * renderer can show and hide them independently. Empty arrays are
 * allowed and mean "InfluxDB unreachable or no data yet" — the UI
 * handles this transparently by showing only the target line.
 */
data class TimeSeriesResponse(
    val runId: String,
    val resolutionSeconds: Int,
    val vus: List<TimeSeriesPoint>,
    val requestsPerSecond: List<TimeSeriesPoint>,
)

data class TimeSeriesPoint(
    /** ISO-8601 timestamp (e.g. "2026-08-04T16:51:22Z"). */
    val time: String,
    /** Measured value at that time (VUs as integer, RPS as float). */
    val value: Number,
)

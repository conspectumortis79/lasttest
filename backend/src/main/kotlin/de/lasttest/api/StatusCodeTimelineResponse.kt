package de.lasttest.api

/**
 * Status-code timeline response. Returned by the
 * `GET /api/test-runs/{id}/status-code-timeline` endpoint; the
 * dashboard reads this to render the cumulative sparkline list
 * below the live ramp chart on the Übersicht tab.
 *
 * The list is sparse — codes that never fired are absent — so
 * the dashboard can apply the `accumulate` transform (sort by
 * count, drop the ones that never produced a sample) without
 * a second round-trip. The endpoint is `200 OK` even when the
 * run is still in QUEUED state and the table is empty: the
 * dashboard polls the same URL throughout the run's lifetime
 * and we don't want a 404 to mean "the run vanished".
 *
 * Field semantics:
 *   * `epochSecond` is the run-relative second (0 = run start),
 *     not the wall-clock second. The backend translates the
 *     k6 stdout's wall-clock stamp into a run-relative value
 *     via `run.startedAt` so the dashboard's x-axis aligns
 *     with the ramp chart's x-axis without an extra join.
 *   * `count` is the cumulative total at this second. The k6
 *     script always emits the counter's running total, so the
 *     field is monotonically non-decreasing for a given
 *     (runId, code) pair.
 */
data class StatusCodeTimelineResponse(
    val runId: String,
    val resolutionSeconds: Int,
    val samples: List<StatusCodeTimelinePoint>,
)

data class StatusCodeTimelinePoint(
    val epochSecond: Long,
    val code: String,
    val count: Long,
)

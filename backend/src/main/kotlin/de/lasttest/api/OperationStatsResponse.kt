package de.lasttest.api

/**
 * Public DTO returned by `GET /api/operations/stats`. The dashboard
 * renders one of these as the "× N" badge next to each operation
 * card in the left list. The endpoint rows are ordered by
 * `testCount` descending so the most-exercised endpoints show up
 * at the top of the response.
 *
 * `lastStatus` is the status of the most recent run for this
 * endpoint, so the UI can colour the badge dot to match. `isNew`
 * is a derived flag (`testCount == 0`) so the frontend does not
 * have to special-case the empty-counter case.
 */
data class OperationStatsResponse(
    val method: String,
    val path: String,
    val testCount: Long,
    val lastStatus: TestRunStatus,
    val lastTestAt: String,
    val lastRunId: String,
)

/**
 * Public DTO returned by `GET /api/test-runs/{id}/report-link`. The
 * dashboard renders a button next to "Im neuen Tab öffnen" that
 * points at this URL; the button is hidden on the dashboard itself
 * (the report link duplicates the same tab the user is already on)
 * and shown on the multi-run list view where the user has to switch
 * contexts to see the details.
 */
data class ReportLinkResponse(
    val runId: String,
    val url: String,
    val isComplete: Boolean,
)

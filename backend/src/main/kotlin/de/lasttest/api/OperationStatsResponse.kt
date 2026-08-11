package de.lasttest.api

data class OperationStatsResponse(
    val method: String,
    val path: String,
    val testCount: Long,
    val lastStatus: TestRunStatus,
    val lastTestAt: String,
    val lastRunId: String,
)

data class ReportLinkResponse(
    val runId: String,
    val url: String,
    val isComplete: Boolean,
)

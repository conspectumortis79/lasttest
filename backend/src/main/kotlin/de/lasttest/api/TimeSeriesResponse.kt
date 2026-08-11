package de.lasttest.api

data class TimeSeriesResponse(
    val runId: String,
    val resolutionSeconds: Int,
    val vus: List<TimeSeriesPoint>,
    val requestsPerSecond: List<TimeSeriesPoint>,
)

data class TimeSeriesPoint(
    val time: String,
    val value: Number,
)

package de.lasttest.domain

import org.springframework.context.annotation.Primary
import org.springframework.stereotype.Service

/**
 * H2-backed implementation of [TimeSeriesReader].
 *
 * Reads the ramp-chart data from the `time_series_sample` table that
 * [LocalK6TestRunService] writes to as a run progresses. This is the
 * primary reader; the InfluxDB-backed reader remains available as a
 * fallback for legacy runs whose data lives in InfluxDB rather than
 * the H2 store. The two are wired by the controller (see
 * [de.lasttest.api.LastTestController.timeSeries]).
 *
 * Why H2 instead of InfluxDB?
 *   - The ramp chart is part of the report; reports must survive
 *     container restarts. InfluxDB is a sidecar that the user may
 *     not have running.
 *   - The "× N" statistics and the run list already live in H2; the
 *     time series is the last piece of the load-test record that
 *     depended on a second store.
 *   - The sample volume per run is small (a few hundred points at
 *     most) so the extra storage cost is negligible.
 */
@Service
@Primary
class H2TimeSeriesReader(
    private val repository: TimeSeriesRepository,
) : TimeSeriesReader {
    override fun readVusOverTime(
        runId: String,
        startedAt: String,
        finishedAt: String,
    ): List<TimeSeriesPoint> =
        repository.findByRunIdOrderByTimestampAsc(runId).map { sample ->
            // The ramp chart wants one entry per second; we feed it
            // both the planned and the actual VU count and let the
            // renderer pick the right line.
            TimeSeriesPoint(
                time = java.time.Instant.ofEpochSecond(sample.timestamp).toString(),
                value = sample.actualVus,
            )
        }

    override fun readRequestsPerSecond(
        runId: String,
        startedAt: String,
        finishedAt: String,
    ): List<TimeSeriesPoint> =
        // The H2 row stores the actual RPS directly; the ramp
        // chart in the report uses the same `TimeSeriesPoint`
        // shape regardless of which measurement it is reading.
        repository.findByRunIdOrderByTimestampAsc(runId).map { sample ->
            TimeSeriesPoint(
                time = java.time.Instant.ofEpochSecond(sample.timestamp).toString(),
                value = sample.actualRps,
            )
        }
}

/**
 * Persists a single (planned, actual) sample of the ramp chart for
 * the given run. Called by [LocalK6TestRunService] during the run
 * lifecycle; the read path in [H2TimeSeriesReader] then serves the
 * data to the report view.
 */
@Service
class TimeSeriesWriter(
    private val repository: TimeSeriesRepository,
) {
    fun record(
        runId: String,
        timestampSeconds: Long,
        plannedVus: Double,
        actualVus: Double,
        actualRps: Double,
    ) {
        // UPSERT on (run_id, timestamp): the seed step writes a
        // planned-only row per second, the live reader then
        // updates that row's actualVus / actualRps as k6 reports
        // them. Without the upsert we'd accumulate one row per
        // second *and* one row per k6 status line, which would
        // double-plot the chart.
        val existing = repository.findByRunIdOrderByTimestampAsc(runId)
            .firstOrNull { it.timestamp == timestampSeconds }
        val sample = existing ?: TimeSeriesEntity().apply {
            this.runId = runId
            this.timestamp = timestampSeconds
        }
        sample.plannedVus = plannedVus
        sample.actualVus = actualVus
        sample.actualRps = actualRps
        repository.save(sample)
    }
}

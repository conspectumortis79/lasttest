package de.lasttest.domain

import org.springframework.context.annotation.Primary
import org.springframework.stereotype.Service

/**
 * H2-backed implementation of [StatusCodeTimeSeriesReader].
 *
 * Reads the per-second status-code time series from the
 * `status_code_time_series` table that
 * [StatusCodeTimeSeriesWriter] writes to. The table is the
 * primary source for the dashboard's "Status-Codes über Zeit"
 * sparkline list; the k6 summary remains the fall-back for
 * runs that completed before this feature shipped.
 *
 * Why H2 instead of InfluxDB?
 *   - Coupling with the existing time-series infrastructure:
 *     the same H2 instance already holds the ramp-chart
 *     samples, so the dashboard readers don't need a second
 *     store to render the two timelines side-by-side.
 *   - Per-run sample count is small (a few dozen status codes
 *     * a few seconds of runtime = a few hundred rows at most),
 *     so the storage cost is negligible.
 *   - Schema is portable: the table is created by Hibernate
 *     on application start, shippable with no external
 *     dependency.
 */
@Service
@Primary
class H2StatusCodeTimeSeriesReader(
    private val repository: StatusCodeTimeSeriesRepository,
) : StatusCodeTimeSeriesReader {
    override fun readStatusCodesOverTime(runId: String): List<StatusCodeTimeSeriesPoint> =
        repository.findByRunIdOrderByEpochSecondAscCodeAsc(runId).map { row ->
            StatusCodeTimeSeriesPoint(
                epochSecond = row.epochSecond,
                code = row.code,
                count = row.count,
            )
        }
}

/**
 * Persists a single per-second status-code sample. Called from
 * the k6 stdout reader task in [LocalK6TestRunService] every
 * time the script emits a `STAMP:<second>|{...}` line.
 *
 * Upserts on `(runId, epochSecond, code)`: the same stamp may
 * arrive twice (k6 re-emits the line on the iteration that
 * crosses the second boundary, so the live reader can see it
 * at least once per VU). Without the upsert we'd accumulate one
 * row per stamp emission, and the dashboard chart would
 * double-plot the same point.
 */
@Service
class StatusCodeTimeSeriesWriter(
    private val repository: StatusCodeTimeSeriesRepository,
) {
    fun record(
        runId: String,
        epochSecond: Long,
        code: String,
        count: Long,
    ) {
        val existing = repository
            .findByRunIdOrderByEpochSecondAscCodeAsc(runId)
            .firstOrNull { it.epochSecond == epochSecond && it.code == code }
        val sample = existing ?: StatusCodeTimeSeriesEntity().apply {
            this.runId = runId
            this.epochSecond = epochSecond
            this.code = code
        }
        // The k6 script emits ONE stamp per VU per wall-clock
        // second. Each stamp carries the VU's local cumulative
        // count (the JS-side `__lt_status_counts` mirror of the
        // k6 Counter — see [DefaultK6ScriptGenerator]. The
        // backend Sums the incoming counters across all VUs
        // instead of overwriting, so the stored row represents
        // the total across every VU on this run. The race
        // window is small (one VU's stamp + the read-modify-write
        // here) but in practice the row is rarely written by
        // more than one VU at the same second because the k6
        // iteration cycle is roughly 1 s per VU.
        sample.count = ((existing?.count ?: 0L) + count)
        repository.save(sample)
    }
}

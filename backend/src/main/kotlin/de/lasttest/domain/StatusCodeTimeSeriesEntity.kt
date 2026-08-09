package de.lasttest.domain

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.GeneratedValue
import jakarta.persistence.GenerationType
import jakarta.persistence.Id
import jakarta.persistence.Index
import jakarta.persistence.Table

/**
 * One sample of the per-second status-code counts for a single
 * k6 run. The dashboard's "Status-Codes über Zeit" sparkline
 * list reads this table to render the cumulative status-code
 * curve in real time, instead of waiting for the k6 summary at
 * the end of the run.
 *
 * Storage shape: one row per (run_id, second, code) tuple. The
 * k6 script's `__lt_status_stamp` helper emits a JSON line every
 * second; the backend parses it and writes one row per code per
 * second, so the table is sparse (codes that never fired do not
 * appear). The reader rolls the rows up into a per-code time
 * series in `StatusCodeTimeSeriesReader`.
 *
 * The compound index on `(run_id, epoch_second)` is the only one
 * that matters: the dashboard chart fetches the whole timeline
 * in a single `WHERE run_id = ? ORDER BY epoch_second, code`
 * query.
 *
 * Historical data: runs that completed before this feature
 * shipped have no rows in this table. The dashboard falls back
 * to the k6 summary's per-operation counts (uniformly
 * distributed across the run duration) so old runs still
 * render a sparkline — just not a *real* one.
 */
@Entity
@Table(
    name = "status_code_time_series",
    indexes = [
        Index(name = "idx_status_code_run_ts", columnList = "run_id,epoch_second"),
    ],
)
class StatusCodeTimeSeriesEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "id", nullable = false)
    var id: Long? = null

    @Column(name = "run_id", length = 36, nullable = false)
    lateinit var runId: String

    /**
     * Run-relative second of the sample. The k6 script stamps
     * with `Math.floor(Date.now() / 1000)` (the wall-clock
     * second), and the backend subtracts the run's startedAt
     * epoch to get the run-relative coordinate. Storing the
     * run-relative value (not the wall-clock value) keeps the
     * table portable across runs that started at different
     * times and lets the dashboard connect the sparkline's
     * x-axis to the ramp chart's x-axis without an extra join.
     */
    @Column(name = "epoch_second", nullable = false)
    var epochSecond: Long = 0

    /**
     * HTTP status code as a string. "200", "404", "429" for
     * numeric codes; "err" for network errors (status === 0);
     * "other" for codes outside the pre-declared list. The
     * string form keeps the column heterogeneous-friendly in
     * case k6 starts using alphanumeric codes in the future.
     */
    @Column(name = "code", length = 16, nullable = false)
    lateinit var code: String

    /**
     * Cumulative count of this code at this second. The k6
     * script always emits the counter's `.count` value (the
     * running total since the run started), so the column is
     * strictly monotonically non-decreasing for a given
     * (run_id, code). The dashboard applies the `accumulate`
     * transform in the frontend so the JSON endpoint can stay
     * monotonic-by-design — that way the JS sparkline is just a
     * straight read with no deduplication or sorting.
     */
    @Column(name = "count", nullable = false)
    var count: Long = 0
}

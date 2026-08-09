package de.lasttest.domain

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.GeneratedValue
import jakarta.persistence.GenerationType
import jakarta.persistence.Id
import jakarta.persistence.Index
import jakarta.persistence.Table

/**
 * One sample of the ramp-chart time series for a single k6 run.
 *
 * The "Auslastung (Soll vs Ist)" chart in the report plots planned
 * VUs against the actual VUs k6 reported at the same wall-clock
 * instant. Each run therefore produces a stream of samples, all
 * keyed by the [runId] of the run that emitted them. The chart
 * fetches the samples in a single `WHERE run_id = ? ORDER BY
 * timestamp` query, so the index on `(run_id, timestamp)` is the
 * only one that matters.
 *
 * The H2 database is the *primary* storage; the InfluxDB writer
 * still receives the same samples as a side-effect so existing
 * Grafana dashboards keep working. See [InfluxDbTimeSeriesReader]
 * for the dual-write implementation.
 */
@Entity
@Table(
    name = "time_series_sample",
    indexes = [
        Index(name = "idx_time_series_run_ts", columnList = "run_id,timestamp"),
    ],
)
class TimeSeriesEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "id", nullable = false)
    var id: Long? = null

    @Column(name = "run_id", length = 36, nullable = false)
    lateinit var runId: String

    /** Wall-clock instant when the sample was emitted by k6. */
    @Column(name = "timestamp", nullable = false)
    var timestamp: Long = 0

    /**
     * Planned VUs at this instant (read from the load profile).
     * Stored as a double so the ramp-step interpolation is
     * straightforward.
     */
    @Column(name = "planned_vus", nullable = false)
    var plannedVus: Double = 0.0

    /** Actual VUs reported by k6's `vus` metric. */
    @Column(name = "actual_vus", nullable = false)
    var actualVus: Double = 0.0

    /**
     * Throughput at this instant. `Double.NaN` for the planned
     * line — the load profile does not know the throughput, only
     * the VU count.
     */
    @Column(name = "actual_rps", nullable = false)
    var actualRps: Double = 0.0
}

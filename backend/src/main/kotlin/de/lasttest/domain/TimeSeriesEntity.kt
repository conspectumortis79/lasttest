package de.lasttest.domain

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.GeneratedValue
import jakarta.persistence.GenerationType
import jakarta.persistence.Id
import jakarta.persistence.Index
import jakarta.persistence.Table

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

    @Column(name = "timestamp", nullable = false)
    var timestamp: Long = 0

    @Column(name = "planned_vus", nullable = false)
    var plannedVus: Double = 0.0

    @Column(name = "actual_vus", nullable = false)
    var actualVus: Double = 0.0

    @Column(name = "actual_rps", nullable = false)
    var actualRps: Double = 0.0
}

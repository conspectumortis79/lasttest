package de.lasttest.domain

import de.lasttest.api.TestRunStatus
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.EnumType
import jakarta.persistence.Enumerated
import jakarta.persistence.Id
import jakarta.persistence.IdClass
import jakarta.persistence.Index
import jakarta.persistence.Table
import java.io.Serializable
import java.time.Instant

/**
 * Materialised "× N" counter for a single (method, path) pair — the
 * number the dashboard shows next to each endpoint in the operation
 * list, together with the most recent test time and the most recent
 * status.
 *
 * The cleanest source of truth is `SELECT method, path, COUNT(*) FROM
 * test_run GROUP BY method, path`, but that query is hot (the list
 * panel re-renders it on every poll) and the row count grows over
 * time. This entity therefore plays the role of a denormalised
 * counter that the service updates on every run transition.
 */
@Entity
@Table(
    name = "operation_statistics",
    indexes = [
        Index(name = "idx_op_stats_method_path", columnList = "operation_method,operation_path"),
    ],
)
@IdClass(OperationStatisticsEntity.Key::class)
class OperationStatisticsEntity {
    @Id
    @Column(name = "operation_method", length = 10, nullable = false)
    lateinit var method: String

    @Id
    @Column(name = "operation_path", length = 512, nullable = false)
    lateinit var path: String

    /** Total number of runs that targeted this endpoint, ever. */
    @Column(name = "test_count", nullable = false)
    var testCount: Long = 0

    /** Timestamp of the most recent run for this endpoint. */
    @Column(name = "last_test_at", nullable = false)
    lateinit var lastTestAt: Instant

    /** Status of the most recent run (so the badge can show a coloured dot). */
    @Enumerated(EnumType.STRING)
    @Column(name = "last_status", length = 16, nullable = false)
    lateinit var lastStatus: TestRunStatus

    /** Run-ID of the most recent run; lets the UI jump to its detail view. */
    @Column(name = "last_run_id", length = 36, nullable = false)
    lateinit var lastRunId: String

    /** Composite primary key so we can `findById(Key(method, path))`. */
    data class Key(
        var method: String = "",
        var path: String = "",
    ) : Serializable
}

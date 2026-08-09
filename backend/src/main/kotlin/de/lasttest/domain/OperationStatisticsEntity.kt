package de.lasttest.domain

import de.lasttest.api.TestRun
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

/**
 * Builds the denormalised [OperationStatisticsEntity] row for a
 * single (method, path) pair from the [TestRun] that just
 * terminated. The [TestRunService] upserts this row on every
 * terminal state transition so the dashboard's × N badge stays in
 * sync with the actual run count.
 *
 * Increments the previous counter by one rather than recomputing
 * the count from `test_run`: a full COUNT(*) would have to scan
 * the whole table on every run, which is fine for the current
 * H2 file mode but would not scale. The entity's
 * [OperationStatisticsEntity.testCount] is the source of truth
 * for the counter, not a projection of [TestRunEntity].
 *
 * The [previous] parameter lets the caller pass the row that
 * already exists (looked up via
 * `OperationStatisticsRepository.findById(Key(method, path))`);
 * pass `null` for the first run on a fresh endpoint. Tests that
 * want to assert the upsert behaviour drive both branches.
 */
fun operationStatisticsFor(
    run: TestRun,
    previous: OperationStatisticsEntity?,
): OperationStatisticsEntity {
    val firstOp =
        run.configuration?.operations?.firstOrNull()
            ?: error("Cannot build operation statistics for run ${run.id}: no operations in configuration")
    val entity = previous ?: OperationStatisticsEntity()
    entity.method = firstOp.method
    entity.path = firstOp.path
    entity.testCount = (previous?.testCount ?: 0L) + 1L
    entity.lastTestAt =
        run.finishedAt?.let { java.time.Instant.parse(it) }
            ?: run.startedAt?.let { java.time.Instant.parse(it) }
            ?: java.time.Instant.parse(run.createdAt)
    entity.lastStatus = run.status
    entity.lastRunId = run.id
    return entity
}

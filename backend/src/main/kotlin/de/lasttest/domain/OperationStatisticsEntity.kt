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

    @Column(name = "test_count", nullable = false)
    var testCount: Long = 0

    @Column(name = "last_test_at", nullable = false)
    lateinit var lastTestAt: Instant

    @Enumerated(EnumType.STRING)
    @Column(name = "last_status", length = 16, nullable = false)
    lateinit var lastStatus: TestRunStatus

    @Column(name = "last_run_id", length = 36, nullable = false)
    lateinit var lastRunId: String

    data class Key(
        var method: String = "",
        var path: String = "",
    ) : Serializable
}

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

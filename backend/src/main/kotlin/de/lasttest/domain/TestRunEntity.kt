package de.lasttest.domain

import de.lasttest.api.TestRunStatus
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.EnumType
import jakarta.persistence.Enumerated
import jakarta.persistence.Id
import jakarta.persistence.Index
import jakarta.persistence.Lob
import jakarta.persistence.Table
import java.time.Instant

@Entity
@Table(
    name = "test_run",
    indexes = [
        Index(name = "idx_test_run_created_at", columnList = "created_at"),
        Index(name = "idx_test_run_endpoint", columnList = "operation_method,operation_path"),
    ],
)
class TestRunEntity {
    @Id
    @Column(name = "id", length = 36, nullable = false)
    lateinit var id: String

    @Enumerated(EnumType.STRING)
    @Column(name = "status", length = 16, nullable = false)
    lateinit var status: TestRunStatus

    @Column(name = "created_at", nullable = false)
    lateinit var createdAt: Instant

    @Column(name = "started_at")
    var startedAt: Instant? = null

    @Column(name = "finished_at")
    var finishedAt: Instant? = null

    @Column(name = "exit_code")
    var exitCode: Int? = null

    @Lob
    @Column(name = "configuration_json")
    var configurationJson: String? = null

    @Lob
    @Column(name = "summary_json")
    var summaryJson: String? = null

    @Lob
    @Column(name = "console_output", columnDefinition = "CLOB")
    var consoleOutput: String? = null

    @Lob
    @Column(name = "error", columnDefinition = "CLOB")
    var error: String? = null

    @Column(name = "cancelled_at")
    var cancelledAt: Instant? = null

    @Column(name = "cancelled_by_force")
    var cancelledByForce: Boolean? = null

    @Lob
    @Column(name = "original_request_json")
    var originalRequestJson: String? = null

    @Column(name = "operation_method", length = 10)
    var operationMethod: String? = null

    @Column(name = "operation_path", length = 512)
    var operationPath: String? = null

    @Column(name = "operation_id", length = 128)
    var operationId: String? = null
}

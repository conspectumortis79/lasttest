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

/**
 * Persistent representation of a single k6 load-test run.
 *
 * The original API contract uses an immutable [de.lasttest.api.TestRun]
 * data class (cheap to copy, easy to JSON-serialise) that the service
 * keeps in a `ConcurrentHashMap` while k6 is running. That works while
 * the JVM is alive, but loses every run on restart. This entity is the
 * JPA-backed equivalent: status transitions are written through a
 * `save()` call on the repository, and `list()`/`find()` read straight
 * from the database so a new container picks up where the old one left
 * off.
 *
 * Why not just persist the [de.lasttest.api.TestRun] data class
 * directly? Because that data class is also the wire format returned
 * to the frontend, and changing its shape would break the dashboard.
 * The entity is internal — the controller still maps
 * `TestRunEntity → TestRun` before responding.
 */
@Entity
@Table(
    name = "test_run",
    indexes = [
        // The dashboard lists runs newest-first; created_at is the
        // sort key for that query.
        Index(name = "idx_test_run_created_at", columnList = "created_at"),
        // The per-endpoint "× N" badge is implemented as a derived
        // GROUP BY on (method, path), so the columns below get
        // their own index.
        Index(name = "idx_test_run_endpoint", columnList = "operation_method,operation_path"),
    ],
)
class TestRunEntity {
    @Id
    @Column(name = "id", length = 36, nullable = false)
    lateinit var id: String

    /**
     * Lifecycle status. We store it as the enum name (STRING) instead
     * of the ordinal so that inserting a new status between two
     * existing ones does not shift the meaning of historical rows.
     */
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

    /**
     * JSON serialised [de.lasttest.api.TestRunConfiguration]. Keeping
     * the configuration as a single LOB column avoids an N+1 join
     * (one row per test run) and matches the wire format the
     * dashboard already understands.
     */
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

    // ---- Denormalised columns for the × N badge ---------------------
    // The first operation in the run's configuration is the "primary"
    // endpoint the user is interested in. Storing it as flat columns
    // lets the GROUP BY in [OperationStatisticsRepository] answer
    // "how many runs of GET /api/orders today?" without having to
    // parse the JSON configuration on every query. The configuration
    // stays the source of truth — these columns are a cache.
    @Column(name = "operation_method", length = 10)
    var operationMethod: String? = null

    @Column(name = "operation_path", length = 512)
    var operationPath: String? = null

    @Column(name = "operation_id", length = 128)
    var operationId: String? = null
}

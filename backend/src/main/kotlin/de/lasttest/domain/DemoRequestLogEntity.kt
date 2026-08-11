package de.lasttest.domain

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.GeneratedValue
import jakarta.persistence.GenerationType
import jakarta.persistence.Id
import jakarta.persistence.Index
import jakarta.persistence.Table
import java.time.Instant

@Entity
@Table(
    name = "demo_request_log",
    indexes = [
        Index(name = "idx_demo_log_ts", columnList = "timestamp"),
        Index(name = "idx_demo_log_run", columnList = "run_id"),
    ],
)
class DemoRequestLogEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "id", nullable = false)
    var id: Long? = null

    @Column(name = "timestamp", nullable = false)
    lateinit var timestamp: Instant

    @Column(name = "method", length = 10, nullable = false)
    lateinit var method: String

    @Column(name = "path", length = 512, nullable = false)
    lateinit var path: String

    @Column(name = "status_code", nullable = false)
    var statusCode: Int = 0

    @Column(name = "latency_ms", nullable = false)
    var latencyMs: Long = 0

    @Column(name = "run_id", length = 36)
    var runId: String? = null
}

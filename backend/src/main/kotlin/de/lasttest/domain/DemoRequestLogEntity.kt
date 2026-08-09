package de.lasttest.domain

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.GeneratedValue
import jakarta.persistence.GenerationType
import jakarta.persistence.Id
import jakarta.persistence.Index
import jakarta.persistence.Table
import java.time.Instant

/**
 * Persistent record of a single request the bundled demo API served.
 * Backs the "Demo-Traffic" page (which is the live activity feed for
 * the demo when the user has the bundled API running) and the
 * `?demo-traffic=<runId>` overlay that filters the feed to one
 * specific load-test run.
 *
 * The original implementation kept the log in a fixed-size ring
 * buffer in memory (see [de.lasttest.demo.RingBufferDemoRequestLog])
 * so it disappeared on restart. The H2-backed entity keeps the
 * data across container restarts; the ring buffer still does the
 * in-memory cap for the live UI to avoid an unbounded query.
 *
 * A row is added for every request the demo API serves. The index
 * on `timestamp DESC` keeps the "newest first" query cheap, and the
 * index on `run_id` makes the per-run filter a single B-tree lookup.
 */
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

    /**
     * Optional reference to the load-test run that triggered this
     * request. `null` for organic traffic (i.e. the user opening
     * Swagger UI by hand). The H2 schema keeps it nullable so
     * organic traffic is stored as well, which is useful for
     * debugging "did anything hit this endpoint before the load
     * test started?".
     */
    @Column(name = "run_id", length = 36)
    var runId: String? = null
}

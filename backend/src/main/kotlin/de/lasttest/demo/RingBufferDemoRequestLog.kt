package de.lasttest.demo

import de.lasttest.domain.DemoRequestLogEntity
import de.lasttest.domain.DemoRequestLogRepository
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import java.util.ArrayDeque

/**
 * In-memory ring buffer that holds the most recent
 * [MAX_ENTRIES] demo requests, with a side-write to the H2
 * `demo_request_log` table for persistence across container
 * restarts. The deque acts as the ring: [ArrayDeque.addLast]
 * appends at the tail, [ArrayDeque.pollFirst] drops the head when
 * the buffer is full. Synchronisation lives on the instance
 * monitor so the interceptor (writer) and the controller (reader)
 * never see a half-applied state.
 *
 * The H2 write is a side effect: the live dashboard reads the
 * ring buffer because the query is on the hot path and the deque
 * can serve a "last N" snapshot in O(N). The H2 row is a write
 * behind so a container restart can still surface historical
 * entries via the new repository; the controller's `requests()`
 * method stays on the ring buffer for latency.
 *
 * Storage is intentionally bounded — the demo traffic is meant to
 * confirm "did the request arrive" for the last few seconds, not
 * to be a full audit log. The dashboard is happiest when it can
 * render a single page of fresh entries; older entries can be
 * re-driven by re-running the load test.
 *
 * SOLID notes:
 *  - S — the class owns exactly one responsibility: bounded
 *    in-memory storage with a persistent side-write. Path
 *    filtering and HTTP serialisation live elsewhere.
 *  - D — implements [DemoRequestLog]; the interceptor and
 *    controller depend on that interface, not on this class.
 *  - D — the persistence layer is injected via the constructor;
 *    tests can plug in a no-op repository if H2 is not available.
 */
@Service
internal class RingBufferDemoRequestLog(
    private val repository: DemoRequestLogRepository,
) : DemoRequestLog {
    private val log = LoggerFactory.getLogger(RingBufferDemoRequestLog::class.java)
    private val buffer = ArrayDeque<DemoRequestLogEntry>(MAX_ENTRIES)

    override fun record(entry: DemoRequestLogEntry) {
        synchronized(buffer) {
            if (buffer.size >= MAX_ENTRIES) {
                buffer.pollFirst()
            }
            buffer.addLast(entry)
        }
        // Persist in H2 so a container restart can show historical
        // traffic. The write is best-effort: a transient DB error
        // is logged and swallowed so the live dashboard never blocks
        // on a write failure. The in-memory entry is still
        // available for the current session.
        try {
            val entity =
                DemoRequestLogEntity().apply {
                    timestamp = java.time.Instant.parse(entry.timestamp)
                    method = entry.method
                    path = entry.path
                    statusCode = entry.status
                    latencyMs = 0L
                    runId = entry.runId
                }
            repository.save(entity)
        } catch (exception: Exception) {
            log.warn("DemoRequestLogEntity konnte nicht gespeichert werden: {}", exception.message)
        }
    }

    override fun snapshot(
        runId: String?,
        limit: Int,
    ): List<DemoRequestLogEntry> {
        require(limit > 0) { "limit muss > 0 sein." }
        val effectiveLimit = limit.coerceAtMost(MAX_ENTRIES)
        synchronized(buffer) {
            val filtered =
                if (runId == null) {
                    buffer.toList()
                } else {
                    buffer.filter { it.runId == runId }
                }
            // Newest first — the buffer is append-only, so reverse it.
            return filtered.asReversed().take(effectiveLimit)
        }
    }

    override fun clear() {
        synchronized(buffer) {
            buffer.clear()
        }
    }

    companion object {
        /** Maximum number of entries the buffer keeps. The dashboard
         *  default matches the buffer size so the same number is
         *  visible whether the caller asks for "everything" or for
         *  "the last 500". */
        const val MAX_ENTRIES = 500
    }
}

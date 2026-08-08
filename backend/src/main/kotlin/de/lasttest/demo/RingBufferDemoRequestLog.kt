package de.lasttest.demo

import org.springframework.stereotype.Service
import java.util.ArrayDeque

/**
 * In-memory ring buffer that holds the most recent
 * [MAX_ENTRIES] demo requests. The deque acts as the ring:
 * [ArrayDeque.addLast] appends at the tail, [ArrayDeque.pollFirst]
 * drops the head when the buffer is full. Synchronisation lives on
 * the instance monitor so the interceptor (writer) and the
 * controller (reader) never see a half-applied state.
 *
 * Storage is intentionally bounded — the demo traffic is meant to
 * confirm "did the request arrive" for the last few seconds, not
 * to be a full audit log. The dashboard is happiest when it can
 * render a single page of fresh entries; older entries can be
 * re-driven by re-running the load test.
 *
 * SOLID notes:
 *  - S — the class owns exactly one responsibility: bounded
 *    in-memory storage. Path filtering and HTTP serialisation live
 *    elsewhere.
 *  - D — implements [DemoRequestLog]; the interceptor and
 *    controller depend on that interface, not on this class.
 */
@Service
internal class RingBufferDemoRequestLog : DemoRequestLog {
    private val buffer = ArrayDeque<DemoRequestLogEntry>(MAX_ENTRIES)

    override fun record(entry: DemoRequestLogEntry) {
        synchronized(buffer) {
            if (buffer.size >= MAX_ENTRIES) {
                buffer.pollFirst()
            }
            buffer.addLast(entry)
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

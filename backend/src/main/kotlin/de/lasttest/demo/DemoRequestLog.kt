package de.lasttest.demo

/**
 * Storage contract for the demo-API request log. The interceptor
 * writes one [DemoRequestLogEntry] per request, the controller reads
 * a snapshot for the dashboard.
 *
 * Kept as an interface so the bundled in-memory implementation can be
 * swapped for a file-backed or InfluxDB-backed one without touching
 * the interceptor, the controller, or any consumer.
 *
 * SOLID notes:
 *  - S — the interface only knows about entries and snapshots.
 *  - D — [DemoRequestLogInterceptor] and [DemoTrafficController] both
 *    depend on this interface, not on the concrete ring buffer.
 *  - I — only three methods. `clear()` exists so tests and the
 *    dashboard can reset the stream deterministically; the
 *    controller never calls it.
 */
interface DemoRequestLog {
    /**
     * Appends a single entry. Implementations must be thread-safe —
     * the interceptor is called by any Spring MVC worker thread.
     */
    fun record(entry: DemoRequestLogEntry)

    /**
     * Returns the most recent entries, newest first. When [runId]
     * is non-null, only entries with that run id are returned.
     * [limit] is a positive integer; values larger than the buffer
     * capacity are clamped to the capacity. An empty buffer (or an
     * unknown run id) yields an empty list.
     */
    fun snapshot(
        runId: String?,
        limit: Int,
    ): List<DemoRequestLogEntry>

    /** Drops every stored entry. Intended for tests. */
    fun clear()
}

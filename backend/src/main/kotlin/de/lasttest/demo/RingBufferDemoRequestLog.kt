package de.lasttest.demo

import de.lasttest.domain.DemoRequestLogEntity
import de.lasttest.domain.DemoRequestLogRepository
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import java.util.ArrayDeque

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
            return filtered.asReversed().take(effectiveLimit)
        }
    }

    override fun clear() {
        synchronized(buffer) {
            buffer.clear()
        }
        try {
            repository.deleteAll()
        } catch (exception: Exception) {
            log.warn("DemoRequestLogEntity konnte nicht gelöscht werden: {}", exception.message)
        }
    }

    companion object {
        const val MAX_ENTRIES = 500
    }
}

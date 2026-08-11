package de.lasttest.demo

import de.lasttest.domain.DemoRequestLogEntity
import de.lasttest.domain.DemoRequestLogRepository
import org.springframework.data.domain.Page
import org.springframework.data.domain.Pageable
import org.springframework.data.domain.Sort
import java.time.Instant
import java.util.Optional
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class RingBufferDemoRequestLogTest {
    private val noopRepository = de.lasttest.domain.InMemoryDemoRequestLogRepository()

    private fun newLog(): RingBufferDemoRequestLog = RingBufferDemoRequestLog(noopRepository)

    @Test
    fun `snapshot on an empty log returns an empty list`() {
        val log = newLog()

        assertEquals(emptyList(), log.snapshot(runId = null, limit = 10))
        assertEquals(emptyList(), log.snapshot(runId = "any", limit = 10))
    }

    @Test
    fun `snapshot returns the entries newest first`() {
        val log = newLog()
        log.record(entry("1", runId = "r"))
        log.record(entry("2", runId = "r"))
        log.record(entry("3", runId = "r"))

        val snapshot = log.snapshot(runId = null, limit = 10)

        assertEquals(listOf("3", "2", "1"), snapshot.map(DemoRequestLogEntry::method))
    }

    @Test
    fun `snapshot filters by runId and leaves non-matching entries out`() {
        val log = newLog()
        log.record(entry("1", runId = "a"))
        log.record(entry("2", runId = "b"))
        log.record(entry("3", runId = "a"))

        val filtered = log.snapshot(runId = "a", limit = 10)

        assertEquals(listOf("3", "1"), filtered.map(DemoRequestLogEntry::method))
    }

    @Test
    fun `snapshot clamps the limit to the buffer capacity`() {
        val log = newLog()
        repeat(10) { index -> log.record(entry("e$index", runId = "r")) }

        val snapshot = log.snapshot(runId = null, limit = 999_999)

        assertEquals(10, snapshot.size)
    }

    @Test
    fun `snapshot returns at most the requested limit`() {
        val log = newLog()
        repeat(10) { index -> log.record(entry("e$index", runId = "r")) }

        val snapshot = log.snapshot(runId = null, limit = 3)

        assertEquals(3, snapshot.size)
        assertEquals(listOf("e9", "e8", "e7"), snapshot.map(DemoRequestLogEntry::method))
    }

    @Test
    fun `ring buffer drops the oldest entry when full`() {
        val log = newLog()
        repeat(RingBufferDemoRequestLog.MAX_ENTRIES + 50) { index ->
            log.record(entry("e$index", runId = "r"))
        }

        val snapshot = log.snapshot(runId = null, limit = RingBufferDemoRequestLog.MAX_ENTRIES)

        assertEquals(RingBufferDemoRequestLog.MAX_ENTRIES, snapshot.size)
        val firstMethod = snapshot.last().method
        assertEquals("e50", firstMethod, "oldest surviving entry should be the 51st inserted")
        val lastMethod = snapshot.first().method
        assertEquals("e${RingBufferDemoRequestLog.MAX_ENTRIES + 49}", lastMethod, "newest entry should be the most recent insert")
    }

    @Test
    fun `snapshot rejects non-positive limit values`() {
        val log = newLog()
        log.record(entry("1", runId = "r"))

        assertFailsWith<IllegalArgumentException> { log.snapshot(runId = null, limit = 0) }
        assertFailsWith<IllegalArgumentException> { log.snapshot(runId = null, limit = -3) }
    }

    @Test
    fun `clear empties the buffer so the next snapshot is empty`() {
        val log = newLog()
        log.record(entry("1", runId = "r"))
        log.record(entry("2", runId = "r"))

        log.clear()

        assertTrue(log.snapshot(runId = null, limit = 10).isEmpty())
    }

    @Test
    fun `clear also drops the persistent copy so a restart does not resurrect the entries`() {
        val log = newLog()
        log.record(entry("1", runId = "r"))
        log.record(entry("2", runId = "r"))

        log.clear()

        assertEquals(0, noopRepository.count(), "persistent copy must be wiped on clear()")
    }

    @Test
    fun `record swallows the exception when the repository save call fails`() {
        val failingRepository =
            object : DemoRequestLogRepository {
                override fun <S : DemoRequestLogEntity> save(entity: S): S = throw IllegalStateException("boom")

                override fun <S : DemoRequestLogEntity> saveAll(entities: Iterable<S>): List<S> = throw UnsupportedOperationException()

                override fun findById(id: Long): Optional<DemoRequestLogEntity> = Optional.empty()

                override fun existsById(id: Long): Boolean = false

                override fun findAll(): List<DemoRequestLogEntity> = emptyList()

                override fun findAllById(ids: Iterable<Long>): List<DemoRequestLogEntity> = emptyList()

                override fun count(): Long = 0

                override fun deleteById(id: Long) = Unit

                override fun delete(entity: DemoRequestLogEntity) = Unit

                override fun deleteAllById(ids: Iterable<Long>) = Unit

                override fun deleteAll(entities: Iterable<DemoRequestLogEntity>) = Unit

                override fun deleteAll() = Unit

                override fun findAll(pageable: Pageable): Page<DemoRequestLogEntity> = Page.empty(pageable)

                override fun findAll(sort: Sort): List<DemoRequestLogEntity> = emptyList()

                override fun findAllByOrderByTimestampDesc(pageable: Pageable): List<DemoRequestLogEntity> = emptyList()

                override fun findByRunIdOrderByTimestampDesc(
                    runId: String,
                    pageable: Pageable,
                ): List<DemoRequestLogEntity> = emptyList()
            }
        val log = RingBufferDemoRequestLog(failingRepository)

        log.record(entry("1", runId = "r"))

        val snapshot = log.snapshot(runId = null, limit = 10)
        assertEquals(listOf("1"), snapshot.map(DemoRequestLogEntry::method))
    }

    @Test
    fun `clear swallows the exception when the repository deleteAll call fails`() {
        val failingRepository =
            object : DemoRequestLogRepository {
                override fun <S : DemoRequestLogEntity> save(entity: S): S = entity

                override fun <S : DemoRequestLogEntity> saveAll(entities: Iterable<S>): List<S> = entities.toList()

                override fun findById(id: Long): Optional<DemoRequestLogEntity> = Optional.empty()

                override fun existsById(id: Long): Boolean = false

                override fun findAll(): List<DemoRequestLogEntity> = emptyList()

                override fun findAllById(ids: Iterable<Long>): List<DemoRequestLogEntity> = emptyList()

                override fun count(): Long = 0

                override fun deleteById(id: Long) = Unit

                override fun delete(entity: DemoRequestLogEntity) = Unit

                override fun deleteAllById(ids: Iterable<Long>) = Unit

                override fun deleteAll(entities: Iterable<DemoRequestLogEntity>) = Unit

                override fun deleteAll(): Unit = throw IllegalStateException("boom")

                override fun findAll(pageable: Pageable): Page<DemoRequestLogEntity> = Page.empty(pageable)

                override fun findAll(sort: Sort): List<DemoRequestLogEntity> = emptyList()

                override fun findAllByOrderByTimestampDesc(pageable: Pageable): List<DemoRequestLogEntity> = emptyList()

                override fun findByRunIdOrderByTimestampDesc(
                    runId: String,
                    pageable: Pageable,
                ): List<DemoRequestLogEntity> = emptyList()
            }
        val log = RingBufferDemoRequestLog(failingRepository)
        log.record(entry("1", runId = "r"))

        log.clear()

        assertTrue(log.snapshot(runId = null, limit = 10).isEmpty())
    }

    @Test
    fun `concurrent recorders all see their entries in the snapshot`() {
        val log = newLog()
        val threads =
            (0 until 200).map { index ->
                Thread { log.record(entry("e$index", runId = "r")) }
            }
        threads.forEach(Thread::start)
        threads.forEach(Thread::join)

        val snapshot = log.snapshot(runId = null, limit = 1000)
        assertEquals(200, snapshot.size)
    }

    private fun entry(
        method: String,
        runId: String?,
    ): DemoRequestLogEntry =
        DemoRequestLogEntry(
            timestamp = Instant.parse("2026-01-01T00:00:00Z").toString(),
            method = method,
            path = "/demo-api/products",
            queryString = null,
            status = 200,
            userAgent = "k6/test",
            runId = runId,
        )
}

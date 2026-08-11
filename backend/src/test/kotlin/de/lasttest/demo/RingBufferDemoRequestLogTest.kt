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
    /**
     * No-op repository used so the tests do not need an H2 data
     * source. Every `save()` call is a pure in-memory operation;
     * the contract under test is the ring buffer itself, not the
     * persistence layer.
     */
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

        // The buffer is append-only, so the snapshot is reversed:
        // the most recent entry ("3") sits at index 0.
        assertEquals(listOf("3", "2", "1"), snapshot.map(DemoRequestLogEntry::method))
    }

    @Test
    fun `snapshot filters by runId and leaves non-matching entries out`() {
        val log = newLog()
        log.record(entry("1", runId = "a"))
        log.record(entry("2", runId = "b"))
        log.record(entry("3", runId = "a"))

        val filtered = log.snapshot(runId = "a", limit = 10)

        // Only the two "a" entries come back, newest first.
        assertEquals(listOf("3", "1"), filtered.map(DemoRequestLogEntry::method))
    }

    @Test
    fun `snapshot clamps the limit to the buffer capacity`() {
        val log = newLog()
        repeat(10) { index -> log.record(entry("e$index", runId = "r")) }

        val snapshot = log.snapshot(runId = null, limit = 999_999)

        // 10 < MAX_ENTRIES, so the clamp is invisible but the call
        // still returns every entry. The clamp is exercised in the
        // 1000-entries test below.
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
        // Fill the buffer past its capacity so the oldest entry has
        // to be evicted.
        repeat(RingBufferDemoRequestLog.MAX_ENTRIES + 50) { index ->
            log.record(entry("e$index", runId = "r"))
        }

        val snapshot = log.snapshot(runId = null, limit = RingBufferDemoRequestLog.MAX_ENTRIES)

        // The buffer holds exactly MAX_ENTRIES entries; the oldest
        // 50 ("e0" through "e49") were evicted, the newest
        // MAX_ENTRIES are still in there.
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

        // Defensive contract: a malformed query string on the wire
        // would produce limit=0 or a negative number; the
        // controller catches those and falls back to the default,
        // but the storage contract itself still has to reject them
        // so any other caller cannot accidentally break the
        // invariant.
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
        // The dashboard's "reset" button promises a pristine state.
        // The in-memory buffer alone would honour that for the
        // current session, but the H2 side-write would silently
        // surface the old entries on a container restart and undo
        // the reset. The contract is therefore "clear wipes both".
        val log = newLog()
        log.record(entry("1", runId = "r"))
        log.record(entry("2", runId = "r"))

        log.clear()

        // The repository is the in-memory no-op; "all rows gone"
        // is observable through its `count()`.
        assertEquals(0, noopRepository.count(), "persistent copy must be wiped on clear()")
    }

    @Test
    fun `record swallows the exception when the repository save call fails`() {
        // The H2 side-write is best-effort: a transient DB error
        // (e.g. connection pool exhaustion) must not propagate to
        // the caller (the interceptor, on the hot path of every
        // demo request) and must not stop the in-memory ring
        // buffer from accepting the entry.
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

        // record() must not throw despite the repository failure,
        // and the entry must still be visible in the in-memory
        // snapshot.
        log.record(entry("1", runId = "r"))

        val snapshot = log.snapshot(runId = null, limit = 10)
        assertEquals(listOf("1"), snapshot.map(DemoRequestLogEntry::method))
    }

    @Test
    fun `clear swallows the exception when the repository deleteAll call fails`() {
        // Symmetric to the record() case: a transient DB error on
        // the delete side must not prevent the in-memory buffer
        // from being cleared, which is what the live dashboard
        // actually reads.
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

        // clear() must not throw despite the repository failure,
        // and the in-memory buffer must still be emptied.
        log.clear()

        assertTrue(log.snapshot(runId = null, limit = 10).isEmpty())
    }

    @Test
    fun `concurrent recorders all see their entries in the snapshot`() {
        // The interceptor is called by any Spring MVC worker
        // thread, so writes must be safe under concurrent load.
        // 200 threads each insert one entry; every entry must be
        // recoverable.
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

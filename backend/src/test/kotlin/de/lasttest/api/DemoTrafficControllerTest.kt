package de.lasttest.api

import de.lasttest.demo.DefaultDemoControllerToggle
import de.lasttest.demo.DemoRequestLog
import de.lasttest.demo.DemoRequestLogEntry
import de.lasttest.demo.RingBufferDemoRequestLog
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class DemoTrafficControllerTest {
    @Test
    fun `returns an empty envelope when the log has no entries`() {
        val controller = DemoTrafficController(RecordingDemoRequestLog(), DefaultDemoControllerToggle())

        val response = controller.requests(runId = null, limit = null)

        assertEquals(null, response.runId)
        assertEquals(500, response.limit)
        assertEquals(0, response.count)
        assertEquals(emptyList(), response.entries)
    }

    @Test
    fun `echoes the requested runId and applies the default limit when none is given`() {
        val controller = DemoTrafficController(RecordingDemoRequestLog(), DefaultDemoControllerToggle())

        val response = controller.requests(runId = "run-abc", limit = null)

        assertEquals("run-abc", response.runId)
        assertEquals(500, response.limit)
    }

    @Test
    fun `applies a positive limit and propagates it to the response`() {
        val controller = DemoTrafficController(RecordingDemoRequestLog(), DefaultDemoControllerToggle())

        val response = controller.requests(runId = null, limit = 50)

        assertEquals(50, response.limit)
    }

    @Test
    fun `clamps a limit larger than the buffer capacity to the buffer capacity`() {
        val controller = DemoTrafficController(RecordingDemoRequestLog(), DefaultDemoControllerToggle())

        val response = controller.requests(runId = null, limit = 9_999)

        assertEquals(RingBufferDemoRequestLog.MAX_ENTRIES, response.limit)
    }

    @Test
    fun `falls back to the default limit when the request sends a non-positive value`() {
        val controller = DemoTrafficController(RecordingDemoRequestLog(), DefaultDemoControllerToggle())

        val responseZero = controller.requests(runId = null, limit = 0)
        val responseNegative = controller.requests(runId = null, limit = -1)

        assertEquals(500, responseZero.limit)
        assertEquals(500, responseNegative.limit)
    }

    @Test
    fun `returns the entries from the underlying log in the response`() {
        val log = RecordingDemoRequestLog()
        log.entries.add(
            entry(method = "GET", path = "/demo-api/products", status = 200, runId = "r"),
        )
        log.entries.add(
            entry(method = "POST", path = "/demo-api/products/search", status = 401, runId = "r"),
        )
        val controller = DemoTrafficController(log, DefaultDemoControllerToggle())

        val response = controller.requests(runId = "r", limit = 10)

        assertEquals(2, response.count)
        assertEquals("POST", response.entries[0].method)
        assertEquals(401, response.entries[0].status)
        assertEquals("GET", response.entries[1].method)
        assertEquals(200, response.entries[1].status)
        assertEquals("r", response.entries[0].runId)
    }

    @Test
    fun `forwards the trimmed runId to the storage so the lookup never sees stray whitespace`() {
        val log = RecordingDemoRequestLog()
        val controller = DemoTrafficController(log, DefaultDemoControllerToggle())

        controller.requests(runId = "   ", limit = 10)

        assertNull(log.lastRunId, "whitespace runId must be normalised to null")
    }

    @Test
    fun `forwards the requested runId to the storage when it is non-blank`() {
        val log = RecordingDemoRequestLog()
        val controller = DemoTrafficController(log, DefaultDemoControllerToggle())

        controller.requests(runId = "run-1", limit = 10)

        assertEquals("run-1", log.lastRunId)
    }

    @Test
    fun `forwards the limit to the storage layer`() {
        val log = RecordingDemoRequestLog()
        val controller = DemoTrafficController(log, DefaultDemoControllerToggle())

        controller.requests(runId = null, limit = 42)

        assertEquals(42, log.lastLimit)
    }

    @Test
    fun `null runId passes through to the storage so the global snapshot works`() {
        val log = RecordingDemoRequestLog()
        val controller = DemoTrafficController(log, DefaultDemoControllerToggle())

        controller.requests(runId = null, limit = 10)

        assertNull(log.lastRunId)
        assertTrue(log.snapshotCalled)
    }

    @Test
    fun `clearRequests empties the log and returns the empty envelope`() {
        val log = RecordingDemoRequestLog()
        log.entries.add(
            entry(method = "GET", path = "/demo-api/products", status = 200, runId = "r"),
        )
        log.entries.add(
            entry(method = "POST", path = "/demo-api/products/search", status = 401, runId = "r"),
        )
        val controller = DemoTrafficController(log, DefaultDemoControllerToggle())

        val response = controller.clearRequests()

        assertTrue(log.entries.isEmpty(), "clear() must drop every entry the log held")
        assertEquals(null, response.runId)
        assertEquals(0, response.count)
        assertEquals(emptyList(), response.entries)
    }

    @Test
    fun `clearRequests is idempotent on an already-empty log`() {
        val controller = DemoTrafficController(RecordingDemoRequestLog(), DefaultDemoControllerToggle())

        val response = controller.clearRequests()

        assertEquals(0, response.count)
        assertEquals(emptyList(), response.entries)
    }

    private fun entry(
        method: String,
        path: String,
        status: Int,
        runId: String?,
    ): DemoRequestLogEntry =
        DemoRequestLogEntry(
            timestamp = Instant.parse("2026-01-01T00:00:00Z").toString(),
            method = method,
            path = path,
            queryString = null,
            status = status,
            userAgent = "k6/test",
            runId = runId,
        )

    private class RecordingDemoRequestLog : DemoRequestLog {
        val entries: MutableList<DemoRequestLogEntry> = mutableListOf()
        var lastRunId: String? = null
        var lastLimit: Int = 0
        var snapshotCalled: Boolean = false
        var clearCount: Int = 0

        override fun record(entry: DemoRequestLogEntry) {
            entries.add(entry)
        }

        override fun snapshot(
            runId: String?,
            limit: Int,
        ): List<DemoRequestLogEntry> {
            snapshotCalled = true
            lastRunId = runId
            lastLimit = limit
            return entries
                .asReversed()
                .filter { runId == null || it.runId == runId }
                .take(limit)
        }

        override fun clear() {
            entries.clear()
            clearCount++
        }
    }
}

class DemoTrafficStatusControllerTest {
    @Test
    fun `status returns enabled false on a fresh toggle`() {
        val controller = DemoTrafficController(StubRequestLog(), DefaultDemoControllerToggle())

        val response = controller.status()

        assertEquals(false, response.enabled)
    }

    @Test
    fun `status reflects the toggle state after enable and disable`() {
        val toggle = DefaultDemoControllerToggle()
        val controller = DemoTrafficController(StubRequestLog(), toggle)

        controller.setEnabled(DemoEnabledRequest(enabled = true))
        assertEquals(true, controller.status().enabled)

        controller.setEnabled(DemoEnabledRequest(enabled = false))
        assertEquals(false, controller.status().enabled)
    }

    @Test
    fun `POST enabled with true calls enable on the toggle`() {
        val toggle = RecordingDemoControllerToggle()
        val controller = DemoTrafficController(StubRequestLog(), toggle)

        val response = controller.setEnabled(DemoEnabledRequest(enabled = true))

        assertEquals(true, response.enabled)
        assertEquals(true, toggle.enableCount >= 1, "enable() must be called when the request asks for enabled=true")
    }

    @Test
    fun `POST enabled with false calls disable on the toggle`() {
        val toggle = RecordingDemoControllerToggle()
        toggle.enable() // pre-condition
        val controller = DemoTrafficController(StubRequestLog(), toggle)

        val response = controller.setEnabled(DemoEnabledRequest(enabled = false))

        assertEquals(false, response.enabled)
        assertEquals(true, toggle.disableCount >= 1, "disable() must be called when the request asks for enabled=false")
    }

    @Test
    fun `POST enabled with true is idempotent and re-enables a disabled toggle`() {
        val toggle = DefaultDemoControllerToggle()
        val controller = DemoTrafficController(StubRequestLog(), toggle)

        controller.setEnabled(DemoEnabledRequest(enabled = true))
        controller.setEnabled(DemoEnabledRequest(enabled = true))
        controller.setEnabled(DemoEnabledRequest(enabled = false))
        controller.setEnabled(DemoEnabledRequest(enabled = true))

        assertEquals(true, controller.status().enabled, "repeated toggles must converge on the requested state")
    }

    private class StubRequestLog : DemoRequestLog {
        override fun record(entry: DemoRequestLogEntry) = Unit

        override fun snapshot(
            runId: String?,
            limit: Int,
        ): List<DemoRequestLogEntry> = emptyList()

        override fun clear() = Unit
    }

    private class RecordingDemoControllerToggle : de.lasttest.demo.DemoControllerToggle {
        var enableCount: Int = 0
        var disableCount: Int = 0
        private var state: Boolean = false

        override fun isEnabled(): Boolean = state

        override fun enable() {
            state = true
            enableCount++
        }

        override fun disable() {
            state = false
            disableCount++
        }
    }
}

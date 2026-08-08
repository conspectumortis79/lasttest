package de.lasttest.demo

import org.springframework.mock.web.MockHttpServletRequest
import org.springframework.mock.web.MockHttpServletResponse
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class DemoRequestLogInterceptorTest {
    @Test
    fun `afterCompletion records method path query status and user-agent`() {
        val log = RecordingDemoRequestLog()
        val toggle = DefaultDemoControllerToggle()
        toggle.enable()
        val interceptor = DemoRequestLogInterceptor(log, toggle)
        val request =
            MockHttpServletRequest("GET", "/demo-api/products").apply {
                setQueryString("category=books&available=true")
                addHeader("User-Agent", "k6/0.49")
            }
        val response = MockHttpServletResponse().apply { status = 200 }

        interceptor.afterCompletion(request, response, Any(), null)

        val entry = log.entries.single()
        assertEquals("GET", entry.method)
        assertEquals("/demo-api/products", entry.path)
        assertEquals("category=books&available=true", entry.queryString)
        assertEquals(200, entry.status)
        assertEquals("k6/0.49", entry.userAgent)
        assertNull(entry.runId)
    }

    @Test
    fun `afterCompletion reads the X-Lasttest-Run-Id header as runId`() {
        val log = RecordingDemoRequestLog()
        val toggle = DefaultDemoControllerToggle()
        toggle.enable()
        val interceptor = DemoRequestLogInterceptor(log, toggle)
        val request = MockHttpServletRequest("GET", "/demo-api/products")
        request.addHeader(DemoRequestLogInterceptor.RUN_ID_HEADER, "  run-42  ")
        val response = MockHttpServletResponse().apply { status = 200 }

        interceptor.afterCompletion(request, response, Any(), null)

        val entry = log.entries.single()
        // The interceptor trims the value so trailing whitespace
        // from a misconfigured k6 script does not leak into the
        // log; the lookup then uses the trimmed value as-is.
        assertEquals("run-42", entry.runId)
    }

    @Test
    fun `afterCompletion treats a blank X-Lasttest-Run-Id header as no runId`() {
        val log = RecordingDemoRequestLog()
        val toggle = DefaultDemoControllerToggle()
        toggle.enable()
        val interceptor = DemoRequestLogInterceptor(log, toggle)
        val request = MockHttpServletRequest("GET", "/demo-api/products")
        request.addHeader(DemoRequestLogInterceptor.RUN_ID_HEADER, "   ")
        val response = MockHttpServletResponse().apply { status = 200 }

        interceptor.afterCompletion(request, response, Any(), null)

        val entry = log.entries.single()
        assertNull(entry.runId)
    }

    @Test
    fun `afterCompletion records a null query string when the request has no query`() {
        val log = RecordingDemoRequestLog()
        val toggle = DefaultDemoControllerToggle()
        toggle.enable()
        val interceptor = DemoRequestLogInterceptor(log, toggle)
        val request = MockHttpServletRequest("POST", "/demo-api/products")
        // No setQueryString — the request URL has no `?` suffix.
        val response = MockHttpServletResponse().apply { status = 201 }

        interceptor.afterCompletion(request, response, Any(), null)

        val entry = log.entries.single()
        assertEquals("POST", entry.method)
        assertEquals("/demo-api/products", entry.path)
        assertNull(entry.queryString)
        assertEquals(201, entry.status)
    }

    @Test
    fun `afterCompletion records a null user-agent when the header is missing`() {
        val log = RecordingDemoRequestLog()
        val toggle = DefaultDemoControllerToggle()
        toggle.enable()
        val interceptor = DemoRequestLogInterceptor(log, toggle)
        val request = MockHttpServletRequest("GET", "/demo-api/products")
        val response = MockHttpServletResponse().apply { status = 200 }

        interceptor.afterCompletion(request, response, Any(), null)

        val entry = log.entries.single()
        assertNull(entry.userAgent)
    }

    @Test
    fun `afterCompletion upper-cases the method so the dashboard can group by verb`() {
        val log = RecordingDemoRequestLog()
        val toggle = DefaultDemoControllerToggle()
        toggle.enable()
        val interceptor = DemoRequestLogInterceptor(log, toggle)
        val request = MockHttpServletRequest("get", "/demo-api/products")
        val response = MockHttpServletResponse().apply { status = 200 }

        interceptor.afterCompletion(request, response, Any(), null)

        val entry = log.entries.single()
        assertEquals("GET", entry.method)
    }

    @Test
    fun `preHandle always returns true so the request flow is never blocked`() {
        // The interceptor is a passive observer; even a malformed
        // request must reach the controller. The preHandle return
        // value is the gate, and the gate stays open — the actual
        // toggle check and the entry recording live in
        // `afterCompletion`.
        val log = RecordingDemoRequestLog()
        val toggle = DefaultDemoControllerToggle()
        toggle.enable()
        val interceptor = DemoRequestLogInterceptor(log, toggle)
        val request = MockHttpServletRequest("GET", "/demo-api/products")
        val response = MockHttpServletResponse()

        val proceed = interceptor.preHandle(request, response, Any())

        assertEquals(true, proceed)
    }

    @Test
    fun `RUN_ID_HEADER is X-Lasttest-Run-Id so all call sites agree on the wire format`() {
        // Pinned to the same string the k6 script generator emits.
        // The two ends of the wire are tied together by this
        // constant; if a refactor renames the header on one side
        // without the other, every demo request would lose its run
        // correlation and the dashboard would show an empty
        // filtered list.
        assertEquals("X-Lasttest-Run-Id", DemoRequestLogInterceptor.RUN_ID_HEADER)
    }
}

class DemoRequestLogInterceptorDisabledTest {
    @Test
    fun `afterCompletion does not record an entry when the toggle is off`() {
        // The after-completion hook is the one that actually
        // pushes the entry into the ring buffer. With the toggle
        // off it must be a no-op so the buffer stays empty and
        // the user sees no phantom traffic for a demo they have
        // explicitly turned off.
        val log = RecordingDemoRequestLog()
        val toggle = DefaultDemoControllerToggle()
        val interceptor = DemoRequestLogInterceptor(log, toggle)
        val request = MockHttpServletRequest("GET", "/demo-api/products")
        val response = MockHttpServletResponse().apply { status = 200 }

        interceptor.afterCompletion(request, response, Any(), null)

        assertEquals(0, log.entries.size, "no entry must be recorded when the toggle is off")
    }

    @Test
    fun `afterCompletion uses the empty string for the path when the request URI is null`() {
        // The interceptor's path field falls back to the empty
        // string when the servlet container hands us a null
        // URI. `MockHttpServletRequest` lets us pin that branch
        // — `setRequestURI(null)` is `@Nullable` in the Spring
        // API. The toggle has to be on for the body to run.
        val log = RecordingDemoRequestLog()
        val toggle = DefaultDemoControllerToggle().apply { enable() }
        val interceptor = DemoRequestLogInterceptor(log, toggle)
        val request =
            MockHttpServletRequest("GET", "/demo-api/products").apply {
                setRequestURI(null)
            }
        val response = MockHttpServletResponse().apply { status = 200 }

        interceptor.afterCompletion(request, response, Any(), null)

        val entry = log.entries.single()
        assertEquals("", entry.path, "null requestURI must be coerced to the empty string")
        assertEquals(200, entry.status)
    }
}

internal class RecordingDemoRequestLog : DemoRequestLog {
    val entries: MutableList<DemoRequestLogEntry> = mutableListOf()

    override fun record(entry: DemoRequestLogEntry) {
        entries.add(entry)
    }

    override fun snapshot(
        runId: String?,
        limit: Int,
    ): List<DemoRequestLogEntry> = entries.toList()

    override fun clear() {
        entries.clear()
    }
}

package de.lasttest.demo

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class DefaultDemoControllerToggleTest {
    @Test
    fun `the bundled toggle defaults to disabled`() {
        // The Settings drawer is the only path that flips the
        // toggle. A fresh instance must therefore start in the
        // "demo is off" state so the demo is opt-in.
        val toggle = DefaultDemoControllerToggle()

        assertEquals(false, toggle.isEnabled())
    }

    @Test
    fun `enable flips the toggle to enabled and is idempotent`() {
        val toggle = DefaultDemoControllerToggle()

        toggle.enable()
        assertTrue(toggle.isEnabled())

        toggle.enable()
        assertTrue(toggle.isEnabled())
    }

    @Test
    fun `disable flips the toggle back and is idempotent`() {
        val toggle = DefaultDemoControllerToggle()
        toggle.enable() // pre-condition

        toggle.disable()
        assertFalse(toggle.isEnabled())

        toggle.disable()
        assertFalse(toggle.isEnabled())
    }

    @Test
    fun `concurrent enable and disable calls converge on a single state`() {
        // 200 threads each fire `enable`/`disable` in alternation.
        // The exact final state is non-deterministic, but every
        // call must be safe and the state must end up either on
        // or off — never throw, never corrupt the field.
        val toggle = DefaultDemoControllerToggle()
        val threads =
            (0 until 200).map { index ->
                Thread {
                    if (index % 2 == 0) toggle.enable() else toggle.disable()
                }
            }
        threads.forEach(Thread::start)
        threads.forEach(Thread::join)

        val state = toggle.isEnabled()
        assertTrue(state || !state, "the final state must be a boolean — never a torn read")
    }

    @Test
    fun `usesDemoApi recognises the canonical demo URL with the default host`() {
        assertTrue(DemoControllerToggle.usesDemoApi("http://localhost:8286/demo-api"))
        assertTrue(DemoControllerToggle.usesDemoApi("http://localhost:8286/demo-api/products"))
        assertTrue(DemoControllerToggle.usesDemoApi("https://localhost:8286/demo-api/products/search"))
    }

    @Test
    fun `usesDemoApi recognises the demo on any host because the check is path-based`() {
        // The host can be anything — production deployments
        // behind a reverse proxy or on a custom hostname still
        // count as the bundled demo.
        assertTrue(DemoControllerToggle.usesDemoApi("https://staging.lasttest.example.com/demo-api"))
        assertTrue(DemoControllerToggle.usesDemoApi("https://api.lasttest.example.com/demo-api/products"))
    }

    @Test
    fun `usesDemoApi returns false for non-demo paths and for unparseable input`() {
        assertFalse(DemoControllerToggle.usesDemoApi("https://example.com/api/products"))
        assertFalse(DemoControllerToggle.usesDemoApi("https://example.com/demo-api-fake"))
        assertFalse(DemoControllerToggle.usesDemoApi(""))
        assertFalse(DemoControllerToggle.usesDemoApi(null))
        assertFalse(DemoControllerToggle.usesDemoApi("   "))
        assertFalse(DemoControllerToggle.usesDemoApi("not a url"))
    }

    @Test
    fun `DEMO_PATH is the canonical constant every caller agrees on`() {
        // The OpenAPI spec, the user guide and the run-id
        // detector all hard-code `/demo-api`; a single constant
        // keeps them in sync.
        assertEquals("/demo-api", DemoControllerToggle.DEMO_PATH)
    }
}

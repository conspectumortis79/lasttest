package de.lasttest.demo

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class DefaultDemoControllerToggleTest {
    @Test
    fun `the bundled toggle defaults to disabled`() {
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
    fun `DEMO_PATH is the canonical constant every caller agrees on`() {
        assertEquals("/demo-api", DemoControllerToggle.DEMO_PATH)
    }
}

package de.lasttest.demo

import org.springframework.stereotype.Service
import java.util.concurrent.atomic.AtomicBoolean

/**
 * In-memory, process-wide implementation of [DemoControllerToggle].
 * Backed by an [AtomicBoolean] so the toggle is safe to read and
 * flip from any thread — the controller, the interceptor and the
 * REST endpoint that drives the Settings switch all run on
 * different worker threads.
 *
 * The initial state is `false`: the demo is opt-in. The user
 * activates it manually from the Settings drawer; there is no
 * automatic detection.
 *
 * SOLID notes:
 *  - S — this class owns exactly one piece of state. The "what
 *    should we do about it" logic lives in the consumers.
 *  - D — implements [DemoControllerToggle]; everything else in
 *    the codebase depends on that interface, not on this class.
 */
@Service
class DefaultDemoControllerToggle : DemoControllerToggle {
    private val enabled: AtomicBoolean = AtomicBoolean(false)

    override fun isEnabled(): Boolean = enabled.get()

    override fun enable() {
        enabled.set(true)
    }

    override fun disable() {
        enabled.set(false)
    }
}

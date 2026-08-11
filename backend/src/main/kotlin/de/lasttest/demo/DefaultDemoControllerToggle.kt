package de.lasttest.demo

import org.springframework.stereotype.Service
import java.util.concurrent.atomic.AtomicBoolean

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

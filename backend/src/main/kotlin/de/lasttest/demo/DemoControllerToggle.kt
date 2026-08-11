package de.lasttest.demo

interface DemoControllerToggle {
    fun isEnabled(): Boolean

    fun enable()

    fun disable()

    companion object {
        const val DEMO_PATH: String = "/demo-api"
    }
}

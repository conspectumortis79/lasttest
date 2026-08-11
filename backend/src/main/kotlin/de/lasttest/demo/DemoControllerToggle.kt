package de.lasttest.demo

interface DemoControllerToggle {
    fun isEnabled(): Boolean

    fun enable()

    /** Disables the demo. Idempotent. */
    fun disable()

    companion object {
        /**
         * Path component that identifies the bundled demo. Kept
         * as a public constant because the demo URL convention is
         * referenced from tests, the OpenAPI spec, and the user
         * guide; having a single source of truth avoids drift.
         */
        const val DEMO_PATH: String = "/demo-api"
    }
}

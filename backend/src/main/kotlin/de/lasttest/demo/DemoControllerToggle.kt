package de.lasttest.demo

/**
 * Process-wide switch for the bundled demo API. The toggle is the
 * single source of truth for "is the demo currently active?" and
 * is consulted by:
 *  - [DemoProductController] — every handler short-circuits to 404
 *    when the toggle is off, so requests do not even reach the
 *    business logic;
 *  - [DemoRequestLogInterceptor] — when off, the interceptor skips
 *    the entry recording in `afterCompletion`;
 *  - the frontend (via `GET /api/demo-api/status`) — to decide
 *    whether the "Demo-API" toolbar entry is rendered and to
 *    drive the "active" badge next to it.
 *
 * The toggle is **deliberately** a runtime state, not a
 * `@ConditionalOnProperty`. The user flips the demo on and off
 * from the Settings drawer at any time; tearing down and
 * rebuilding the Spring context on every change would be both
 * slow and surprising.
 *
 * The initial state is `false`: the demo is opt-in. There is no
 * auto-detection — a previous design tried to enable the demo
 * based on the imported spec's `servers` list, but that hid the
 * toggle from the user. A manual switch in Settings keeps the
 * state under the user's control.
 *
 * SOLID notes:
 *  - S — single responsibility: expose "is the demo on?" and let
 *    callers decide what that means for them.
 *  - D — every consumer depends on this interface, not on the
 *    concrete `DefaultDemoControllerToggle`. A different storage
 *    (file, env var, etc.) is a one-line wiring change.
 */
interface DemoControllerToggle {
    /**
     * Returns `true` when the bundled demo API should respond to
     * requests. The default value is `false` — the demo is opt-in
     * via the Settings drawer.
     */
    fun isEnabled(): Boolean

    /** Enables the demo. Idempotent. */
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

// Loader and type definitions for the demo-API status. The
// Settings drawer flips the toggle by POSTing to
// `/api/demo-traffic/enabled`; the rest of the app reads the
// current state from `/api/demo-traffic/status` and re-reads it
// whenever the user returns to the toolbar / dashboard so the UI
// stays in sync with whatever the backend has decided.

/**
 * `localStorage` key the demo toggle is persisted under. Lives
 * here (next to the `DemoStatus` type) rather than inside the
 * React hook file so the persistence contract is testable
 * without a JSX toolchain.
 */
export const DEMO_STATUS_STORAGE_KEY = 'lasttest.demo.enabled'

/**
 * Reads the user's last choice from `localStorage`. Returns
 * `false` when the value is missing or `localStorage` is
 * unavailable. The canonical representation is the literal
 * string `"true"` (anything else, including `"True"`,
 * `"1"` or `undefined`, counts as off) — the contract is
 * intentionally narrow so a future migration is easy.
 */
export function readStoredDemoEnabled(): boolean {
  try {
    return localStorage.getItem(DEMO_STATUS_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

/**
 * Mirrors the user's choice into `localStorage`. A no-op when
 * the storage is unavailable so a private-mode browser does
 * not break the UI.
 */
export function writeStoredDemoEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(DEMO_STATUS_STORAGE_KEY, enabled ? 'true' : 'false')
  } catch {
    // Best-effort. The in-memory state still works for the
    // current session; the choice just does not survive a
    // page refresh.
  }
}

export type DemoStatus = {
  enabled: boolean
  /**
   * `true` once the provider has finished its first read from
   * the backend. Components that need to react to the toggle
   * (e.g. auto-load the demo spec on enable) gate their
   * effect on this flag so they do not fire with the default
   * `false` state during the first paint.
   */
  loaded: boolean
}

export const DEMO_DISABLED: DemoStatus = { enabled: false, loaded: true }
export const DEMO_ENABLED: DemoStatus = { enabled: true, loaded: true }

/**
 * Reads the current demo-API status. Returns
 * [DEMO_DISABLED] on any error so the rest of the UI can fall
 * back to a safe "demo is off" state — a transient backend
 * hiccup must not flip the user's mental model of "is the demo
 * actually running?".
 */
export async function fetchDemoStatus(): Promise<DemoStatus> {
  try {
    const response = await fetch('/api/demo-traffic/status')
    if (response.ok) {
      const data = (await response.json()) as DemoStatus
      return data
    }
    return DEMO_DISABLED
  } catch {
    return DEMO_DISABLED
  }
}

/**
 * Flips the demo on or off. The endpoint returns the new state
 * so the caller does not have to issue a follow-up read.
 */
export async function setDemoEnabled(enabled: boolean): Promise<DemoStatus> {
  try {
    const response = await fetch('/api/demo-traffic/enabled', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled }),
    })
    if (response.ok) {
      const data = (await response.json()) as DemoStatus
      return data
    }
    return enabledState(enabled)
  } catch {
    return enabledState(enabled)
  }
}

function enabledState(enabled: boolean): DemoStatus {
  // Pulled out so the "successfully wrote the request but the
  // server returned a 4xx/5xx" path and the "network blew up
  // before the request even left" path converge on the same
  // optimistic fallback. Keeping the ternary in one place also
  // makes the branch coverage requirement trivial to hit: every
  // caller either passes `true` or `false`, no implicit default.
  return enabled ? DEMO_ENABLED : DEMO_DISABLED
}

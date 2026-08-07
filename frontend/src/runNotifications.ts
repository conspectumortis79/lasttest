// Pure helpers for the per-run completion notifications.
//
// The dashboard polls every in-flight run once a second and merges
// the fresh status into a React state map. Whenever a run crosses
// the `in-flight → terminal` boundary, the user wants to be told —
// not silently bounced, the badge grazing from orange to red is
// easy to miss when the tab is in the background. The detection
// logic lives here as a pure function so it can be unit-tested
// without spinning up a renderer, and so the App.tsx polling
// effect can call it inside a `setRuns` updater without taking a
// dependency on the user's notification settings.
//
// Two output kinds are emitted so the caller does not have to
// re-derive the title / body from the run status:
//
//   - `'COMPLETED'` — k6 finished normally, the run went green
//   - `'FAILED'`    — k6 failed, was stopped, or was force-aborted
//
// Decoupled from i18n: the App.tsx side injects the localised
// strings via the `format*` callbacks. That keeps the pure module
// free of the dict and lets the same detections drive a UI toast
// in a future revision without rewriting the rules.

import { isTerminalRun } from './runDashboard.ts'
import type { TestRun } from './k6Report.ts'

export type NotificationKind = 'COMPLETED' | 'FAILED'

export type NotificationSettings = {
  /** Master switch. When false, no notifications are emitted. */
  enabled: boolean
  /** Notify when a run reaches COMPLETED. */
  onSuccess: boolean
  /** Notify when a run reaches FAILED / STOPPED / ABORTED. */
  onFailure: boolean
}

/**
 * Browser-level Notification permission, as exposed by the
 * `Notification` constructor. The `'default'` value is the
 * initial state when the user has not yet been asked.
 */
export type NotificationPermissionState = 'default' | 'granted' | 'denied'

/**
 * Pure projection of the Settings-drawer state for the
 * notifications section. Pulled out of the JSX so it can be
 * unit-tested without a React renderer and so the drawer itself
 * stays a dumb formatter.
 *
 * Rules:
 *  - Master toggle is disabled when the browser has denied
 *    permission — blocking the toggle is the only honest signal
 *    because flipping it would have no effect.
 *  - Sub-checkboxes are visible only when the master is *on* and
 *    permission is not denied; the user picks the granularity
 *    they want to be notified about.
 *  - The warning banner is shown exactly when the browser has
 *    denied permission, regardless of the toggle state, so old
 *    persisted `enabled: true` settings do not silently break.
 */
export type NotificationSectionState = {
  masterDisabled: boolean
  subCheckboxesVisible: boolean
  warningVisible: boolean
}

export function computeNotificationSectionState(
  settings: NotificationSettings,
  permission: NotificationPermissionState,
): NotificationSectionState {
  const masterDisabled = permission === 'denied'
  return {
    masterDisabled,
    subCheckboxesVisible: settings.enabled && permission !== 'denied',
    warningVisible: permission === 'denied',
  }
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: false,
  onSuccess: false,
  onFailure: true,
}

export type TerminalNotification = {
  runId: string
  kind: NotificationKind
  /** Status the run reached, for callers that want to inspect the granularity. */
  status: TestRun['status']
}

const STORAGE_KEY = 'lasttest.notificationSettings.v1'

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

function isNotificationSettings(value: unknown): value is NotificationSettings {
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return isBoolean(record.enabled) && isBoolean(record.onSuccess) && isBoolean(record.onFailure)
}

/**
 * Reads the persisted notification settings from `localStorage`.
 * Falls back to {@link DEFAULT_NOTIFICATION_SETTINGS} when no
 * stored value is present, when the stored value is malformed, or
 * when `localStorage` itself is unavailable (private mode, SSR).
 *
 * The `storage` parameter is injectable so the function stays
 * unit-testable without touching the real browser API. Callers
 * are expected to pass `null` when running in an environment
 * without `localStorage` (SSR, server-side tests).
 */
export function loadNotificationSettings(
  storage: Pick<Storage, 'getItem'> | null,
): NotificationSettings {
  if (storage === null) return { ...DEFAULT_NOTIFICATION_SETTINGS }
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (raw === null) return { ...DEFAULT_NOTIFICATION_SETTINGS }
    const parsed: unknown = JSON.parse(raw)
    if (!isNotificationSettings(parsed)) return { ...DEFAULT_NOTIFICATION_SETTINGS }
    return parsed
  } catch {
    return { ...DEFAULT_NOTIFICATION_SETTINGS }
  }
}

/**
 * Persists the notification settings under the versioned storage
 * key. Errors are swallowed so a failing `localStorage` (quota,
 * private mode) never bubbles into the render path.
 */
export function saveNotificationSettings(
  settings: NotificationSettings,
  storage: Pick<Storage, 'setItem'> | null,
): void {
  if (storage === null) return
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Persistence is a nice-to-have, not a contract.
  }
}

/**
 * True when the run status is a "success" terminal state. Used
 * to decide whether the master switch + `onSuccess` ought to fire.
 */
export function isCompletionStatus(status: TestRun['status']): boolean {
  return status === 'COMPLETED'
}

/**
 * True when the run status is a "failure" terminal state. Covers
 * every non-success terminal outcome so the user gets told about
 * a hard FAILED, a graceful STOPPED and a force-aborted run alike.
 * STOPPING is intentionally excluded: the run is still owned by
 * k6 and the final status may still be STOPPED (which this
 * predicate does catch).
 */
export function isFailureStatus(status: TestRun['status']): boolean {
  return status === 'FAILED' || status === 'STOPPED' || status === 'ABORTED'
}

/**
 * Compares the previous and current run maps and returns one
 * notification per run that crossed `in-flight → terminal` between
 * the two snapshots. The settings filter is applied so the master
 * switch and the success/failure toggles do exactly what the user
 * configured in the Settings drawer.
 *
 * Pure: the function never mutates the inputs and never reads
 * `localStorage` or the DOM. The caller is responsible for
 * turning the returned `TerminalNotification[]` into an actual
 * `Notification` (or a future toast) — that side effect lives in
 * App.tsx, not here, so this module stays testable.
 *
 * A run that already had a terminal status in `prev` is *not*
 * re-emitted, even when the status changes between two terminal
 * states (e.g. STOPPING → STOPPED → ABORTED). The boundary the
 * user cares about is the moment the run settles, not every
 * post-terminal follow-up transition.
 */
export function detectTerminalTransitions(
  prev: Record<string, TestRun>,
  next: Record<string, TestRun>,
  settings: NotificationSettings,
): TerminalNotification[] {
  if (!settings.enabled) return []
  const result: TerminalNotification[] = []
  for (const [id, nextRun] of Object.entries(next)) {
    const prevRun = prev[id]
    if (prevRun === undefined) continue
    if (isTerminalRun(prevRun.status)) continue
    if (!isTerminalRun(nextRun.status)) continue
    if (isCompletionStatus(nextRun.status)) {
      if (settings.onSuccess) result.push({ runId: id, kind: 'COMPLETED', status: nextRun.status })
    } else if (isFailureStatus(nextRun.status)) {
      if (settings.onFailure) result.push({ runId: id, kind: 'FAILED', status: nextRun.status })
    }
  }
  return result
}

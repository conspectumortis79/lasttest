// Unit tests for the per-run completion notification logic. The
// detection is a pure function so the whole surface — defaults,
// localStorage round-trip, status classification, and the
// prev/next diff — can be exercised without React or a browser.
import { deepEqual, equal, ok } from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  computeNotificationSectionState,
  detectTerminalTransitions,
  isCompletionStatus,
  isFailureStatus,
  loadNotificationSettings,
  saveNotificationSettings,
  type NotificationSettings,
} from './runNotifications.ts'
import type { TestRun } from './k6Report.ts'

function makeRun(id: string, status: TestRun['status']): TestRun {
  return { id, status, createdAt: '2026-01-01T00:00:00Z' } as TestRun
}

function settings(overrides: Partial<NotificationSettings> = {}): NotificationSettings {
  return { ...DEFAULT_NOTIFICATION_SETTINGS, ...overrides }
}

function makeStorage(): Storage {
  const map = new Map<string, string>()
  return {
    getItem(key: string) { return map.has(key) ? map.get(key)! : null },
    setItem(key: string, value: string) { map.set(key, value) },
    removeItem() { /* unused */ },
    clear() { map.clear() },
    key() { return null },
    get length() { return map.size },
  } as unknown as Storage
}

test('DEFAULT_NOTIFICATION_SETTINGS starts disabled, fires only on failure', () => {
  // The Settings drawer must show a safe default: notifications
  // off, "tell me when something failed" on. Confirming the
  // defaults here keeps a future refactor from accidentally
  // spamming the user with success notifications on first install.
  equal(DEFAULT_NOTIFICATION_SETTINGS.enabled, false)
  equal(DEFAULT_NOTIFICATION_SETTINGS.onSuccess, false)
  equal(DEFAULT_NOTIFICATION_SETTINGS.onFailure, true)
})

test('isCompletionStatus is true only for COMPLETED', () => {
  equal(isCompletionStatus('COMPLETED'), true)
  equal(isCompletionStatus('FAILED'), false)
  equal(isCompletionStatus('STOPPED'), false)
  equal(isCompletionStatus('ABORTED'), false)
  // In-flight statuses must not be classified as a "success"
  // outcome, otherwise a long RUNNING run could fire a
  // notification the moment the user enables the toggle.
  equal(isCompletionStatus('QUEUED'), false)
  equal(isCompletionStatus('RUNNING'), false)
  equal(isCompletionStatus('STOPPING'), false)
})

test('isFailureStatus covers FAILED, STOPPED and ABORTED; nothing else', () => {
  equal(isFailureStatus('FAILED'), true)
  equal(isFailureStatus('STOPPED'), true)
  equal(isFailureStatus('ABORTED'), true)
  // A successful run must never be re-routed through the failure
  // path; the notification body would mislead the user.
  equal(isFailureStatus('COMPLETED'), false)
  // In-flight statuses are not "failed" yet — STOPPING only
  // becomes a failure once the backend confirms STOPPED.
  equal(isFailureStatus('QUEUED'), false)
  equal(isFailureStatus('RUNNING'), false)
  equal(isFailureStatus('STOPPING'), false)
})

test('loadNotificationSettings returns the defaults when nothing is stored', () => {
  const storage = makeStorage()
  deepEqual(loadNotificationSettings(storage), DEFAULT_NOTIFICATION_SETTINGS)
})

test('loadNotificationSettings returns the defaults when the stored value is malformed', () => {
  const storage = makeStorage()
  storage.setItem('lasttest.notificationSettings.v1', '{not valid json')
  deepEqual(loadNotificationSettings(storage), DEFAULT_NOTIFICATION_SETTINGS)

  // Wrong shape: the persisted payload must be an object with
  // exactly the three boolean fields. Anything else is treated as
  // a fresh install and the defaults are returned.
  storage.setItem('lasttest.notificationSettings.v1', JSON.stringify({ enabled: 'yes' }))
  deepEqual(loadNotificationSettings(storage), DEFAULT_NOTIFICATION_SETTINGS)

  storage.setItem('lasttest.notificationSettings.v1', JSON.stringify({ enabled: true }))
  deepEqual(loadNotificationSettings(storage), DEFAULT_NOTIFICATION_SETTINGS)

  // Each individual field must be a boolean; the second and third
  // slots used to slip through the type guard because the chain
  // short-circuited on the very first wrong value. The guard now
  // demands every field be a boolean, so these payloads are
  // rejected as well.
  storage.setItem('lasttest.notificationSettings.v1', JSON.stringify({ enabled: true, onSuccess: 'yes', onFailure: true }))
  deepEqual(loadNotificationSettings(storage), DEFAULT_NOTIFICATION_SETTINGS)
  storage.setItem('lasttest.notificationSettings.v1', JSON.stringify({ enabled: true, onSuccess: true, onFailure: 1 }))
  deepEqual(loadNotificationSettings(storage), DEFAULT_NOTIFICATION_SETTINGS)
  storage.setItem('lasttest.notificationSettings.v1', JSON.stringify({ enabled: 1, onSuccess: true, onFailure: true }))
  deepEqual(loadNotificationSettings(storage), DEFAULT_NOTIFICATION_SETTINGS)

  // `null` and arrays are valid `typeof === 'object'` values but
  // they are not the plain settings record we expect. The guard
  // must reject them so a user that pasted a wrong payload by
  // accident still gets the safe defaults on the next load.
  storage.setItem('lasttest.notificationSettings.v1', JSON.stringify(null))
  deepEqual(loadNotificationSettings(storage), DEFAULT_NOTIFICATION_SETTINGS)
  storage.setItem('lasttest.notificationSettings.v1', JSON.stringify([]))
  deepEqual(loadNotificationSettings(storage), DEFAULT_NOTIFICATION_SETTINGS)
})

test('loadNotificationSettings returns the defaults when localStorage is unavailable', () => {
  // Defensive: SSR or private-mode browsers may throw on access.
  // The caller passes `null` as the storage argument to opt out
  // entirely (also used by the unit tests).
  deepEqual(loadNotificationSettings(null), DEFAULT_NOTIFICATION_SETTINGS)
})

test('loadNotificationSettings round-trips a previously saved payload', () => {
  const storage = makeStorage()
  const payload: NotificationSettings = { enabled: true, onSuccess: true, onFailure: false }
  saveNotificationSettings(payload, storage)
  deepEqual(loadNotificationSettings(storage), payload)
})

test('saveNotificationSettings is a no-op when storage is unavailable', () => {
  // The function must not throw on `null` storage. It is called
  // from inside a React effect; a thrown error would surface in
  // the UI as a red overlay.
  saveNotificationSettings({ enabled: true, onSuccess: true, onFailure: true }, null)
  ok(true)
})

test('saveNotificationSettings stores the JSON-encoded payload under the versioned key', () => {
  const storage = makeStorage()
  const payload: NotificationSettings = { enabled: true, onSuccess: false, onFailure: true }
  saveNotificationSettings(payload, storage)
  const raw = storage.getItem('lasttest.notificationSettings.v1')
  ok(raw !== null)
  deepEqual(JSON.parse(raw!), payload)
})

test('saveNotificationSettings swallows quota / availability errors', () => {
  // Some browsers (private mode) reject `setItem` with a quota
  // error. The caller must not see the exception bubble up.
  const broken = {
    getItem() { return null },
    setItem() { throw new Error('QuotaExceededError') },
    removeItem() { /* unused */ },
    clear() { /* unused */ },
    key() { return null },
    get length() { return 0 },
  } as unknown as Storage
  saveNotificationSettings({ enabled: true, onSuccess: true, onFailure: true }, broken)
  ok(true)
})

test('detectTerminalTransitions returns an empty list when notifications are disabled', () => {
  // The master switch is the kill-switch — even with both
  // success and failure toggles on, the function must yield
  // nothing when `enabled` is false.
  const prev = { a: makeRun('a', 'RUNNING') }
  const next = { a: makeRun('a', 'COMPLETED') }
  const result = detectTerminalTransitions(prev, next, settings({ enabled: false, onSuccess: true, onFailure: true }))
  deepEqual(result, [])
})

test('detectTerminalTransitions emits a COMPLETED notification on a fresh in-flight → COMPLETED transition', () => {
  const prev = { a: makeRun('a', 'RUNNING') }
  const next = { a: makeRun('a', 'COMPLETED') }
  const result = detectTerminalTransitions(prev, next, settings({ enabled: true, onSuccess: true, onFailure: true }))
  deepEqual(result, [{ runId: 'a', kind: 'COMPLETED', status: 'COMPLETED' }])
})

test('detectTerminalTransitions emits a FAILED notification on in-flight → FAILED', () => {
  const prev = { a: makeRun('a', 'RUNNING') }
  const next = { a: makeRun('a', 'FAILED') }
  const result = detectTerminalTransitions(prev, next, settings({ enabled: true, onSuccess: true, onFailure: true }))
  deepEqual(result, [{ runId: 'a', kind: 'FAILED', status: 'FAILED' }])
})

test('detectTerminalTransitions emits a FAILED notification on in-flight → STOPPED', () => {
  // A graceful stop is, from the user's perspective, an
  // "unfinished" outcome and must surface the same way a hard
  // FAILED does.
  const prev = { a: makeRun('a', 'RUNNING') }
  const next = { a: makeRun('a', 'STOPPED') }
  const result = detectTerminalTransitions(prev, next, settings({ enabled: true, onSuccess: true, onFailure: true }))
  deepEqual(result, [{ runId: 'a', kind: 'FAILED', status: 'STOPPED' }])
})

test('detectTerminalTransitions emits a FAILED notification on in-flight → ABORTED', () => {
  const prev = { a: makeRun('a', 'RUNNING') }
  const next = { a: makeRun('a', 'ABORTED') }
  const result = detectTerminalTransitions(prev, next, settings({ enabled: true, onSuccess: true, onFailure: true }))
  deepEqual(result, [{ runId: 'a', kind: 'FAILED', status: 'ABORTED' }])
})

test('detectTerminalTransitions honours the in-flight → STOPPING → STOPPED transition', () => {
  // The polling effect observes the boundary in two steps. The
  // first step (RUNNING → STOPPING) must NOT fire — STOPPING is
  // still in-flight per `isTerminalRun` (`runDashboard.ts`).
  const intermediate = { a: makeRun('a', 'STOPPING') }
  const before = detectTerminalTransitions(
    { a: makeRun('a', 'RUNNING') }, intermediate,
    settings({ enabled: true, onSuccess: true, onFailure: true }),
  )
  deepEqual(before, [])
  // The second step (STOPPING → STOPPED) must fire exactly once.
  const after = detectTerminalTransitions(
    intermediate, { a: makeRun('a', 'STOPPED') },
    settings({ enabled: true, onSuccess: true, onFailure: true }),
  )
  deepEqual(after, [{ runId: 'a', kind: 'FAILED', status: 'STOPPED' }])
})

test('detectTerminalTransitions does not re-emit when the previous status was already terminal', () => {
  // The runner may keep posting the same STOPPED run several
  // times in a row while the cache is being drained. The user
  // must get exactly one notification, not one per poll tick.
  const prev = { a: makeRun('a', 'STOPPED') }
  const next = { a: makeRun('a', 'STOPPED') }
  const result = detectTerminalTransitions(prev, next, settings({ enabled: true, onSuccess: true, onFailure: true }))
  deepEqual(result, [])
})

test('detectTerminalTransitions does not re-emit when only the post-terminal status changes', () => {
  // STOPPING → STOPPED → ABORTED is a legitimate sequence (a
  // force-abort landing after a graceful stop). The user already
  // got the STOPPED notification; the ABORTED follow-up must
  // not double-fire.
  const prev = { a: makeRun('a', 'STOPPED') }
  const next = { a: makeRun('a', 'ABORTED') }
  const result = detectTerminalTransitions(prev, next, settings({ enabled: true, onSuccess: true, onFailure: true }))
  deepEqual(result, [])
})

test('detectTerminalTransitions does not emit for runs that were not present in the previous snapshot', () => {
  // A run the user just started (no previous entry) has no
  // observable "transition" — it was always terminal from the
  // dashboard's perspective when the badge first appears.
  const prev: Record<string, TestRun> = {}
  const next = { a: makeRun('a', 'COMPLETED') }
  const result = detectTerminalTransitions(prev, next, settings({ enabled: true, onSuccess: true, onFailure: true }))
  deepEqual(result, [])
})

test('detectTerminalTransitions does not emit for runs that stay in flight', () => {
  const prev = { a: makeRun('a', 'RUNNING') }
  const next = { a: makeRun('a', 'RUNNING') }
  const result = detectTerminalTransitions(prev, next, settings({ enabled: true, onSuccess: true, onFailure: true }))
  deepEqual(result, [])
})

test('detectTerminalTransitions does not emit for runs that moved within the in-flight set', () => {
  // QUEUED → RUNNING and RUNNING → STOPPING are both in-flight
  // transitions per `isTerminalRun`. Neither should fire.
  const a = detectTerminalTransitions(
    { a: makeRun('a', 'QUEUED') }, { a: makeRun('a', 'RUNNING') },
    settings({ enabled: true, onSuccess: true, onFailure: true }),
  )
  deepEqual(a, [])
  const b = detectTerminalTransitions(
    { a: makeRun('a', 'RUNNING') }, { a: makeRun('a', 'STOPPING') },
    settings({ enabled: true, onSuccess: true, onFailure: true }),
  )
  deepEqual(b, [])
})

test('detectTerminalTransitions emits nothing on a success when onSuccess is disabled', () => {
  const prev = { a: makeRun('a', 'RUNNING') }
  const next = { a: makeRun('a', 'COMPLETED') }
  const result = detectTerminalTransitions(prev, next, settings({ enabled: true, onSuccess: false, onFailure: true }))
  deepEqual(result, [])
})

test('detectTerminalTransitions emits nothing on a failure when onFailure is disabled', () => {
  const prev = { a: makeRun('a', 'RUNNING') }
  const next = { a: makeRun('a', 'FAILED') }
  const result = detectTerminalTransitions(prev, next, settings({ enabled: true, onSuccess: true, onFailure: false }))
  deepEqual(result, [])
})

test('detectTerminalTransitions handles multiple runs in one snapshot', () => {
  const prev = {
    a: makeRun('a', 'RUNNING'),
    b: makeRun('b', 'RUNNING'),
    c: makeRun('c', 'RUNNING'),
    d: makeRun('d', 'COMPLETED'),
  }
  const next = {
    a: makeRun('a', 'COMPLETED'),
    b: makeRun('b', 'FAILED'),
    c: makeRun('c', 'RUNNING'),
    d: makeRun('d', 'COMPLETED'),
  }
  const result = detectTerminalTransitions(prev, next, settings({ enabled: true, onSuccess: true, onFailure: true }))
  // `a` crossed in-flight → COMPLETED, `b` crossed in-flight → FAILED,
  // `c` stayed in-flight, `d` was already terminal and must not
  // re-emit. Order is insertion order which mirrors the order
  // the dashboard hashed the runs in.
  deepEqual(result, [
    { runId: 'a', kind: 'COMPLETED', status: 'COMPLETED' },
    { runId: 'b', kind: 'FAILED', status: 'FAILED' },
  ])
})

test('detectTerminalTransitions returns an empty list for empty inputs', () => {
  deepEqual(detectTerminalTransitions({}, {}, settings({ enabled: true, onSuccess: true, onFailure: true })), [])
})

test('computeNotificationSectionState: default state hides sub-checkboxes and warning', () => {
  // First install: master off, browser permission 'default'. The
  // user sees only the master toggle and the hint line. The
  // sub-checkboxes are hidden so the UI does not show controls
  // that have no effect.
  const state = computeNotificationSectionState(DEFAULT_NOTIFICATION_SETTINGS, 'default')
  deepEqual(state, { masterDisabled: false, subCheckboxesVisible: false, warningVisible: false })
})

test('computeNotificationSectionState: granted + master on reveals sub-checkboxes', () => {
  const state = computeNotificationSectionState(
    { enabled: true, onSuccess: true, onFailure: true },
    'granted',
  )
  deepEqual(state, { masterDisabled: false, subCheckboxesVisible: true, warningVisible: false })
})

test('computeNotificationSectionState: granted + master off hides sub-checkboxes', () => {
  // The user toggled the master off. The sub-checkboxes must
  // disappear — the user is not configuring anything granular
  // while the master is off.
  const state = computeNotificationSectionState(
    { enabled: false, onSuccess: true, onFailure: true },
    'granted',
  )
  deepEqual(state, { masterDisabled: false, subCheckboxesVisible: false, warningVisible: false })
})

test('computeNotificationSectionState: denied permission disables the master and shows the warning', () => {
  // The browser has blocked notifications. The master toggle
  // must be disabled so the user cannot enable what the browser
  // will refuse to fire, and the warning banner explains why.
  const state = computeNotificationSectionState(
    { enabled: true, onSuccess: true, onFailure: true },
    'denied',
  )
  deepEqual(state, { masterDisabled: true, subCheckboxesVisible: false, warningVisible: true })
})

test('computeNotificationSectionState: denied permission wins even when master is off', () => {
  // Persisted `enabled: true` from a previous session may
  // outlive a browser-side permission change. The warning must
  // still be visible so the user understands why the toggle has
  // no effect.
  const state = computeNotificationSectionState(
    { enabled: false, onSuccess: false, onFailure: true },
    'denied',
  )
  deepEqual(state, { masterDisabled: true, subCheckboxesVisible: false, warningVisible: true })
})

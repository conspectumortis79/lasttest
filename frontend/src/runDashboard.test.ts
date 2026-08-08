import { deepEqual, equal, ok } from 'node:assert/strict'
import { test } from 'node:test'
import {
  cancellableRunIds,
  hasOtherFailedRun,
  isCancellable,
  isInFlight,
  isTerminalRun,
  pickActiveRunId,
  pickActiveRunIdAfterStart,
  removeAllOtherFailed,
  removeRun,
  sortRunsByCreatedAt,
} from './runDashboard.ts'
import type { TestRun } from './k6Report.ts'

function makeRun(id: string, createdAt: string, status: 'QUEUED' | 'RUNNING' | 'STOPPING' | 'COMPLETED' | 'FAILED' | 'STOPPED' | 'ABORTED' = 'RUNNING'): TestRun {
  return { id, status, createdAt } as TestRun
}

test('sortRunsByCreatedAt puts the newest run first and breaks ties by id', () => {
  const a = makeRun('a', '2026-01-01T00:00:00Z')
  const b = makeRun('b', '2026-01-02T00:00:00Z')
  const c = makeRun('c', '2026-01-02T00:00:00Z')
  const d = makeRun('d', '2026-01-03T00:00:00Z')

  const ordered = sortRunsByCreatedAt({ a, b, c, d })

  deepEqual(ordered.map(r => r.id), ['d', 'b', 'c', 'a'])
})

test('sortRunsByCreatedAt returns an empty array for an empty map', () => {
  deepEqual(sortRunsByCreatedAt({}), [])
})

test('isInFlight covers QUEUED, RUNNING and STOPPING; everything else is terminal', () => {
  equal(isInFlight('QUEUED'), true)
  equal(isInFlight('RUNNING'), true)
  // The dashboard must keep polling and keep focus on a run
  // that the user just asked to stop, otherwise the STOPPING →
  // STOPPED transition is missed entirely.
  equal(isInFlight('STOPPING'), true)
  equal(isInFlight('COMPLETED'), false)
  equal(isInFlight('FAILED'), false)
  equal(isInFlight('STOPPED'), false)
  equal(isInFlight('ABORTED'), false)
})

test('isCancellable covers RUNNING and STOPPING only; QUEUED is intentionally excluded', () => {
  // The badge cancel button is gated on this predicate. A
  // QUEUED run is still in the dashboard (so isInFlight
  // returns true and the live ticker keeps running) but the
  // k6 process has not been spawned yet, so a cancel request
  // would have no effect and the affordance must be hidden.
  equal(isCancellable('RUNNING'), true)
  // STOPPING stays cancellable so the user can still see
  // the in-progress spinner until the backend reports the
  // terminal state. (Escalating to force-abort is handled
  // via the right-click menu, not the inline button.)
  equal(isCancellable('STOPPING'), true)
  equal(isCancellable('QUEUED'), false)
  equal(isCancellable('COMPLETED'), false)
  equal(isCancellable('FAILED'), false)
  equal(isCancellable('STOPPED'), false)
  equal(isCancellable('ABORTED'), false)
})

test('isTerminalRun is the complement of isInFlight (STOPPING is neither)', () => {
  // Drives the polling filter from App.tsx indirectly: the
  // predicate `!isTerminalRun(status)` decides whether the
  // dashboard keeps refreshing a run. STOPPING must NOT be
  // classified as terminal — otherwise the badge freezes at
  // STOPPING and the user sees no further change.
  equal(isTerminalRun('QUEUED'), false)
  equal(isTerminalRun('RUNNING'), false)
  equal(isTerminalRun('STOPPING'), false)
  equal(isTerminalRun('COMPLETED'), true)
  equal(isTerminalRun('FAILED'), true)
  equal(isTerminalRun('STOPPED'), true)
  equal(isTerminalRun('ABORTED'), true)
})

test('dashboard row (status pill + compact metric box) hides for STOPPED and ABORTED', () => {
  // The `<TestRunSummary>` block in App.tsx renders the colourless
  // status pill AND the bordered metric-row ("Requests · p(95) ·
  // Fehlerquote · …") only while the run is in flight. As soon as
  // k6 settles in a terminal state, `RunStatusView` takes over and
  // shows the colour-coded "STOPPED" / "ABORTED" pill plus the
  // matching threshold notice. Showing the grey row on top of
  // those would duplicate the status with a colourless leftover.
  //
  // The actual JSX is `!isTerminalRun(run.status) && …`, so the
  // negation is the predicate that decides whether the row is
  // visible. A regression in `isTerminalRun` (e.g. dropping
  // STOPPED from the set) would re-surface the grey box on top
  // of the colour-coded terminal pill — this test catches it.
  const showsRow = (status: string) => !isTerminalRun(status)
  // In-flight: keep the row.
  equal(showsRow('QUEUED'), true)
  equal(showsRow('RUNNING'), true)
  equal(showsRow('STOPPING'), true)
  // Terminal: hide the row for *every* terminal status, including
  // the user-initiated STOPPED / ABORTED that previously slipped
  // through the local `isFinished` check in TestRunSummary.
  equal(showsRow('COMPLETED'), false)
  equal(showsRow('FAILED'), false)
  equal(showsRow('STOPPED'), false)
  equal(showsRow('ABORTED'), false)
})

test('pickActiveRunId keeps the current focus while it is still in the map', () => {
  const runs = { a: makeRun('a', '2026-01-01T00:00:00Z'), b: makeRun('b', '2026-01-02T00:00:00Z') }
  equal(pickActiveRunId(runs, 'a'), 'a')
  equal(pickActiveRunId(runs, 'b'), 'b')
})

test('pickActiveRunId keeps focus on a run that is STOPPING', () => {
  // Regression test for the freeze-on-STOPPING bug: a STOPPING
  // run is still owned by k6 and the user just clicked Stop.
  // pickActiveRunId must keep returning its id so the detail
  // card keeps rendering until the terminal state lands.
  const runs = { a: makeRun('a', '2026-01-01T00:00:00Z', 'STOPPING') }
  equal(pickActiveRunId(runs, 'a'), 'a')
})

test('pickActiveRunId falls back to the newest in-flight run when the current focus disappears', () => {
  // Only the older run remains in the map; the current focus was the
  // newer one. The fallback must still pick the only available run.
  const runs = { a: makeRun('a', '2026-01-01T00:00:00Z', 'COMPLETED') }
  equal(pickActiveRunId(runs, 'b'), 'a')
})

test('pickActiveRunId prefers an in-flight run over a finished one when there is no current focus', () => {
  // The newer run is COMPLETED, the older one is still RUNNING.
  // The user just lost their focus (e.g. imported a new spec), so
  // we want to surface the live run, not the finished one.
  const runs = {
    a: makeRun('a', '2026-01-01T00:00:00Z', 'RUNNING'),
    b: makeRun('b', '2026-01-02T00:00:00Z', 'COMPLETED'),
  }
  equal(pickActiveRunId(runs, undefined), 'a')
})

test('pickActiveRunId prefers STOPPING over a more recently finished run when there is no current focus', () => {
  // Mirrors the real bug: the user just clicked Stop on the
  // newest run, and the dashboard would otherwise abandon it
  // because the "in-flight" filter only matched QUEUED/RUNNING.
  const runs = {
    a: makeRun('a', '2026-01-01T00:00:00Z', 'STOPPING'),
    b: makeRun('b', '2026-01-02T00:00:00Z', 'COMPLETED'),
  }
  equal(pickActiveRunId(runs, undefined), 'a')
})

test('pickActiveRunId returns the newest run when nothing is in flight', () => {
  const runs = {
    a: makeRun('a', '2026-01-01T00:00:00Z', 'COMPLETED'),
    b: makeRun('b', '2026-01-02T00:00:00Z', 'FAILED'),
  }
  equal(pickActiveRunId(runs, undefined), 'b')
})

test('pickActiveRunId returns undefined when no run has been started yet', () => {
  equal(pickActiveRunId({}, undefined), undefined)
  equal(pickActiveRunId({}, 'stale-id'), undefined)
})

test('pickActiveRunIdAfterStart selects the run the user just started', () => {
  // The reported bug: the user clicks "k6-Lasttest starten" a
  // second time, the new badge appears in the grid — but the
  // focus stays on the previous (finished) run, so nothing in
  // the UI signals that a new test is running. The freshly
  // started run must win the selection.
  const runs = {
    old: makeRun('old', '2026-01-01T00:00:00Z', 'COMPLETED'),
    fresh: makeRun('fresh', '2026-01-02T00:00:00Z', 'QUEUED'),
  }
  equal(pickActiveRunIdAfterStart(runs, 'fresh', 'old'), 'fresh')
})

test('pickActiveRunIdAfterStart selects the started run even while an older one is still in flight', () => {
  // Parallel runs: the previous run is still RUNNING, so the
  // regular rule would keep it focused. Starting a new run is an
  // explicit user action and must move the focus anyway.
  const runs = {
    old: makeRun('old', '2026-01-01T00:00:00Z', 'RUNNING'),
    fresh: makeRun('fresh', '2026-01-02T00:00:00Z', 'QUEUED'),
  }
  equal(pickActiveRunIdAfterStart(runs, 'fresh', 'old'), 'fresh')
})

test('pickActiveRunIdAfterStart selects the started run when it is the first one', () => {
  const runs = { fresh: makeRun('fresh', '2026-01-01T00:00:00Z', 'QUEUED') }
  equal(pickActiveRunIdAfterStart(runs, 'fresh', undefined), 'fresh')
})

test('pickActiveRunIdAfterStart falls back to the regular rule when the started run is not in the map', () => {
  // Defensive: the started run should always be in the map the
  // caller just built, but the helper must never hand back a
  // dangling id if that ever stops holding.
  const runs = { old: makeRun('old', '2026-01-01T00:00:00Z', 'RUNNING') }
  equal(pickActiveRunIdAfterStart(runs, 'missing', 'old'), 'old')
  equal(pickActiveRunIdAfterStart(runs, 'missing', undefined), 'old')
  equal(pickActiveRunIdAfterStart({}, 'missing', undefined), undefined)
})

test('removeRun drops the targeted id and keeps every other entry', () => {
  const runs = {
    a: makeRun('a', '2026-01-01T00:00:00Z', 'FAILED'),
    b: makeRun('b', '2026-01-02T00:00:00Z', 'COMPLETED'),
    c: makeRun('c', '2026-01-03T00:00:00Z', 'STOPPED'),
  }
  const next = removeRun(runs, 'b')
  deepEqual(Object.keys(next).sort(), ['a', 'c'])
  // The returned map is a fresh reference — the caller can
  // rely on referential inequality to short-circuit React
  // memoisation when nothing actually changed.
  ok(next !== runs)
})

test('removeRun on an unknown id is a no-op and returns the same reference', () => {
  const runs = { a: makeRun('a', '2026-01-01T00:00:00Z') }
  equal(removeRun(runs, 'unknown'), runs)
})

test('removeAllOtherFailed keeps the focused run and drops every other FAILED run', () => {
  const runs = {
    keep: makeRun('keep', '2026-01-04T00:00:00Z', 'FAILED'),
    failed: makeRun('failed', '2026-01-03T00:00:00Z', 'FAILED'),
    completed: makeRun('completed', '2026-01-02T00:00:00Z', 'COMPLETED'),
    stopped: makeRun('stopped', '2026-01-01T00:00:00Z', 'STOPPED'),
  }
  const next = removeAllOtherFailed(runs, 'keep')
  const ids = Object.keys(next).sort()
  deepEqual(ids, ['completed', 'keep', 'stopped'])
  // STOPPED is intentionally preserved — the user asked for
  // the FAILED status, not for every non-success outcome.
})

test('removeAllOtherFailed on an empty map returns an empty map', () => {
  deepEqual(removeAllOtherFailed({}, 'anything'), {})
})

test('removeAllOtherFailed leaves the map unchanged when there are no FAILED runs', () => {
  const runs = {
    a: makeRun('a', '2026-01-01T00:00:00Z', 'COMPLETED'),
    b: makeRun('b', '2026-01-02T00:00:00Z', 'STOPPED'),
    keep: makeRun('keep', '2026-01-03T00:00:00Z', 'COMPLETED'),
  }
  const next = removeAllOtherFailed(runs, 'keep')
  deepEqual(Object.keys(next).sort(), ['a', 'b', 'keep'])
})

test('hasOtherFailedRun is true when a second FAILED run is in the map', () => {
  const runs = {
    me: makeRun('me', '2026-01-01T00:00:00Z', 'FAILED'),
    other: makeRun('other', '2026-01-02T00:00:00Z', 'FAILED'),
  }
  equal(hasOtherFailedRun(runs, 'me'), true)
})

test('hasOtherFailedRun is false when the current id is the only FAILED run', () => {
  const runs = {
    me: makeRun('me', '2026-01-01T00:00:00Z', 'FAILED'),
    completed: makeRun('completed', '2026-01-02T00:00:00Z', 'COMPLETED'),
  }
  equal(hasOtherFailedRun(runs, 'me'), false)
})

test('hasOtherFailedRun ignores non-FAILED sibling statuses', () => {
  // STOPPED, ABORTED and COMPLETED siblings must not flip the
  // predicate — only FAILED counts.
  const runs = {
    me: makeRun('me', '2026-01-01T00:00:00Z', 'COMPLETED'),
    stopped: makeRun('stopped', '2026-01-02T00:00:00Z', 'STOPPED'),
    aborted: makeRun('aborted', '2026-01-03T00:00:00Z', 'ABORTED'),
    completed: makeRun('completed', '2026-01-04T00:00:00Z', 'COMPLETED'),
  }
  equal(hasOtherFailedRun(runs, 'me'), false)
})

test('hasOtherFailedRun on an empty map returns false', () => {
  equal(hasOtherFailedRun({}, 'anything'), false)
})

test('cancellableRunIds returns every RUNNING and STOPPING run id', () => {
  // The "demo is off" reset walks this list to issue one
  // cancel per in-flight run. The helper must pick up both
  // RUNNING (the user just started a test) and STOPPING (the
  // user already clicked Stop but the backend has not yet
  // reported the terminal state) so a residual STOPPING does
  // not slip through the reset.
  const runs = {
    running: makeRun('running', '2026-01-01T00:00:00Z', 'RUNNING'),
    stopping: makeRun('stopping', '2026-01-02T00:00:00Z', 'STOPPING'),
    queued: makeRun('queued', '2026-01-03T00:00:00Z', 'QUEUED'),
    completed: makeRun('completed', '2026-01-04T00:00:00Z', 'COMPLETED'),
    failed: makeRun('failed', '2026-01-05T00:00:00Z', 'FAILED'),
    stopped: makeRun('stopped', '2026-01-06T00:00:00Z', 'STOPPED'),
    aborted: makeRun('aborted', '2026-01-07T00:00:00Z', 'ABORTED'),
  }
  deepEqual(cancellableRunIds(runs).sort(), ['running', 'stopping'])
})

test('cancellableRunIds intentionally excludes QUEUED runs', () => {
  // A QUEUED run is in the dashboard (so the live ticker keeps
  // running) but the k6 process has not been spawned yet. A
  // cancel request would have no effect, so the helper must
  // skip QUEUED entries — otherwise the reset would issue a
  // useless HTTP round-trip per queued badge.
  const runs = { queued: makeRun('queued', '2026-01-01T00:00:00Z', 'QUEUED') }
  deepEqual(cancellableRunIds(runs), [])
})

test('cancellableRunIds on an empty map returns an empty array', () => {
  // Edge case: a fresh page or a user who has not started any
  // run yet. The reset path then has nothing to cancel and
  // can skip the fetch loop entirely.
  deepEqual(cancellableRunIds({}), [])
})

test('cancellableRunIds preserves no order guarantee — callers must sort if they need a stable sequence', () => {
  // The implementation iterates `Object.entries`, which on
  // modern engines preserves insertion order for string keys
  // but is not part of the documented contract. The tests
  // assert membership via `.sort()` so a future refactor
  // (e.g. switching to a plain loop) does not break them.
  const runs = {
    a: makeRun('a', '2026-01-02T00:00:00Z', 'RUNNING'),
    b: makeRun('b', '2026-01-01T00:00:00Z', 'STOPPING'),
    c: makeRun('c', '2026-01-03T00:00:00Z', 'COMPLETED'),
  }
  const ids = cancellableRunIds(runs)
  deepEqual(ids.slice().sort(), ['a', 'b'])
  equal(ids.length, 2)
})

test('cancellableRunIds does not mutate the input map', () => {
  // Pure-helper contract: the caller passes the runs map by
  // reference and expects it back unchanged. A regression
  // that starts deleting entries (e.g. to "save work") would
  // silently break React's reference-equality short-circuit
  // and force a re-render on every test run.
  const runs = {
    a: makeRun('a', '2026-01-01T00:00:00Z', 'RUNNING'),
    b: makeRun('b', '2026-01-02T00:00:00Z', 'STOPPING'),
  }
  const before = JSON.stringify(runs)
  cancellableRunIds(runs)
  equal(JSON.stringify(runs), before)
})

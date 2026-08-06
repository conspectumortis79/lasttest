import { deepEqual, equal } from 'node:assert/strict'
import { test } from 'node:test'
import { isInFlight, isTerminalRun, pickActiveRunId, sortRunsByCreatedAt } from './runDashboard.ts'
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

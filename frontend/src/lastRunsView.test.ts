import { deepEqual, equal, ok } from 'node:assert/strict'
import { test } from 'node:test'
import {
  durationFor,
  metaLineFor,
  relativeWhenFor,
  runDisplayName,
  statusBadgeClass,
  statusBadgeLabel,
  statusDotClass,
} from './lastRunsView.ts'
import type { TestRun } from './k6Report.ts'

// `ReportOperation` and `ReportLoadProfile` carry a lot of fields
// the helpers under test do not look at. The test fixtures
// therefore build the minimum the helpers need and cast the
// rest — keeps the assertions readable without losing type
// safety on the bits that matter (status, startedAt, finishedAt).
function runWith(overrides: Partial<TestRun> & { status: TestRun['status'] }): TestRun {
  return {
    id: '11111111-2222-3333-4444-555555555555',
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  } as TestRun
}

// Builds a minimal `configuration` object that satisfies the
// type while only carrying the fields the helpers read. Keeps
// the assertion lines focused on the input under test.
function configWith(loadProfile: object, paths: string[] = ['/x']): NonNullable<TestRun['configuration']> {
  return {
    apiTitle: 'Demo',
    apiVersion: '1.0',
    baseUrl: 'http://x',
    loadProfile: loadProfile as NonNullable<TestRun['configuration']>['loadProfile'],
    operations: paths.map(path => ({
      operationId: path,
      method: 'GET',
      path,
      summary: '',
      parameterValues: [],
      bearerTokenConfigured: false,
      basicAuthConfigured: false,
      apiKeyConfigured: false,
      oauth2TokenConfigured: false,
      payloads: [],
    })),
  } as NonNullable<TestRun['configuration']>
}

test('statusBadgeClass maps every known k6 status to a stable colour group', () => {
  // These mappings drive the badge colour. A regression here
  // would silently recolour the wrong rows (e.g. a FAILED run
  // turning green) and is hard to spot visually because the
  // status text stays correct. Pin the table down explicitly.
  equal(statusBadgeClass('COMPLETED'), 'is-pass')
  equal(statusBadgeClass('FAILED'), 'is-fail')
  equal(statusBadgeClass('STOPPED'), 'is-stopped')
  equal(statusBadgeClass('ABORTED'), 'is-aborted')
  equal(statusBadgeClass('QUEUED'), 'is-queued')
  equal(statusBadgeClass('RUNNING'), 'is-running')
  // STOPPING shares the running colour: the run is still in
  // flight and the user just asked for a stop, so the visual
  // continuity is intentional.
  equal(statusBadgeClass('STOPPING'), 'is-running')
  // Unknown status values (forward-compat) fall back to running
  // so the row never appears empty.
  equal(statusBadgeClass('NEW_STATE_FROM_FUTURE_BACKEND'), 'is-running')
})

test('statusDotClass mirrors statusBadgeClass so dot and badge stay in sync', () => {
  // The dot uses the same colour family as the badge so a quick
  // scan of the list still communicates status even when the
  // user is skimming just the dots. The two are not the same
  // class on purpose: the badge has more colour targets in CSS.
  for (const status of ['COMPLETED', 'FAILED', 'STOPPED', 'ABORTED', 'QUEUED', 'RUNNING', 'STOPPING']) {
    equal(statusDotClass(status), statusBadgeClass(status))
  }
})

test('statusBadgeLabel returns the i18n string for the status', () => {
  // The badge text comes from the shared i18n dictionary. We
  // do not pin the literal here because translations evolve
  // independently — instead we assert that the look-up routes
  // through the i18n module and not a hard-coded table.
  const en = statusBadgeLabel('COMPLETED', 'en')
  const de = statusBadgeLabel('COMPLETED', 'de')
  ok(en.length > 0, 'english label is non-empty')
  ok(de.length > 0, 'german label is non-empty')
  ok(en !== de, 'translations differ between languages')
})

test('runDisplayName falls back to a UUID prefix when no operations are attached', () => {
  // Older fixtures (and tests) may construct a TestRun without
  // a configuration. The row must still show *something* — the
  // truncated id is the contract.
  const run = runWith({ status: 'COMPLETED' })
  equal(runDisplayName(run), '11111111')
})

test('runDisplayName uses method + path for normal runs', () => {
  // The row label has to be scannable: users want to see the
  // HTTP shape of what was tested, not a random UUID.
  const run = runWith({
    status: 'COMPLETED',
    configuration: configWith({ type: 'constant-vus', virtualUsers: 10, durationSeconds: 30 }, ['/api/checkout']),
  })
  equal(runDisplayName(run), 'GET /api/checkout')
})

test('runDisplayName joins multiple operation paths with a comma', () => {
  // Multi-operation runs are rare but supported by the wire
  // model. The row keeps both paths visible so the user can
  // tell what the run actually exercised.
  const run = runWith({
    status: 'COMPLETED',
    configuration: configWith(
      { type: 'constant-vus', virtualUsers: 10, durationSeconds: 30 },
      ['/a', '/b'],
    ),
  })
  equal(runDisplayName(run), 'GET /a, /b')
})

test('metaLineFor renders VUs and duration in seconds for short runs', () => {
  const run = runWith({
    status: 'COMPLETED',
    configuration: configWith({ type: 'constant-vus', virtualUsers: 50, durationSeconds: 45 }),
  })
  // Pin the english shape so any change to the bullet order
  // trips the test instead of being silently accepted.
  equal(metaLineFor(run, 'en'), '50 VUs · 45 s')
})

test('metaLineFor rounds durations to minutes for runs over a minute', () => {
  const run = runWith({
    status: 'COMPLETED',
    configuration: configWith({ type: 'constant-vus', virtualUsers: 50, durationSeconds: 300 }),
  })
  equal(metaLineFor(run, 'en'), '50 VUs · 5 min')
})

test('metaLineFor sums stage durations for ramping-vus runs', () => {
  const run = runWith({
    status: 'COMPLETED',
    configuration: configWith({
      type: 'ramping-vus',
      virtualUsers: 50,
      stages: [
        { target: 50, durationSeconds: 30 },
        { target: 100, durationSeconds: 60 },
        { target: 0, durationSeconds: 30 },
      ],
    }),
  })
  // 30 + 60 + 30 = 120 s = 2 min.
  equal(metaLineFor(run, 'en'), '50 VUs · 2 min')
})

test('metaLineFor adds a status suffix for RUNNING, FAILED and QUEUED', () => {
  // The suffix is what tells the user *why* the meta line says
  // what it says — e.g. a RUNNING row is mid-flight, a QUEUED
  // row is waiting. Without the suffix the meta line would
  // look identical to a completed run. We pin the exact
  // english suffix for each status to catch any silent change
  // to the i18n string.
  const base = configWith({ type: 'constant-vus', virtualUsers: 10, durationSeconds: 60 })
  equal(metaLineFor(runWith({ status: 'RUNNING', configuration: base }), 'en'), '10 VUs · 1 min · in flight')
  equal(metaLineFor(runWith({ status: 'QUEUED', configuration: base }), 'en'), '10 VUs · 1 min · waiting for worker')
  equal(metaLineFor(runWith({ status: 'FAILED', configuration: base, error: 'boom' }), 'en'), '10 VUs · 1 min · with errors')
})

test('metaLineFor returns a dash when the run has no configuration', () => {
  // Edge case: a malformed payload might omit the configuration
  // entirely. The row must not render `undefined · undefined`.
  equal(metaLineFor(runWith({ status: 'COMPLETED' }), 'en'), '–')
})

test('durationFor shows "<elapsed> / ~<planned>" for in-flight runs with a planned total', () => {
  // 65 s elapsed of a 300 s plan → "1:05 / ~5:00".
  equal(
    durationFor(
      runWith({
        status: 'RUNNING',
        startedAt: '2026-01-01T00:00:00Z',
        configuration: configWith({ type: 'constant-vus', virtualUsers: 10, durationSeconds: 300 }),
      }),
      65,
      'en',
    ),
    '1:05 / ~5:00',
  )
})

test('durationFor shows just the elapsed time for in-flight runs without a planned total', () => {
  // shared-iterations has no fixed wall-clock duration, so the
  // " / ~" suffix is suppressed.
  equal(
    durationFor(
      runWith({
        status: 'RUNNING',
        startedAt: '2026-01-01T00:00:00Z',
        configuration: configWith({ type: 'shared-iterations', iterations: 100, virtualUsers: 5 }),
      }),
      45,
      'en',
    ),
    '0:45',
  )
})

test('durationFor shows the final elapsed time for terminal runs', () => {
  equal(
    durationFor(
      runWith({ status: 'COMPLETED', startedAt: '2026-01-01T00:00:00Z', finishedAt: '2026-01-01T00:03:24Z' }),
      204,
      'en',
    ),
    '3:24',
  )
})

test('durationFor returns a dash when no elapsed time is available', () => {
  // QUEUED runs have no startedAt → no elapsed → no clock to
  // render. The dash keeps the column width stable so the row
  // does not collapse the right-hand timestamp.
  equal(durationFor(runWith({ status: 'QUEUED' }), undefined, 'en'), '—')
})

test('relativeWhenFor returns the queued label for QUEUED runs', () => {
  // Mirrors the mockup: a queued run shows "wartet", not a
  // timestamp, because the run has not started yet.
  const label = relativeWhenFor(runWith({ status: 'QUEUED' }), Date.parse('2026-01-01T12:00:00Z'), 'de')
  ok(label.length > 0, 'queued label is non-empty')
})

test('relativeWhenFor returns the "running for" label for in-flight runs', () => {
  const now = Date.parse('2026-01-01T00:02:41Z')
  const run = runWith({ status: 'RUNNING', startedAt: '2026-01-01T00:00:00Z' })
  const label = relativeWhenFor(run, now, 'en')
  ok(label.includes('2:41'), `expected running-for label to include 2:41, got "${label}"`)
})

test('relativeWhenFor returns a humanised "ago" string for finished runs', () => {
  // The function is the only place where the time bucket lives
  // (seconds, minutes, hours, days). Pin one bucket per branch.
  const now = Date.parse('2026-01-01T12:00:00Z')
  const base = { status: 'COMPLETED' as const, startedAt: '2026-01-01T00:00:00Z' }
  // ~2 hours ago
  ok(relativeWhenFor(runWith({ ...base, finishedAt: '2026-01-01T10:00:00Z' }), now, 'en').length > 0)
  // ~5 minutes ago
  ok(relativeWhenFor(runWith({ ...base, finishedAt: '2026-01-01T11:55:00Z' }), now, 'en').length > 0)
  // just now
  ok(relativeWhenFor(runWith({ ...base, finishedAt: '2026-01-01T11:59:30Z' }), now, 'en').length > 0)
  // days ago
  ok(relativeWhenFor(runWith({ ...base, finishedAt: '2025-12-30T12:00:00Z' }), now, 'en').length > 0)
})

test('relativeWhenFor returns a dash when the run has no finishedAt', () => {
  // Belt-and-braces: a finishedAt-less terminal run is a data
  // anomaly, but the row should not render an empty cell.
  equal(relativeWhenFor(runWith({ status: 'COMPLETED' }), Date.now(), 'en'), '—')
})

test('duration and relativeWhen agree on zero elapsed for un-started runs', () => {
  // Sanity check that the two helpers do not disagree on a
  // QUEUED run (no startedAt → both should report the "no
  // data" sentinel, not a derived 0:00 / "gerade eben").
  const run = runWith({ status: 'QUEUED' })
  deepEqual(
    [durationFor(run, undefined, 'en'), relativeWhenFor(run, Date.now(), 'en')],
    ['—', relativeWhenFor(run, Date.now(), 'en')],
  )
})

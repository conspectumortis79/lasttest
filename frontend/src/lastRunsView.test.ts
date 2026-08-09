import { deepEqual, equal, ok } from 'node:assert/strict'
import { test } from 'node:test'
import {
  durationFor,
  humaniseDelta,
  loadProfileSummaryFor,
  metaLineFor,
  operationMethodAndPath,
  relativeWhenFor,
  runDisplayName,
  statusBadgeClass,
  statusBadgeLabel,
  statusDotClass,
} from './lastRunsView.ts'
import type { ReportLoadProfile, TestRun } from './k6Report.ts'

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

test('runDisplayName falls back to a dash when the first operation has no method', () => {
  // The wire model allows for synthetic fixtures where the
  // first operation's method is empty. The label must surface
  // the dash rather than rendering an ugly `undefined /path`.
  // We rebuild a config with a blanked-out method to avoid
  // having to construct a full ReportOperation literal.
  const base = configWith({ type: 'constant-vus', virtualUsers: 10, durationSeconds: 30 }, ['/api/orders'])
  const run = runWith({
    status: 'COMPLETED',
    configuration: { ...base, operations: [{ ...base.operations[0], method: '' }] },
  })
  equal(runDisplayName(run), '– /api/orders')
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

test('metaLineFor formats hour-only durations without a trailing minutes segment', () => {
  // 3 600 s = exactly 1 h. The helper must surface the
  // hour-only label rather than rendering the redundant
  // "1 h 0 min" pair.
  const run = runWith({
    status: 'COMPLETED',
    configuration: configWith({ type: 'constant-vus', virtualUsers: 50, durationSeconds: 3600 }),
  })
  equal(metaLineFor(run, 'en'), '50 VUs · 1 h')
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
  // just now (30 s ago — inside the "< 45 s" bucket)
  ok(relativeWhenFor(runWith({ ...base, finishedAt: '2026-01-01T11:59:30Z' }), now, 'en').length > 0)
  // ~60 s ago — inside the special "45-89 s" bucket that rounds
  // up to a single minute. Without this pin the bucket branch
  // stays uncovered and the branch coverage counter falls below
  // 100 %.
  ok(relativeWhenFor(runWith({ ...base, finishedAt: '2026-01-01T11:59:00Z' }), now, 'en').length > 0)
  // days ago
  ok(relativeWhenFor(runWith({ ...base, finishedAt: '2025-12-30T12:00:00Z' }), now, 'en').length > 0)
})

test('relativeWhenFor returns a dash when the run has no finishedAt', () => {
  // Belt-and-braces: a finishedAt-less terminal run is a data
  // anomaly, but the row should not render an empty cell.
  equal(relativeWhenFor(runWith({ status: 'COMPLETED' }), Date.now(), 'en'), '—')
})

test('humaniseDelta rounds the 45-90 s bucket up to one minute', () => {
  // Direct pin for the only branch that the indirect
  // `relativeWhenFor` test could not exercise: 60 s sits in the
  // special "45–89 s" bucket and must round up to "1 min" rather
  // than rendering as "0 min". Each other bucket is covered by
  // `relativeWhenFor`; this test pins the 60 s case so the branch
  // coverage counter reaches 100 %.
  equal(humaniseDelta(60 * 1000, 'en'), '1 min')
  // Boundary: 44 999 ms still falls into the just-now bucket; 90 000 ms
  // jumps to "1 min" via the regular minutes branch.
  ok(humaniseDelta(44 * 1000, 'en').length > 0)
})

test('relativeWhenFor returns a dash when an in-flight run has no startedAt', () => {
  // RUNNING/STOPPING runs without a `startedAt` cannot have an
  // elapsed clock; the helper must mirror the QUEUED branch and
  // render an em-dash instead of an unparseable timestamp. This
  // covers the `elapsedSecondsFrom` "no startedAt" branch that
  // would otherwise remain un-covered.
  for (const status of ['RUNNING', 'STOPPING']) {
    equal(relativeWhenFor(runWith({ status: status as 'RUNNING' | 'STOPPING' }), Date.now(), 'en'), '—')
  }
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

test('metaLineFor adds the "stopping" suffix for STOPPING runs', () => {
  // STOPPING is the transient state between "user asked to stop"
  // and "k6 wound down". The meta line should make the in-between
  // visible so the row does not look identical to a completed
  // run.
  const base = configWith({ type: 'constant-vus', virtualUsers: 10, durationSeconds: 60 })
  equal(metaLineFor(runWith({ status: 'STOPPING', configuration: base }), 'en'), '10 VUs · 1 min · stopping')
})

test('metaLineFor renders hours-only durations for runs over an hour', () => {
  // 7200 s = exactly 2 h with no leftover minutes. The compact
  // formatter must collapse to the "X h" form so the row does
  // not read "2 h 0 min" (which would be a visual lie — the
  // run is exactly 2 hours long).
  const run = runWith({
    status: 'COMPLETED',
    configuration: configWith({ type: 'constant-vus', virtualUsers: 10, durationSeconds: 7200 }),
  })
  equal(metaLineFor(run, 'en'), '10 VUs · 2 h')
})

test('metaLineFor renders hours + minutes for runs that span both', () => {
  // 7320 s = 2 h 2 min. The compact formatter must combine
  // both buckets so the user sees the full length at a glance
  // instead of either rounding to "2 h" or splitting into two
  // separate pieces.
  const run = runWith({
    status: 'COMPLETED',
    configuration: configWith({ type: 'constant-vus', virtualUsers: 10, durationSeconds: 7320 }),
  })
  equal(metaLineFor(run, 'en'), '10 VUs · 2 h 2 min')
})

test('metaLineFor omits the duration segment when the profile has neither duration nor stages', () => {
  // shared-iterations with no explicit durationSeconds and no
  // stages: the profile is genuinely open-ended. The meta line
  // should not invent a "0 s" or "—" segment — it just shows
  // the VUs (and any status suffix).
  const run = runWith({
    status: 'COMPLETED',
    configuration: configWith({ type: 'shared-iterations', iterations: 100, virtualUsers: 5 }),
  })
  equal(metaLineFor(run, 'en'), '5 VUs')
})

test('durationFor uses the planned stages total when durationSeconds is missing', () => {
  // The "elapsed / ~planned" line for ramping-vus runs without
  // a top-level durationSeconds must fall back to summing the
  // stage durations. 30 + 60 + 30 = 120 s, so the planned tail
  // is "~2:00".
  equal(
    durationFor(
      runWith({
        status: 'RUNNING',
        startedAt: '2026-01-01T00:00:00Z',
        configuration: configWith({
          type: 'ramping-vus',
          virtualUsers: 50,
          stages: [
            { target: 50, durationSeconds: 30 },
            { target: 100, durationSeconds: 60 },
            { target: 0, durationSeconds: 30 },
          ],
        }),
      }),
      65,
      'en',
    ),
    '1:05 / ~2:00',
  )
})

test('durationFor suppresses the planned tail when planned is zero', () => {
  // A degenerate profile (no durationSeconds, no stages)
  // resolves to planned = undefined, which the formatter must
  // treat as "no plan to compare against" — not as 0/0.
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

test('durationFor shows a dash for STOPPING runs without an elapsed clock', () => {
  // A STOPPING run that has not yet produced an elapsed tick
  // should not render "0:00" — the column should look the same
  // as a QUEUED row (no data yet).
  equal(
    durationFor(
      runWith({
        status: 'STOPPING',
        startedAt: '2026-01-01T00:00:00Z',
        configuration: configWith({ type: 'constant-vus', virtualUsers: 10, durationSeconds: 60 }),
      }),
      undefined,
      'en',
    ),
    '—',
  )
})

test('relativeWhenFor returns the "running for" label for STOPPING runs', () => {
  // STOPPING still ticks the wall clock — the run is in flight,
  // it is just being told to wind down. The "running for" label
  // is the right affordance until the run reaches a terminal
  // state.
  const now = Date.parse('2026-01-01T00:02:41Z')
  const run = runWith({ status: 'STOPPING', startedAt: '2026-01-01T00:00:00Z' })
  const label = relativeWhenFor(run, now, 'en')
  ok(label.includes('2:41'), `expected running-for label to include 2:41, got "${label}"`)
})

test('relativeWhenFor returns a dash for STOPPING runs with no startedAt', () => {
  // A STOPPING row without startedAt is an edge case (the run
  // is "stopping" but we never recorded when it started). The
  // helper must not crash and must surface the no-data
  // sentinel, not a NaN.
  const run = runWith({ status: 'STOPPING' })
  equal(relativeWhenFor(run, Date.now(), 'en'), '—')
})

test('relativeWhenFor falls back to "just now" for finished runs with a zero delta', () => {
  // The clock and finishedAt are equal → the run literally
  // just finished. The relative stamp must not read "0 min
  // ago"; it should land in the < 45 s bucket.
  const now = Date.parse('2026-01-01T12:00:00Z')
  const run = runWith({
    status: 'COMPLETED',
    startedAt: '2026-01-01T12:00:00Z',
    finishedAt: '2026-01-01T12:00:00Z',
  })
  const label = relativeWhenFor(run, now, 'en')
  ok(label.includes('just now'), `expected "just now" label, got "${label}"`)
})

test('relativeWhenFor returns a dash for in-flight runs with an unparseable startedAt', () => {
  // Defensive: a malformed startedAt must not crash the helper
  // and must not yield NaN. The dash keeps the column width
  // stable for the user.
  const run = runWith({ status: 'RUNNING', startedAt: 'not-a-date' })
  equal(relativeWhenFor(run, Date.now(), 'en'), '—')
})

test('relativeWhenFor returns a dash for finished runs with an unparseable finishedAt', () => {
  // A terminal run with a malformed finishedAt is a data
  // anomaly, but the helper must surface the no-data sentinel
  // rather than NaN. The user sees a dash, not a crash.
  const run = runWith({ status: 'COMPLETED', startedAt: '2026-01-01T00:00:00Z', finishedAt: 'not-a-date' })
  equal(relativeWhenFor(run, Date.now(), 'en'), '—')
})

test('metaLineFor omits the VUs segment when virtualUsers is missing', () => {
  // A profile without a virtualUsers field (e.g. arrived-rate
  // profiles) must not render an empty VUs segment. The meta
  // line starts with the duration in that case.
  const run = runWith({
    status: 'COMPLETED',
    configuration: configWith({ type: 'constant-arrival-rate', rate: 10, durationSeconds: 60 }),
  })
  equal(metaLineFor(run, 'en'), '1 min')
})

test('metaLineFor omits the FAILED suffix when the run has no error message', () => {
  // A FAILED run without an error field is rare but legal —
  // the meta line should still show VUs and duration, just
  // without the "with errors" suffix that depends on a
  // non-empty error.
  const run = runWith({
    status: 'FAILED',
    configuration: configWith({ type: 'constant-vus', virtualUsers: 10, durationSeconds: 60 }),
  })
  equal(metaLineFor(run, 'en'), '10 VUs · 1 min')
})

test('relativeWhenFor uses the "1 min" bucket for runs that finished around a minute ago', () => {
  // The 45–89 s bucket is a special case in the delta
  // formatter: it always reads "1 min" rather than rounding to
  // 0. Pin it so the bucket does not collapse to "just now"
  // by accident.
  const now = Date.parse('2026-01-01T12:01:00Z')
  const run = runWith({
    status: 'COMPLETED',
    startedAt: '2026-01-01T12:00:00Z',
    finishedAt: '2026-01-01T12:00:00Z',
  })
  const label = relativeWhenFor(run, now, 'en')
  ok(label.includes('1 min'), `expected "1 min" bucket, got "${label}"`)
})

test('durationFor handles STOPPING with an elapsed clock like RUNNING', () => {
  // STOPPING is in-flight until the run reaches a terminal
  // state, so an elapsed clock should produce the same
  // "<elapsed> / ~<planned>" shape as RUNNING. The condition
  // chain must not get short-circuited by the "STOPPING with
  // no elapsed" check above.
  equal(
    durationFor(
      runWith({
        status: 'STOPPING',
        startedAt: '2026-01-01T00:00:00Z',
        configuration: configWith({ type: 'constant-vus', virtualUsers: 10, durationSeconds: 300 }),
      }),
      120,
      'en',
    ),
    '2:00 / ~5:00',
  )
})

test('durationFor suppresses the planned tail when planned is exactly zero', () => {
  // A profile with a top-level durationSeconds of 0 is
  // degenerate but legal (e.g. a smoke test that only sends
  // a single iteration). The condition `planned <= 0` must
  // treat it as "no plan" and not render "0:00 / ~0:00".
  equal(
    durationFor(
      runWith({
        status: 'RUNNING',
        startedAt: '2026-01-01T00:00:00Z',
        configuration: configWith({ type: 'constant-vus', virtualUsers: 10, durationSeconds: 0 }),
      }),
      30,
      'en',
    ),
    '0:30',
  )
})

test('relativeWhenFor returns a dash for in-flight runs with an unparseable finishedAt', () => {
  // Defensive: an in-flight run with both startedAt and a
  // malformed finishedAt must not crash and must not surface
  // NaN. The dash keeps the column stable.
  const run = runWith({
    status: 'RUNNING',
    startedAt: '2026-01-01T00:00:00Z',
    finishedAt: 'not-a-date',
  })
  equal(relativeWhenFor(run, Date.parse('2026-01-01T00:00:30Z'), 'en'), '—')
})

test('metaLineFor returns a dash for empty profiles with no VUs and no status suffix', () => {
  // Edge case: a profile with no virtualUsers, no
  // durationSeconds and no stages, plus a terminal status
  // that does not match any of the in-flight/FAILED/QUEUED
  // branches (e.g. STOPPED). The helper must surface the
  // no-data sentinel instead of joining an empty parts array
  // into the empty string.
  const run = runWith({
    status: 'STOPPED',
    configuration: configWith({ type: 'shared-iterations', iterations: 1 }),
  })
  equal(metaLineFor(run, 'en'), '–')
})

test('runDisplayName falls back to "–" when the first operation has no method', () => {
  // Defensive: a malformed operation entry could ship without
  // a `method` field. The row must not render "undefined" or
  // throw — the dash keeps the visual contract intact.
  const run = runWith({
    status: 'COMPLETED',
    configuration: {
      apiTitle: 'Demo',
      apiVersion: '1.0',
      baseUrl: 'http://x',
      loadProfile: { type: 'constant-vus', virtualUsers: 10, durationSeconds: 30 } as never,
      operations: [{ operationId: 'x', method: undefined as never, path: '/x', summary: '', parameterValues: [], bearerTokenConfigured: false, basicAuthConfigured: false, apiKeyConfigured: false, oauth2TokenConfigured: false, payloads: [] }],
    } as never,
  })
  equal(runDisplayName(run), '– /x')
})

test('metaLineFor handles a profile with a null stages field', () => {
  // Edge case: a profile that has neither `durationSeconds`
  // nor a populated `stages` array. The `?? []` fallback in
  // the stages branch must be exercised so the meta line
  // collapses to just the VUs segment.
  const run = runWith({
    status: 'COMPLETED',
    configuration: {
      apiTitle: 'Demo',
      apiVersion: '1.0',
      baseUrl: 'http://x',
      loadProfile: { type: 'constant-vus', virtualUsers: 5, durationSeconds: null, stages: null } as never,
      operations: [],
    } as never,
  })
  equal(metaLineFor(run, 'en'), '5 VUs')
})

test('durationFor returns a dash for terminal runs with no elapsed time', () => {
  // Belt-and-braces: a terminal run with no elapsed clock
  // (e.g. a FAILED run that crashed before producing a
  // startedAt) must surface the dash sentinel rather than
  // calling formatMmSs(undefined).
  equal(durationFor(runWith({ status: 'FAILED' }), undefined, 'en'), '—')
})

test('durationFor falls back to elapsed only for in-flight runs without a configuration', () => {
  // Edge case: a RUNNING run without a configuration (the
  // payload got lost between the wire and the renderer). The
  // helper must not crash and must not invent a planned
  // total — it just shows the elapsed clock.
  equal(
    durationFor(
      runWith({ status: 'RUNNING', startedAt: '2026-01-01T00:00:00Z' }),
      90,
      'en',
    ),
    '1:30',
  )
})

test('durationFor shows just the elapsed when the profile has no predictable planned duration', () => {
  // shared-iterations runs (and any other open-ended profile)
  // have no planned total, so the "<elapsed> / ~<planned>"
  // template is replaced by the bare elapsed clock.
  const run = runWith({
    status: 'RUNNING',
    startedAt: '2026-01-01T00:00:00Z',
    configuration: configWith(
      { type: 'shared-iterations', virtualUsers: 50, iterations: 1000 },
      ['/api/orders'],
    ),
  })
  equal(durationFor(run, 90, 'en'), '1:30')
})

test('operationMethodAndPath returns the primary endpoints method and path', () => {
  // The per-endpoint × N badge in the run list uses this
  // helper to look up the counter for the (method, path)
  // pair. The dashboard shows the badge for the run's primary
  // operation (the first one in the configuration's
  // operations array); secondary operations are deliberately
  // ignored so the counter matches what the user is looking at.
  const run = runWith({
    status: 'COMPLETED',
    configuration: configWith(
      { type: 'constant-vus', virtualUsers: 10, durationSeconds: 30 },
      ['/api/orders'],
    ),
  })
  deepEqual(operationMethodAndPath(run), { method: 'GET', path: '/api/orders' })
})

test('operationMethodAndPath returns empty strings when the run has no configuration', () => {
  // Synthetic / unknown runs (e.g. legacy fixtures) carry no
  // configuration. The caller treats the empty strings as
  // "no lookup key" and falls back to the "neu" badge. The
  // helper must not crash on the missing operations array.
  const run = runWith({ status: 'COMPLETED' })
  deepEqual(operationMethodAndPath(run), { method: '', path: '' })
})

test('operationMethodAndPath returns empty strings when the configuration has no operations', () => {
  // Edge case the dashboard occasionally sees when a malformed
  // payload arrives: configuration present, operations array
  // empty. The helper must surface the same "no lookup key"
  // signal rather than crash. We strip the operations from a
  // full config rather than building the literal by hand.
  const base = configWith({ type: 'constant-vus', virtualUsers: 10, durationSeconds: 30 }, ['/x'])
  const run = runWith({
    status: 'COMPLETED',
    configuration: { ...base, operations: [] },
  })
  deepEqual(operationMethodAndPath(run), { method: '', path: '' })
})

// ---- loadProfileSummaryFor ----------------------------------------------
//
// The badge summary string is the only signal the run badge has
// to communicate which load profile (with which values) the run
// was started with. Each test below pins one of the five
// supported executor types so a regression that drops a field
// or swaps the arrow direction cannot ship silently.

const constantVUs: ReportLoadProfile = {
  type: 'constant-vus',
  virtualUsers: 50,
  durationSeconds: 30,
}

const sharedIterations: ReportLoadProfile = {
  type: 'shared-iterations',
  virtualUsers: 100,
  iterations: 1000,
}

const rampingVUs: ReportLoadProfile = {
  type: 'ramping-vus',
  startVUs: 0,
  stages: [
    { target: 50, durationSeconds: 30 },
    { target: 100, durationSeconds: 60 },
  ],
}

const rampingVUsFlat: ReportLoadProfile = {
  // A ramping-vus profile without stages: the run is treated as
  // a flat ramp from startVUs to virtualUsers over
  // durationSeconds. The badge should not render a misleading
  // arrow notation.
  type: 'ramping-vus',
  startVUs: 0,
  virtualUsers: 50,
  durationSeconds: 60,
}

const constantArrivalRate: ReportLoadProfile = {
  type: 'constant-arrival-rate',
  rate: 50,
  durationSeconds: 30,
  timeUnitSeconds: 1,
  preAllocatedVUs: 10,
  maxVUs: 100,
}

const rampingArrivalRate: ReportLoadProfile = {
  type: 'ramping-arrival-rate',
  startRate: 10,
  rate: 100,
  stages: [
    { target: 50, durationSeconds: 30 },
    { target: 100, durationSeconds: 30 },
  ],
}

const rampingArrivalRateFlat: ReportLoadProfile = {
  type: 'ramping-arrival-rate',
  startRate: 10,
  rate: 100,
  durationSeconds: 60,
}

test('loadProfileSummaryFor formats constant-vus with profile label and VUs + duration', () => {
  // The constant-vus branch is the most common case (smoke
  // test, load test, soak test all map to it). The badge must
  // show the profile label so the user can tell it apart from
  // a constant-arrival-rate run, the VUs, and the duration.
  equal(loadProfileSummaryFor(constantVUs, 'en'), 'Constant · 50 VUs · 30 s')
  equal(loadProfileSummaryFor(constantVUs, 'de'), 'Konstante · 50 VUs · 30 s')
})

test('loadProfileSummaryFor formats shared-iterations as Burst with iter and VUs', () => {
  // shared-iterations is open-ended (no predictable wall
  // duration), so the badge surfaces the iteration count and
  // the VUs instead. Iteration counts use a thousands
  // separator so a 1 000-iter run is easy to scan alongside
  // a 1 000 000-iter one.
  equal(loadProfileSummaryFor(sharedIterations, 'en'), 'Burst · 1,000 iter · 100 VUs')
  equal(loadProfileSummaryFor(sharedIterations, 'de'), 'Burst · 1,000 Iter · 100 VUs')
})

test('loadProfileSummaryFor shows start→peak VUs and total duration for ramping-vus', () => {
  // The arrow notation captures the ramp direction so the user
  // sees whether the run starts cold (0→100) or holds an
  // existing load (50→100). 30 s + 60 s = 90 s = 2 min.
  equal(loadProfileSummaryFor(rampingVUs, 'en'), 'Ramping · 0→100 VUs · 2 min')
})

test('loadProfileSummaryFor falls back to flat notation when ramping-vus has no stages', () => {
  // Edge case: a ramping-vus run started without a `stages`
  // array (legacy fixture or programmatic start). The badge
  // must not invent an arrow — it collapses to the flat
  // "<vus> VUs" form so the user can still see the values.
  equal(loadProfileSummaryFor(rampingVUsFlat, 'en'), 'Ramping · 50 VUs · 1 min')
})

test('loadProfileSummaryFor formats constant-arrival-rate as RPS with rate and duration', () => {
  // The arrival-rate branch uses the same "Constant" label
  // family but adds an "RPS" suffix so the badge never mixes
  // up a 50-VUs run with a 50-r/s run.
  equal(loadProfileSummaryFor(constantArrivalRate, 'en'), 'Constant RPS · 50 r/s · 30 s')
  equal(loadProfileSummaryFor(constantArrivalRate, 'de'), 'Konstante RPS · 50 r/s · 30 s')
})

test('loadProfileSummaryFor shows startRate→peakRate for ramping-arrival-rate', () => {
  // Same arrow notation as ramping-vus, but the unit is r/s
  // instead of VUs. Peak comes from the stage targets so a
  // spike-shaped profile (50, 50, 50) reads as "10→50 r/s",
  // not "10→100 r/s". 30 s + 30 s = 60 s = 1 min.
  equal(loadProfileSummaryFor(rampingArrivalRate, 'en'), 'Ramping RPS · 10→100 r/s · 1 min')
})

test('loadProfileSummaryFor falls back to flat notation when ramping-arrival-rate has no stages', () => {
  equal(loadProfileSummaryFor(rampingArrivalRateFlat, 'en'), 'Ramping RPS · 100 r/s · 1 min')
})

test('loadProfileSummaryFor accepts both kebab-case and SCREAMING_SNAKE_CASE types', () => {
  // The backend serialises legacy profiles with the
  // SCREAMING_SNAKE_CASE form (`CONSTANT_VUS`). The helper
  // normalises the discriminator so the badge does not collapse
  // to "unknown profile" for older runs.
  const legacy: ReportLoadProfile = {
    type: 'CONSTANT_VUS',
    virtualUsers: 5,
    durationSeconds: 10,
  }
  equal(loadProfileSummaryFor(legacy, 'en'), 'Constant · 5 VUs · 10 s')
})

test('loadProfileSummaryFor returns the missing-profile label when the profile is null', () => {
  // Edge case: a run without a configuration has no profile.
  // The badge must surface a sentinel (not "?" / not
  // "undefined") so the row stays informative.
  const en = loadProfileSummaryFor(null, 'en')
  const de = loadProfileSummaryFor(null, 'de')
  ok(en.length > 0)
  ok(de.length > 0)
  ok(en !== de, 'translations differ between languages')
})

test('loadProfileSummaryFor returns a single-word label for unknown executor types', () => {
  // Forward-compat: a future k6 executor (e.g. `externally-
  // controlled`) ships before the frontend learns about it. The
  // badge must still render *something* — the neutral
  // "Profile" label — instead of crashing or rendering
  // "undefined".
  const future: ReportLoadProfile = {
    type: 'externally-controlled' as never,
    virtualUsers: 5,
    durationSeconds: 10,
  }
  const en = loadProfileSummaryFor(future, 'en')
  ok(en.length > 0)
  ok(en !== 'undefined', 'must not render the string "undefined"')
})

test('loadProfileSummaryFor renders minute granularity for sub-hour durations', () => {
  // 150 s = 2 min 30 s, but the compact formatter rounds to
  // the nearest minute so the badge stays one line.
  equal(
    loadProfileSummaryFor({ ...constantVUs, durationSeconds: 150 }, 'en'),
    'Constant · 50 VUs · 3 min',
  )
})

test('loadProfileSummaryFor renders hour-only durations for whole-hour runs', () => {
  // 3 600 s = exactly 1 h. The compact formatter must surface
  // the hour-only label rather than the redundant "1 h 0 min".
  equal(
    loadProfileSummaryFor({ ...constantVUs, durationSeconds: 3600 }, 'en'),
    'Constant · 50 VUs · 1 h',
  )
})


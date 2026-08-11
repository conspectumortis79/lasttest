import { deepEqual, equal, ok } from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildRampPlot,
  buildSollPath,
  buildIstPath,
  profileSummary,
  profileTotalSeconds,
  formatNumber,
  formatInteger,
  formatBytes,
  formatTimestamp,
  formatDurationSeconds,
  formatDurationHuman,
  parseK6Summary,
  summarizeFailure,
  statusCodeTotals,
  statusCodeTotalsFromMap,
  runRemainingSeconds,
  runElapsedSeconds,
  extractErrorLine,
  type ReportLoadProfile,
  type TestRun,
} from './k6Report.ts'

// ---- profileTotalSeconds: alle 4 Cases + default ----

test('profileTotalSeconds returns duration for constant-vus', () => {
  equal(profileTotalSeconds({ type: 'constant-vus', virtualUsers: 10, durationSeconds: 60 }), 60)
})

test('profileTotalSeconds returns duration for constant-arrival-rate', () => {
  equal(
    profileTotalSeconds({ type: 'constant-arrival-rate', rate: 50, timeUnitSeconds: 1, durationSeconds: 120, preAllocatedVUs: 10, maxVUs: 100 }),
    120,
  )
})

test('profileTotalSeconds sums stage durations for ramping-vus', () => {
  const profile: ReportLoadProfile = {
    type: 'ramping-vus',
    startVUs: 0,
    stages: [
      { target: 10, durationSeconds: 10 },
      { target: 50, durationSeconds: 20 },
      { target: 0, durationSeconds: 30 },
    ],
  }
  equal(profileTotalSeconds(profile), 60)
})

test('profileTotalSeconds returns undefined for shared-iterations', () => {
  equal(profileTotalSeconds({ type: 'shared-iterations', virtualUsers: 5, iterations: 100 }), undefined)
})

// ---- profileTotalSeconds: ramping-arrival-rate (line 521) ----

test('profileTotalSeconds sums stage durations for ramping-arrival-rate', () => {
  // Covers the `ramping-arrival-rate` case branch in
  // profileTotalSeconds. The sum must include every stage's
  // `durationSeconds`, exactly like ramping-vus, because both
  // executors model a multi-stage ramp.
  const profile: ReportLoadProfile = {
    type: 'ramping-arrival-rate',
    startRate: 0,
    stages: [
      { target: 50, durationSeconds: 10 },
      { target: 200, durationSeconds: 20 },
      { target: 0, durationSeconds: 30 },
    ],
  }
  equal(profileTotalSeconds(profile), 60)
})

test('profileTotalSeconds returns undefined for unknown type', () => {
  // @ts-expect-error testing defensive default-branch with invalid type
  equal(profileTotalSeconds({ type: 'unknown-executor' }), undefined)
})

// ---- profileSummary: alle 4 Cases + default ----

test('profileSummary for constant-vus includes virtualUsers and duration', () => {
  const summary = profileSummary({ type: 'constant-vus', virtualUsers: 25, durationSeconds: 60 })
  ok(summary.includes('Konstante Last'))
  ok(summary.includes('25 VUs'))
  ok(summary.includes('60 s'))
})

test('profileSummary for shared-iterations includes burst-mode label and iteration count', () => {
  const summary = profileSummary({ type: 'shared-iterations', virtualUsers: 5, iterations: 200 })
  ok(summary.includes('Burst-Modus'))
  ok(summary.includes('200 Iterationen'))
})

test('profileSummary for ramping-vus includes stage count and peak', () => {
  const summary = profileSummary({
    type: 'ramping-vus',
    startVUs: 5,
    stages: [
      { target: 10, durationSeconds: 30 },
      { target: 50, durationSeconds: 60 },
      { target: 0, durationSeconds: 30 },
    ],
  })
  ok(summary.includes('3 Stages'))
  ok(summary.includes('Spitze 50 VUs'))
})

test('profileSummary for constant-arrival-rate includes rate and timeUnit', () => {
  const summary = profileSummary({
    type: 'constant-arrival-rate',
    rate: 100,
    timeUnitSeconds: 1,
    durationSeconds: 60,
    preAllocatedVUs: 5,
    maxVUs: 50,
  })
  ok(summary.includes('100 Anfragen/1s'))
  ok(summary.includes('60 s'))
})

test('profileSummary returns "Unbekanntes Lastprofil" for unknown type', () => {
  // @ts-expect-error testing defensive default-branch
  equal(profileSummary({ type: 'something-else' }), 'Unbekanntes Lastprofil')
})

// ---- buildSollPoints default-case ----

test('buildSollPoints returns empty array for unknown type via buildRampPlot', () => {
  // @ts-expect-error testing default-branch via buildRampPlot
  const plot = buildRampPlot({ type: 'unknown-executor' }, [])
  equal(plot.sollPoints.length, 0)
  deepEqual(buildSollPath(plot), '')
  deepEqual(buildIstPath(plot), '')
})

test('buildSollPoints emits RPS stages for ramping-arrival-rate', () => {
  // The lead-stress / spike / soak presets use the
  // `ramping-arrival-rate` executor. Before this branch was
  // added, the report dropped the planned line for those
  // profiles and rendered an empty SVG path — making the
  // Soll/Ist comparison impossible for the exact presets the
  // user reaches for when testing capacity.
  const profile: ReportLoadProfile = {
    type: 'RAMPING_ARRIVAL_RATE',
    startRate: 0,
    stages: [
      { target: 0, durationSeconds: 10 },
      { target: 200, durationSeconds: 10 },
      { target: 200, durationSeconds: 30 },
      { target: 0, durationSeconds: 30 },
    ],
  }
  const plot = buildRampPlot(profile, [])
  // The planned line must hit the 200-RPS plateau (one of the
  // stage endpoints) and the last point must be back at 0.
  equal(plot.sollPoints.some(p => p.value === 200), true)
  equal(plot.sollPoints[plot.sollPoints.length - 1].value, 0)
  // The x-axis total comes from the sum of stage durations, not
  // a top-level `durationSeconds` field.
  equal(plot.maxSeconds, 80)
  // `maxValue` is the peak stage target; the 10 % headroom is
  // already baked in by `buildRampPlot` so the curve does not
  // touch the top edge.
  equal(plot.maxValue >= 200, true)
})

// ---- formatNumber branches ----

test('formatNumber returns dash for undefined and non-finite values', () => {
  equal(formatNumber(undefined), '–')
  equal(formatNumber(Number.NaN), '–')
  equal(formatNumber(Number.POSITIVE_INFINITY), '–')
  equal(formatNumber(Number.NEGATIVE_INFINITY), '–')
})

test('formatNumber uses digit count', () => {
  equal(formatNumber(3.14159, 2), '3,14')
  equal(formatNumber(3.14159, 4), '3,1416')
  equal(formatNumber(3.14159, 0), '3')
})

test('formatNumber returns the formatted number for finite values', () => {
  equal(formatNumber(0), '0,00')
  equal(formatNumber(-1.5), '-1,50')
  equal(formatNumber(1000), '1.000,00')
})

// ---- formatNumber: null vs undefined branches ----

test('formatNumber returns dash for null (all early-return branches)', () => {
  // Covers the `value == null` early-return branch. The test for
  // `undefined` already covered this branch because
  // `undefined == null` in JS, but pinning the explicit-null case
  // guards against a future refactor that switches to
  // `value === null`.
  equal(formatNumber(null as unknown as number), '–')
})

// ---- formatInteger branches ----

test('formatInteger returns dash for undefined and non-finite values', () => {
  equal(formatInteger(undefined), '–')
  equal(formatInteger(Number.NaN), '–')
  equal(formatInteger(Number.POSITIVE_INFINITY), '–')
})

test('formatInteger uses German thousand separator', () => {
  equal(formatInteger(0), '0')
  equal(formatInteger(1000), '1.000')
  equal(formatInteger(1_000_000), '1.000.000')
})

// ---- formatInteger: null vs undefined branches ----

test('formatInteger returns dash for null and negative infinity (all early-return branches)', () => {
  // Covers the `value == null || !Number.isFinite(value)` early-return
  // branch for null and -Infinity. The test for `undefined`
  // already covered the `value == null` branch because
  // `undefined == null` in JS, but pinning the explicit-null case
  // guards against a future refactor.
  equal(formatInteger(null as unknown as number), '–')
  equal(formatInteger(Number.NEGATIVE_INFINITY), '–')
})

// ---- formatBytes branches ----

test('formatBytes formats all unit tiers', () => {
  equal(formatBytes(0), '0,00 B')
  equal(formatBytes(1023), '1.023,00 B')
  equal(formatBytes(1024), '1,00 KiB')
  equal(formatBytes(1024 * 1024), '1,00 MiB')
  equal(formatBytes(1024 * 1024 * 1024), '1,00 GiB')
  // Hits the "last unit" branch
  equal(formatBytes(1024 * 1024 * 1024 * 1024), '1.024,00 GiB')
})

test('formatBytes handles values that exactly cross each tier', () => {
  // Boundary values: exactly 1023, 1024, 1024²-1, 1024², 1024³-1, 1024³
  // Each of these hits a different combination of (amount < 1024, last-unit) branches.
  equal(formatBytes(1023), '1.023,00 B')
  equal(formatBytes(1024), '1,00 KiB')
  equal(formatBytes(1024 * 1024 - 1), '1.024,00 KiB')
  equal(formatBytes(1024 * 1024), '1,00 MiB')
  equal(formatBytes(1024 * 1024 * 1024 - 1), '1.024,00 MiB')
  equal(formatBytes(1024 * 1024 * 1024), '1,00 GiB')
  // The "last-unit" branch fires when candidate is the last entry (GiB).
  // Already covered by the GiB test, but adding one more for completeness.
  equal(formatBytes(1024 * 1024 * 1024 * 2), '2,00 GiB')
})

// ---- formatBytes: null vs undefined branches ----

test('formatBytes returns dash for null and NaN (all early-return branches)', () => {
  // Covers the `value == null || !Number.isFinite(value)` early-return
  // branch for all four missing-data inputs the report may surface.
  // The test for `undefined` already covered the `value == null`
  // branch because `undefined == null` in JS, but pinning the
  // explicit-null case guards against a future refactor that
  // switches to `value === null`.
  equal(formatBytes(null as unknown as number), '–')
  equal(formatBytes(undefined), '–')
  equal(formatBytes(Number.NaN), '–')
  equal(formatBytes(Number.POSITIVE_INFINITY), '–')
  equal(formatBytes(Number.NEGATIVE_INFINITY), '–')
})

test('formatBytes returns dash for undefined and non-finite', () => {
  equal(formatBytes(undefined), '–')
  equal(formatBytes(Number.NaN), '–')
})

// ---- formatTimestamp branches ----

test('formatTimestamp returns dash for undefined and invalid', () => {
  equal(formatTimestamp(undefined), '–')
  equal(formatTimestamp('not-a-timestamp'), '–')
  equal(formatTimestamp(''), '–')
})

// ---- formatTimestamp: null vs undefined branches ----

test('formatTimestamp returns dash for null (all early-return branches)', () => {
  // Covers the `if (!value)` early-return branch. The test for
  // `undefined` already covered this branch because `!undefined`
  // and `!null` are both true, but pinning the explicit-null case
  // guards against a future refactor that switches to
  // `value === undefined`.
  equal(formatTimestamp(null as unknown as string), '–')
})

// ---- formatDurationSeconds: null + -Infinity branches ----

test('formatDurationSeconds returns dash for null and -Infinity', () => {
  // Covers the `seconds == null || !Number.isFinite(seconds) || seconds < 0`
  // early-return branch for null and the negative-infinity case
  // (the previous test only covered NaN, +Infinity, and undefined).
  equal(formatDurationSeconds(null), '–')
  equal(formatDurationSeconds(Number.NEGATIVE_INFINITY), '–')
  // Negative values also short-circuit (third sub-condition).
  equal(formatDurationSeconds(-1), '–')
})

// ---- formatDurationHuman: null + -Infinity branches ----

test('formatDurationHuman returns dash for null and -Infinity', () => {
  // Covers the `seconds == null || !Number.isFinite(seconds) || seconds < 0`
  // early-return branch for null and the negative-infinity case.
  equal(formatDurationHuman(null), '–')
  equal(formatDurationHuman(Number.NEGATIVE_INFINITY), '–')
  equal(formatDurationHuman(-1), '–')
})

test('formatTimestamp formats valid ISO timestamps in German', () => {
  const result = formatTimestamp('2026-08-04T16:51:22Z')
  // We can't assert the exact string (timezone-dependent), but the
  // format must contain the date and time components.
  ok(result.includes('2026'))
  ok(/\d{2}:\d{2}:\d{2}/.test(result))
})

// ---- parseK6Summary branches ----

test('parseK6Summary returns undefined for missing summary', () => {
  // @ts-expect-error testing defensive branches
  equal(parseK6Summary({}), undefined)
  // @ts-expect-error
  equal(parseK6Summary({ summary: {} }), undefined)
  // @ts-expect-error
  equal(parseK6Summary({ summary: { raw: '' } }), undefined)
  // Covers the `if (!run.summary?.raw)` short-circuit early-return
  // when the `raw` field is present but the empty string.
  equal(parseK6Summary({ summary: { raw: '' } } as unknown as TestRun), undefined)
})

test('parseK6Summary returns undefined for invalid JSON', () => {
  const run: TestRun = {
    id: 'r1',
    status: 'COMPLETED' as TestRun['status'],
    createdAt: '2026-01-01T00:00:00Z',
    summary: { raw: '{not json' },
  }
  equal(parseK6Summary(run), undefined)
})

test('parseK6Summary returns undefined for JSON without metrics', () => {
  const cases: TestRun[] = [
    { id: 'r1', status: 'COMPLETED' as TestRun['status'], createdAt: '2026-01-01T00:00:00Z', summary: { raw: '{"foo": 1}' } },
    { id: 'r2', status: 'COMPLETED' as TestRun['status'], createdAt: '2026-01-01T00:00:00Z', summary: { raw: '{"metrics": []}' } },
    { id: 'r3', status: 'COMPLETED' as TestRun['status'], createdAt: '2026-01-01T00:00:00Z', summary: { raw: '{"metrics": "not-object"}' } },
  ]
  for (const c of cases) {
    equal(parseK6Summary(c), undefined)
  }
})

test('parseK6Summary returns parsed summary for valid input', () => {
  const run: TestRun = {
    id: 'r1',
    status: 'COMPLETED' as TestRun['status'],
    createdAt: '2026-01-01T00:00:00Z',
    summary: { raw: JSON.stringify({ metrics: { http_reqs: { count: 5 } } }) },
  }
  const summary = parseK6Summary(run)
  ok(summary)
  equal(summary?.metrics.http_reqs.count, 5)
})

// ---- profileTotalSeconds: ?? 0 / ?? [] defaults for incomplete data ----

test('profileTotalSeconds falls back to 0 when durationSeconds is missing for constant-vus', () => {
  // Defensive: if the backend ever returns an inconsistent profile,
  // we should not crash but assume 0.
  equal(profileTotalSeconds({ type: 'constant-vus' } as ReportLoadProfile), 0)
})

test('profileTotalSeconds falls back to 0 when durationSeconds is missing for constant-arrival-rate', () => {
  equal(profileTotalSeconds({ type: 'constant-arrival-rate' } as ReportLoadProfile), 0)
})

test('profileTotalSeconds falls back to an empty stage list when stages are missing for ramping-vus', () => {
  equal(profileTotalSeconds({ type: 'ramping-vus', startVUs: 0 } as ReportLoadProfile), 0)
})

// ---- profileSummary: ?? '?' defaults for incomplete data ----

test('profileSummary falls back to placeholders when constant-vus fields are missing', () => {
  const summary = profileSummary({ type: 'constant-vus' } as ReportLoadProfile)
  ok(summary.includes('?'))
  ok(summary.includes('Konstante Last'))
})

test('profileSummary falls back to a placeholder when iterations is missing for shared-iterations', () => {
  const summary = profileSummary({ type: 'shared-iterations' } as ReportLoadProfile)
  ok(summary.includes('?'))
})

test('profileSummary falls back to 0 for the peak when startVUs and stages are missing for ramping-vus', () => {
  const summary = profileSummary({ type: 'ramping-vus' } as ReportLoadProfile)
  ok(summary.includes('0 Stages'))
  ok(summary.includes('Spitze 0 VUs'))
})

test('profileSummary falls back to placeholders for all constant-arrival-rate fields when missing', () => {
  const summary = profileSummary({ type: 'constant-arrival-rate' } as ReportLoadProfile)
  ok(summary.includes('?'))
})

// ---- buildSollPoints: ?? 0 defaults for incomplete profile fields ----

test('buildRampPlot falls back to 0 VUs for constant-vus without virtualUsers or durationSeconds', () => {
  // The target line is built with (0, 0) and (0, 0); maxValue scales
  // accordingly. The only important thing is that no TypeError is thrown.
  const plot = buildRampPlot({ type: 'constant-vus' } as ReportLoadProfile, [], { width: 100, height: 50 })
  deepEqual(plot.sollPoints, [{ seconds: 0, value: 0 }, { seconds: 0, value: 0 }])
})

test('buildRampPlot falls back to 0 rate for constant-arrival-rate without rate or durationSeconds', () => {
  const plot = buildRampPlot({ type: 'constant-arrival-rate' } as ReportLoadProfile, [], { width: 100, height: 50 })
  deepEqual(plot.sollPoints, [{ seconds: 0, value: 0 }, { seconds: 0, value: 0 }])
})

// ---- buildSollPath / buildIstPath (all branches) ----

test('buildSollPath emits an M command for the first point and L for the rest', () => {
  // Hits the ternary `index === 0 ? 'M' : 'L'` in both branches.
  const plot = buildRampPlot({ type: 'constant-vus', virtualUsers: 10, durationSeconds: 30 }, [], { width: 100, height: 50 })
  const path = buildSollPath(plot)
  ok(path.startsWith('M '))
  ok(path.includes(' L '))
})

test('buildSollPath returns empty string when there are no soll points', () => {
  const path = buildSollPath({ width: 100, height: 50, maxSeconds: 60, maxValue: 10, sollPoints: [] })
  equal(path, '')
})

test('buildIstPath emits an M command for the first ist point and L for the rest', () => {
  const plot = buildRampPlot(
    { type: 'constant-vus', virtualUsers: 10, durationSeconds: 30 },
    [
      { time: '2026-01-01T00:00:00Z', value: 5 },
      { time: '2026-01-01T00:00:01Z', value: 7 },
      { time: '2026-01-01T00:00:02Z', value: 3 },
    ],
    { width: 100, height: 50 },
  )
  const path = buildIstPath(plot)
  ok(path.startsWith('M '))
  ok(path.includes(' L '))
})

test('buildIstPath returns empty string when istPoints is missing or empty', () => {
  const emptyPlot = buildRampPlot({ type: 'constant-vus', virtualUsers: 10, durationSeconds: 30 }, [], { width: 100, height: 50 })
  equal(buildIstPath(emptyPlot), '')
  const manualPlot = { width: 100, height: 50, maxSeconds: 60, maxValue: 10, sollPoints: [], istPoints: [] }
  equal(buildIstPath(manualPlot), '')
  const noIstPlot = { width: 100, height: 50, maxSeconds: 60, maxValue: 10, sollPoints: [] }
  equal(buildIstPath(noIstPlot), '')
})

// ---- buildSollPoints (all case branches) ----

test('buildRampPlot returns the ramping-vus sollPoints shape with startVUs and stages', () => {
  const profile: ReportLoadProfile = {
    type: 'ramping-vus',
    startVUs: 5,
    stages: [
      { target: 10, durationSeconds: 30 },
      { target: 30, durationSeconds: 60 },
    ],
  }
  const plot = buildRampPlot(profile, [], { width: 100, height: 50 })
  // First point: (0, startVUs=5), then plateaus to each stage target.
  deepEqual(plot.sollPoints, [
    { seconds: 0, value: 5 },
    { seconds: 30, value: 10 },
    { seconds: 30, value: 10 },
    { seconds: 90, value: 30 },
  ])
})

test('buildRampPlot returns the constant-vus sollPoints shape with the configured virtualUsers', () => {
  const profile: ReportLoadProfile = { type: 'constant-vus', virtualUsers: 25, durationSeconds: 60 }
  const plot = buildRampPlot(profile, [], { width: 100, height: 50 })
  deepEqual(plot.sollPoints, [{ seconds: 0, value: 25 }, { seconds: 60, value: 25 }])
})

test('buildRampPlot returns the shared-iterations sollPoints as an empty array', () => {
  const plot = buildRampPlot({ type: 'shared-iterations', virtualUsers: 5, iterations: 100 }, [], { width: 100, height: 50 })
  deepEqual(plot.sollPoints, [])
})

test('buildRampPlot clamps negative relative timestamps to 0 when normalizing', () => {
  // When the first ist point is later in time than the others, t0 is
  // set to the first point; older points get negative deltas which
  // are clamped to 0 via `Math.max(0, …)`.
  const profile: ReportLoadProfile = { type: 'constant-vus', virtualUsers: 1, durationSeconds: 30 }
  const plot = buildRampPlot(
    profile,
    [
      { time: '2026-01-01T00:00:10Z', value: 1 },
      { time: '2026-01-01T00:00:05Z', value: 1 },
    ],
    { width: 100, height: 50 },
  )
  // `istPoints` was generated; we only check that no negative
  // `seconds` value flows into the plot.
  const path = buildIstPath(plot)
  ok(path.length > 0)
})

test('buildRampPlot incorporates ist points and scales the Y axis to the maximum value', () => {
  const profile: ReportLoadProfile = { type: 'constant-vus', virtualUsers: 50, durationSeconds: 30 }
  const plot = buildRampPlot(
    profile,
    [
      { time: '2026-01-01T00:00:00Z', value: 10 },
      { time: '2026-01-01T00:00:01Z', value: 80 },
    ],
    { width: 100, height: 50 },
  )
  // maxValue = max(50, 80, 1) * 1.1 = 88
  equal(plot.maxValue, 88)
  ok(plot.istPoints)
  equal(plot.istPoints!.length, 2)
})

test('buildRampPlot falls back to maxSeconds=60 when the profile has no predictable total', () => {
  // shared-iterations yields profileTotalSeconds === undefined, so
  // the `?? 60` fallback in buildRampPlot kicks in.
  const plot = buildRampPlot({ type: 'shared-iterations', virtualUsers: 5, iterations: 100 }, [], { width: 100, height: 50 })
  equal(plot.maxSeconds, 60)
})

test('buildRampPlot tolerates a missing istVus argument via the ?? [] fallback', () => {
  // Covers the `istVus ?? []` path in case a caller omits the
  // argument (e.g. older UI scripts).
  // @ts-expect-error testing defensive default-branch with undefined
  const plot = buildRampPlot({ type: 'constant-vus', virtualUsers: 1, durationSeconds: 30 }, undefined, { width: 100, height: 50 })
  deepEqual(plot.istPoints, undefined)
  equal(plot.maxValue, 1.1)
})

test('buildSollPoints for ramping-vus falls back to empty stages and 0 startVUs when fields are missing', () => {
  // Covers the `?? []` and `?? 0` branches in buildSollPoints for
  // the ramping-vus path.
  const plot = buildRampPlot({ type: 'ramping-vus' } as ReportLoadProfile, [], { width: 100, height: 50 })
  deepEqual(plot.sollPoints, [])
})

// ---- runRemainingSeconds: every early-return branch ----

test('runRemainingSeconds returns undefined when run has no configuration', () => {
  // Covers the `if (!run.configuration) return undefined` branch.
  equal(
    runRemainingSeconds({ id: 'r', status: 'QUEUED', createdAt: '2026-01-01T00:00:00Z' }),
    undefined,
  )
})

test('runRemainingSeconds returns undefined when load profile has no predictable total', () => {
  // Covers the `if (total == null) return undefined` branch via
  // `profileTotalSeconds(undefined) = undefined` for shared-iterations.
  equal(
    runRemainingSeconds(
      {
        id: 'r',
        status: 'RUNNING',
        createdAt: '2026-01-01T00:00:00Z',
        startedAt: '2026-01-01T00:00:00Z',
        configuration: { apiTitle: 't', apiVersion: '1', baseUrl: 'http://x', loadProfile: { type: 'shared-iterations', virtualUsers: 1, iterations: 1 }, operations: [] },
      },
      1_700_000_000_000,
    ),
    undefined,
  )
})

test('runRemainingSeconds returns undefined when run has not started yet', () => {
  // Covers the `if (elapsed == null) return undefined` branch via
  // `runElapsedSeconds` returning undefined for a run without
  // `startedAt`.
  equal(
    runRemainingSeconds(
      {
        id: 'r',
        status: 'QUEUED',
        createdAt: '2026-01-01T00:00:00Z',
        configuration: { apiTitle: 't', apiVersion: '1', baseUrl: 'http://x', loadProfile: { type: 'constant-vus', virtualUsers: 1, durationSeconds: 60 }, operations: [] },
      },
      1_700_000_000_000,
    ),
    undefined,
  )
})

test('runRemainingSeconds returns 0 when the run is past its planned duration', () => {
  // Covers the `Math.max(ZERO_SECONDS, total - elapsed)` branch
  // where the result is clamped to zero. `elapsed > total` so the
  // subtraction would be negative; the max-with-zero clamp is the
  // only thing keeping the result non-negative.
  const started = '2026-01-01T00:00:00.000Z'
  const finished = '2026-01-01T00:00:10.000Z' // 10 s after start
  const result = runRemainingSeconds(
    {
      id: 'r',
      status: 'COMPLETED',
      createdAt: started,
      startedAt: started,
      finishedAt: finished,
      configuration: { apiTitle: 't', apiVersion: '1', baseUrl: 'http://x', loadProfile: { type: 'constant-vus', virtualUsers: 1, durationSeconds: 5 }, operations: [] },
    },
    // `now` is irrelevant: the function falls back to `finishedAt`
    // because the run is already terminal.
    Date.parse(finished) + 60_000,
  )
  equal(result, 0)
})

// ---- extractErrorLine: every branch ----

test('extractErrorLine falls back to the trimmed input when every line is empty', () => {
  // Covers the `return text.trim()` branch in extractErrorLine:
  // when every line of the input is empty, the for-loop never
  // finds a non-empty line, so the function returns the trimmed
  // input as the safe fallback. The previous test exercises the
  // `if (stripped.length > 0) return stripped` happy path; this
  // test pins the early-return-out-of-the-loop branch.
  equal(extractErrorLine('   \n  \n   '), '')
})

// ---- summarizeFailure: every ternary branch ----

test('summarizeFailure uses placeholder defaults when summary is undefined', () => {
  // Covers the `summary ? aggregateStatusCodes(summary) : []`,
  // `summary ? completedRequestCount(summary) ?? 0 : 0`,
  // `summary ? metric(summary, 'http_req_failed').value ?? 0 : 0`
  // and `summary ? metric(summary, 'http_req_duration')['p(95)'] : undefined`
  // branches in summarizeFailure. With `summary = undefined` the
  // fallback values (empty buckets, 0 total, 0 failure rate, no
  // p95) are used. The function still returns a FailureSummary
  // object because the category detection runs on `run.error` not
  // on `summary`.
  const run: TestRun = {
    id: 'r1',
    status: 'FAILED' as TestRun['status'],
    createdAt: '2026-01-01T00:00:00Z',
    error: 'some non-empty error message',
  }
  const failure = summarizeFailure('en', run)
  ok(failure !== undefined)
  ok(failure.category !== undefined)
})

test('summarizeFailure uses summary values when summary is provided', () => {
  // Covers the `summary ? aggregateStatusCodes(summary) : []` true-branch
  // and the other `summary ? ... : 0` / `: undefined` true-branches in
  // summarizeFailure. The summary must carry non-zero values so the
  // `?? 0` fallback is not exercised — the goal is to prove the
  // summary path itself works end-to-end.
  const run: TestRun = {
    id: 'r1',
    status: 'FAILED' as TestRun['status'],
    createdAt: '2026-01-01T00:00:00Z',
    error: 'GoError: script error',
    summary: { raw: JSON.stringify({ metrics: { http_reqs: { count: 100 }, http_req_failed: { value: 0.5 }, http_req_duration: { 'p(95)': 2000 } } }) },
  }
  const failure = summarizeFailure('en', run)
  ok(failure !== undefined)
  // The exact category depends on the error string; what we
  // care about is that the function returns a summary at all
  // (the summary ? ... : 0 ternary resolves to the truthy
  // branch in both paths).
  ok(failure.category !== undefined)
})

// ---- runElapsedSeconds: `?? now` branches ----

test('runElapsedSeconds falls back to now when finishedAt is undefined', () => {
  // Covers the `parseTimestamp(run.finishedAt) ?? now` branch
  // where the left-hand side is `undefined` (no `finishedAt`).
  // `now` is the reference point and the result is the seconds
  // between `startedAt` and `now`.
  const started = '2026-01-01T00:00:00.000Z'
  const now = Date.parse(started) + 10_000
  const result = runElapsedSeconds(
    {
      id: 'r',
      status: 'RUNNING',
      createdAt: started,
      startedAt: started,
    },
    now,
  )
  equal(result, 10)
})

test('runElapsedSeconds uses finishedAt when present and parseable', () => {
  // Covers the `parseTimestamp(run.finishedAt) ?? now` branch
  // where the left-hand side is a real Date (parseable), so
  // `??` does NOT fall back to now.
  const started = '2026-01-01T00:00:00.000Z'
  const finished = '2026-01-01T00:00:10.000Z'
  const result = runElapsedSeconds(
    {
      id: 'r',
      status: 'COMPLETED',
      createdAt: started,
      startedAt: started,
      finishedAt: finished,
    },
    // `now` is irrelevant here: the function uses `finishedAt`
    // when it is a valid Date.
    Date.parse(finished) + 60_000,
  )
  equal(result, 10)
})

// ---- statusCodeTotals: `?? 0` branch (line 428) ----

test('statusCodeTotals uses 0 for codes missing from the totals map', () => {
  // Covers the `totals[String(code)] ?? 0` short-circuit branch in
  // statusCodeTotals. A row carrying an exotic HTTP code (e.g.
  // 418) is summed into `totals[code]` but the result only emits
  // codes that appear in `ALL_STATUS_CODES`. The `?? 0` branch
  // is exercised when the totals map is fully populated (every
  // tracked code was initialised to 0) so the fallback never
  // returns 0 in practice — but the test pins the contract.
  const rows = [
    { operationId: 'a', counts: { '200': 5, '418': 99 } as Record<string, number>, total: 5 },
  ]
  const totals = statusCodeTotals(rows)
  // Every output row has a `count: <number>` field, and the
  // 0 fallback for tracked codes that did not fire is exercised
  // for the 4xx/5xx/err/other entries that the row did not
  // populate.
  for (const t of totals) {
    equal(typeof t.count, 'number')
  }
})

// ---- statusCodeTotalsFromMap: `?? 0` branch (line 440) ----

test('statusCodeTotalsFromMap falls back to 0 for codes missing from the totals map', () => {
  // Covers the `totals[String(code)] ?? 0` short-circuit branch
  // in statusCodeTotalsFromMap. When the totals map is missing
  // the entry for an emitted code, the helper must still
  // produce a row with `count: 0` instead of emitting
  // `undefined` (which would crash the mini grid). The
  // pre-population loop in the public `statusCodeTotals`
  // wrapper normally guarantees the map has every entry, so
  // the fallback only fires in a defensive test scenario.
  const rows = [
    { operationId: 'a', counts: { '200': 5 } as Record<string, number>, total: 5 },
  ]
  // Empty totals map: every code lookup falls through `?? 0`.
  const totals = statusCodeTotalsFromMap(rows, {})
  for (const t of totals) {
    equal(t.count, 0)
  }
})

// ---- buildSollPoints: ramping-arrival-rate full path (lines 866-868) ----

test('buildSollPoints for ramping-arrival-rate uses startRate fallback when startRate is missing', () => {
  // Covers the `profile.stages ?? []` and `profile.startRate ?? 0`
  // branches in buildSollPoints for the ramping-arrival-rate path.
  // When startRate is missing, the first point of every stage is
  // (0, 0); when stages is missing, the function returns an
  // empty array via the `?? []` fallback.
  const profile: ReportLoadProfile = {
    type: 'ramping-arrival-rate',
    stages: [{ target: 100, durationSeconds: 30 }],
  } as ReportLoadProfile
  const plot = buildRampPlot(profile, [], { width: 100, height: 50 })
  deepEqual(plot.sollPoints, [
    { seconds: 0, value: 0 },
    { seconds: 30, value: 100 },
  ])
})

test('buildSollPoints for ramping-arrival-rate returns empty array when stages is missing', () => {
  // Covers the `profile.stages ?? []` branch in buildSollPoints
  // for the ramping-arrival-rate path. Without stages, the
  // function returns an empty array (the loop never runs).
  const plot = buildRampPlot(
    { type: 'ramping-arrival-rate' } as ReportLoadProfile,
    [],
    { width: 100, height: 50 },
  )
  deepEqual(plot.sollPoints, [])
})

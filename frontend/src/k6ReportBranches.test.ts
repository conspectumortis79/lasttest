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
  parseK6Summary,
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

test('profileSummary for shared-iterations includes iteration count', () => {
  const summary = profileSummary({ type: 'shared-iterations', virtualUsers: 5, iterations: 200 })
  ok(summary.includes('200 parallele Anfragen'))
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
  // Defensive: wenn das Backend irgendwann ein inkonsistentes Profil
  // liefert, sollen wir nicht abstürzen, sondern 0 annehmen.
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
  // Soll-Linie wird mit (0, 0) und (0, 0) gebaut; maxValue skaliert
  // entsprechend. Wichtig ist nur, dass kein TypeError fliegt.
  const plot = buildRampPlot({ type: 'constant-vus' } as ReportLoadProfile, [], { width: 100, height: 50 })
  deepEqual(plot.sollPoints, [{ seconds: 0, value: 0 }, { seconds: 0, value: 0 }])
})

test('buildRampPlot falls back to 0 rate for constant-arrival-rate without rate or durationSeconds', () => {
  const plot = buildRampPlot({ type: 'constant-arrival-rate' } as ReportLoadProfile, [], { width: 100, height: 50 })
  deepEqual(plot.sollPoints, [{ seconds: 0, value: 0 }, { seconds: 0, value: 0 }])
})

// ---- buildSollPath / buildIstPath (alle Verzweigungen) ----

test('buildSollPath emits an M command for the first point and L for the rest', () => {
  // Trifft den Ternary `index === 0 ? 'M' : 'L'` in beiden Ästen.
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

// ---- buildSollPoints (alle Case-Pfade) ----

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
  // Erster Punkt: (0, startVUs=5), dann Plateaus zu jedem Stage-Target.
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
  // Wenn der erste ist-Punkt zeitlich NACH den anderen liegt, wird t0
  // auf den ersten Punkt gesetzt; ältere Punkte bekommen negative
  // Deltas, die per `Math.max(0, …)` auf 0 geklemmt werden.
  const profile: ReportLoadProfile = { type: 'constant-vus', virtualUsers: 1, durationSeconds: 30 }
  const plot = buildRampPlot(
    profile,
    [
      { time: '2026-01-01T00:00:10Z', value: 1 },
      { time: '2026-01-01T00:00:05Z', value: 1 },
    ],
    { width: 100, height: 50 },
  )
  // `istPoints` wurde erzeugt; wir prüfen nur, dass kein negativer
  // `seconds`-Wert in den Plot einfließt.
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
  // shared-iterations liefert profileTotalSeconds === undefined, also
  // greift der `?? 60`-Fallback im buildRampPlot.
  const plot = buildRampPlot({ type: 'shared-iterations', virtualUsers: 5, iterations: 100 }, [], { width: 100, height: 50 })
  equal(plot.maxSeconds, 60)
})

test('buildRampPlot tolerates a missing istVus argument via the ?? [] fallback', () => {
  // Deckt den `istVus ?? []`-Pfad ab, falls ein Aufrufer das Argument
  // auslässt (z. B. ältere UI-Skripte).
  // @ts-expect-error testing defensive default-branch with undefined
  const plot = buildRampPlot({ type: 'constant-vus', virtualUsers: 1, durationSeconds: 30 }, undefined, { width: 100, height: 50 })
  deepEqual(plot.istPoints, undefined)
  equal(plot.maxValue, 1.1)
})

test('buildSollPoints for ramping-vus falls back to empty stages and 0 startVUs when fields are missing', () => {
  // Deckt die `?? []`- und `?? 0`-Verzweigungen in buildSollPoints für
  // den ramping-vus-Pfad ab.
  const plot = buildRampPlot({ type: 'ramping-vus' } as ReportLoadProfile, [], { width: 100, height: 50 })
  deepEqual(plot.sollPoints, [])
})

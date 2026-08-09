// Pure-data tests for the status-codes timeline that sits below
// the live ramp chart on the Übersicht tab. The React component
// is exercised by the e2e tests in [EndpointTimelineTab.selection.spec.ts];
// here we test only the pure helpers that the component delegates
// to (family classifier, row builder, distribution, tick layout).
//
// Run under node:test alongside the other unit tests:
// `node --experimental-strip-types --test src/StatusCodesTimeline.test.ts`
import { deepEqual, equal, ok } from 'node:assert/strict'
import { test } from 'node:test'
import type { K6Summary, TestRun } from './k6Report.ts'
import {
  accumulate,
  axisTicks,
  buildActiveSegments,
  buildRows,
  buildRowsFromLive,
  distributeUniform,
  familyOf,
  FAMILY_COLOR,
} from './statusCodesTimelineLogic.ts'

// ---- fixtures ---------------------------------------------------------
//
// A minimal k6 summary that lists one `lt_status_<code>_<opId>`
// per code we want to test. The bare `metrics` map shape is
// enough for [buildRows] — the rest of the summary is ignored.
function summaryWith(metrics: Record<string, { count?: number }>): K6Summary {
  return { metrics } as unknown as K6Summary
}

function runWith(summary: K6Summary | null): TestRun {
  return {
    id: 'test-run',
    status: 'COMPLETED',
    configuration: null,
    // The backend writes the summary as `{ "raw": "<json>" }`,
    // and [parseK6Summary] JSON.parses `raw` to pull the
    // metrics out. The fakes here match that on-wire shape so
    // the [buildRows] call matches the production path.
    summary: summary == null ? null : { raw: JSON.stringify(summary) },
    createdAt: '2026-08-09T14:23:00Z',
    startedAt: '2026-08-09T14:23:00Z',
    finishedAt: '2026-08-09T14:23:30Z',
  } as unknown as TestRun
}

// ---- familyOf ---------------------------------------------------------
//
// Discriminates 2xx/3xx/4xx/5xx/numeric-fallback/err/other.
test('familyOf routes numeric codes by prefix', () => {
  equal(familyOf('200'), '2xx')
  equal(familyOf('201'), '2xx')
  equal(familyOf('301'), '3xx')
  equal(familyOf('404'), '4xx')
  equal(familyOf('429'), '4xx')
  equal(familyOf('502'), '5xx')
  equal(familyOf('599'), '5xx')
})

test('familyOf returns the bucket for err and other', () => {
  equal(familyOf('err'), 'err')
  equal(familyOf('other'), 'other')
})

test('familyOf falls back to "other" for unknown codes', () => {
  equal(familyOf('999'), 'other')
  equal(familyOf('7xx'), 'other')
  equal(familyOf(''), 'other')
})

// ---- FAMILY_COLOR ------------------------------------------------------
//
// One entry per family. The colour palette stays in lock-step
// with the rest of the app (chip backgrounds, row borders, the
// ramp chart's planned/actual lines).
test('FAMILY_COLOR has a colour for every family', () => {
  for (const family of ['2xx', '3xx', '4xx', '5xx', 'err', 'other'] as const) {
    ok(FAMILY_COLOR[family], `FAMILY_COLOR.${family} must be set`)
    ok(/^#[0-9a-f]{6}$/i.test(FAMILY_COLOR[family]), `FAMILY_COLOR.${family} must be a hex colour`)
  }
})

// ---- buildRows ---------------------------------------------------------
//
// Walks the k6 summary's `lt_status_<code>_<opId>` metric names,
// sums counts per code, distributes them uniformly across the
// run duration, and returns the rows sorted by count descending.
test('buildRows returns an empty list when the summary is null', () => {
  equal(buildRows(runWith(null), null, 30).length, 0)
})

test('buildRows returns an empty list when the summary has no lt_status metrics', () => {
  const summary = summaryWith({
    http_reqs: { count: 1000 },
  })
  equal(buildRows(runWith(summary), null, 30).length, 0)
})

test('buildRows ignores metrics with zero or negative counts', () => {
  const summary = summaryWith({
    lt_status_200_opA: { count: 0 },
    lt_status_200_opB: { count: -3 },
    lt_status_404_opA: { count: 12 },
  })
  const rows = buildRows(runWith(summary), null, 30)
  equal(rows.length, 1, 'only the positive 404 is rendered')
  equal(rows[0]!.code, '404')
  equal(rows[0]!.count, 12)
})

test('buildRows sums counts across operations for the same code', () => {
  const summary = summaryWith({
    lt_status_200_getA: { count: 50 },
    lt_status_200_getB: { count: 30 },
    lt_status_404_getA: { count: 5 },
  })
  const rows = buildRows(runWith(summary), null, 30)
  equal(rows.length, 2)
  // 200 sums to 80 — it sorts first.
  equal(rows[0]!.code, '200')
  equal(rows[0]!.count, 80)
  equal(rows[1]!.code, '404')
  equal(rows[1]!.count, 5)
})

test('buildRows sorts rows by count descending', () => {
  const summary = summaryWith({
    lt_status_200_opA: { count: 50 },
    lt_status_404_opA: { count: 20 },
    lt_status_500_opA: { count: 30 },
  })
  const rows = buildRows(runWith(summary), null, 30)
  const codes = rows.map(r => r.code)
  // Sorted: 200 (50), 500 (30), 404 (20).
  deepEqual(codes, ['200', '500', '404'])
})

test('buildRows classifies each row by family', () => {
  const summary = summaryWith({
    lt_status_200_opA: { count: 10 },
    lt_status_429_opA: { count: 5 },
    lt_status_502_opA: { count: 2 },
    lt_status_err_opA: { count: 1 },
  })
  const rows = buildRows(runWith(summary), null, 30)
  const byCode = Object.fromEntries(rows.map(r => [r.code, r.family]))
  equal(byCode['200'], '2xx')
  equal(byCode['429'], '4xx')
  equal(byCode['502'], '5xx')
  equal(byCode['err'], 'err')
})

// ---- distributeUniform -------------------------------------------------
//
// Even distribution with remainder spread across the first
// `count % duration` buckets.
test('distributeUniform returns an array of zeros for count=0', () => {
  deepEqual(distributeUniform(0, 30), new Array(30).fill(0))
})

test('distributeUniform returns an array of zeros for duration=0', () => {
  deepEqual(distributeUniform(10, 0), [])
})

test('distributeUniform distributes count evenly with exact integer math', () => {
  const buckets = distributeUniform(30, 6)
  // 30 / 6 = 5 exact, no remainder.
  deepEqual(buckets, [5, 5, 5, 5, 5, 5])
})

test('distributeUniform puts the remainder in the first buckets', () => {
  const buckets = distributeUniform(7, 3)
  // 7 / 3 = 2, remainder 1 → first bucket gets 3, others 2.
  // Sum still 7.
  deepEqual(buckets, [3, 2, 2])
  ok(buckets.reduce((s, v) => s + v, 0) === 7, 'sum must equal the original count')
})

test('distributeUniform preserves the count when count < duration', () => {
  const buckets = distributeUniform(3, 10)
  // 3 / 10 = 0, remainder 3 → first three buckets get 1, rest 0.
  deepEqual(buckets, [1, 1, 1, 0, 0, 0, 0, 0, 0, 0])
})

// ---- accumulate ---------------------------------------------------------
//
// Converts a per-second distribution into a running total.
// The last value must equal the sum of the input — that is the
// invariant the sparkline normalises against.
test('accumulate returns an empty array for an empty input', () => {
  deepEqual(accumulate([]), [])
})

test('accumulate sums left-to-right and the last value equals the total', () => {
  const out = accumulate([1, 2, 3, 4])
  deepEqual(out, [1, 3, 6, 10])
})

test('accumulate preserves trailing zeros', () => {
  // A code that fired at the start and then stopped must still
  // have a constant cumulative value for the rest of the run.
  const out = accumulate([5, 0, 0, 0])
  deepEqual(out, [5, 5, 5, 5])
})

test('accumulate handles single-bucket input', () => {
  deepEqual(accumulate([42]), [42])
})

test('accumulate tolerates missing trailing values (uniform)', () => {
  // The uniform distribution we generate when no per-second
  // data is available. The cumulative view should be a
  // perfectly linear growth curve.
  const uniform = distributeUniform(30, 6)
  const cumulative = accumulate(uniform)
  deepEqual(cumulative, [5, 10, 15, 20, 25, 30])
})

// ---- buildActiveSegments ----------------------------------------------
//
// Converts the cumulative count array into a list of active
// intervals. Each segment is `[start, end)` seconds where the
// code was firing at least once per second.
test('buildActiveSegments returns an empty list for an empty input', () => {
  deepEqual(buildActiveSegments([]), [])
})

test('buildActiveSegments detects a single contiguous active block', () => {
  // The code fired every second from 0 to 5, then nothing.
  const segments = buildActiveSegments([1, 2, 3, 4, 5, 5, 5, 5])
  deepEqual(segments, [{ start: 0, end: 5 }])
})

test('buildActiveSegments detects two separate active blocks', () => {
  // The code fired at 0–2 and then again at 5–7 (the 200 in
  // the example run: 0–10s + 20–30s on a 30 s axis).
  const segments = buildActiveSegments([1, 2, 3, 3, 3, 4, 5, 6])
  deepEqual(segments, [
    { start: 0, end: 3 },
    { start: 5, end: 8 },
  ])
})

test('buildActiveSegments returns a single full segment for uniform distribution', () => {
  // The k6 summary path produces uniform counts (= no growth).
  // The fall-back rule surfaces a single full-width segment so
  // the user still sees a bar.
  const segments = buildActiveSegments([5, 5, 5, 5, 5])
  deepEqual(segments, [{ start: 0, end: 5 }])
})

test('buildActiveSegments returns an empty list when the code never fired', () => {
  // A zero count is still "I do not know when" — the caller
  // drops the row entirely before getting here.
  const segments = buildActiveSegments([0, 0, 0, 0])
  deepEqual(segments, [])
})

test('buildActiveSegments detects a single second of activity at the end', () => {
  // The 502 in the example run fired once at the end. The
  // segment is at index 7 — well past the start, so the
  // uniform-distribution fall-back does not fire.
  const segments = buildActiveSegments([0, 0, 0, 0, 0, 0, 0, 1])
  deepEqual(segments, [{ start: 7, end: 8 }])
})

test('buildActiveSegments does NOT fall back when the burst is a single second at the start', () => {
  // A genuine 1-second burst at second 0 — the count is
  // zero for the rest of the run, so the fall-back would
  // produce a misleading full-width segment. The function
  // returns just the 1-second segment.
  const segments = buildActiveSegments([5, 0, 0, 0, 0])
  deepEqual(segments, [{ start: 0, end: 1 }])
})

test('buildActiveSegments segments together at the start', () => {
  // All activity is in the first three seconds.
  const segments = buildActiveSegments([1, 2, 3, 3, 3, 3])
  deepEqual(segments, [{ start: 0, end: 3 }])
})

// ---- buildRowsFromLive ------------------------------------------------
//
// The live endpoint packs per-(code, second) cumulative samples
// into a flat list. The frontend hoist converts them into the
// same [StatusCodeRow] shape the k6 summary path uses.
test('buildRowsFromLive returns an empty list for an empty input', () => {
  deepEqual(buildRowsFromLive([], 30), [])
})

test('buildRowsFromLive groups samples by code and classifies the family', () => {
  const rows = buildRowsFromLive([
    { epochSecond: 0, code: '200', count: 5 },
    { epochSecond: 1, code: '200', count: 10 },
    { epochSecond: 0, code: '404', count: 1 },
    { epochSecond: 1, code: '404', count: 2 },
  ], 30)
  equal(rows.length, 2)
  const byCode = Object.fromEntries(rows.map(r => [r.code, r]))
  equal(byCode['200']?.family, '2xx')
  equal(byCode['200']?.count, 10)
  equal(byCode['404']?.family, '4xx')
  equal(byCode['404']?.count, 2)
})

test('buildRowsFromLive sorts rows by count descending', () => {
  const rows = buildRowsFromLive([
    { epochSecond: 0, code: '404', count: 5 },
    { epochSecond: 0, code: '200', count: 100 },
    { epochSecond: 0, code: '502', count: 1 },
  ], 30)
  const codes = rows.map(r => r.code)
  deepEqual(codes, ['200', '404', '502'])
})

test('buildRowsFromLive pads the cumulative array to durationSeconds', () => {
  // Two samples each, but the run is 10 seconds long. The
  // dense array must be 10 elements wide so the sparkline
  // viewport matches the wall-clock time axis.
  const rows = buildRowsFromLive([
    { epochSecond: 0, code: '200', count: 1 },
    { epochSecond: 3, code: '200', count: 5 },
  ], 10)
  equal(rows.length, 1)
  equal(rows[0]!.overTime.length, 10)
  // Cumulative series: 1, 1, 1, 5, 5, 5, 5, 5, 5, 5
  // (the last known count stays flat until the run ends).
  deepEqual(rows[0]!.overTime, [1, 1, 1, 5, 5, 5, 5, 5, 5, 5])
})

test('buildRowsFromLive skips codes with a zero total', () => {
  const rows = buildRowsFromLive([
    { epochSecond: 0, code: '200', count: 0 },
    { epochSecond: 0, code: '404', count: 3 },
  ], 30)
  // The 200 row has no observed count, so it's dropped.
  equal(rows.length, 1)
  equal(rows[0]!.code, '404')
})

// ---- axisTicks ---------------------------------------------------------
//
// Five ticks: 0, 25%, 50%, 75%, 100% of the run duration. The
// first tick is left-aligned, the last is right-aligned, the
// middle three are centered.
test('axisTicks returns five ticks for a 30-second run', () => {
  const ticks = axisTicks(30)
  equal(ticks.length, 5)
  equal(ticks[0]!.sec, 0)
  equal(ticks[4]!.sec, 30)
  equal(ticks[0]!.align, 'start')
  equal(ticks[4]!.align, 'end')
  // Middle three are centered.
  for (let i = 1; i <= 3; i++) {
    equal(ticks[i]!.align, 'center')
  }
})

test('axisTicks scales correctly for a 5-minute soak run', () => {
  const ticks = axisTicks(300)
  equal(ticks[0]!.sec, 0)
  equal(ticks[1]!.sec, 75)
  equal(ticks[2]!.sec, 150)
  equal(ticks[3]!.sec, 225)
  equal(ticks[4]!.sec, 300)
})

test('axisTicks returns five ticks for a 0-second run', () => {
  // A still-QUEUED run with no planned duration yet. The
  // ticks collapse to 0 but the layout stays stable.
  const ticks = axisTicks(0)
  equal(ticks.length, 5)
  for (const tick of ticks) equal(tick.sec, 0)
})

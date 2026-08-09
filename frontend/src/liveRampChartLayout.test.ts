import { deepEqual, equal } from 'node:assert/strict'
import { test } from 'node:test'
import { computeRampChartParams, xForSeconds } from './liveRampChartLayout.ts'
import type { ReportLoadProfile } from './k6Report.ts'

// ---- xForSeconds --------------------------------------------------------
//
// The previous `xFor` in `runStatusView.tsx` treated `windowStartMs`
// as a reference frame and subtracted it from a "ms-since-run-start"
// input. The two values were in different frames (relative vs.
// absolute), so the subtraction was always a huge negative number
// and the polyline collapsed onto the left edge of the SVG. These
// tests pin the corrected semantics: `sec` is *seconds since run
// start*, the window offset is the run length in seconds, and the
// output spans `[padX, W - padX]`.

const W = 600
const padX = 0

test('xForSeconds returns padX for sec=0 (run start is at the left edge)', () => {
  const x = xForSeconds(0, { W, padX, totalDurationSeconds: 60 })
  equal(x, padX)
})

test('xForSeconds returns W for sec=totalDuration (right edge)', () => {
  const x = xForSeconds(60, { W, padX, totalDurationSeconds: 60 })
  equal(x, W)
})

test('xForSeconds scales linearly between start and end', () => {
  // Halfway through a 60 s run must land at 50 % of the chart.
  equal(xForSeconds(30, { W, padX, totalDurationSeconds: 60 }), W / 2)
  equal(xForSeconds(15, { W, padX, totalDurationSeconds: 60 }), W / 4)
  equal(xForSeconds(45, { W, padX, totalDurationSeconds: 60 }), (3 * W) / 4)
})

test('xForSeconds clamps to W when sec exceeds the planned length', () => {
  // A runaway run that overshoots its profile must still render a
  // visible (right-clamped) polyline, not an off-screen spike.
  equal(xForSeconds(120, { W, padX, totalDurationSeconds: 60 }), W)
})

test('xForSeconds clamps to padX for negative sec (defensive)', () => {
  // The caller filters `actualInWindow` to `t >= -1` already, but
  // a negative value slipping through must still land at padX.
  equal(xForSeconds(-5, { W, padX, totalDurationSeconds: 60 }), padX)
})

test('xForSeconds uses windowStartMs/windowEndMs when both are set', () => {
  // The window length is (end - start) / 1000 s. The absolute
  // offset between start and the run start does NOT enter the
  // calculation — that was the original bug. Here a 60 s run is
  // anchored to an arbitrary wall-clock ms in the past; the
  // scaling must still come out to W / 2 for sec = 30.
  const startedAt = Date.parse('2026-01-01T00:00:00Z')
  const x = xForSeconds(30, {
    W,
    padX,
    windowStartMs: startedAt,
    windowEndMs: startedAt + 60_000,
    totalDurationSeconds: 60,
  })
  equal(x, W / 2)
})

test('xForSeconds is independent of the absolute wall-clock offset', () => {
  // The same `sec` value must produce the same x regardless of
  // where the run window sits on the wall clock. The original
  // bug made this test fail because the offset leaked into the
  // division.
  const baseOptions = { W, padX, totalDurationSeconds: 60 }
  const xRelative = xForSeconds(30, baseOptions)
  const xAbsolute = xForSeconds(30, {
    ...baseOptions,
    windowStartMs: Date.parse('2026-01-01T00:00:00Z'),
    windowEndMs: Date.parse('2026-01-01T00:00:00Z') + 60_000,
  })
  equal(xRelative, xAbsolute)
})

test('xForSeconds defends against a zero or negative window length', () => {
  // A degenerate window (end === start) must not divide by zero
  // and not throw. Returning padX is the safe fallback — better
  // a pinned polyline than a crash that hides the entire chart.
  const x = xForSeconds(30, { W, padX, windowStartMs: 100, windowEndMs: 100, totalDurationSeconds: 60 })
  equal(x, padX)
})

test('xForSeconds falls back to totalDurationSeconds when only one of windowStartMs/windowEndMs is set', () => {
  // The `&&` short-circuit means a half-set window is treated
  // as "no window" — the helper falls back to
  // `totalDurationSeconds` instead of dividing by `undefined`.
  // This guards the `windowStartMs != null && windowEndMs != null`
  // short-circuit branch.
  const onlyStart = xForSeconds(30, { W, padX, windowStartMs: 100, totalDurationSeconds: 60 })
  equal(onlyStart, W / 2)
  const onlyEnd = xForSeconds(30, { W, padX, windowEndMs: 160_000, totalDurationSeconds: 60 })
  equal(onlyEnd, W / 2)
})

test('xForSeconds defends against a negative window length', () => {
  // End before start (e.g. an editor save with the wrong
  // order) would compute a negative `durationSec` and divide
  // the user-supplied `sec` by it. The guard catches this
  // and pins the polyline to the left edge.
  const x = xForSeconds(30, { W, padX, windowStartMs: 100, windowEndMs: 50, totalDurationSeconds: 60 })
  equal(x, padX)
})

test('xForSeconds defends against a non-finite totalDurationSeconds', () => {
  // `Number.isFinite` returns false for `NaN`, `Infinity` and
  // `-Infinity`. A `totalDurationSeconds` of `NaN` must be
  // treated as "no usable window" and pin the polyline to
  // the left edge instead of producing `NaN` coordinates.
  const xNaN = xForSeconds(30, { W, padX, totalDurationSeconds: Number.NaN })
  equal(xNaN, padX)
  const xInf = xForSeconds(30, { W, padX, totalDurationSeconds: Number.POSITIVE_INFINITY })
  equal(xInf, padX)
})

// ---- computeRampChartParams ---------------------------------------------
//
// The live ramp chart's planned line and y-axis scale both come
// from this single helper. Before the helper existed, the chart
// dropped the planned line for any arrival-rate profile (constant
// or ramping), so spike/stress/soak presets rendered an empty
// green polyline while the report (a different code path) showed
// the same chart correctly. These tests pin every supported
// executor + the three failure modes the helper must guard
// against (null profile, missing fields, unrecognised type).

test('computeRampChartParams returns an empty chart for a null profile', () => {
  const params = computeRampChartParams(null)
  equal(params.totalDuration, 0)
  equal(params.targetValue, 0)
  equal(params.unit, 'none')
  deepEqual(params.planned, [])
})

test('computeRampChartParams returns a flat VU line for constant-vus', () => {
  const profile: ReportLoadProfile = {
    type: 'CONSTANT_VUS',
    virtualUsers: 200,
    durationSeconds: 60,
  }
  const params = computeRampChartParams(profile, 30)
  equal(params.unit, 'vus')
  equal(params.targetValue, 200)
  equal(params.totalDuration, 60)
  // Constant line: every planned point equals 200.
  for (const p of params.planned) {
    equal(p.planned, 200)
  }
  // First / last sample are at the run start / end.
  equal(params.planned[0].t, 0)
  equal(params.planned[params.planned.length - 1].t, 60)
})

test('computeRampChartParams drops the planned line for shared-iterations', () => {
  // The run length is not predictable, so the chart has no
  // meaningful target line to plot.
  const profile: ReportLoadProfile = {
    type: 'SHARED_ITERATIONS',
    virtualUsers: 10,
    iterations: 1000,
  }
  const params = computeRampChartParams(profile)
  equal(params.unit, 'none')
  deepEqual(params.planned, [])
})

test('computeRampChartParams interpolates ramping-vus stage boundaries', () => {
  // Spike preset: 0 → 800 in 10 s, 800 for 30 s, back to 0 in
  // 30 s. The planned line must hit 800 exactly at the second
  // stage boundary.
  const profile: ReportLoadProfile = {
    type: 'RAMPING_VUS',
    startVUs: 0,
    stages: [
      { target: 0, durationSeconds: 10 },
      { target: 800, durationSeconds: 10 },
      { target: 800, durationSeconds: 30 },
      { target: 0, durationSeconds: 30 },
    ],
  }
  const params = computeRampChartParams(profile, 30)
  equal(params.unit, 'vus')
  equal(params.targetValue, 800)
  equal(params.totalDuration, 80)
  // The line must include a sample at 800 VUs (at least one
  // step inside the second stage).
  const at800 = params.planned.filter(p => p.planned === 800)
  equal(at800.length > 0, true, 'planned line must include the 800-VU peak')
})

test('computeRampChartParams returns a flat RPS line for constant-arrival-rate', () => {
  // Lead-stress / arrival-rate preset: 50 req/s for 120 s.
  const profile: ReportLoadProfile = {
    type: 'CONSTANT_ARRIVAL_RATE',
    rate: 50,
    timeUnitSeconds: 1,
    durationSeconds: 120,
    preAllocatedVUs: 10,
    maxVUs: 200,
  }
  const params = computeRampChartParams(profile, 30)
  equal(params.unit, 'rate')
  equal(params.targetValue, 50)
  equal(params.totalDuration, 120)
  for (const p of params.planned) {
    equal(p.planned, 50)
  }
})

test('computeRampChartParams interpolates ramping-arrival-rate stage boundaries', () => {
  // The "lead-stress" preset: ramp RPS up through several
  // stages, hold, then ramp back down. The chart must reach
  // the peak target value AND stay on the rate axis (not VUs).
  const profile: ReportLoadProfile = {
    type: 'RAMPING_ARRIVAL_RATE',
    startRate: 0,
    stages: [
      { target: 0, durationSeconds: 30 },
      { target: 50, durationSeconds: 60 },
      { target: 100, durationSeconds: 60 },
      { target: 200, durationSeconds: 60 },
      { target: 0, durationSeconds: 30 },
    ],
  }
  const params = computeRampChartParams(profile, 30)
  equal(params.unit, 'rate')
  equal(params.targetValue, 200)
  equal(params.totalDuration, 240)
  const at200 = params.planned.filter(p => p.planned === 200)
  equal(at200.length > 0, true, 'planned line must include the 200-RPS peak')
})

test('computeRampChartParams defends against constant-vus with no virtualUsers', () => {
  // An editor save with virtualUsers = 0 / null must not plot a
  // flat 0 line — that would visually look like a run that
  // never started. Return an empty chart instead.
  const profile: ReportLoadProfile = {
    type: 'CONSTANT_VUS',
    virtualUsers: 0,
    durationSeconds: 60,
  }
  const params = computeRampChartParams(profile)
  deepEqual(params.planned, [])
  equal(params.targetValue, 0)
})

test('computeRampChartParams returns an empty chart for an unknown type', () => {
  // New executors in k6 land before the helper learns about
  // them. The chart should stay usable (targetValue 0 → flat
  // measured line at the bottom) rather than throw.
  const profile = { type: 'FUTURE_EXECUTOR' } as unknown as ReportLoadProfile
  const params = computeRampChartParams(profile)
  equal(params.unit, 'none')
  deepEqual(params.planned, [])
})

test('computeRampChartParams falls back to 0 for missing constant-vus fields', () => {
  // The `?? 0` fallbacks in the helper must trigger when the
  // incoming profile has `virtualUsers: undefined` or
  // `durationSeconds: undefined`. Otherwise a missing field
  // becomes `NaN` (e.g. `0 / undefined`) and breaks the chart.
  // The `virtualUsers: undefined` branch is the *nullish*
  // side of the `??` operator; the explicit-zero side is
  // covered by the "defends against no virtualUsers" test.
  const profile: ReportLoadProfile = {
    type: 'CONSTANT_VUS',
    durationSeconds: 60,
  }
  const params = computeRampChartParams(profile)
  deepEqual(params.planned, [])
  equal(params.targetValue, 0)
})

test('computeRampChartParams falls back to [] for missing stages in ramping-vus', () => {
  // The `profile.stages ?? []` fallback's nullish branch.
  // The non-nullish branch is covered by every test that
  // passes an explicit `stages` array.
  const profile: ReportLoadProfile = {
    type: 'RAMPING_VUS',
    startVUs: 0,
    virtualUsers: 100,
    durationSeconds: 60,
  }
  const params = computeRampChartParams(profile)
  equal(params.targetValue, 100)
  // The `stages` fallback is a 2-point ramp from `startVUs` to
  // `virtualUsers`, so the line still has two samples.
  equal(params.planned.length, 2)
})

test('computeRampChartParams falls back to undefined virtualUsers in constant-vus', () => {
  // The `profile.virtualUsers ?? 0` fallback's nullish branch
  // for the constant-vus path (line 126). A profile with the
  // field *missing* must trigger the nullish fallback; an
  // explicit zero (covered by the "no virtualUsers" test) is
  // the non-nullish side of the same operator.
  const profile: ReportLoadProfile = {
    type: 'CONSTANT_VUS',
    durationSeconds: 60,
  }
  const params = computeRampChartParams(profile)
  deepEqual(params.planned, [])
  equal(params.targetValue, 0)
})

test('computeRampChartParams falls back to undefined durationSeconds in constant-vus', () => {
  // Mirror of the virtualUsers fallback for the duration
  // field (line 127). The explicit-zero side is covered by
  // the "zero duration" test; this exercises the *undefined*
  // side of the `??` operator.
  const profile: ReportLoadProfile = {
    type: 'CONSTANT_VUS',
    virtualUsers: 50,
  }
  const params = computeRampChartParams(profile)
  deepEqual(params.planned, [])
  equal(params.targetValue, 0)
})

test('computeRampChartParams falls back to undefined startVUs / durationSeconds in ramping-vus', () => {
  // The `?? 0` fallback for `virtualUsers` / `durationSeconds`
  // in the "no stages" branch. The explicit-zero side is
  // covered by the "zero target" test; this exercises the
  // *undefined* side of the `??` operator, which matters
  // when an editor save was missing the field entirely.
  const profile: ReportLoadProfile = {
    type: 'RAMPING_VUS',
    // startVUs, virtualUsers, durationSeconds, stages all
    // missing — the helper must still return a valid empty
    // chart instead of throwing on `undefined`.
  }
  const params = computeRampChartParams(profile)
  deepEqual(params.planned, [])
  equal(params.targetValue, 0)
})

test('computeRampChartParams falls back to undefined rate / durationSeconds in constant-arrival-rate', () => {
  // Mirror of the constant-vus undefined-fields guard for the
  // rate-based path. A profile without `rate` or
  // `durationSeconds` (e.g. an old saved profile) must
  // produce an empty chart rather than `NaN` coordinates.
  const profile: ReportLoadProfile = {
    type: 'CONSTANT_ARRIVAL_RATE',
  }
  const params = computeRampChartParams(profile)
  deepEqual(params.planned, [])
  equal(params.targetValue, 0)
})

test('computeRampChartParams falls back to undefined startRate / durationSeconds in ramping-arrival-rate', () => {
  // Same pattern for the ramping arrival-rate path. The
  // missing-stages and missing-fields branches both feed
  // into the `target <= 0 || duration <= 0` guard, which
  // must return an empty chart instead of `NaN`.
  const profile: ReportLoadProfile = {
    type: 'RAMPING_ARRIVAL_RATE',
  }
  const params = computeRampChartParams(profile)
  deepEqual(params.planned, [])
  equal(params.targetValue, 0)
})

test('computeRampChartParams returns empty for ramping-arrival-rate with stages summing to zero', () => {
  // Mirror of the ramping-vus zero-total-duration guard. The
  // `if (totalDuration <= 0)` branch in the stages path must
  // also return an empty chart for the rate-based executor.
  const profile: ReportLoadProfile = {
    type: 'RAMPING_ARRIVAL_RATE',
    startRate: 0,
    stages: [
      { target: 50, durationSeconds: 0 },
      { target: 50, durationSeconds: 0 },
    ],
  }
  const params = computeRampChartParams(profile)
  deepEqual(params.planned, [])
  equal(params.targetValue, 0)
})

test('computeRampChartParams falls back to a 2-point ramp for ramping-vus without stages', () => {
  // Edge case: a saved `ramping-vus` profile with no `stages`
  // array. The helper must still return a planned line so the
  // user sees something instead of an empty SVG. k6's own
  // behaviour is a linear ramp from `startVUs` to the
  // `virtualUsers` target, but with no stages we conservatively
  // emit a flat line at the start value — the live samples
  // will still drive the visible curve.
  const profile: ReportLoadProfile = {
    type: 'RAMPING_VUS',
    startVUs: 10,
    virtualUsers: 100,
    durationSeconds: 60,
    // stages intentionally missing
  }
  const params = computeRampChartParams(profile, 30)
  equal(params.unit, 'vus')
  equal(params.targetValue, 100)
  // Two points: start of the run and end of the run.
  equal(params.planned.length, 2)
  equal(params.planned[0].t, 0)
  equal(params.planned[1].t, 60)
})

test('computeRampChartParams falls back to a 2-point ramp for ramping-arrival-rate without stages', () => {
  // Mirror of the ramping-vus case for the rate-based executor.
  // The fallback must keep the helper from throwing when a
  // preset happens to be saved without its `stages` field.
  const profile: ReportLoadProfile = {
    type: 'RAMPING_ARRIVAL_RATE',
    startRate: 5,
    rate: 50,
    durationSeconds: 60,
  }
  const params = computeRampChartParams(profile, 30)
  equal(params.unit, 'rate')
  equal(params.targetValue, 50)
  equal(params.planned.length, 2)
})

test('computeRampChartParams interpolates a sub-step stage (duration < stepSeconds)', () => {
  // Edge case: a stage shorter than the sampling step still
  // produces at least one sample (the helper clamps
  // `stepCount` to a minimum of 1 inside `rampPointsForStages`).
  // Without that guard the inner `for` loop would never run
  // and the planned line would skip the stage entirely.
  const profile: ReportLoadProfile = {
    type: 'RAMPING_VUS',
    startVUs: 0,
    stages: [
      { target: 100, durationSeconds: 5 },
      { target: 100, durationSeconds: 55 },
    ],
  }
  const params = computeRampChartParams(profile, 30)
  equal(params.totalDuration, 60)
  // The line must hit the 100-VU target at least once.
  const at100 = params.planned.filter(p => p.planned === 100)
  equal(at100.length > 0, true, 'short stage must still emit a 100-VU sample')
})

test('computeRampChartParams returns empty for ramping-vus with stages summing to zero', () => {
  // A profile whose stages add up to 0 s of planned load
  // (e.g. an editor save that lost its values) must not draw
  // a zero-second ramp — the chart should stay empty so the
  // user notices the missing data instead of a confusing
  // flat-at-zero line.
  const profile: ReportLoadProfile = {
    type: 'RAMPING_VUS',
    startVUs: 0,
    stages: [
      { target: 50, durationSeconds: 0 },
      { target: 50, durationSeconds: 0 },
    ],
  }
  const params = computeRampChartParams(profile)
  deepEqual(params.planned, [])
  equal(params.targetValue, 0)
})

test('computeRampChartParams returns empty for constant-arrival-rate with zero rate', () => {
  // Mirror of the constant-vus zero-value guard for the
  // arrival-rate path. Without this, a saved profile with
  // rate = 0 would draw a flat-at-zero "Soll" line that looks
  // identical to "no planned load".
  const profile: ReportLoadProfile = {
    type: 'CONSTANT_ARRIVAL_RATE',
    rate: 0,
    durationSeconds: 60,
  }
  const params = computeRampChartParams(profile)
  deepEqual(params.planned, [])
  equal(params.targetValue, 0)
})

test('computeRampChartParams returns empty for constant-vus with zero duration', () => {
  // The constant-vus guard's `||` short-circuits on
  // `durationSeconds <= 0` too — a profile with a non-zero
  // VU target but a zero duration must NOT plot a flat
  // line at 0 s. The chart stays empty so the user notices
  // the missing data.
  const profile: ReportLoadProfile = {
    type: 'CONSTANT_VUS',
    virtualUsers: 50,
    durationSeconds: 0,
  }
  const params = computeRampChartParams(profile)
  deepEqual(params.planned, [])
  equal(params.targetValue, 0)
})

test('computeRampChartParams returns empty for constant-arrival-rate with zero duration', () => {
  // Mirror of the constant-vus zero-duration guard for the
  // rate-based path.
  const profile: ReportLoadProfile = {
    type: 'CONSTANT_ARRIVAL_RATE',
    rate: 50,
    durationSeconds: 0,
  }
  const params = computeRampChartParams(profile)
  deepEqual(params.planned, [])
  equal(params.targetValue, 0)
})

test('computeRampChartParams returns empty for ramping-vus without stages and zero target', () => {
  // The `stages.length === 0` branch's inner guard must also
  // fire when the fallback `virtualUsers` target is 0 (or
  // missing). A profile with no stages and no target must not
  // draw a flat-at-zero line.
  const profile: ReportLoadProfile = {
    type: 'RAMPING_VUS',
    startVUs: 0,
    virtualUsers: 0,
    durationSeconds: 60,
  }
  const params = computeRampChartParams(profile)
  deepEqual(params.planned, [])
  equal(params.targetValue, 0)
})

test('computeRampChartParams returns empty for ramping-arrival-rate without stages and zero target', () => {
  // Mirror of the ramping-vus zero-target guard for the
  // rate-based path.
  const profile: ReportLoadProfile = {
    type: 'RAMPING_ARRIVAL_RATE',
    startRate: 0,
    rate: 0,
    durationSeconds: 60,
  }
  const params = computeRampChartParams(profile)
  deepEqual(params.planned, [])
  equal(params.targetValue, 0)
})

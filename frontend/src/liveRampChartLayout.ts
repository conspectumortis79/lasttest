// Pure layout helpers for the "Auslastung (Soll vs Ist)" ramp chart.
// Extracted into a `.ts` module so they can be unit-tested with
// `node:test` (which cannot load `.tsx`) and so the React component
// stays focused on rendering. Every function here is pure: same
// inputs, same number out, no state, no DOM.

import type { ReportLoadProfile } from './k6Report.ts'

/**
 * The y-axis unit the live ramp chart is showing. Picked from
 * the executor type so the same component can render VUs for
 * `constant-vus` / `ramping-vus` / `shared-iterations` AND
 * requests-per-second for `constant-arrival-rate` /
 * `ramping-arrival-rate` (which is what the lead-stress, spike
 * and soak presets use).
 */
export type RampChartUnit = 'vus' | 'rate' | 'none'

/**
 * A single sample on the chart. `t` is "seconds since the run
 * started" (documented in [RampPoint] in `runStatusView.tsx`
 * too). `planned` is NaN when the executor has no meaningful
 * target line (e.g. shared-iterations). `actual` is NaN when
 * the live sample for that instant has not arrived yet.
 */
export type RampPoint = {
  t: number
  planned: number
  actual: number
}

/**
 * The layout parameters a single ramp chart needs to render
 * a profile. Computed once per profile in
 * [computeRampChartParams] and passed down to the SVG.
 */
export type RampChartParams = {
  /**
   * Total run length in seconds. The chart's x-axis maps this
   * to its right edge. `0` means "no planned run length" — the
   * live tab then renders only the measured line.
   */
  totalDuration: number
  /**
   * The peak of the planned curve. Drives the y-axis range so
   * the planned line always reaches the top of the chart.
   * `0` means "no planned line" (e.g. shared-iterations).
   */
  targetValue: number
  /**
   * What the y-axis is showing. `vus` for VU-based executors
   * (constant-vus, ramping-vus, shared-iterations), `rate` for
   * arrival-rate executors (constant-arrival-rate,
   * ramping-arrival-rate — which covers the lead-stress, spike
   * and soak presets), and `none` when the chart has no planned
   * line to scale to.
   */
  unit: RampChartUnit
  /**
   * The planned (green) polyline. Empty array when the profile
   * has no meaningful target line.
   */
  planned: RampPoint[]
}

/**
 * One stage of a ramping-* profile. Mirrors
 * [ReportLoadStage] in `k6Report.ts` but is duplicated here so
 * this module stays importable without dragging the whole report
 * surface (and its test fixtures) into a unit-test run.
 */
type RampStage = { target: number, durationSeconds: number }

function normalizedProfileType(profile: ReportLoadProfile): string {
  return profile.type.toLowerCase().replace(/_/g, '-')
}

function rampPointsForStages(
  stages: readonly RampStage[],
  startValue: number,
  stepSeconds: number,
): RampPoint[] {
  // Caller is responsible for the empty-stages case — the
  // calling sites in [computeRampChartParams] build the
  // 2-point fallback directly so the planned line stays
  // meaningful when the profile is missing its `stages` array.
  const points: RampPoint[] = []
  let offset = 0
  let current = startValue
  for (const stage of stages) {
    const target = stage.target
    const stepCount = Math.max(1, Math.floor(stage.durationSeconds / stepSeconds))
    for (let i = 0; i < stepCount; i++) {
      const f = (i + 1) / stepCount
      points.push({
        t: offset + (i + 1) * (stage.durationSeconds / stepCount),
        planned: current + (target - current) * f,
        actual: NaN,
      })
    }
    offset += stage.durationSeconds
    current = target
  }
  return points
}

/**
 * Computes every parameter the live ramp chart needs from a
 * load profile. The previous [plannedRampPoints] in
 * `runStatusView.tsx` only handled the VU-based executors and
 * dropped the planned line for arrival-rate profiles entirely,
 * so the chart rendered an empty green line for any user that
 * picked a spike/stress/soak preset. This consolidates the
 * rules so every executor gets a meaningful planned line, AND
 * the y-axis label switches from "VUs" to "Anfragen/s" when
 * the executor measures requests instead of users.
 */
export function computeRampChartParams(
  profile: ReportLoadProfile | null | undefined,
  stepSeconds = 30,
): RampChartParams {
  const empty: RampChartParams = { totalDuration: 0, targetValue: 0, unit: 'none', planned: [] }
  if (!profile) return empty
  switch (normalizedProfileType(profile)) {
    case 'constant-vus': {
      const vus = profile.virtualUsers ?? 0
      const duration = profile.durationSeconds ?? 0
      if (vus <= 0 || duration <= 0) return { totalDuration: 0, targetValue: 0, unit: 'vus', planned: [] }
      const planned: RampPoint[] = []
      for (let t = 0; t <= duration; t += stepSeconds) {
        planned.push({ t, planned: vus, actual: NaN })
      }
      return { totalDuration: duration, targetValue: vus, unit: 'vus', planned }
    }
    case 'ramping-vus': {
      const stages = profile.stages ?? []
      const startValue = profile.startVUs ?? 0
      // When `stages` is missing we still need a planned line,
      // otherwise the user sees an empty chart for what is
      // really a valid profile. Fall back to the
      // `virtualUsers` target and the top-level
      // `durationSeconds` so the chart stays usable.
      if (stages.length === 0) {
        const target = profile.virtualUsers ?? 0
        const duration = profile.durationSeconds ?? 0
        if (target <= 0 || duration <= 0) return { totalDuration: 0, targetValue: 0, unit: 'vus', planned: [] }
        return {
          totalDuration: duration,
          targetValue: target,
          unit: 'vus',
          planned: [
            { t: 0, planned: startValue, actual: NaN },
            { t: duration, planned: target, actual: NaN },
          ],
        }
      }
      const totalDuration = stages.reduce((sum, s) => sum + s.durationSeconds, 0)
      if (totalDuration <= 0) return { totalDuration: 0, targetValue: 0, unit: 'vus', planned: [] }
      const peak = stages.reduce((max, s) => Math.max(max, s.target), startValue)
      return {
        totalDuration,
        targetValue: peak,
        unit: 'vus',
        planned: rampPointsForStages(stages, startValue, stepSeconds),
      }
    }
    case 'shared-iterations': {
      // No meaningful planned line (the run length is not
      // predictable). The chart still renders the measured
      // line, scaled to the highest VU value seen so far.
      return { totalDuration: 0, targetValue: 0, unit: 'none', planned: [] }
    }
    case 'constant-arrival-rate': {
      // The user picked arrival-rate because they want to see
      // RPS, not VUs. The chart plots the target `rate` as a
      // horizontal line so live "Ist (RPS)" and planned
      // "Soll (rate)" are directly comparable.
      const rate = profile.rate ?? 0
      const duration = profile.durationSeconds ?? 0
      if (rate <= 0 || duration <= 0) return { totalDuration: 0, targetValue: 0, unit: 'rate', planned: [] }
      const planned: RampPoint[] = []
      for (let t = 0; t <= duration; t += stepSeconds) {
        planned.push({ t, planned: rate, actual: NaN })
      }
      return { totalDuration: duration, targetValue: rate, unit: 'rate', planned }
    }
    case 'ramping-arrival-rate': {
      // Same shape as `ramping-vus` but the y-axis unit is
      // requests/second, not VUs. Used by the lead-stress,
      // spike and soak presets.
      const stages = profile.stages ?? []
      const startValue = profile.startRate ?? 0
      if (stages.length === 0) {
        const target = profile.rate ?? 0
        const duration = profile.durationSeconds ?? 0
        if (target <= 0 || duration <= 0) return { totalDuration: 0, targetValue: 0, unit: 'rate', planned: [] }
        return {
          totalDuration: duration,
          targetValue: target,
          unit: 'rate',
          planned: [
            { t: 0, planned: startValue, actual: NaN },
            { t: duration, planned: target, actual: NaN },
          ],
        }
      }
      const totalDuration = stages.reduce((sum, s) => sum + s.durationSeconds, 0)
      if (totalDuration <= 0) return { totalDuration: 0, targetValue: 0, unit: 'rate', planned: [] }
      const peak = stages.reduce((max, s) => Math.max(max, s.target), startValue)
      return {
        totalDuration,
        targetValue: peak,
        unit: 'rate',
        planned: rampPointsForStages(stages, startValue, stepSeconds),
      }
    }
    default:
      return empty
  }
}

/**
 * Options for [xForSeconds].
 *
 * `W` and `padX` define the SVG viewport the polyline is
 * projected onto. `windowStartMs`/`windowEndMs` (absolute
 * wall-clock milliseconds) are preferred when both are set —
 * the caller passes them so the chart's x-axis aligns with the
 * dashboard clock; otherwise we fall back to
 * `totalDurationSeconds` (run length in seconds).
 */
export type XForOptions = {
  W: number
  padX: number
  windowStartMs?: number | null
  windowEndMs?: number | null
  totalDurationSeconds: number
}

/**
 * Maps a "seconds since run start" value to an x-coordinate in
 * the `[padX, W - padX]` range.
 *
 * Background: the previous implementation treated `windowStartMs`
 * as a reference frame and subtracted it from the input. The
 * inputs the React callers pass (and the `RampPoint.t` field
 * documented in `runStatusView.tsx`) are *seconds-since-run-start*
 * — never absolute wall-clock ms — so the subtraction was always
 * a huge negative number and the polyline collapsed onto the
 * left edge of the SVG (every projected x clamped to 0).
 *
 * The fix: ignore the absolute offset entirely. The offset
 * between `windowStartMs` and `windowEndMs` is the run duration
 * by construction (`App.tsx` sets `end = start + totalDuration *
 * 1000`), so `(end - start) / 1000` IS the run length in
 * seconds. The fallback path divides `sec` by
 * `totalDurationSeconds` directly, both in the same unit.
 *
 * The result is clamped to `[0, 1]` before being projected so a
 * run that exceeds its planned length still produces a visible
 * (right-clamped) polyline.
 */
export function xForSeconds(sec: number, options: XForOptions): number {
  const { W, padX, windowStartMs, windowEndMs, totalDurationSeconds } = options
  let durationSec: number
  if (windowStartMs != null && windowEndMs != null) {
    durationSec = (windowEndMs - windowStartMs) / 1000
  } else {
    durationSec = totalDurationSeconds
  }
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    // Defensive: a degenerate window must not divide by zero.
    // Returning `padX` keeps the polyline pinned to the left
    // edge instead of exploding off the chart.
    return padX
  }
  const t = Math.max(0, Math.min(1, sec / durationSec))
  return padX + t * (W - padX * 2)
}

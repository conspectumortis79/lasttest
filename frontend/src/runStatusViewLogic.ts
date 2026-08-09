// Helper functions for the run-status / ramp-chart surfaces.
// Pulled into their own .ts module (no JSX) so runStatusView.tsx
// can stay purely declarative (only React components) and pass
// the react(only-export-components) lint rule cleanly. The
// behaviour is identical to the previous inline implementation
// — only the file boundary moved.

import type { TestRun } from './k6Report.ts'

export type RampPoint = {
  /** Seconds since the run started, fractional. */
  t: number
  /** Planned VU count at this instant (linear interpolation). */
  planned: number
  /** Actual VU count at this instant, NaN if not yet sampled. */
  actual: number
}

/**
 * Builds the planned (green) line for the ramp chart from a
 * load profile. Constant-vus = flat line at the target;
 * ramping-vus = linear ramp from 0 to target over
 * durationSeconds; shared-iterations / constant-arrival-rate
 * = no planned line (the helper returns an empty array so the
 * caller renders only the measured line). The function is
 * exposed so tests can assert the interpolation.
 */
export function plannedRampPoints(
  profile: {
    type: string
    virtualUsers?: number | null
    durationSeconds?: number | null
    stages?: { target: number, durationSeconds: number }[] | null
    rate?: number | null
    startRate?: number | null
  } | null,
  totalDurationSeconds: number,
  stepSeconds = 30,
): RampPoint[] {
  if (!profile) return []
  if (profile.type === 'constant-vus') {
    const vus = profile.virtualUsers ?? 0
    if (vus <= 0) return []
    const points: RampPoint[] = []
    for (let t = 0; t <= totalDurationSeconds; t += stepSeconds) {
      points.push({ t, planned: vus, actual: NaN })
    }
    return points
  }
  if (profile.type === 'shared-iterations') {
    // No meaningful target line because the duration is not predictable.
    return []
  }
  if (profile.type === 'ramping-vus') {
    const points: RampPoint[] = []
    if (profile.stages && profile.stages.length > 0) {
      // Stage-driven ramp: walk the stages and emit a point at
      // each stage boundary. The interpolation between stages is
      // linear.
      let offset = 0
      let current = profile.virtualUsers ? 0 : 0
      for (const stage of profile.stages) {
        const target = stage.target
        const stepCount = Math.max(1, Math.floor(stage.durationSeconds / stepSeconds))
        for (let i = 0; i < stepCount; i++) {
          const f = (i + 1) / stepCount
          points.push({ t: offset + (i + 1) * (stage.durationSeconds / stepCount), planned: current + (target - current) * f, actual: NaN })
        }
        offset += stage.durationSeconds
        current = target
      }
      return points
    }
    // No stages: linear ramp from 0 to target across the
    // profile's planned duration.
    const target = profile.virtualUsers ?? 0
    const dur = profile.durationSeconds ?? totalDurationSeconds
    if (target <= 0 || dur <= 0) return []
    for (let t = 0; t <= dur; t += stepSeconds) {
      points.push({ t, planned: Math.min(target, (t / dur) * target), actual: NaN })
    }
    return points
  }
  if (profile.type === 'constant-arrival-rate') {
    // The user picked arrival-rate because they want to see
    // RPS, not VUs. The ramp chart therefore plots the target
    // rate as a horizontal line so the live "Ist (RPS)" and
    // the planned "Soll (rate)" are directly comparable.
    const rate = profile.rate ?? 0
    if (rate <= 0) return []
    const points: RampPoint[] = []
    for (let t = 0; t <= totalDurationSeconds; t += stepSeconds) {
      points.push({ t, planned: rate, actual: NaN })
    }
    return points
  }
  if (profile.type === 'ramping-arrival-rate') {
    // Same as ramping-vus but the y-axis unit is RPS. Used by
    // the lead-stress / spike / soak presets.
    const points: RampPoint[] = []
    if (profile.stages && profile.stages.length > 0) {
      let offset = 0
      let current = profile.startRate ?? 0
      for (const stage of profile.stages) {
        const target = stage.target
        const stepCount = Math.max(1, Math.floor(stage.durationSeconds / stepSeconds))
        for (let i = 0; i < stepCount; i++) {
          const f = (i + 1) / stepCount
          points.push({ t: offset + (i + 1) * (stage.durationSeconds / stepCount), planned: current + (target - current) * f, actual: NaN })
        }
        offset += stage.durationSeconds
        current = target
      }
      return points
    }
    const target = profile.rate ?? 0
    const dur = profile.durationSeconds ?? totalDurationSeconds
    if (target <= 0 || dur <= 0) return []
    for (let t = 0; t <= dur; t += stepSeconds) {
      points.push({ t, planned: Math.min(target, (t / dur) * target), actual: NaN })
    }
    return points
  }
  return []
}

/**
 * Pulls the actual VU samples out of the run's most recent
 * summary. k6 writes per-second vus values into the summary
 * JSON; the helper plucks the array. Returns an empty array
 * when the run has not produced a summary yet (still in
 * flight with no iterations completed).
 */
export function actualVusSamples(run: TestRun): RampPoint[] {
  const raw = run.summary?.raw
  if (typeof raw !== 'string' || raw.length === 0) return []
  let summary: { metrics?: { vus?: { values?: Record<string, number> } } }
  try {
    summary = JSON.parse(raw) as { metrics?: { vus?: { values?: Record<string, number> } } }
  } catch {
    return []
  }
  const values = summary.metrics?.vus?.values
  if (!values) return []
  const points: RampPoint[] = []
  for (const [t, planned] of Object.entries(values)) {
    const time = Number(t)
    const value = Number(planned)
    if (Number.isFinite(time) && Number.isFinite(value)) {
      points.push({ t: time, planned: value, actual: value })
    }
  }
  return points
}

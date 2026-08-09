// Pure helpers for the status-codes timeline that sits below the
// live ramp chart on the Übersicht tab. Kept in a `.ts` file (no
// JSX) so the data builders can be unit-tested under `node:test`
// without bundling the React component. The component itself
// imports from here and adds the rendering layer on top.
//
// All helpers are side-effect-free: same inputs, same outputs,
// no state, no DOM. The React component owns the wall-clock
// formatter and the SVG rendering; the helpers below own the
// data shape and the per-second distribution.
import { parseK6Summary, type TestRun } from './k6Report.ts'

// ---- per-status-code row -----------------------------------------------
//
// One sparkline row. `overTime` is the per-second distribution
// (one number per second-bucket of the run). The array length
// matches the run's total duration in seconds; the rendering
// SVG sizes itself via `viewBox="0 0 N 32"` so the polyline
// scales linearly with the number of buckets.
//
// The sparkline is rendered as a *cumulative* (running total)
// curve, not a per-second rate — the user wants to see how the
// count grows over time, not the absolute count per bucket. The
// cumulative transform happens in the React component via
// [accumulate], not here, so the per-second data is preserved
// for any future surface that wants to show the rate instead.
export type StatusCodeRow = {
  code: string
  family: '2xx' | '3xx' | '4xx' | '5xx' | 'err' | 'other'
  count: number
  overTime: number[]
}

// ---- family classifier -------------------------------------------------
//
// Mirrors the [TRACKED_STATUS_CODES] discriminator in `k6Report.ts`
// but kept local so this module can fire without dragging the
// whole report surface into its imports. The two definitions
// agree on the 2xx/3xx/4xx/5xx prefix mapping; `err` and
// `other` are the network-error and unexpected-bucket fallbacks
// declared by the k6 script generator.
export function familyOf(code: string): StatusCodeRow['family'] {
  if (code === 'err') return 'err'
  if (code === 'other') return 'other'
  const c = Number(code)
  if (Number.isFinite(c)) {
    if (c >= 200 && c < 300) return '2xx'
    if (c >= 300 && c < 400) return '3xx'
    if (c >= 400 && c < 500) return '4xx'
    if (c >= 500 && c < 600) return '5xx'
  }
  return 'other'
}

// ---- aggregate + distribute --------------------------------------------
//
// Walks the k6 summary's `lt_status_<code>_<opId>` metric names
// and sums the count per code across operations. Returns the
// caller-formatted list of [StatusCodeRow] for the rendered list
// — already sorted by count descending so the dominant code sits
// at the top.
//
// The per-second distribution is uniform: every bucket gets
// `count / durationSeconds` rounded. This is honest — the user
// sees a flat line for codes that fired once, rather than a
// misleading peak manufactured by sampling noise. The shape
// becomes informative only when the backend starts emitting
// real per-second status counters (see the file-level comment
// in [StatusCodesTimeline.tsx]).
export function buildRows(run: TestRun, _startedAtMs: number | null, durationSeconds: number): StatusCodeRow[] {
  const summary = parseK6Summary(run)
  if (!summary) return []
  const counts = new Map<string, number>()
  for (const metricName of Object.keys(summary.metrics)) {
    const match = /^lt_status_(.+?)_(.+)$/.exec(metricName)
    if (!match) continue
    const code = match[1]!
    const count = summary.metrics[metricName]!.count
    if (count == null || !Number.isFinite(count) || count <= 0) continue
    counts.set(code, (counts.get(code) ?? 0) + count)
  }
  const rows: StatusCodeRow[] = []
  const safeDuration = Math.max(1, Math.round(durationSeconds))
  for (const [code, count] of counts) {
    const overTime = distributeUniform(count, safeDuration)
    rows.push({
      code,
      family: familyOf(code),
      count,
      overTime,
    })
  }
  rows.sort((a, b) => b.count - a.count)
  return rows
}

// Distributes `count` evenly across `duration` buckets. The
// first `count % duration` buckets get the +1 remainder so the
// sum is exact.
export function distributeUniform(count: number, duration: number): number[] {
  const buckets = new Array<number>(duration).fill(0)
  if (count <= 0 || duration <= 0) return buckets
  const base = Math.floor(count / duration)
  const remainder = count % duration
  for (let i = 0; i < duration; i++) {
    buckets[i] = base + (i < remainder ? 1 : 0)
  }
  return buckets
}

// ---- accumulate -------------------------------------------------------
//
// Converts a per-second distribution into a cumulative (running
// total) series. The output length matches the input length and
// the last value equals the sum of the input — i.e. the row's
// `count` field. The transform is what the sparkline polyline
// reads so the user sees a growth curve instead of a flat line
// (uniform distribution) or a spiky rate (raw per-second
// counts). The cumulative shape is what the user expects from a
// "summation over time" view, and matches the visual language
// of the rest of the dashboard (the rising line tells the same
// story as the Tests poller in the LastRunsPanel).
export function accumulate(perSecond: number[]): number[] {
  const out = new Array<number>(perSecond.length)
  let running = 0
  for (let i = 0; i < perSecond.length; i++) {
    running += perSecond[i] ?? 0
    out[i] = running
  }
  return out
}

// ---- axis tick layout -------------------------------------------------
//
// Five ticks: 0, 25%, 50%, 75%, 100% of the run duration. Same
// layout as the ramp chart's wall-clock axis so the two surfaces
// align visually.
export function axisTicks(durationSeconds: number): { sec: number, align: 'start' | 'center' | 'end' }[] {
  return [
    { sec: 0, align: 'start' },
    { sec: durationSeconds * 0.25, align: 'center' },
    { sec: durationSeconds * 0.5, align: 'center' },
    { sec: durationSeconds * 0.75, align: 'center' },
    { sec: durationSeconds, align: 'end' },
  ]
}

// ---- family colour -----------------------------------------------------
//
// One colour per family. Reused by the React component for the
// chip background, the row border and the sparkline stroke. The
// hues match the rest of the app's status-code palette so the
// Overview tab feels consistent with the run-grid and the report.
export const FAMILY_COLOR: Record<StatusCodeRow['family'], string> = {
  '2xx': '#22c55e',
  '3xx': '#3b82f6',
  '4xx': '#fb923c',
  '5xx': '#ef4444',
  'err': '#c026d3',
  'other': '#475569',
}

// ---- time segment -------------------------------------------------------
//
// One interval during which a status code was active. Stored as
// half-open `[start, end)` seconds — the second at `end` is the
// first second where the code was NOT active. The Gantt bar
// renders one segment per interval, so the user sees exactly
// when a code was firing during the run.
export type Segment = {
  /** Run-relative second where the code became active. */
  start: number
  /** Run-relative second where the code stopped being active. */
  end: number
}

// ---- buildActiveSegments ---------------------------------------------
//
// Converts the per-second cumulative count array into a list of
// active segments. Reads the array left-to-right and emits a
// segment for every contiguous run of seconds where the count
// grew (i.e. the code fired at least once during that second).
//
// The fall-back rule at the bottom handles the k6 summary path
// where the data is uniformly distributed (= no growth at any
// second). Without the fall-back the Gantt bar would render
// empty, which is misleading — the user clearly knows the code
// fired but they do not know when. The wide single segment is
// an honest "we don't know when" indicator: the bar is present
// but covers the full run, so the user can see at a glance
// which codes we have data for.
//
// Live data path: the backend emits cumulative counts per
// second so the growth pattern is real. The segments line up
// with the actual moments the code was active.
export function buildActiveSegments(overTime: number[]): Segment[] {
  if (overTime.length === 0) return []
  const segments: Segment[] = []
  let inSegment = false
  let segmentStart = 0
  for (let i = 0; i < overTime.length; i++) {
    const prev = i > 0 ? overTime[i - 1]! : 0
    const curr = overTime[i]!
    const isActive = curr > prev
    if (isActive && !inSegment) {
      segmentStart = i
      inSegment = true
    } else if (!isActive && inSegment) {
      segments.push({ start: segmentStart, end: i })
      inSegment = false
    }
  }
  if (inSegment) {
    segments.push({ start: segmentStart, end: overTime.length })
  }
  // Fall-back for the k6 summary path (uniform distribution):
  // the only "growth" is the initial bump from 0 to the
  // baseline count at second 0. If the count stays > 0 for
  // the rest of the run, the data is uniform and the user
  // has no per-second timing info. Render a single full-width
  // segment so the bar is still visible — the alternative is
  // an empty bar, which would be misleading for a code that
  // obviously fired. The check distinguishes uniform from a
  // genuine 1-second burst at the start (`[5, 0, 0, 0, 0]`
  // does NOT trigger the fall-back — the count is 0 for the
  // rest of the run).
  if (segments.length === 1 && overTime[overTime.length - 1]! > 0) {
    const seg = segments[0]!
    if (seg.start === 0 && seg.end - seg.start === 1 && overTime.slice(1).some(v => v > 0)) {
      return [{ start: 0, end: overTime.length }]
    }
  }
  return segments
}

// ---- live-sample shape -------------------------------------------------
//
// One sample returned by the backend's per-second status-code
// time-series endpoint. The backend stores cumulative counts
// (the k6 script's `counter.count` is the running total), so
// `count` is monotonically non-decreasing for a given
// `(code, epochSecond)` pair. The frontend treats the array as
// already-cumulative and just slices it into per-code rows.
export type StatusCodeTimelinePoint = {
  epochSecond: number
  code: string
  count: number
}

// ---- buildRowsFromLive -------------------------------------------------
//
// Rolls the live endpoint's per-(code, second) samples into the
// same [StatusCodeRow] shape [buildRows] produces for the k6
// summary path. The backend already returns cumulative counts,
// so the per-code time series is just the slice of `samples`
// matching the code, sorted by `epochSecond`. Each row's
// `overTime` is the cumulative array — the sparkline component
// reads it directly via [accumulate].
//
// The helper pads the array to `durationSeconds` so the chart
// width matches the wall-clock time axis. Padding values are
// flat at the last known cumulative count (the user sees the
// line stay flat between the last k6 stamp and the right-edge
// axis label instead of dropping to zero — a drop-to-zero
// reading would be misleading for a cumulative view).
export function buildRowsFromLive(
  samples: StatusCodeTimelinePoint[],
  durationSeconds: number,
): StatusCodeRow[] {
  const byCode = new Map<string, number[]>()
  let maxSecond = 0
  for (const sample of samples) {
    const arr = byCode.get(sample.code) ?? []
    arr[sample.epochSecond] = sample.count
    byCode.set(sample.code, arr)
    if (sample.epochSecond > maxSecond) maxSecond = sample.epochSecond
  }
  const safeDuration = Math.max(1, durationSeconds)
  const rows: StatusCodeRow[] = []
  for (const [code, sparse] of byCode) {
    const dense = new Array<number>(safeDuration).fill(0)
    let last = 0
    for (let i = 0; i < safeDuration; i++) {
      const v = sparse[i]
      if (v != null) last = v
      dense[i] = last
    }
    const total = last
    if (total <= 0) continue
    rows.push({
      code,
      family: familyOf(code),
      count: total,
      overTime: dense,
    })
  }
  rows.sort((a, b) => b.count - a.count)
  return rows
}

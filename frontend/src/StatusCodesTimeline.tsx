// Status-Codes timeline — the Gantt-bar list that sits below the
// ramp chart on the Overview tab. Each row shows the total count
// of one status code alongside a horizontal Gantt bar: the
// coloured segments mark the seconds where the code was active,
// the empty areas mark the seconds where it was not.
//
// The x-axis on every bar renders the same wall-clock time
// labels as the ramp chart above (HH:MM:SS, five ticks, derived
// from `run.startedAt`). Because the two charts share a time
// scale, the user can scroll their eye vertically between the
// load curve and the error bar and see immediately whether the
// error correlates with the load ramp.
//
// Data source: the live polling endpoint that reads the
// per-second status-code stamps the k6 script emits via
// `console.log('STAMP:<second>|<json>')`. The backend parses
// the stamps and writes one row per (run, second, code) to H2.
// The dashboard polls the same endpoint at the same 1-second
// cadence as the ramp chart above so the two surfaces stay in
// lock-step — the Gantt bars grow in real time as k6 stamps
// each second. For runs that completed before the live
// stream shipped, the component falls back to the k6 summary's
// uniform-distribution count so the bar still renders (with
// an `is-summary` modifier that slightly fades the segment).
//
// The pure data helpers (family classifier, row builder, tick
// layout, segment builder, family colour) live in
// [statusCodesTimelineLogic.ts] so they can be unit-tested
// without JSX. This component owns the wall-clock formatter
// and the Gantt-bar rendering.
import { useEffect, useState } from 'react'
import { useLanguage } from './languageStorage.ts'
import { translate } from './i18n.ts'
import type { TestRun } from './k6Report.ts'
import {
  axisTicks,
  buildActiveSegments,
  buildRows,
  buildRowsFromLive,
  type StatusCodeRow,
  type StatusCodeTimelinePoint,
} from './statusCodesTimelineLogic.ts'
import { RAMP_POLL_INTERVAL_MS } from './App.tsx'

// ---- formatWallClockTick ---------------------------------------------
//
// Local copy of the helper in [runStatusView]. Kept here so
// this component is self-contained — the alternative (a shared
// util in `liveRampChartLayout.ts`) would drag the layout
// module into a presentational surface that has no business
// caring about ramp-chart projection.
function formatWallClockTick(startMs: number | null, sec: number): string {
  if (startMs == null || !Number.isFinite(startMs)) {
    return `${Math.round(sec)} s`
  }
  const d = new Date(startMs + sec * 1000)
  const hh = d.getHours().toString().padStart(2, '0')
  const mm = d.getMinutes().toString().padStart(2, '0')
  const ss = d.getSeconds().toString().padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

// ---- StatusCodesTimeline component -------------------------------------

type StatusCodesTimelineProps = {
  run: TestRun
  /**
   * Wall-clock timestamp of the run's `startedAt`. Passed in
   * by the parent so the component can skip the `run.startedAt`
   * lookup — the parent already does it for the ramp chart, so
   * giving the same value here keeps the two surfaces aligned.
   */
  startedAtMs: number | null
}

export function StatusCodesTimeline({ run, startedAtMs }: StatusCodesTimelineProps) {
  const { language } = useLanguage()
  // Live samples from the backend's per-second status-code
  // time-series endpoint. Empty until the first poll lands; the
  // component falls back to the k6 summary's aggregate counts
  // when no live samples are available yet (e.g. the run is
  // already finished by the time the user opens the tab).
  const [liveSamples, setLiveSamples] = useState<StatusCodeTimelinePoint[]>([])

  // The component re-renders every 1 s while the run is in
  // flight so the live samples stay fresh. The same interval
  // drives the live-samples poll — the dashboard fetches the
  // latest per-second counts over the same 1 s window so the
  // component re-renders with the new data. After the run
  // terminates the timer is cleared by the cleanup function
  // and the component renders the final cumulative counts
  // from the k6 summary.
  useEffect(() => {
    const inFlight = run.status === 'RUNNING' || run.status === 'QUEUED' || run.status === 'STOPPING'
    if (!inFlight) return
    let cancelled = false
    const tick = () => {
      if (cancelled) return
      fetch(`/api/test-runs/${encodeURIComponent(run.id)}/status-code-timeline`)
        .then(r => (r.ok ? r.json() : null))
        .then((data: { samples?: StatusCodeTimelinePoint[] } | null) => {
          if (cancelled || !data || !data.samples) return
          setLiveSamples(data.samples)
        })
        .catch(() => { /* ignore transient errors */ })
    }
    tick()
    // Same 1 s cadence as the ramp chart so the Gantt bars
    // grow in lock-step with the measured load. The endpoint
    // is a cheap H2 read, so the cost is negligible even at
    // 1 Hz across N concurrent runs.
    const id = window.setInterval(tick, RAMP_POLL_INTERVAL_MS)
    return () => { cancelled = true; window.clearInterval(id) }
  }, [run.id, run.status])

  // Run duration in seconds. Until the run is finished we
  // anchor the x-axis to the *planned* duration from the load
  // profile so the sparklines have a reasonable time scale;
  // after the run is finished we use the actual elapsed time
  // so the rightmost tick lands on the real exit time.
  const finishedAtMs = run.finishedAt ? Date.parse(run.finishedAt) : null
  const plannedDuration = run.configuration?.loadProfile?.durationSeconds ?? 0
  const durationSeconds = finishedAtMs != null && startedAtMs != null
    ? Math.max(1, Math.round((finishedAtMs - startedAtMs) / 1000))
    : (plannedDuration > 0 ? plannedDuration : 60)

  // Live samples take priority over the k6 summary. The live
  // endpoint carries cumulative counts per (code, second),
  // which the [buildRowsFromLive] helper rolls up into the
  // same [StatusCodeRow] shape the k6 summary path produces.
  // For older runs that finished before the live endpoint
  // shipped, the live list is empty and [buildRows] is used
  // as the fall-back.
  const rows = liveSamples.length > 0
    ? buildRowsFromLive(liveSamples, durationSeconds)
    : buildRows(run, startedAtMs, durationSeconds)

  // The total request count is the sum of every status code we
  // surfaced. We use it for the per-row percentage labels so the
  // user can compare codes against each other at a glance.
  const total = rows.reduce((sum, r) => sum + r.count, 0)

  // Empty state — k6 has not written the summary yet, OR the
  // summary has no `lt_status_*` counters. Either way we
  // surface the placeholder so the chart height stays stable
  // (the LazyRampChart above it is taller, so the card
  // naturally stretches).
  if (rows.length === 0) {
    return <div className="status-codes-timeline">
      <div className="status-codes-head">
        <div className="status-codes-title">{translate(language, 'statusCodes.title')}</div>
        <div className="status-codes-meta">{translate(language, 'statusCodes.empty')}</div>
      </div>
    </div>
  }

  const ticks = axisTicks(durationSeconds)
  const isLeader = (row: StatusCodeRow, index: number) => {
    // The first row is always the leader (it has the highest
    // count after sorting). We also flag 4xx/5xx rows
    // independently so the user sees the failure shapes even
    // when many 2xx sit above them.
    if (index === 0) return true
    return row.family === '4xx' || row.family === '5xx'
  }

  return <div className="status-codes-timeline">
    <div className="status-codes-head">
      <div className="status-codes-title">{translate(language, 'statusCodes.title')}</div>
      <div className="status-codes-meta">
        {translate(language, 'statusCodes.total', { n: total.toLocaleString(language) })}
        {startedAtMs != null && (
          <>
            {' · '}
            {translate(language, 'statusCodes.startedAt', { time: formatWallClockTick(startedAtMs, 0) })}
          </>
        )}
      </div>
    </div>
    <ol className="status-codes-list">
      {rows.map((row, index) => (
        <li
          key={row.code}
          className={`status-codes-row family-${row.family} ${isLeader(row, index) ? 'is-leader' : ''}`}
        >
          <span className={`status-codes-chip family-${row.family}`}>{row.code}</span>
          <div className="status-codes-chart">
            <StatusCodeGanttBar row={row} durationSeconds={durationSeconds} />
            <div className="status-codes-axis">
              {ticks.map(({ sec, align }) => (
                <span key={`t-${sec}`} style={{ textAlign: align }}>
                  {formatWallClockTick(startedAtMs, sec)}
                </span>
              ))}
            </div>
          </div>
          <span className="status-codes-count">{row.count.toLocaleString(language)}</span>
          <span className="status-codes-pct">
            {total > 0 ? `${((row.count / total) * 100).toFixed(2)} %` : '–'}
          </span>
        </li>
      ))}
    </ol>
  </div>
}

// ---- StatusCodeGanttBar -----------------------------------------------
//
// Renders a single code's timeline as a horizontal Gantt bar.
// Each coloured segment is one interval where the code was
// active; the empty areas between segments are inactive. The
// viewer sees "when" the code fired, not just "how many".
//
// Each segment is an absolutely-positioned `<div>` whose `left`
// and `width` come from the proportional position of the
// interval within the run. The family colour comes from
// [FAMILY_COLOR]; the gradient plus inset highlight give the
// filled portion a subtle "raised" feel that matches the
// chip styling on the left.
//
// The track is a plain dark div with a thin border — the
// empty segments are *negative space*, not a separate
// element. The CSS in App.css handles the segment styling.
function StatusCodeGanttBar({ row, durationSeconds }: { row: StatusCodeRow, durationSeconds: number }) {
  const segments = buildActiveSegments(row.overTime)
  const safeDuration = Math.max(1, durationSeconds)
  return <div className="status-codes-gantt">
    {segments.map((seg, i) => {
      const leftPct = (seg.start / safeDuration) * 100
      const widthPct = ((seg.end - seg.start) / safeDuration) * 100
      // Single full-width segment from the k6 summary path? Add
      // a "is-summary" hint so the CSS can render it slightly
      // faded — the user knows the bar is "we don't know when"
      // rather than "the code fired the whole time".
      const isSummary = segments.length === 1 && seg.start === 0 && seg.end === safeDuration
      return <div
        key={`${row.code}-${i}`}
        className={`status-codes-gantt-seg family-${row.family}${isSummary ? ' is-summary' : ''}`}
        style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
        title={isSummary
          ? `Active throughout the run (k6 summary — no per-second timing available)`
          : `Active ${seg.start}s – ${seg.end}s`}
      />
    })}
  </div>
}

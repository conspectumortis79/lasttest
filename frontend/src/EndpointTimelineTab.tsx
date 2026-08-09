// Per-endpoint timeline tab. Mirrors the `runs-timeline.html`
// mockup: a 7-day heatmap (colour = day's outcome) plus a
// single-row Gantt of every run for the selected endpoint.
// The data source is `/api/operations/{method}/{path:.*}/runs`,
// polled on the same cadence as the run list so a new run
// shows up in the timeline within a few seconds.

import { useEffect, useRef, useState } from 'react'
import { useLanguage } from './languageStorage.ts'
import { translate, type SupportedLanguage } from './i18n.ts'
import type { TestRun } from './k6Report.ts'
import { formatTimestamp } from './k6Report.ts'
import { formatDayTick, formatHourTick } from './endpointTimelineTicks.ts'
import { RunContextMenu } from './RunContextMenu.tsx'
import type { MenuItem } from './runMenuItems.ts'
// Pure helpers for the "endpoint + profile" line that the
// timeline list now renders on every past run. Lives in
// `lastRunsView.ts` so the same formatter drives the run-grid
// badges above and the timeline list below — one source of
// truth for "what does a load profile look like in this app".
import { loadProfileSummaryFor, operationMethodAndPath } from './lastRunsView.ts'
import { dispatchRunMenuAction, type RunActionHandlers } from './runActionHandlers.ts'
import { mergeTimelineMenuRuns } from './runDashboard.ts'

export type EndpointTimelineProps = {
  method: string
  path: string
  apiTitle?: string
  /**
   * ID of the run currently selected in the parent list. The
   * matching bar in the Gantt is highlighted so the user can
   * see where the focused run sits in the history of the
   * endpoint.
   */
  selectedRunId: string
  /** Refresh tick from the parent (used to re-fetch the data). */
  refreshTick?: number
  /**
   * Optional `createdAt` (ISO-8601) of the run the parent
   * wants the timeline to re-centre on. When this prop
   * changes, the internal `focusedTs` snaps to the new value
   * so a click in the [LastRunsPanel] jumps the chart to the
   * matching day instead of forcing the user back to the
   * Übersicht tab. The parent passes `null` (or omits the
   * prop) to leave the existing focus alone.
   */
  focusRunCreatedAt?: string | null
  /**
   * Bundle of actions the right-click menu dispatches to. The
   * parent owns the actual implementation (clipboard, fetch,
   * state updates) so the tab stays a pure presentation
   * component. Every handler takes the targeted run id so the
   * same bundle drives both the focused-run Aktionen tab and
   * right-click menus on arbitrary past runs (timeline list
   * items / Gantt bars).
   */
  handlers: RunActionHandlers
  /**
   * All known runs keyed by id. Required so the right-click
   * menu can disable the "remove all other failed" item when
   * no other FAILED run is in the dashboard (see
   * [buildRunMenuItems]). Without it the user could click the
   * action with no visible effect.
   */
  runs: Record<string, TestRun>
}

type Window = '24h' | '7d' | '30d' | '90d'

const WINDOW_HOURS: Record<Window, number> = {
  '24h': 24,
  '7d': 24 * 7,
  '30d': 24 * 30,
  '90d': 24 * 90,
}

const WINDOW_DAYS: Record<Window, number> = {
  '24h': 1,
  '7d': 7,
  '30d': 30,
  '90d': 90,
}

type DayBucket = {
  start: number
  end: number
  runs: TestRun[]
  status: 'green' | 'yellow' | 'red' | 'empty'
}

export function EndpointTimelineTab({ method, path, apiTitle, refreshTick, focusRunCreatedAt, handlers, runs: runsMap }: EndpointTimelineProps) {
  const { language } = useLanguage()
  const [window_, setWindow] = useState<Window>('7d')
  const [timelineRuns, setTimelineRuns] = useState<TestRun[]>([])
  // Runs removed from the timeline stay hidden across a refresh of
  // the endpoint data. The backend remains unchanged; this mirrors
  // the dashboard's "remove from view" semantics while preventing
  // the next timeline fetch from immediately restoring the item.
  const [hiddenRunIds, setHiddenRunIds] = useState<Set<string>>(() => new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  /**
   * Wall-clock instant the timeline is centred on. Defaults to
   * "now", but the user can jump to a specific run by clicking
   * a bar in the Gantt track or a list item below the chart —
   * the timeline then re-anchors on that run's `createdAt`
   * without re-fetching data. The "Reset" button restores the
   * default behaviour.
   */
  const [focusedTs, setFocusedTs] = useState<number | null>(null)
  /**
   * Right-click menu state. Local to the tab so the menu's
   * click-outside / Escape listeners do not affect the parent
   * dashboard's overview-badge menu (they are independent
   * surfaces and the user can have both open on the same
   * screen). `null` when no menu is open.
   */
  const [runMenu, setRunMenu] = useState<{ runId: string, x: number, y: number } | null>(null)
  const runMenuRef = useRef<HTMLDivElement | null>(null)

  /**
   * Opens the menu on a right-click. Anchors at the cursor so
   * the gesture feels native. `event.preventDefault()` keeps the
   * browser's own context menu from popping up alongside our
   * custom one.
   */
  function openRunMenu(event: React.MouseEvent, runId: string) {
    event.preventDefault()
    setRunMenu({ runId, x: event.clientX, y: event.clientY })
  }

  /**
   * Closes the local menu, applies timeline-local cleanup, and
   * dispatches the picked item to the parent handler bundle.
   *
   * Cleanup needs both state updates: `timelineRuns` is owned by
   * this tab, while the dashboard map is owned by the parent. The
   * old implementation only called the parent, so historical runs
   * (which exist solely in `timelineRuns`) never disappeared from
   * this view. Keeping hidden ids separately also prevents a later
   * timeline refresh from restoring an item the user dismissed.
   */
  async function runMenuAction(item: MenuItem) {
    if (!runMenu) return
    const id = runMenu.runId
    setRunMenu(null)
    if (item.action === 'remove-from-view') {
      setHiddenRunIds(current => addHiddenRunIds(current, [id]))
    } else if (item.action === 'remove-all-other-failed') {
      const failedRunIds = timelineRuns
        .filter(run => run.status === 'FAILED' && run.id !== id)
        .map(run => run.id)
      setHiddenRunIds(current => addHiddenRunIds(current, failedRunIds))
    }
    await dispatchRunMenuAction(item, handlers, id)
  }

  // Close the menu on outside-click or Escape. Same pattern as
  // the overview's badge menu — local effect, scoped to this
  // tab's menu state so the parent dashboard's separate menu
  // (if open) is unaffected.
  useEffect(() => {
    if (!runMenu) return
    function handlePointer(event: MouseEvent) {
      if (runMenuRef.current && !runMenuRef.current.contains(event.target as Node)) {
        setRunMenu(null)
      }
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setRunMenu(null)
    }
    window.addEventListener('mousedown', handlePointer)
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('mousedown', handlePointer)
      window.removeEventListener('keydown', handleKey)
    }
  }, [runMenu])

  // Re-centre the timeline when the parent tells us a new
  // run should drive the focus. The dependency is the ISO
  // string itself (not the parsed number) so the effect
  // ignores [null] ↔ [null] re-renders that happen when the
  // parent clears the focus, and only fires for a *change* of
  // target. The effect does NOT clobber a user-driven focus
  // inside the tab (clicking a bar in the Gantt) because the
  // parent stops sending `focusRunCreatedAt` once the user
  // takes manual control.
  useEffect(() => {
    if (!focusRunCreatedAt) return
    const ts = Date.parse(focusRunCreatedAt)
    if (Number.isFinite(ts)) setFocusedTs(ts)
  }, [focusRunCreatedAt])

  // Fetch on mount, when the endpoint changes, or when the
  // parent signals a refresh (typically after the user starts
  // a new run on the dashboard). The window selector does NOT
  // trigger a re-fetch — we already have every run the backend
  // knows about, and the slice is computed client-side below.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    const url = `/api/operations/runs?method=${encodeURIComponent(method)}&path=${encodeURIComponent(path)}`
    fetch(url)
      .then(async response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return (await response.json()) as TestRun[]
      })
      .then(data => {
        if (cancelled) return
        setTimelineRuns(data)
      })
      .catch(reason => {
        if (cancelled) return
        setError(translate(language, 'lastRuns.fetchError', { reason: String(reason) }))
        setTimelineRuns([])
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [method, path, language, refreshTick])

  // Mirror the parent's `runs` map onto `timelineRuns` so a
  // status change in the parent shows up in the Gantt and the
  // list without waiting for the next /api/operations/runs
  // refresh.
  //
  // Why this exists: the user reported that cancelling a
  // run from the timeline's right-click menu keeps the
  // badge stuck on "Running …" / "läuft …" — the cancel
  // hits the backend and the parent (App.tsx) merges the
  // updated TestRun into its `runs` map, but the tab's
  // local `timelineRuns` is sourced from a separate fetch
  // that only re-runs on `method` / `path` / `language` /
  // `refreshTick` changes. Until one of those changes, the
  // tab keeps rendering the pre-cancel snapshot.
  //
  // The parent is the source of truth for status transitions
  // on runs the parent knows about (typically anything the
  // user has started in this session or anything the
  // polling loop has touched). We therefore prefer the
  // parent's snapshot over the fetched snapshot for every
  // run id that appears in both maps. Runs the parent has
  // never seen (historical rows loaded after a page reload)
  // keep their fetched values — the parent has nothing
  // better to offer.
  //
  // The merge is idempotent: when the parent and the fetch
  // agree on every field the effect returns the same
  // reference, so React skips the re-render. The check is
  // deliberately field-by-field rather than reference-based
  // because the parent and the fetch produce two distinct
  // objects that are usually equal in content but never
  // in identity.
  useEffect(() => {
    setTimelineRuns(current => {
      if (current.length === 0) return current
      let changed = false
      const next = current.map(run => {
        const updated = runsMap[run.id]
        if (updated === undefined) return run
        if (
          updated.status === run.status &&
          updated.startedAt === run.startedAt &&
          updated.finishedAt === run.finishedAt &&
          updated.exitCode === run.exitCode &&
          updated.cancelledAt === run.cancelledAt &&
          updated.cancelledByForce === run.cancelledByForce
        ) {
          return run
        }
        changed = true
        return { ...run, ...updated }
      })
      return changed ? next : current
    })
  }, [runsMap])

  // Centre of the timeline window — either the focused run or
  // "now". Every offset below is computed relative to this
  // anchor so the user can navigate the history without losing
  // the relative-position context.
  const now = Date.now()
  const centerTs = focusedTs ?? now
  const windowMs = WINDOW_HOURS[window_] * 60 * 60 * 1000
  // Slice the runs to the symmetric window around the anchor.
  // Symmetric (= |ts - centerTs| ≤ windowMs/2) is what lets us
  // centre "today" in the middle of the chart instead of
  // pushing it to the right edge.
  const visibleTimelineRuns = timelineRuns.filter(run => !hiddenRunIds.has(run.id))
  const windowedRuns = visibleTimelineRuns.filter(run => {
    const ts = Date.parse(run.createdAt)
    return Number.isFinite(ts) && Math.abs(ts - centerTs) <= windowMs / 2
  })

  // Heatmap buckets: dayCount buckets centred on `centerTs`.
  // For 7 days: 3 before, today, 3 after — the today cell sits
  // at index dayCount/2 so the heatmap is balanced around the
  // anchor.
  const dayCount = WINDOW_DAYS[window_]
  const dayBuckets: DayBucket[] = []
  const pastBuckets = Math.floor((dayCount - 1) / 2)
  const futureBuckets = dayCount - 1 - pastBuckets
  for (let i = -pastBuckets; i <= futureBuckets; i++) {
    const start = centerTs + i * 24 * 60 * 60 * 1000
    const end = start + 24 * 60 * 60 * 1000
    const bucketRuns = windowedRuns.filter(run => {
      const ts = Date.parse(run.createdAt)
      return ts >= start && ts < end
    })
    let status: DayBucket['status'] = 'empty'
    if (bucketRuns.length > 0) {
      const hasFailed = bucketRuns.some(r => r.status === 'FAILED' || r.status === 'ABORTED')
      const hasStopped = bucketRuns.some(r => r.status === 'STOPPED')
      status = hasFailed ? 'red' : hasStopped ? 'yellow' : 'green'
    }
    dayBuckets.push({ start, end, runs: bucketRuns, status })
  }

  // Stats summary (relative to the *centre* so the focus label
  // stays meaningful when the user has jumped to a historical
  // run).
  const total = windowedRuns.length
  const passed = windowedRuns.filter(r => r.status === 'COMPLETED').length
  const failed = windowedRuns.filter(r => r.status === 'FAILED').length
  const lastRun = windowedRuns.length > 0
    ? windowedRuns.reduce((latest, r) => Date.parse(r.createdAt) > Date.parse(latest.createdAt) ? r : latest)
    : null
  const lastFailed = windowedRuns.find(r => r.status === 'FAILED')
  const isFocused = focusedTs !== null

  return <div className="timeline-tab">
    {/* Toolbar: endpoint chip + window selector */}
    <div className="timeline-tab-toolbar">
      <div className="timeline-tab-endpoint-chip">
        <span className="lbl">{translate(language, 'detail.timeline.filterLabel')}</span>
        <span className={`method method-${method.toLowerCase()}`}>{method}</span>
        <code>{path}</code>
        {apiTitle && <span className="lbl">· {apiTitle}</span>}
      </div>
      <div className="timeline-tab-seg">
        <button onClick={() => setWindow('24h')} className={window_ === '24h' ? 'active' : ''}>24 h</button>
        <button onClick={() => setWindow('7d')} className={window_ === '7d' ? 'active' : ''}>7 d</button>
        <button onClick={() => setWindow('30d')} className={window_ === '30d' ? 'active' : ''}>30 d</button>
        <button onClick={() => setWindow('90d')} className={window_ === '90d' ? 'active' : ''}>90 d</button>
      </div>
      {isFocused && (
        <button
          type="button"
          className="timeline-tab-reset"
          onClick={() => setFocusedTs(null)}
          title="Zurück zur aktuellen Zeit springen"
        >
          ↺ {language === 'de' ? 'Auf „jetzt" zurücksetzen' : 'Reset to "now"'}
        </button>
      )}
      {isFocused && (
        <div className="timeline-tab-focus-label">
          {language === 'de' ? 'Zentriert auf' : 'Centred on'} <strong>{formatTimestamp(new Date(centerTs).toISOString())}</strong>
          {' '}({language === 'de' ? 'vor' : ''} {Math.round((now - centerTs) / 1000 / 60)} {language === 'de' ? 'Min' : 'min'})
        </div>
      )}
    </div>

    {error && <div className="run-tab-empty" style={{ borderColor: '#793b4b' }}>
      <div className="run-tab-empty-title">{translate(language, 'detail.timeline.error.title')}</div>
      <div className="run-tab-empty-hint">{error}</div>
    </div>}

    {/* Stat strip */}
    <div className="timeline-tab-stats">
      <div className="timeline-tab-stat">
        <div className="label">{translate(language, 'detail.timeline.stats.runs', { window: window_ })}</div>
        <div className="value">{total}</div>
        <div className="sub">{loading ? translate(language, 'detail.timeline.stats.sub.loading') : translate(language, 'detail.timeline.stats.sub.runs')}</div>
      </div>
      <div className="timeline-tab-stat good">
        <div className="label">{translate(language, 'detail.timeline.stats.passed')}</div>
        <div className="value">{passed}</div>
        <div className="sub">{total > 0 ? translate(language, 'detail.timeline.stats.sub.successRate', { pct: Math.round((passed / total) * 100) }) : ''}</div>
      </div>
      <div className="timeline-tab-stat bad">
        <div className="label">{translate(language, 'detail.timeline.stats.failed')}</div>
        <div className="value">{failed}</div>
        <div className="sub">{failed > 0 ? translate(language, 'detail.timeline.stats.sub.attention') : translate(language, 'detail.timeline.stats.sub.noIssues')}</div>
      </div>
      <div className="timeline-tab-stat warn">
        <div className="label">{translate(language, 'detail.timeline.stats.lastIssues')}</div>
        <div className="value" style={{ fontSize: total > 0 ? '14px' : '20px' }}>
          {lastFailed ? formatTimestamp(lastFailed.createdAt) : '–'}
        </div>
        <div className="sub">
          {lastRun ? translate(language, 'detail.timeline.stats.sub.lastRun', { when: formatTimestamp(lastRun.createdAt) }) : translate(language, 'detail.timeline.stats.sub.noLastRun')}
        </div>
      </div>
    </div>

    {/* Heatmap: one cell per day, colour = day's outcome. The
         "centre" cell (index = pastBuckets) sits in the middle
         so the heatmap is balanced around the anchor. When the
         user has focused on a historical run, the centre cell
         is highlighted instead and the labels read relative to
         that anchor. */}
    <div className="timeline-tab-heatmap">
      <div className="timeline-tab-heatmap-title">
        {translate(language, 'detail.timeline.heatmap.title', { days: dayCount, when: formatTimestamp(new Date(centerTs).toISOString()) })}
      </div>
      <div className="timeline-tab-heatmap-bars">
        {dayBuckets.map((bucket, i) => {
          const isCentre = i === pastBuckets
          const failed = bucket.runs.filter(r => r.status === 'FAILED' || r.status === 'ABORTED').length
          const stopped = bucket.runs.filter(r => r.status === 'STOPPED').length
          return <div className="timeline-tab-day" key={bucket.start}>
            <div className={`bar ${bucket.status} ${isCentre ? 'today' : ''}`}>
              <div className="count">{bucket.runs.length}</div>
              {failed > 0 && <div className="issue">{translate(language, 'detail.timeline.dayBucket.failed', { n: failed })}</div>}
              {failed === 0 && stopped > 0 && <div className="issue warn">{translate(language, 'detail.timeline.dayBucket.stopped', { n: stopped })}</div>}
            </div>
            <div className={`lbl ${isCentre ? 'today' : ''}`}>
              {dayLabel(bucket.start, centerTs, language)}
            </div>
          </div>
        })}
      </div>
    </div>

    {/* Gantt: single row with one bar per run. The window is
         centred on `centerTs` (= now or the focused run), so the
         "jetzt"/"focus" line sits at 50% rather than 100%. Clicking
         a bar jumps the timeline to that run's timestamp. */}
    <div className="timeline-tab-canvas">
      <div className="axis">
        {dayBucketTicks(dayCount, centerTs, window_)}
      </div>
      <div className="lane">
        <div className="lane-label">{method}<br />{path}</div>
        <div className="lane-track">
          {/* Day separator lines */}
          {dayBuckets.map(bucket => (
            <div key={`sep-${bucket.start}`} className="day-sep" style={{ left: dayOffsetPercent(bucket.start, centerTs, windowMs) }} />
          ))}
          {/* Centre line ("jetzt" or the focused run's timestamp).
              Positioned at 50% because the window is symmetric
              around centreTs. */}
          <div className="now-line" style={{ left: '50%' }} />
          <div className="now-label" style={{ left: '50%' }}>
            {isFocused ? translate(language, 'detail.timeline.focus') : translate(language, 'detail.timeline.now')}
          </div>
          {/* One bar per run */}
          {windowedRuns.map(run => {
            const ts = Date.parse(run.createdAt)
            const leftPct = Math.max(0, Math.min(100, ((ts - (centerTs - windowMs / 2)) / windowMs) * 100))
            const widthPct = 1.5
            const isFocusedRun = isFocused && Math.abs(ts - centerTs) < 1000
            return <div
              key={run.id}
              data-run-id={run.id}
              // The bar's `is-selected` is driven exclusively by
              // the in-tab focus, NOT by the parent-owned
              // `selectedRunId`. The two were OR'd together here
              // and the resulting class lit up two bars at once
              // whenever the user clicked a different list item:
              // the parent-driven `selectedRunId` matched the old
              // active run, and the click-driven `isFocusedRun`
              // matched the new one. The user expects exactly one
              // bar to be highlighted at a time, and the timeline
              // is a navigation surface (not a selection surface),
              // so the focus is the right source of truth. The
              // active run is already painted in the run-grid
              // above; the Gantt should reflect where the user
              // has scrolled the chart, not the run-grid pick.
              className={`timeline-tab-bar ${runStatusClass(run.status)} ${isFocusedRun ? 'is-selected' : ''}`}
              style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
              title={`${formatTimestamp(run.createdAt)} · ${run.status} · ${run.id.slice(0, 8)} — ${translate(language, 'detail.timeline.list.item')}`}
              onClick={() => setFocusedTs(ts)}
              // Right-click opens the same per-run menu as on
              // the list items below and the overview badges.
              // The bar is 1.5 % wide so it is small but the
              // gesture is supported for consistency.
              onContextMenu={event => openRunMenu(event, run.id)}
            />
          })}
        </div>
      </div>
      <div className="timeline-tab-legend">
        <span className="l-pass">{translate(language, 'detail.timeline.legend.passed')}</span>
        <span className="l-failed">{translate(language, 'detail.timeline.legend.failed')}</span>
        <span className="l-stopped">{translate(language, 'detail.timeline.legend.stopped')}</span>
        <span className="l-selected">{translate(language, 'detail.timeline.legend.selected')}</span>
      </div>
    </div>

    {/* Compact list of the most-recent runs in the window */}
    <div className="timeline-tab-list-head">
      {translate(language, 'detail.timeline.list.head')} <span className="sub">{translate(language, 'detail.timeline.list.sub', { count: windowedRuns.length })}</span>
    </div>
    <div className="timeline-tab-list">
      {windowedRuns
        .slice()
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .slice(0, 8)
        .map(run => {
          // Ein Listeneintrag gilt als „fokussiert", wenn sein
          // `createdAt` mit dem aktuellen `centerTs` überein­
          // stimmt. Das matcht das Verhalten des Gantt-Balkens
          // (siehe `isFocusedRun` weiter oben), damit der
          // visuell hervorgehobene Eintrag in der Liste immer
          // derselbe ist, dessen Zeitpunkt im Diagramm zentriert
          // ist.
          const listTs = Date.parse(run.createdAt)
          const isListFocused = isFocused && Math.abs(listTs - centerTs) < 1000
          return <div
            key={run.id}
            data-run-id={run.id}
            // Mirror of the Gantt-bar fix above: the list item's
            // `is-selected` is driven by the in-tab focus only.
            // Adding `run.id === selectedRunId` to the condition
            // let the previously-active run keep its highlight
            // after the user clicked a different list item,
            // producing the "zwei badges markiert" behaviour the
            // user reported. The list is sorted newest-first and
            // renders a window into the endpoint's history; the
            // highlight marks the run whose timestamp is centred
            // on the chart, which is exactly the focus.
            className={`timeline-tab-list-item ${isListFocused ? 'is-selected' : ''}`}
            title={`${formatTimestamp(run.createdAt)} · ${run.status} · ${run.id.slice(0, 8)} — ${translate(language, 'detail.timeline.list.item')}`}
            // Klick auf einen Eintrag in der Liste springt NUR
            // im Zeitstrahl zu dieser Zeit (`setFocusedTs`). Der
            // aktive Run im Inspector wird bewusst NICHT ge­
            // wechselt: die Timeline-Liste rendert Runs aus
            // einem eigenen Fetch (`/api/operations/runs`), die
            // nicht zwingend in der `runs`-Map des Parents
            // liegen. Würden wir hier `handlers.onFocusRun(run.id)`
            // aufrufen und die Id fehlt im Parent, würde der
            // Inspector zusammenbrechen (`run` würde `undefined`
            // und das ganze `RunDetail` würde verschwinden — die
            // "Seite springt weg"-Symptomatik, die der Nutzer
            // nach der ersten Implementierung dieser Brücke
            // gemeldet hat). Der Wechsel passiert weiterhin aus­
            // schließlich über die Run-Badges im Übersicht-Tab.
            // `setFocusedTs` ist eine reine Client-State-Änderung,
            // keine Daten-Neuladung.
            onClick={() => setFocusedTs(listTs)}
            // Right-click opens the same per-run context menu
            // as on the overview badges and the Gantt bars
            // above. The list item is the primary target — it
            // is much larger than the 1.5 %-wide Gantt bar and
            // therefore easier to hit. The menu lives in
            // [RunContextMenu] so both surfaces stay in sync
            // by construction.
            onContextMenu={event => openRunMenu(event, run.id)}
          >
            {isListFocused && <span className="pin" aria-hidden="true">●</span>}
            <div className="top">
              <span className={`status-badge is-${runStatusBadgeClass(run.status)}`}>{runStatusBadgeLabel(run.status, language)}</span>
              <span className="when">
                <span className="rel">{relativeWhen(run.createdAt, now, language)}</span>
                <br />
                <span className="abs">{formatTimestamp(run.createdAt)} · {run.id.slice(0, 8)}</span>
              </span>
            </div>
            {/* Endpoint row: method pill + path. Even though the
                timeline is already filtered by endpoint (via the
                parent-owned `method` / `path` props), the per-run
                operation can differ for runs that exercised more
                than one operation against the same path; we
                surface the run's *own* operation so the user can
                tell two near-identical runs apart without opening
                the run detail. Falls back to the timeline-level
                `method` / `path` when the run has no configuration
                attached (legacy fixtures). */}
            {(() => {
              const { method: runMethod, path: runPath } = operationMethodAndPath(run)
              const endpointMethod = runMethod || method
              const endpointPath = runPath || path
              return <div className="timeline-list-endpoint">
                <span className={`timeline-list-method method-${endpointMethod.toLowerCase()}`}>{endpointMethod}</span>
                <span className="timeline-list-path">{endpointPath}</span>
              </div>
            })()}
            {/* Bottom row: load-profile summary on the left,
                exit code / error marker on the right. The profile
                summary uses the same formatter as the run-grid
                badges above (and the report tab) so a 50-VUs/30-s
                run reads identically everywhere — the user does
                not have to learn a second format. The previous
                `vulist` element (just "X VUs") was a subset of
                this string, so swapping it out does not lose any
                information. */}
            <div className="bot">
              <span className="vulist" title={loadProfileSummaryFor(run.configuration?.loadProfile, language)}>
                {loadProfileSummaryFor(run.configuration?.loadProfile, language)}
              </span>
              <span className="rid">{exitOrError(run, language)}</span>
            </div>
          </div>
        })}
      {windowedRuns.length === 0 && !loading && (
        <div className="run-tab-empty" style={{ gridColumn: '1 / -1' }}>
          <div className="run-tab-empty-title">{translate(language, 'detail.timeline.empty.title')}</div>
          <div className="run-tab-empty-hint">
            {translate(language, 'detail.timeline.empty.hint', { window: window_ })}
          </div>
        </div>
      )}
    </div>
    {/* Right-click menu — same component as the overview uses,
        so the item list (status-dependent focus / rerun /
        share / cleanup actions) stays in lockstep by
        construction. The menu state is local to this tab so
        closing it does not affect the parent dashboard's
        overview-badge menu. */}
    {runMenu && (() => {
      // Resolve the run (and its sibling scan for "remove all
      // other failed") from a merged source. The dashboard map
      // only contains runs started in this session; historical
      // runs live exclusively in [timelineRuns]. Looking up the
      // run from the dashboard map alone made the menu
      // immediately call `onClose()` (its defensive
      // `if (!run) return null` path) on every right-click on a
      // historical run, which is the bug fixed here.
      const menuRuns = mergeTimelineMenuRuns(runsMap, visibleTimelineRuns)
      return <RunContextMenu
        menu={runMenu}
        run={menuRuns[runMenu.runId]}
        runs={menuRuns}
        language={language}
        onAction={runMenuAction}
        onClose={() => setRunMenu(null)}
        menuRef={runMenuRef}
      />
    })()}
  </div>
}

function addHiddenRunIds(current: ReadonlySet<string>, runIds: Iterable<string>): Set<string> {
  const next = new Set(current)
  for (const runId of runIds) next.add(runId)
  return next
}

function dayLabel(ts: number, center: number, language: SupportedLanguage): string {
  // Labels are relative to the timeline's anchor (today or the
  // focused run), so the centre bucket always reads "heute"
  // regardless of which run the user has jumped to. Buckets in
  // the future read "+Nd", past buckets read "vor Nd". All
  // literals live in the i18n dict so the dashboard switches
  // languages in lock-step with the rest of the chrome.
  const diffDays = Math.round((ts - center) / (24 * 60 * 60 * 1000))
  if (diffDays === 0) return translate(language, 'detail.timeline.dayLabel.today')
  if (diffDays === 1) return translate(language, 'detail.timeline.dayLabel.future', { n: 1 })
  if (diffDays === -1) return translate(language, 'detail.timeline.dayLabel.yesterday')
  if (diffDays > 0) return translate(language, 'detail.timeline.dayLabel.future', { n: diffDays })
  return translate(language, 'detail.timeline.dayLabel.past', { n: -diffDays })
}

function dayBucketTicks(dayCount: number, center: number, window: Window) {
  // For 24h, draw 6 hourly ticks centred on `now`. For longer
  // windows, one tick per day centred on `center`. The label
  // position is the centre of each bucket, not the boundary,
  // so the text does not overlap the day-separator lines below.
  //
  // The labels show concrete wall-clock values (HH:MM for
  // 24h, "TT.MM" for ≥ 7d with an extra "HH:MM" on the major
  // centre tick) rather than only relative offsets like
  // "-6h" / "+6h". The user expects to read the absolute
  // moment the tick is anchored to, not do mental arithmetic
  // every time the centre changes. The actual formatting lives
  // in [endpointTimelineTicks.ts] so the helpers can be unit
  // tested without React.
  if (window === '24h') {
    const ticks: number[] = [-12, -6, 0, 6, 12]
    return ticks.map(h => {
      const left = ((h + 12) / 24) * 100
      const date = new Date(center + h * 60 * 60 * 1000)
      const major = h === 0
      return <div key={h} className={major ? 'tick major' : 'tick'} style={{ left: `${left}%` }}>
        <span>{formatHourTick(date)}</span>
      </div>
    })
  }
  const dayStep = dayCount <= 7 ? 1 : dayCount <= 30 ? 5 : 15
  const pastBuckets = Math.floor((dayCount - 1) / 2)
  const ticks = []
  for (let i = -pastBuckets; i <= dayCount - 1 - pastBuckets; i += dayStep) {
    const ts = center + i * 24 * 60 * 60 * 1000
    const date = new Date(ts)
    const left = ((i + pastBuckets) / dayCount) * 100
    const major = i === 0
    ticks.push(<div key={i} className={major ? 'tick major' : 'tick'} style={{ left: `${left}%` }}>
      <span>{formatDayTick(date, major)}</span>
    </div>)
  }
  return ticks
}

function dayOffsetPercent(ts: number, center: number, windowMs: number): number {
  // Map an absolute timestamp to a 0..100 % position inside the
  // symmetric window centred on `center`.
  return Math.max(0, Math.min(100, ((ts - (center - windowMs / 2)) / windowMs) * 100))
}

function runStatusClass(status: string): string {
  switch (status) {
    case 'COMPLETED': return 'completed'
    case 'FAILED':
    case 'ABORTED': return 'failed'
    case 'STOPPED':
    case 'STOPPING': return 'stopped'
    default: return 'completed'
  }
}

function runStatusBadgeClass(status: string): string {
  switch (status) {
    case 'COMPLETED': return 'pass'
    case 'FAILED': return 'fail'
    case 'ABORTED': return 'fail'
    case 'STOPPED':
    case 'STOPPING': return 'stopped'
    case 'QUEUED':
    case 'RUNNING': return 'running'
    default: return 'running'
  }
}

function runStatusBadgeLabel(status: string, language: SupportedLanguage): string {
  // Resolves the human-readable status label from the i18n dict
  // (key shape: `status.badge.completed` / `status.badge.failed`
  // / ...). The legacy implementation was an in-place
  // `Record<string, ...>` with German-only values — every
  // English label was actually German in disguise, which is
  // exactly the bug the user reported. Switching to the central
  // dict keeps the two languages in lock-step with the rest of
  // the dashboard. Unknown statuses fall through to the raw
  // value (e.g. "QUEUED" stays "QUEUED" in English).
  const key = `status.badge.${status.toLowerCase()}` as Parameters<typeof translate>[1]
  const translated = translate(language, key)
  return translated === key ? status : translated
}

function relativeWhen(iso: string, now: number, language: SupportedLanguage): string {
  // Each branch resolves the human label through the i18n dict
  // (`when.justNow`, `when.minutes`, `when.hours`, `when.days`)
  // so the formatter switches language in lock-step with the
  // rest of the dashboard. The previous version used inline
  // `language === 'de' ? ... : ...` ternaries which made it
  // easy to forget a branch.
  const diff = now - Date.parse(iso)
  if (!Number.isFinite(diff) || diff < 0) return '–'
  const minutes = Math.round(diff / 60000)
  if (minutes < 1) return translate(language, 'when.justNow')
  if (minutes < 60) return translate(language, 'when.minutes', { n: minutes })
  const hours = Math.round(minutes / 60)
  if (hours < 24) return translate(language, 'when.hours', { n: hours })
  const days = Math.round(hours / 24)
  if (days === 1) return translate(language, 'when.yesterday')
  return translate(language, 'when.days', { n: days })
}

function exitOrError(run: TestRun, language: SupportedLanguage): string {
  // Resolves the bottom-row hint from the i18n dict so the
  // formatter switches language in lock-step with the rest
  // of the dashboard. The previous version hard-coded the
  // German strings ("läuft …" / "siehe Diagnose") which
  // meant the English chrome of the timeline tab rendered
  // German hints when the user picked English — a small
  // but visible inconsistency. The exit-code label is left
  // as a plain `exit N` because that is the form every
  // shell / CI log uses; a localised `Exit code {code}`
  // would be a separate design decision.
  if (run.status === 'RUNNING' || run.status === 'QUEUED') {
    return translate(language, 'detail.timeline.runningHint')
  }
  if (run.exitCode != null) return `exit ${run.exitCode}`
  if (run.error) return translate(language, 'detail.timeline.seeDiagnostics')
  return '–'
}

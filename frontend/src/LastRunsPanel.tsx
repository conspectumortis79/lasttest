// "Letzte Läufe" panel — the row-based list view that replaces
// the old `run-grid` of badge cards. Each row shows a status dot,
// a human-readable identifier (HTTP method + path), a status
// badge (e.g. "BESTANDEN" / "FEHLGESCHLAGEN"), a one-line meta
// string (VUs / duration / status suffix), the elapsed/planned
// duration and a relative "when" stamp on the right.
//
// The row is also the right-click target: `onContextMenu` is
// forwarded straight to the caller so the same
// `RunContextMenu` the rest of the app uses can be opened with
// the exact same coordinates and items. This keeps a single
// menu implementation rather than a per-view clone.
//
// The component is presentational — all decision logic lives in
// `lastRunsView.ts` (status → CSS class, meta line, duration and
// relative-time formatters) so the React tree stays small and
// the heavy lifting stays unit-testable under `node:test`.
//
// Since the per-endpoint "× N" statistics release, every row
// also renders a small badge next to the operation name
// showing the total number of times that endpoint has been
// tested. The badge is data-driven by [useOperationStats] and
// is a no-op (renders nothing) until the first response
// arrives — so the panel still works on cold start, offline,
// or when the backend is down.

import { useLanguage } from './languageStorage.ts'
import { translate } from './i18n.ts'
import type { TestRun } from './k6Report.ts'
import { runElapsedSeconds } from './k6Report.ts'
import { isInFlight, sortRunsByCreatedAt } from './runDashboard.ts'
import {
  durationFor,
  metaLineFor,
  operationMethodAndPath,
  relativeWhenFor,
  runDisplayName,
  statusBadgeClass,
  statusBadgeLabel,
  statusDotClass,
} from './lastRunsView.ts'
import { findTestCount, useOperationStats } from './useOperationStats.ts'

type LastRunsPanelProps = {
  runs: Record<string, TestRun>
  activeRunId: string | undefined
  /** Clock tick used to compute live durations and "running for" labels. */
  now: number
  onSelect: (runId: string) => void
  /**
   * Receives the right-click event so the caller can position
   * the existing `RunContextMenu` at the cursor. The panel
   * itself stays free of menu state — it only forwards the
   * event up. This matches the contract the old `run-grid`
   * already had with `App.tsx`'s `openRunMenu` helper.
   */
  onContextMenu: (event: React.MouseEvent, runId: string) => void
}

export function LastRunsPanel({ runs, activeRunId, now, onSelect, onContextMenu }: LastRunsPanelProps) {
  const { language } = useLanguage()
  const ordered = sortRunsByCreatedAt(runs)
  // Polls /api/operations/stats in the background. The data
  // flows down into [LastRunsRow] via the `stats` prop so each
  // row can render its own × N badge without re-fetching.
  const { stats } = useOperationStats({ intervalMs: 5_000 })

  if (ordered.length === 0) {
    return (
      <div className="last-runs-card card">
        <header className="last-runs-head">
          <h3 className="last-runs-title">{translate(language, 'lastRuns.heading')}</h3>
        </header>
        <div className="last-runs-empty">{translate(language, 'lastRuns.empty')}</div>
      </div>
    )
  }

  return (
    <div className="last-runs-card card">
      <header className="last-runs-head">
        <h3 className="last-runs-title">{translate(language, 'lastRuns.heading')}</h3>
        <span className="last-runs-project">
          {translate(language, 'lastRuns.project', { name: ordered[0]?.configuration?.apiTitle ?? 'lasttest' })}
        </span>
        <div className="last-runs-actions">
          <button type="button" className="btn btn-ghost last-runs-filter">
            {translate(language, 'lastRuns.filter')}
          </button>
        </div>
      </header>
      <div className="last-runs-list" role="tablist" aria-label={translate(language, 'lastRuns.aria')}>
        {ordered.map(run => (
          <LastRunsRow
            key={run.id}
            run={run}
            now={now}
            isActive={run.id === activeRunId}
            stats={stats}
            onSelect={() => onSelect(run.id)}
            onContextMenu={event => onContextMenu(event, run.id)}
          />
        ))}
      </div>
    </div>
  )
}

type LastRunsRowProps = {
  run: TestRun
  now: number
  isActive: boolean
  stats: import('./useOperationStats.ts').OperationStats[]
  onSelect: () => void
  onContextMenu: (event: React.MouseEvent) => void
}

function LastRunsRow({ run, now, isActive, stats, onSelect, onContextMenu }: LastRunsRowProps) {
  const { language } = useLanguage()
  const elapsed = runElapsedSeconds(run, now)
  const inFlight = isInFlight(run.status)
  const badgeClass = statusBadgeClass(run.status)
  const dotClass = statusDotClass(run.status)
  // Look up the per-endpoint × N count. The hook returns an
  // empty list on cold start, so [findTestCount] gives 0 by
  // default — meaning "neu" (untested) is the safe rendering
  // until the first response arrives.
  const { method, path } = operationMethodAndPath(run)
  const testCount = method ? findTestCount(stats, method, path) : 0
  const countLabel = testCount > 0 ? `× ${testCount}` : translate(language, 'lastRuns.untested')
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      // `run-badge` is kept as an additional class so the e2e
      // tests that target the old grid still find the row by
      // its old selector. The new visual contract lives in
      // `run-list-row` and the per-status modifier.
      className={`run-list-row run-badge run-badge-${run.status.toLowerCase()} ${isActive ? 'active' : ''} ${inFlight ? 'is-in-flight' : 'is-terminal'}`}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      title={`${run.id} · ${runDisplayName(run)} — ${translate(language, 'lastRuns.hintTitle')}`}
    >
      <span className={`run-status-dot run-status-dot-${dotClass}`} aria-hidden="true" />
      <div className="run-list-main">
        <div className="run-list-name">
          <span className="run-list-identifier">{runDisplayName(run)}</span>
          <span
            className={`run-list-test-count ${testCount === 0 ? 'untested' : ''}`}
            title={
              testCount > 0
                ? translate(language, 'lastRuns.tested.title', { n: testCount })
                : translate(language, 'lastRuns.untested.title')
            }
          >
            {countLabel}
          </span>
          <span className={`status-badge ${badgeClass}`}>{statusBadgeLabel(run.status, language)}</span>
          <span className="run-list-hint" aria-hidden="true">
            <kbd>{translate(language, 'lastRuns.rightClick')}</kbd>
            {translate(language, 'lastRuns.forActions')}
          </span>
        </div>
        <div className="run-list-meta">{metaLineFor(run, language)}</div>
      </div>
      <div className="run-list-right">
        <span className="run-list-dur">{durationFor(run, elapsed, language)}</span>
        <span className="run-list-when">{relativeWhenFor(run, now, language)}</span>
      </div>
    </button>
  )
}

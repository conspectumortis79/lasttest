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

import { useLanguage } from './useLanguage.tsx'
import { translate } from './i18n.ts'
import type { TestRun } from './k6Report.ts'
import { runElapsedSeconds } from './k6Report.ts'
import { isInFlight, sortRunsByCreatedAt } from './runDashboard.ts'
import {
  durationFor,
  metaLineFor,
  relativeWhenFor,
  runDisplayName,
  statusBadgeClass,
  statusBadgeLabel,
  statusDotClass,
} from './lastRunsView.ts'

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
  onSelect: () => void
  onContextMenu: (event: React.MouseEvent) => void
}

function LastRunsRow({ run, now, isActive, onSelect, onContextMenu }: LastRunsRowProps) {
  const { language } = useLanguage()
  const elapsed = runElapsedSeconds(run, now)
  const inFlight = isInFlight(run.status)
  const badgeClass = statusBadgeClass(run.status)
  const dotClass = statusDotClass(run.status)
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
          <span className={`status-badge ${badgeClass}`}>{statusBadgeLabel(run.status, language)}</span>
          <span className="run-list-hint" aria-hidden="true">
            <kbd>Rechtsklick</kbd>
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

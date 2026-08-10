// Pure helpers for the run-badge context menu. Extracted from
// `App.tsx` so the menu layout (status-dependent items,
// separators, danger variants) is unit-testable without having to
// render React.
//
// Labels are produced from the shared i18n dictionary so the
// menu speaks the user's language. The English fallback keeps
// tests stable when the lookup would otherwise return the key.
import { translate, type SupportedLanguage } from './i18n.ts'
import type { TestRun } from './k6Report.ts'
import { hasOtherFailedRun } from './runDashboard.ts'

export const IN_FLIGHT_STATUSES: ReadonlySet<string> = new Set([
  'QUEUED',
  'RUNNING',
  'STOPPING',
])

export const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'COMPLETED',
  'FAILED',
  'STOPPED',
  'ABORTED',
])

type RunMenuState =
  | 'in-flight'
  | 'terminal-cancellable'
  | 'terminal-aborted'
  | 'terminal'

export function classifyRunForMenu(run: TestRun): RunMenuState {
  if (IN_FLIGHT_STATUSES.has(run.status)) return 'in-flight'
  if (run.status === 'ABORTED') return 'terminal-aborted'
  return 'terminal'
}

export type MenuItemAction =
  | 'focus'
  | 'copy-run-id'
  | 'copy-report-link'
  | 'open-report'
  | 'export-metrics'
  | 'download-script'
  | 'stop'
  | 'force-abort'
  | 'rerun'
  | 'remove-from-view'
  | 'remove-all-other-failed'

export type MenuItem = {
  id: string
  label: string
  shortcut?: string
  danger?: boolean
  action: MenuItemAction
  disabledReason?: string | null
}

export function buildRunMenuItems(
  run: TestRun,
  lang: SupportedLanguage = 'en',
  siblingRuns?: Record<string, TestRun>,
  /**
   * Whether the `rerun` action is offered in the menu.
   *
   * Defaults to `true` so the overview dashboard — which
   * uses the same component for its badge right-click —
   * keeps the historical "Erneut starten" entry point.
   *
   * The per-endpoint timeline tab sets this to `false`:
   * timeline rows are a passive history view and the
   * payload data the rerun would replay was intentionally
   * stripped from the timeline persist path, so offering a
   * rerun from a timeline row would only produce a
   * half-replayed run that the user has no way to
   * preview. Hiding the action is more honest than letting
   * the user click it and wondering why k6 sent an empty
   * body.
   */
  showRerun: boolean = true,
  /**
   * Whether the `export-metrics` action is offered in the
   * menu.
   *
   * Defaults to `true` so the overview dashboard keeps
   * the `k6-JSON exportieren` entry point — the k6
   * summary is part of the dashboard's live view and the
   * user expects to be able to grab it from the badge
   * they can already see.
   *
   * The per-endpoint timeline tab sets this to `false`:
   * timeline rows are a passive history view, and the k6
   * summary that drives the export is fetched separately
   * from the run the badge is about. Offering the export
   * from the timeline row would either trigger an extra
   * round trip per click or silently hand the user a
   * stale blob — both worse than just hiding the item.
   */
  showExportMetrics: boolean = true,
): MenuItem[][] {
  const groups: MenuItem[][] = []
  const isInFlight = IN_FLIGHT_STATUSES.has(run.status)
  if (isInFlight) {
    // The in-flight menu deliberately omits the historical
    // focus entry (`Show live details` in English /
    // `Live-Details anzeigen` in German). The previous
    // behaviour offered an explicit "focus this run" item
    // here so the user could switch the inspector to a
    // different QUEUED/RUNNING/STOPPING row; the toggle
    // was redundant because clicking the badge in the
    // overview grid already does the same thing. Removing
    // the entry keeps the in-flight menu small (the k6
    // control surface is what the user wants when they
    // right-click a live run) and matches the terminal
    // menu, which dropped its analogous `Show summary` /
    // `Zusammenfassung anzeigen` item for the same reason.
    groups.push([
      { id: 'copy-id', label: translate(lang, 'menu.copyRunId'), action: 'copy-run-id' },
      { id: 'open-report', label: translate(lang, 'menu.openReport'), action: 'open-report' },
    ])
    groups.push([
      { id: 'stop', label: translate(lang, 'menu.stop'), shortcut: 'S', action: 'stop' },
      { id: 'force-abort', label: translate(lang, 'menu.forceAbort'), shortcut: '⇧S', action: 'force-abort', danger: true },
    ])
    return groups
  }
  // Terminal menu: the `Show summary` /
  // `Zusammenfassung anzeigen` (and `Show aborted
  // details` / `Aborted-Details anzeigen`) item used to
  // live at the head of this group. Removing it: the
  // action was a duplicate of "left-click the badge",
  // the German label confused users who expected a true
  // summary view (the inspector already shows the
  // summary), and the toggle is not available from the
  // timeline context anyway. The export-metrics item is
  // gated on [showExportMetrics] — see that parameter's
  // KDoc for the per-surface rationale.
  const terminalViewGroup: MenuItem[] = [
    { id: 'copy-report-link', label: translate(lang, 'menu.copyReportLink'), action: 'copy-report-link' },
    { id: 'open-report', label: translate(lang, 'menu.openReport'), action: 'open-report' },
    {
      id: 'download-script',
      label: translate(lang, 'menu.downloadScript'),
      action: 'download-script',
    },
  ]
  if (showExportMetrics) {
    terminalViewGroup.push({
      id: 'export-metrics',
      label: translate(lang, 'menu.exportMetrics'),
      action: 'export-metrics',
      disabledReason: run.status === 'ABORTED'
        ? translate(lang, 'menu.export.disabled.aborted')
        : run.summary?.raw
          ? null
          : translate(lang, 'menu.export.disabled.noSummary'),
    })
  }
  groups.push(terminalViewGroup)
  if (showRerun) {
    groups.push([
      { id: 'rerun', label: translate(lang, 'menu.rerun'), action: 'rerun' },
    ])
  }
  // Third group on terminal runs: lets the user clean up the
  // dashboard without leaving the page. "Remove from view"
  // drops the clicked badge from the in-memory map; "Remove all
  // other failed" drops every FAILED badge except the clicked
  // one. The bulk action is disabled when nothing would be
  // removed (no other FAILED badges in the map), so the user
  // is not tempted to click an action with no effect. Both
  // actions are visually destructive: the data only lives in
  // the React state and a page refresh would re-hydrate it
  // from the backend, but the user's selection / ordering /
  // dashboard focus are affected.
  groups.push([
    {
      id: 'remove-from-view',
      label: translate(lang, 'menu.removeFromView'),
      action: 'remove-from-view',
      danger: true,
    },
    {
      id: 'remove-all-other-failed',
      label: translate(lang, 'menu.removeAllOtherFailed'),
      action: 'remove-all-other-failed',
      danger: true,
      disabledReason: siblingRuns === undefined
        ? null
        : hasOtherFailedRun(siblingRuns, run.id)
          ? null
          : translate(lang, 'menu.removeAllOtherFailed.disabled.noOther'),
    },
  ])
  return groups
}

export function isMenuItemEnabled(item: MenuItem): boolean {
  return !item.disabledReason
}

export function menuItemCount(run: TestRun): number {
  return buildRunMenuItems(run).reduce((sum, group) => sum + group.length, 0)
}

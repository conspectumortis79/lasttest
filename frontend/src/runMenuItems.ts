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

export type RunMenuState =
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
): MenuItem[][] {
  const groups: MenuItem[][] = []
  const isInFlight = IN_FLIGHT_STATUSES.has(run.status)
  const isTerminalAborted = run.status === 'ABORTED'
  if (isInFlight) {
    groups.push([
      { id: 'focus', label: translate(lang, 'menu.focus'), action: 'focus' },
      { id: 'copy-id', label: translate(lang, 'menu.copyRunId'), action: 'copy-run-id' },
      { id: 'open-report', label: translate(lang, 'menu.openReport'), action: 'open-report' },
    ])
    groups.push([
      { id: 'stop', label: translate(lang, 'menu.stop'), shortcut: 'S', action: 'stop' },
      { id: 'force-abort', label: translate(lang, 'menu.forceAbort'), shortcut: '⇧S', action: 'force-abort', danger: true },
    ])
    return groups
  }
  groups.push([
    {
      id: 'focus',
      label: isTerminalAborted ? translate(lang, 'menu.focus.aborted') : translate(lang, 'menu.focus.summary'),
      action: 'focus',
    },
    { id: 'copy-report-link', label: translate(lang, 'menu.copyReportLink'), action: 'copy-report-link' },
    { id: 'open-report', label: translate(lang, 'menu.openReport'), action: 'open-report' },
    {
      id: 'export-metrics',
      label: translate(lang, 'menu.exportMetrics'),
      action: 'export-metrics',
      disabledReason: run.status === 'ABORTED'
        ? translate(lang, 'menu.export.disabled.aborted')
        : run.summary?.raw
          ? null
          : translate(lang, 'menu.export.disabled.noSummary'),
    },
  ])
  groups.push([
    { id: 'rerun', label: translate(lang, 'menu.rerun'), action: 'rerun' },
  ])
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

// Pure helpers for the run-badge context menu. Extracted from
// `App.tsx` so the menu layout (status-dependent items,
// separators, danger variants) is unit-testable without having to
// render React.

import type { TestRun } from './k6Report.ts'

/**
 * The five terminal / pre-terminal run states we treat differently
 * in the menu. QUEUED / RUNNING share a "live controls" set;
 * STOPPING keeps the same set because the user may still want to
 * escalate to a force abort. COMPLETED, STOPPED, FAILED and ABORTED
 * collapse into the same "read-only" menu with a "Rerun" entry.
 *
 * The strings here match the `TestRunStatus` enum on the backend
 * (Model.kt). Kept as `string` so the frontend stays forgiving if
 * an older server sends a status literal the bundled UI has never
 * heard of.
 */
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

/**
 * Categorises a run so the menu can decide which items to show.
 * Pure: does not read any global state, easy to unit test.
 */
export type RunMenuState =
  | 'in-flight'
  | 'terminal-cancellable' // currently nothing maps here; reserved
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

export type MenuItem = {
  /** Stable id — used by tests and as React `key`. */
  id: string
  /** Visible label, already localised to German to match the rest of the UI. */
  label: string
  /** Optional keyboard shortcut hint, displayed right-aligned. */
  shortcut?: string
  /** Render in red — destructive actions only. */
  danger?: boolean
  /** Underlying action; the menu component routes on this. */
  action: MenuItemAction
  /**
   * Disabled reason, rendered as the title and a faded row. `null`
   * (default) keeps the item enabled. The menu treats any truthy
   * string as "do not invoke the action".
   */
  disabledReason?: string | null
}

/**
 * Builds the list of groups (separators between groups are
 * rendered by the menu component, not encoded here) for the given
 * run. The first group is always "view / share", the last group is
 * always "control" (stop / force / rerun).
 *
 * Keeping this pure lets the same logic drive the React menu and
 * any future Playwright/E2E spec that needs to know which actions
 * are reachable for a status.
 */
export function buildRunMenuItems(run: TestRun): MenuItem[][] {
  const groups: MenuItem[][] = []
  const isInFlight = IN_FLIGHT_STATUSES.has(run.status)
  const isTerminalAborted = run.status === 'ABORTED'
  if (isInFlight) {
    groups.push([
      { id: 'focus', label: 'Live-Details anzeigen', action: 'focus' },
      { id: 'copy-id', label: 'Run-ID kopieren', action: 'copy-run-id' },
      { id: 'open-report', label: 'k6-Webreport öffnen', action: 'open-report' },
    ])
    groups.push([
      { id: 'stop', label: 'Stop (graceful)', shortcut: 'S', action: 'stop' },
      { id: 'force-abort', label: 'Force abort', shortcut: '⇧S', action: 'force-abort', danger: true },
    ])
    return groups
  }
  // Terminal state — read-only view + rerun.
  groups.push([
    { id: 'focus', label: isTerminalAborted ? 'Aborted-Details anzeigen' : 'Zusammenfassung anzeigen', action: 'focus' },
    { id: 'copy-report-link', label: 'Report-Link kopieren', action: 'copy-report-link' },
    { id: 'open-report', label: 'k6-Webreport öffnen', action: 'open-report' },
    {
      id: 'export-metrics',
      label: 'k6-JSON exportieren',
      action: 'export-metrics',
      disabledReason: run.status === 'ABORTED'
        ? 'Aborted runs have no complete summary to export.'
        : run.summary?.raw
          ? null
          : 'Run hat keine k6-Zusammenfassung — JSON-Export nicht verfügbar.',
    },
  ])
  groups.push([
    { id: 'rerun', label: 'Erneut ausführen', action: 'rerun' },
  ])
  return groups
}

/**
 * True when the menu item should be reachable in the UI. We keep
 * `disabledReason` on the item itself so the tooltip stays in sync
 * with the visible label.
 */
export function isMenuItemEnabled(item: MenuItem): boolean {
  return !item.disabledReason
}

/**
 * Counts how many menu items buildRunMenuItems returns for the
 * given run. Useful for Playwright assertions on the rendered menu.
 */
export function menuItemCount(run: TestRun): number {
  return buildRunMenuItems(run).reduce((sum, group) => sum + group.length, 0)
}

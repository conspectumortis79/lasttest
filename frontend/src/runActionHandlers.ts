// Bundle of callbacks for run-targeted actions.
//
// Every handler takes the run id explicitly so the same bundle
// drives both surfaces that act on a single run:
//   - the "Aktionen" tab inside [RunDetail] (operates on the
//     focused run),
//   - per-run right-click menus (overview badges, per-endpoint
//     timeline list / Gantt — can target any past run).
//
// Keeping the action routing in [App] means the fetch calls,
// clipboard and i18n live in one place. The type itself lives
// here (rather than in `App.tsx`) so child components can import
// it without pulling the whole `App.tsx` module — and without
// a circular import.
import type { MenuItem, MenuItemAction } from './runMenuItems.ts'

export type RunActionHandlers = {
  /** Switch the dashboard focus to the targeted run. */
  onFocusRun: (runId: string) => void
  onStop: (runId: string, force: boolean) => void | Promise<void>
  onRerun: (runId: string) => void | Promise<void>
  onCopyRunId: (runId: string) => void | Promise<void>
  onCopyReportLink: (runId: string) => void | Promise<void>
  onOpenReport: (runId: string) => void | Promise<void>
  onDownloadScript: (runId: string) => void | Promise<void>
  onExportMetrics: (runId: string) => void | Promise<void>
  onRemove: (runId: string) => void
  onRemoveAllOtherFailed: (runId: string) => void
  /**
   * Wipe the entire timeline. The handler is the one place
   * that talks to the backend (the "Alle löschen" button on
   * the per-endpoint timeline tab) and resets the
   * in-memory `runs` map. Returns a promise so the caller
   * can surface a confirmation toast or an error message
   * based on the result.
   */
  onClearAll: () => Promise<{ cancelled: number, deleted: number } | null>
}

/**
 * Single dispatch table from [MenuItemAction] to the matching
 * handler in [RunActionHandlers]. Extracted so the overview
 * badge menu and the per-endpoint timeline menu share one
 * implementation — adding a new action means changing exactly
 * two places (this table + the bundle construction in [App]),
 * never the menu components.
 *
 * The function is pure: it takes the picked item, the
 * handlers bundle, and the target run id, then calls the
 * matching handler. The caller is responsible for closing the
 * menu (`setRunMenu(null)`) — that is a UI concern, not an
 * action concern, and embedding it here would couple the
 * dispatch to React state.
 */
export async function dispatchRunMenuAction(
  item: Pick<MenuItem, 'action'>,
  handlers: RunActionHandlers,
  runId: string,
): Promise<void> {
  switch (item.action as MenuItemAction) {
    case 'focus':
      handlers.onFocusRun(runId)
      return
    case 'copy-run-id':
      await handlers.onCopyRunId(runId)
      return
    case 'copy-report-link':
      await handlers.onCopyReportLink(runId)
      return
    case 'open-report':
      handlers.onOpenReport(runId)
      return
    case 'export-metrics':
      await handlers.onExportMetrics(runId)
      return
    case 'download-script':
      handlers.onDownloadScript(runId)
      return
    case 'stop':
      await handlers.onStop(runId, false)
      return
    case 'force-abort':
      await handlers.onStop(runId, true)
      return
    case 'rerun':
      await handlers.onRerun(runId)
      return
    case 'remove-from-view':
      handlers.onRemove(runId)
      return
    case 'remove-all-other-failed':
      handlers.onRemoveAllOtherFailed(runId)
      return
  }
}

// Unit tests for the run-menu dispatch logic in
// `runActionHandlers.ts`.
//
// Scope:
//   1. every [MenuItemAction] routes to exactly one handler in
//      [RunActionHandlers], and the handler is called with the
//      run id the dispatcher received;
//   2. `stop` / `force-abort` map to `onStop` with the right
//      `force` flag (the menu has two distinct actions that
//      share a handler);
//   3. unknown actions are silently ignored (the menu never
//      produces one today, but the dispatcher is a pure
//      function and should be defensive).
//
// These tests cover the only piece of logic that was easy to
// silently break during the timeline-right-click refactor —
// i.e. renaming a handler in `RunActionHandlers` without
// updating the switch in `dispatchRunMenuAction` (or vice
// versa). The dispatch table is the single source of truth for
// "menu action → handler".

import { deepEqual, equal } from 'node:assert/strict'
import { test } from 'node:test'
import { dispatchRunMenuAction, type RunActionHandlers } from './runActionHandlers.ts'
import type { MenuItem, MenuItemAction } from './runMenuItems.ts'

/** Builds a no-op handlers bundle that records every call. */
function makeRecordedHandlers(): {
  handlers: RunActionHandlers
  calls: Record<keyof RunActionHandlers, unknown[]>
} {
  const calls: Record<keyof RunActionHandlers, unknown[]> = {
    onFocusRun: [],
    onStop: [],
    onRerun: [],
    onCopyRunId: [],
    onCopyReportLink: [],
    onOpenReport: [],
    onDownloadScript: [],
    onExportMetrics: [],
    onRemove: [],
    onRemoveAllOtherFailed: [],
    onClearAll: [],
  }
  const handlers: RunActionHandlers = {
    onFocusRun: (id) => { calls.onFocusRun.push(id) },
    onStop: (id, force) => { calls.onStop.push({ id, force }) },
    onRerun: (id) => { calls.onRerun.push(id) },
    onCopyRunId: (id) => { calls.onCopyRunId.push(id) },
    onCopyReportLink: (id) => { calls.onCopyReportLink.push(id) },
    onOpenReport: (id) => { calls.onOpenReport.push(id) },
    onDownloadScript: (id) => { calls.onDownloadScript.push(id) },
    onExportMetrics: (id) => { calls.onExportMetrics.push(id) },
    onRemove: (id) => { calls.onRemove.push(id) },
    onRemoveAllOtherFailed: (id) => { calls.onRemoveAllOtherFailed.push(id) },
    onClearAll: async () => { calls.onClearAll.push(true); return { cancelled: 0, deleted: 0 } },
  }
  return { handlers, calls }
}

function makeItem(action: MenuItemAction): MenuItem {
  // The dispatcher only reads `action`; the rest of the menu
  // item is irrelevant for these tests.
  return { id: action, label: action, action }
}

// ---- positive path: every action routes to its handler ----------------

const ROUTING: ReadonlyArray<{
  action: MenuItemAction
  handler: keyof RunActionHandlers
  args?: unknown[]
}> = [
  { action: 'focus', handler: 'onFocusRun' },
  { action: 'copy-run-id', handler: 'onCopyRunId' },
  { action: 'copy-report-link', handler: 'onCopyReportLink' },
  { action: 'open-report', handler: 'onOpenReport' },
  { action: 'export-metrics', handler: 'onExportMetrics' },
  { action: 'download-script', handler: 'onDownloadScript' },
  { action: 'rerun', handler: 'onRerun' },
  { action: 'remove-from-view', handler: 'onRemove' },
  { action: 'remove-all-other-failed', handler: 'onRemoveAllOtherFailed' },
]

for (const { action, handler } of ROUTING) {
  test(`dispatch routes "${action}" to ${handler} with the target run id`, async () => {
    const { handlers, calls } = makeRecordedHandlers()
    await dispatchRunMenuAction(makeItem(action), handlers, 'target-run')
    deepEqual(calls[handler], ['target-run'])
    // Every other handler must be untouched.
    for (const other of Object.keys(calls) as (keyof RunActionHandlers)[]) {
      if (other === handler) continue
      equal(calls[other].length, 0, `${other} should not be called for "${action}"`)
    }
  })
}

// ---- stop / force-abort: shared handler, different flags -------------

test('dispatch routes "stop" to onStop with force=false', async () => {
  const { handlers, calls } = makeRecordedHandlers()
  await dispatchRunMenuAction(makeItem('stop'), handlers, 'run-x')
  deepEqual(calls.onStop, [{ id: 'run-x', force: false }])
})

test('dispatch routes "force-abort" to onStop with force=true', async () => {
  const { handlers, calls } = makeRecordedHandlers()
  await dispatchRunMenuAction(makeItem('force-abort'), handlers, 'run-y')
  deepEqual(calls.onStop, [{ id: 'run-y', force: true }])
})

// ---- error path: unknown actions are silent no-ops --------------------

test('dispatch silently ignores unknown actions', async () => {
  const { handlers, calls } = makeRecordedHandlers()
  // The type system forbids unknown actions for `MenuItemAction`,
  // but the dispatcher should still be defensive if the cast is
  // ever bypassed (e.g. server-driven menu items in a future
  // release).
  const unknown = { id: 'x', label: 'x', action: 'unknown-action' as MenuItemAction }
  await dispatchRunMenuAction(unknown, handlers, 'run-z')
  for (const key of Object.keys(calls) as (keyof RunActionHandlers)[]) {
    equal(calls[key].length, 0, `${key} should not be called for unknown action`)
  }
})

// ---- async handlers: dispatcher awaits their return ------------------

test('dispatch awaits async handlers before resolving', async () => {
  const order: string[] = []
  const handlers: RunActionHandlers = {
    onFocusRun: () => {},
    onStop: async () => { await new Promise(resolve => setTimeout(resolve, 5)); order.push('stop-done') },
    onRerun: async (id) => { order.push(`rerun-${id}`) },
    onCopyRunId: () => {},
    onCopyReportLink: () => {},
    onOpenReport: () => {},
    onDownloadScript: () => {},
    onExportMetrics: async () => { await new Promise(resolve => setTimeout(resolve, 5)); order.push('export-done') },
    onRemove: () => {},
    onRemoveAllOtherFailed: () => {},
    onClearAll: async () => ({ cancelled: 0, deleted: 0 }),
  }
  await dispatchRunMenuAction(makeItem('export-metrics'), handlers, 'run-a')
  deepEqual(order, ['export-done'])
  await dispatchRunMenuAction(makeItem('rerun'), handlers, 'run-b')
  deepEqual(order, ['export-done', 'rerun-run-b'])
})

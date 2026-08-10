import { deepEqual, equal, ok } from 'node:assert/strict'
import { test } from 'node:test'
import type { TestRun } from './k6Report.ts'
import {
  buildRunMenuItems,
  classifyRunForMenu,
  IN_FLIGHT_STATUSES,
  isMenuItemEnabled,
  menuItemCount,
  TERMINAL_STATUSES,
} from './runMenuItems.ts'

function runWith(status: string, extras: Partial<TestRun> = {}): TestRun {
  return {
    id: 'run-id-1',
    status,
    createdAt: '2026-01-01T00:00:00Z',
    ...extras,
  } as TestRun
}

test('IN_FLIGHT_STATUSES contains QUEUED, RUNNING and STOPPING', () => {
  ok(IN_FLIGHT_STATUSES.has('QUEUED'))
  ok(IN_FLIGHT_STATUSES.has('RUNNING'))
  ok(IN_FLIGHT_STATUSES.has('STOPPING'))
})

test('TERMINAL_STATUSES contains COMPLETED, FAILED, STOPPED and ABORTED', () => {
  ok(TERMINAL_STATUSES.has('COMPLETED'))
  ok(TERMINAL_STATUSES.has('FAILED'))
  ok(TERMINAL_STATUSES.has('STOPPED'))
  ok(TERMINAL_STATUSES.has('ABORTED'))
})

test('classifyRunForMenu distinguishes in-flight vs aborted vs other terminal', () => {
  equal(classifyRunForMenu(runWith('QUEUED')), 'in-flight')
  equal(classifyRunForMenu(runWith('RUNNING')), 'in-flight')
  equal(classifyRunForMenu(runWith('STOPPING')), 'in-flight')
  equal(classifyRunForMenu(runWith('COMPLETED')), 'terminal')
  equal(classifyRunForMenu(runWith('FAILED')), 'terminal')
  equal(classifyRunForMenu(runWith('STOPPED')), 'terminal')
  equal(classifyRunForMenu(runWith('ABORTED')), 'terminal-aborted')
})

test('in-flight menu has two groups with a stop and a force-abort item', () => {
  const groups = buildRunMenuItems(runWith('RUNNING'))

  equal(groups.length, 2)
  // The historical focus entry (`Show live details` /
  // `Live-Details anzeigen`) was dropped: clicking the
  // badge in the overview grid is the supported way to
  // switch the inspector to a different in-flight run, and
  // the right-click menu is reserved for the k6 control
  // surface (stop / force-abort) plus the share items.
  const top = groups[0].map(item => item.id)
  deepEqual(top, ['copy-id', 'open-report'])
  const control = groups[1].map(item => item.id)
  deepEqual(control, ['stop', 'force-abort'])
  // Force abort is visually marked as destructive.
  ok(groups[1].find(item => item.id === 'force-abort')?.danger === true)
  ok(groups[1].find(item => item.id === 'stop')?.danger !== true)
})

test('in-flight menu does NOT expose a focus item', () => {
  // Defence-in-depth pin on the removal of the focus
  // entry: a regression that re-adds the item would
  // silently restore the redundant toggle and re-introduce
  // the duplicate UX (click badge vs. right-click
  // `Live-Details anzeigen`). The KDoc on
  // [buildRunMenuItems] documents why the entry is gone.
  for (const status of ['QUEUED', 'RUNNING', 'STOPPING']) {
    const actions = buildRunMenuItems(runWith(status)).flat().map(item => item.action)
    ok(!actions.includes('focus'), `focus action must not appear in in-flight menu for ${status}`)
  }
})

test('terminal menu omits the focus item entirely', () => {
  // The previous focus entry (`Show summary` /
  // `Zusammenfassung anzeigen`, and `Show aborted details`
  // / `Aborted-Details anzeigen` for ABORTED) was a
  // duplicate of "left-click the badge" — the inspector
  // already shows the run summary. Removing it shrinks the
  // menu and stops confusing users who expected the entry
  // to open a real summary view.
  for (const status of ['COMPLETED', 'FAILED', 'STOPPED', 'ABORTED']) {
    const actions = buildRunMenuItems(runWith(status)).flat().map(item => item.action)
    ok(!actions.includes('focus'), `focus action must not appear in terminal menu for ${status}`)
  }
})

test('terminal menu offers rerun and disables export when no summary is present', () => {
  const groups = buildRunMenuItems(runWith('COMPLETED'))

  // The terminal menu now has three groups: the view/export
  // group, the rerun group, and the cleanup group (see
  // `terminal menu offers a cleanup group ...` below).
  equal(groups.length, 3)
  const viewGroup = groups[0]
  equal(viewGroup.find(item => item.id === 'copy-report-link')?.action, 'copy-report-link')
  equal(viewGroup.find(item => item.id === 'open-report')?.action, 'open-report')
  equal(viewGroup.find(item => item.id === 'download-script')?.action, 'download-script')
  const exportItem = viewGroup.find(item => item.id === 'export-metrics')!
  ok(!isMenuItemEnabled(exportItem), 'export is disabled when no summary is present')

  const rerunGroup = groups[1]
  equal(rerunGroup[0]?.id, 'rerun')
  // Default language is English; the explicit German label is
  // covered by the i18n dictionary tests.
  equal(rerunGroup[0]?.label, 'Rerun')
})

test('terminal menu enables export when a summary is present', () => {
  const groups = buildRunMenuItems(runWith('COMPLETED', { summary: { raw: '{}' } }))
  const exportItem = groups[0].find(item => item.id === 'export-metrics')!
  ok(isMenuItemEnabled(exportItem))
  equal(exportItem.disabledReason, null)
})

test('ABORTED menu still disables export even when a summary is present', () => {
  // The previous ABORTED test also asserted the focus
  // item's label (`Show aborted details`); that focus
  // entry is now gone, so the assertion moved here and
  // covers only the export side of the ABORTED contract:
  // partial counters are not a complete summary, so the
  // export stays disabled even when `summary.raw` is
  // populated.
  const groups = buildRunMenuItems(runWith('ABORTED', { summary: { raw: '{}' } }))
  const exportItem = groups[0].find(item => item.id === 'export-metrics')!
  ok(!isMenuItemEnabled(exportItem), 'ABORTED export must stay disabled even when summary is present')
})

test('terminal menu omits the export-metrics item when showExportMetrics is false', () => {
  // The per-endpoint timeline tab sets `showExportMetrics =
  // false` because exporting from a timeline row would
  // either trigger an extra round trip or hand back a
  // stale blob — see the KDoc on
  // [buildRunMenuItems.showExportMetrics]. Pin the contract
  // across every terminal status.
  for (const status of ['COMPLETED', 'FAILED', 'STOPPED', 'ABORTED']) {
    const actions = buildRunMenuItems(runWith(status), 'en', undefined, true, false)
      .flat()
      .map(item => item.action)
    ok(!actions.includes('export-metrics'), `export-metrics must not appear for ${status} when showExportMetrics is false`)
  }
})

test('terminal menu keeps the export-metrics item when showExportMetrics defaults to true', () => {
  // Backwards-compatible default: callers that do not
  // pass the flag (the overview dashboard, the existing
  // menuItemCount helper) still get the export entry.
  const groups = buildRunMenuItems(runWith('COMPLETED', { summary: { raw: '{}' } }))
  ok(groups[0].some(item => item.id === 'export-metrics'), 'export-metrics must appear when showExportMetrics defaults to true')
})

test('showExportMetrics flag does not affect the in-flight menu', () => {
  // The in-flight menu never exposed export-metrics
  // (k6 has not produced a summary yet) — the flag must
  // be a no-op there. Pin explicitly so a future refactor
  // that conditionally adds export to the in-flight menu
  // does not silently flip the behaviour.
  for (const status of ['QUEUED', 'RUNNING', 'STOPPING']) {
    const withFlag = buildRunMenuItems(runWith(status), 'en', undefined, true, false)
    const withoutFlag = buildRunMenuItems(runWith(status), 'en', undefined, true, true)
    deepEqual(withFlag, withoutFlag)
    const actions = withFlag.flat().map(item => item.action)
    ok(!actions.includes('export-metrics'), `export-metrics must not appear for ${status}`)
  }
})

test('menuItemCount counts every item across every group', () => {
  // Terminal runs carry the cleanup group (remove-from-view,
  // remove-all-other-failed) and the download-script item on
  // top of the standard two groups, so they have 7 items
  // instead of 4 — one less than before the focus entry was
  // removed. In-flight runs stay at 4 — the download is
  // only meaningful once the test is finished, and the
  // historical focus entry was already gone there.
  equal(menuItemCount(runWith('RUNNING')), 4)
  equal(menuItemCount(runWith('COMPLETED')), 7)
  equal(menuItemCount(runWith('FAILED')), 7)
  equal(menuItemCount(runWith('STOPPED')), 7)
  equal(menuItemCount(runWith('ABORTED')), 7)
})

test('download-script is offered for every terminal status and never for in-flight runs', () => {
  // A user right-clicking a finished (or otherwise terminal)
  // badge must be able to grab the k6 script that produced the
  // result. In-flight runs are excluded on purpose: the script
  // is still in-flight from the user's point of view, and the
  // view already exposes `open-report` for inspection.
  for (const status of ['COMPLETED', 'FAILED', 'STOPPED', 'ABORTED']) {
    const items = buildRunMenuItems(runWith(status)).flat()
    const scriptItem = items.find(item => item.action === 'download-script')
    ok(scriptItem, `download-script must be present for ${status}`)
    equal(scriptItem?.disabledReason ?? null, null, `download-script must be enabled for ${status}`)
  }
  for (const status of ['QUEUED', 'RUNNING', 'STOPPING']) {
    const items = buildRunMenuItems(runWith(status)).flat()
    ok(!items.some(item => item.action === 'download-script'), `download-script must not appear for ${status}`)
  }
})

test('German label for download-script matches the i18n dictionary', () => {
  // Lock in the German label so a translation regression shows
  // up here rather than only in production. The English text is
  // covered by the default-language tests above.
  const groups = buildRunMenuItems(runWith('COMPLETED'), 'de')
  equal(groups[0].find(item => item.id === 'download-script')?.label, 'k6-Skript herunterladen')
})

test('terminal menu offers a cleanup group with remove-from-view and remove-all-other-failed', () => {
  // The cleanup group sits at the end of the terminal menu and
  // exposes two destructive actions. Both are visually marked
  // as danger so the existing red tint from is-danger applies.
  const groups = buildRunMenuItems(runWith('COMPLETED'))
  equal(groups.length, 3)
  const cleanup = groups[2]
  equal(cleanup.length, 2)
  equal(cleanup[0]?.action, 'remove-from-view')
  equal(cleanup[0]?.danger, true)
  equal(cleanup[1]?.action, 'remove-all-other-failed')
  equal(cleanup[1]?.danger, true)
})

test('in-flight menu does NOT expose the cleanup group', () => {
  // Cleanup is for terminal runs only. A user who right-clicks
  // a RUNNING/QUEUED/STOPPING badge must not be offered to
  // delete a run that is still owned by k6.
  for (const status of ['QUEUED', 'RUNNING', 'STOPPING']) {
    const groups = buildRunMenuItems(runWith(status))
    const actions = groups.flat().map(item => item.action)
    ok(!actions.includes('remove-from-view'))
    ok(!actions.includes('remove-all-other-failed'))
  }
})

test('cleanup items default to enabled when siblingRuns is omitted', () => {
  // Backwards-compatible signature: callers that don't pass the
  // sibling runs map (e.g. simple unit tests) get the cleanup
  // items in their enabled state. The disabled-reason guard is
  // only applied when siblingRuns is provided.
  const groups = buildRunMenuItems(runWith('COMPLETED'))
  const cleanup = groups[2]
  equal(cleanup[0]?.disabledReason ?? null, null)
  equal(cleanup[1]?.disabledReason ?? null, null)
})

test('cleanup items enable when at least one other FAILED run is present', () => {
  // The bulk remove becomes meaningful as soon as a second
  // FAILED badge is in the dashboard; with a sibling map, the
  // item drops its disabled-reason and the user can click it.
  const siblingRuns = {
    me: runWith('FAILED', { id: 'me' }),
    other: runWith('FAILED', { id: 'other' }),
  }
  const groups = buildRunMenuItems(siblingRuns.me, undefined, siblingRuns)
  const cleanup = groups[2]
  equal(cleanup[0]?.disabledReason ?? null, null)
  equal(cleanup[1]?.disabledReason ?? null, null)
})

test('remove-all-other-failed is disabled when no other FAILED run is present', () => {
  // The clicked badge is the only FAILED one — the bulk action
  // would be a no-op. Disable with a reason so the user is not
  // tempted to click an action with no visible effect.
  const siblingRuns = {
    me: runWith('FAILED', { id: 'me' }),
    other: runWith('COMPLETED', { id: 'other' }),
  }
  const groups = buildRunMenuItems(siblingRuns.me, undefined, siblingRuns)
  const cleanup = groups[2]
  equal(cleanup[1]?.disabledReason, 'No other failed runs to remove.')
})

test('remove-from-view stays enabled even when no other FAILED run is present', () => {
  // The single-run removal is always meaningful — even if the
  // dashboard has only one badge, clicking "remove from view"
  // clears it. The disabled-reason guard only applies to the
  // bulk action.
  const siblingRuns = {
    me: runWith('COMPLETED', { id: 'me' }),
  }
  const groups = buildRunMenuItems(siblingRuns.me, undefined, siblingRuns)
  const cleanup = groups[2]
  equal(cleanup[0]?.disabledReason ?? null, null)
  ok(cleanup[0]?.danger === true)
})

test('STOPPING runs still expose stop and force-abort so the user can escalate', () => {
  // A user who already asked for a graceful stop but did not see
  // progress must still be able to escalate to a force abort from
  // the same menu. The FAILED/COMPLETED/STOPPED/ABORTED group is
  // terminal and must NOT contain stop/force-abort.
  const inFlight = buildRunMenuItems(runWith('STOPPING'))
  ok(inFlight[1].some(item => item.action === 'stop'))
  ok(inFlight[1].some(item => item.action === 'force-abort'))

  for (const status of ['COMPLETED', 'FAILED', 'STOPPED', 'ABORTED']) {
    const items = buildRunMenuItems(runWith(status)).flat()
    ok(!items.some(item => item.action === 'stop'))
    ok(!items.some(item => item.action === 'force-abort'))
  }
})

test('German labels for the cleanup group match the i18n dictionary', () => {
  // The English defaults above already cover the English text;
  // this test locks in the German labels so a translation
  // regression surfaces here rather than in production.
  const groups = buildRunMenuItems(runWith('COMPLETED'), 'de')
  const cleanup = groups[2]
  equal(cleanup[0]?.label, 'Aus Ansicht entfernen')
  equal(cleanup[1]?.label, 'Alle anderen fehlgeschlagenen Läufe entfernen')

  const siblingRuns = {
    me: runWith('FAILED', { id: 'me' }),
  }
  const disabledGroups = buildRunMenuItems(siblingRuns.me, 'de', siblingRuns)
  equal(
    disabledGroups[2][1]?.disabledReason,
    'Keine weiteren fehlgeschlagenen Läufe zum Entfernen.',
  )
})

// ---- showRerun flag -------------------------------------------------
//
// The per-endpoint timeline tab opts out of the `rerun` action
// (timeline rows are a passive history view and the payload
// data the rerun would replay was intentionally stripped
// from the timeline persist path). The overview dashboard
// keeps the historical `Erneut starten` entry point. The
// flag is the single toggle between the two surfaces — the
// tests below pin both halves of that contract.

test('terminal menu omits the rerun action when showRerun is false', () => {
  // The timeline's right-click menu must not advertise a
  // rerun at all — neither the action nor the dedicated
  // group, otherwise a user clicking it would trigger a
  // half-replayed run (payload data stripped, no preview).
  const groups = buildRunMenuItems(runWith('COMPLETED'), 'en', undefined, false)
  const allActions = groups.flat().map(item => item.action)
  ok(!allActions.includes('rerun'), 'rerun action must not appear when showRerun is false')
  // The rerun group itself is gone, so the cleanup group
  // shifts to index 1 instead of the default index 2.
  equal(groups.length, 2)
  equal(groups[1][0]?.action, 'remove-from-view')
})

test('terminal menu keeps the rerun action when showRerun defaults to true', () => {
  // Backwards-compatible default: callers that do not pass
  // the flag (the overview dashboard, the existing
  // menuItemCount helper) still get the rerun action.
  const groups = buildRunMenuItems(runWith('COMPLETED'))
  const allActions = groups.flat().map(item => item.action)
  ok(allActions.includes('rerun'), 'rerun action must appear when showRerun defaults to true')
})

test('showRerun flag is honoured for every terminal status', () => {
  // The contract is per-status, not per-COMPLETED-only: a
  // right-click on a FAILED, STOPPED or ABORTED timeline
  // row also must not offer rerun, because the timeline
  // strip applies to every persisted row regardless of
  // status.
  for (const status of ['COMPLETED', 'FAILED', 'STOPPED', 'ABORTED']) {
    const allActions = buildRunMenuItems(runWith(status), 'en', undefined, false)
      .flat()
      .map(item => item.action)
    ok(!allActions.includes('rerun'), `rerun must not appear for ${status} when showRerun is false`)
  }
})

test('showRerun flag does not affect the in-flight menu', () => {
  // Rerun is a terminal-only concept (you cannot rerun a
  // QUEUED/RUNNING/STOPPING row). The flag therefore has no
  // effect on the in-flight menu — there is no rerun group
  // there either way. Pin that explicitly so a future
  // refactor that conditionally adds rerun to the in-flight
  // menu fails the build rather than silently expanding the
  // surface.
  for (const status of ['QUEUED', 'RUNNING', 'STOPPING']) {
    const withFlag = buildRunMenuItems(runWith(status), 'en', undefined, false)
    const withoutFlag = buildRunMenuItems(runWith(status), 'en', undefined, true)
    deepEqual(withFlag, withoutFlag)
    const allActions = withFlag.flat().map(item => item.action)
    ok(!allActions.includes('rerun'), `rerun must not appear for ${status}`)
  }
})

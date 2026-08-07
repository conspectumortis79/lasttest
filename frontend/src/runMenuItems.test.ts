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
  const top = groups[0].map(item => item.id)
  deepEqual(top, ['focus', 'copy-id', 'open-report'])
  const control = groups[1].map(item => item.id)
  deepEqual(control, ['stop', 'force-abort'])
  // Force abort is visually marked as destructive.
  ok(groups[1].find(item => item.id === 'force-abort')?.danger === true)
  ok(groups[1].find(item => item.id === 'stop')?.danger !== true)
})

test('terminal menu offers rerun and disables export when no summary is present', () => {
  const groups = buildRunMenuItems(runWith('COMPLETED'))

  // The terminal menu now has three groups: the view/export
  // group, the rerun group, and the cleanup group (see
  // `terminal menu offers a cleanup group ...` below).
  equal(groups.length, 3)
  const viewGroup = groups[0]
  equal(viewGroup.find(item => item.id === 'focus')?.action, 'focus')
  equal(viewGroup.find(item => item.id === 'copy-report-link')?.action, 'copy-report-link')
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

test('ABORTED menu labels the focus item as Aborted-Details and disables export', () => {
  const groups = buildRunMenuItems(runWith('ABORTED', { summary: { raw: '{}' } }))
  // ABORTED explicitly disables export even when a summary is
  // present — partial counters are not a complete summary.
  const exportItem = groups[0].find(item => item.id === 'export-metrics')!
  ok(!isMenuItemEnabled(exportItem))
  // Default language is English; the explicit German label is
  // covered by the i18n dictionary tests.
  equal(
    groups[0].find(item => item.id === 'focus')?.label,
    'Show aborted details',
  )
})

test('menuItemCount counts every item across every group', () => {
  // Terminal runs carry the cleanup group (remove-from-view,
  // remove-all-other-failed) on top of the standard two groups,
  // so they have 7 items instead of 5. In-flight runs stay at 5.
  equal(menuItemCount(runWith('RUNNING')), 5)
  equal(menuItemCount(runWith('COMPLETED')), 7)
  equal(menuItemCount(runWith('FAILED')), 7)
  equal(menuItemCount(runWith('STOPPED')), 7)
  equal(menuItemCount(runWith('ABORTED')), 7)
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

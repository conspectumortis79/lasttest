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

  equal(groups.length, 2)
  const viewGroup = groups[0]
  equal(viewGroup.find(item => item.id === 'focus')?.action, 'focus')
  equal(viewGroup.find(item => item.id === 'copy-report-link')?.action, 'copy-report-link')
  const exportItem = viewGroup.find(item => item.id === 'export-metrics')!
  ok(!isMenuItemEnabled(exportItem), 'export is disabled when no summary is present')

  const rerunGroup = groups[1]
  equal(rerunGroup[0]?.id, 'rerun')
  equal(rerunGroup[0]?.label, 'Erneut ausführen')
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
  equal(
    groups[0].find(item => item.id === 'focus')?.label,
    'Aborted-Details anzeigen',
  )
})

test('menuItemCount counts every item across every group', () => {
  equal(menuItemCount(runWith('RUNNING')), 5)
  equal(menuItemCount(runWith('COMPLETED')), 5)
  equal(menuItemCount(runWith('ABORTED')), 5)
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

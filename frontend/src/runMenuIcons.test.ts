// Ensures every menu action has a matching icon path. A missing
// entry would render an empty `<svg>` in the run-badge context
// menu — visible as a blank slot next to the action label. This
// test makes the gap between the two enums loud.
import { deepEqual, equal, ok } from 'node:assert/strict'
import { test } from 'node:test'
import { KNOWN_MENU_ACTIONS, menuIconPaths } from './runMenuIconPaths.ts'
import { buildRunMenuItems } from './runMenuItems.ts'
import type { TestRun } from './k6Report.ts'

const BASE_RUN = {
  id: 'run-id-1',
  status: 'RUNNING',
  createdAt: '2026-01-01T00:00:00Z',
} as unknown as TestRun

test('every MenuItemAction produced by the menu has an icon path', () => {
  // Deducing the canonical action set from `buildRunMenuItems`
  // means a new action added without an icon shows up here as
  // a missing-key failure, not as silent drift.
  const actions = new Set<string>()
  for (const status of ['RUNNING', 'COMPLETED', 'ABORTED', 'FAILED', 'STOPPED', 'STOPPING', 'QUEUED']) {
    for (const group of buildRunMenuItems({ ...BASE_RUN, status }))
      for (const item of group) actions.add(item.action)
  }
  for (const action of actions) {
    ok(action in menuIconPaths, `missing icon path for action "${action}"`)
  }
})

test('icon table is keyed by the same action set the menu ships', () => {
  // The icon table must not claim any actions the menu never
  // produces, otherwise the map silently drifts from the menu.
  deepEqual(
    Object.keys(menuIconPaths).sort(),
    [...KNOWN_MENU_ACTIONS].sort(),
  )
})

test('every icon path is non-empty SVG path data', () => {
  for (const [action, d] of Object.entries(menuIconPaths)) {
    equal(typeof d, 'string', `path for ${action} must be a string`)
    ok(d.trim().length > 0, `path for ${action} must not be empty`)
  }
})

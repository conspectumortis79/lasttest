// React component for the run-badge context menu icons.
// The path data is sourced from `runMenuIconPaths.ts` (pure
// `.ts`) so the table stays unit testable under `node:test`.
// Adding a new `MenuItemAction` only requires a new entry in
// that table — `MenuItemIcon` needs no change.
import type { ReactElement } from 'react'
import type { MenuItemAction } from './runMenuItems.ts'
import { menuIconPaths } from './runMenuIconPaths.ts'

export function MenuItemIcon({ action }: { action: MenuItemAction }): ReactElement {
  return (
    <svg className="run-context-menu-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={menuIconPaths[action]} />
    </svg>
  )
}

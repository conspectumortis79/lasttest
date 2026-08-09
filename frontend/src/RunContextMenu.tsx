// Floating context menu that opens on right-click on a run
// "badge". Extracted from `App.tsx` so the same component is
// used both by the run grid (Übersicht) and by per-endpoint
// surfaces like [EndpointTimelineTab] — neither side has to
// re-implement the viewport-clamping logic or the
// status-dependent item list.
//
// The component is intentionally dumb: it does not know what
// each action does. It just emits the picked `MenuItem` and
// lets the parent route to the right handler. The item list
// itself comes from `buildRunMenuItems(run)` which lives in
// `runMenuItems.ts` and is unit-tested in isolation.
import { translate, type SupportedLanguage } from './i18n.ts'
import type { TestRun } from './k6Report.ts'
import { buildRunMenuItems, type MenuItem } from './runMenuItems.ts'
import { MenuItemIcon } from './runMenuIcons.tsx'

export type RunContextMenuProps = {
  /** Where the menu should be anchored. The cursor position at the
   *  right-click moment; the component clamps it into the viewport. */
  menu: { runId: string, x: number, y: number }
  /** The run the menu was opened on. `undefined` when the run was
   *  removed between the right-click and the render — the menu
   *  closes itself in that case. */
  run: TestRun | undefined
  /** Full runs map. Required so the menu can disable the
   *  "remove all other failed" item when there is nothing else
   *  to remove (see `buildRunMenuItems`). */
  runs: Record<string, TestRun>
  language: SupportedLanguage
  /** Fired with the picked `MenuItem`. The parent decides what the
   *  action does — typically by switching on `item.action` and
   *  routing to the matching backend call or local state update. */
  onAction: (item: MenuItem) => void
  /** Fired when the menu should close (Escape, outside click, or
   *  `run` disappeared). The parent owns the menu state. */
  onClose: () => void
  /** Ref to the menu container. The parent uses this for the
   *  outside-click check so the menu does not close when the
   *  user clicks inside its own bounds. */
  menuRef: React.RefObject<HTMLDivElement | null>
}

export function RunContextMenu({
  menu,
  run,
  runs,
  language,
  onAction,
  onClose,
  menuRef,
}: RunContextMenuProps) {
  // Defensive: the menu should be closed by the parent when run
  // disappears from the map, but render nothing if it slipped
  // through.
  if (!run) { onClose(); return null }
  // The full runs map is passed so the menu can disable the
  // "remove all other failed" item when no other FAILED run
  // is in the dashboard. Without it the user could click the
  // action with no visible effect. The active language comes
  // from the toolbar so the labels match the rest of the UI.
  const groups = buildRunMenuItems(run, language, runs)
  // Clamp the position so the menu stays inside the viewport.
  // We use 8px padding from the viewport edge so the rounded
  // corners and the focus ring do not get clipped.
  const menuWidth = 240
  const menuHeightEstimate = 48 * groups.flat().length + 24
  const x = Math.max(8, Math.min(menu.x, window.innerWidth - menuWidth - 8))
  const y = Math.max(8, Math.min(menu.y, window.innerHeight - menuHeightEstimate - 8))
  return <div
    ref={menuRef}
    className="run-context-menu"
    role="menu"
    aria-label={translate(language, 'run.contextMenu.aria')}
    style={{ left: x, top: y }}
    onContextMenu={event => event.preventDefault()}
  >
    {groups.map((group, groupIndex) => <div key={groupIndex} className="run-context-menu-group">
      {group.map(item => {
        const disabled = Boolean(item.disabledReason)
        return <button
          key={item.id}
          type="button"
          role="menuitem"
          className={`run-context-menu-item ${item.danger ? 'is-danger' : ''} ${disabled ? 'is-disabled' : ''}`}
          disabled={disabled}
          title={item.disabledReason ?? item.label}
          onClick={() => { if (!disabled) onAction(item) }}
        >
          <MenuItemIcon action={item.action} />
          <span>{item.label}</span>
          {item.shortcut && <kbd className="kbd">{item.shortcut}</kbd>}
        </button>
      })}
      {groupIndex < groups.length - 1 && <div className="run-context-menu-separator" />}
    </div>)}
  </div>
}

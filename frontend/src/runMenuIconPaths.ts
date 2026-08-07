// Pure data — SVG-path strings for the run-badge context menu.
// Lives in a `.ts` (not `.tsx`) file so the path table can be
// unit tested under `node:test --experimental-strip-types`
// without a JSX/TSX runtime. The `.tsx` helper that consumes
// these paths lives in `runMenuIcons.tsx`.
//
// Visual contract — the CSS in `App.css` styles the rendered
// `<svg>` with `stroke: currentColor` and `stroke-width: 1.5`,
// so the icon inherits the menu item's text colour (including
// the destructive `is-danger` tint) without a second code path.
import type { MenuItemAction } from './runMenuItems.ts'

export const menuIconPaths: Record<MenuItemAction, string> = {
  focus: 'M3 3v18h18 M7 14l4-4 4 4 5-5',
  'copy-run-id': 'M9 9h11a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V11a2 2 0 0 1 2-2z M5 15V5a2 2 0 0 1 2-2h10',
  'copy-report-link': 'M10 14a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07L11.5 5.4 M14 10a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07L12.5 18.6',
  'open-report': 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z M14 3v6h6 M9 13h6 M9 17h4',
  'export-metrics': 'M12 3v12 M7 10l5 5 5-5 M5 21h14',
  stop: 'M6 6h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z',
  'force-abort': 'M12 3a9 9 0 1 0 9 9 M5.6 5.6l12.8 12.8',
  rerun: 'M3 12a9 9 0 0 1 15.5-6.3L21 8 M21 3v5h-5 M21 12a9 9 0 0 1-15.5 6.3L3 16 M3 21v-5h5',
  'remove-from-view': 'M4 7h16 M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2 M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13 M10 11v6 M14 11v6',
  'remove-all-other-failed': 'M3 6h18 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2 M5 6l1 14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-14 M9 10v8 M12 10v8 M15 10v8',
}

export const KNOWN_MENU_ACTIONS: MenuItemAction[] = [
  'focus',
  'copy-run-id',
  'copy-report-link',
  'open-report',
  'export-metrics',
  'stop',
  'force-abort',
  'rerun',
  'remove-from-view',
  'remove-all-other-failed',
]

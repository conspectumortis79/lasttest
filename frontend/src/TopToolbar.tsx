// Sticky top toolbar shown above the main app body. Contains
// brand, primary nav (Dashboard is a placeholder, User Guide and
// README open a markdown popup, Wiki opens the bilingual glossary
// popup), a passive language pill and the settings button (which
// opens the SettingsDrawer). Kept as a separate component so the
// App.tsx body stays focused on the load-test flow and the
// toolbar can be reordered or hidden without touching the rest of
// the app.
import { SUPPORTED_LANGUAGES, translate, type SupportedLanguage } from './i18n.ts'
import { useDemoStatus } from './useDemoStatusState.ts'

export type ToolbarDocId = 'userGuide' | 'readme' | 'wiki'

type TopToolbarProps = {
  language: SupportedLanguage
  onOpenSettings: () => void
  onOpenDoc: (doc: ToolbarDocId, initialQuery?: string) => void
}

type NavEntry = {
  /** i18n key for the visible label. */
  key: 'toolbar.nav.dashboard' | 'toolbar.nav.demoTraffic' | 'toolbar.nav.userGuide' | 'toolbar.nav.readme' | 'toolbar.nav.wiki'
  /** When set, the entry opens a popup instead of being a placeholder link. */
  openDoc?: ToolbarDocId
  /** Optional initial query — only honoured by the wiki entry. */
  initialQuery?: string
  /**
   * When set, the entry renders as a real `<a>` that navigates to
   * the given URL. `hrefTarget` controls the browsing context
   * (default `_self`). Used for the Demo-API link that opens the
   * traffic dashboard in a new tab so the user can keep the
   * lasttest UI open in the current tab.
   */
  href?: string
  hrefTarget?: '_self' | '_blank'
}

const NAV_ITEMS: ReadonlyArray<NavEntry> = [
  { key: 'toolbar.nav.dashboard' },
  { key: 'toolbar.nav.userGuide', openDoc: 'userGuide' },
  { key: 'toolbar.nav.readme', openDoc: 'readme' },
  { key: 'toolbar.nav.wiki', openDoc: 'wiki' },
  // The Demo-API entry sits at the END of the toolbar so it
  // reads as a "power user" feature, gated behind the Settings
  // switch. Placing it at the right edge also keeps it close
  // to the language pill, which is where the user looks when
  // they want to switch the app into a "demo is running" mode.
  { key: 'toolbar.nav.demoTraffic', href: '/?demo-traffic', hrefTarget: '_blank' },
]

export function TopToolbar({ language, onOpenSettings, onOpenDoc }: TopToolbarProps) {
  const active = SUPPORTED_LANGUAGES.find(entry => entry.code === language) ?? SUPPORTED_LANGUAGES[0]!
  const langLabel = active.code.toUpperCase()
  const ariaTemplate = translate(language, 'lang.pill.aria')
  // The Demo-API link only appears when the user has enabled
  // the demo in Settings. The state is read from
  // `useDemoStatus()` so a flip in the drawer updates the
  // toolbar in the same tick.
  const { status } = useDemoStatus()

  return <header className="top-toolbar" role="banner">
    <div className="top-toolbar-brand">
      <span className="top-toolbar-mark" aria-hidden="true">k6</span>
      <span className="top-toolbar-name">{translate(language, 'toolbar.brand')}</span>
    </div>
    <nav className="top-toolbar-nav" aria-label={translate(language, 'toolbar.nav.aria')}>
      {NAV_ITEMS.map((item, index) => {
        if (item.key === 'toolbar.nav.demoTraffic' && !status.enabled) {
          // The demo is opt-in; hide the link entirely when
          // off so the toolbar reflects "demo is not running"
          // at a glance.
          return null
        }
        if (item.openDoc) {
          return (
            <button
              key={item.key}
              type="button"
              className="top-toolbar-nav-link"
              onClick={() => onOpenDoc(item.openDoc!, item.initialQuery)}
            >
              {translate(language, item.key)}
            </button>
          )
        }
        if (item.href) {
          // The "Demo-API" entry carries an additional "active"
          // pill when the demo is running, so the user can see
          // at a glance that the in-process controller is
          // listening for traffic — even when the link itself
          // is not hovered.
          const showActiveBadge = item.key === 'toolbar.nav.demoTraffic' && status.enabled
          return (
            <a
              key={item.key}
              className="top-toolbar-nav-link"
              href={item.href}
              target={item.hrefTarget ?? '_self'}
              rel={item.hrefTarget === '_blank' ? 'noopener noreferrer' : undefined}
            >
              {translate(language, item.key)}
              {showActiveBadge && (
                <span
                  className="top-toolbar-demo-active"
                  aria-label={translate(language, 'toolbar.nav.demoActive.aria')}
                  title={translate(language, 'toolbar.nav.demoActive.tooltip')}
                >
                  <span className="top-toolbar-demo-active-dot" aria-hidden="true" />
                  {translate(language, 'toolbar.nav.demoActive')}
                </span>
              )}
            </a>
          )
        }
        return (
          <a
            key={item.key}
            className={`top-toolbar-nav-link ${index === 0 ? 'is-active' : ''}`}
            href="#"
            aria-current={index === 0 ? 'page' : undefined}
            onClick={event => event.preventDefault()}
          >
            {translate(language, item.key)}
          </a>
        )
      })}
    </nav>
    <span className="top-toolbar-spacer" aria-hidden="true"></span>
    <span
      className="lang-pill"
      role="status"
      aria-label={ariaTemplate.replace('{lang}', active.label)}
    >
      <span className="lang-pill-flag" aria-hidden="true">{active.flag}</span>
      <span className="lang-pill-code">{langLabel}</span>
    </span>
    <button
      type="button"
      className="icon-btn"
      onClick={onOpenSettings}
      aria-label={translate(language, 'settings.btn.aria')}
      title={translate(language, 'toolbar.settings.title')}
    >
      {/* Classic Lucide-style gear: outer cog with eight rounded
          teeth and an inner ring. Two filled paths keep the icon
          visible at 16px without relying on hairline strokes. */}
      <svg className="icon-btn-glyph" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M12.7 2.7a2 2 0 0 0-2.4 0l-1 1.1a1 1 0 0 1-1.05.24l-1.4-.56a2 2 0 0 0-2.45.85l-.55 1.4a1 1 0 0 1-.78.62l-1.5.25a2 2 0 0 0-1.55 2.27l.25 1.5a1 1 0 0 1-.32.96l-1.1 1.1a2 2 0 0 0 0 2.83l1.1 1.1a1 1 0 0 1 .32.96l-.25 1.5a2 2 0 0 0 1.55 2.27l1.5.25a1 1 0 0 1 .78.62l.55 1.4a2 2 0 0 0 2.45.85l1.4-.56a1 1 0 0 1 1.05.24l1 1.1a2 2 0 0 0 2.83 0l1-1.1a1 1 0 0 1 1.05-.24l1.4.56a2 2 0 0 0 2.45-.85l.55-1.4a1 1 0 0 1 .78-.62l1.5-.25a2 2 0 0 0 1.55-2.27l-.25-1.5a1 1 0 0 1 .32-.96l1.1-1.1a2 2 0 0 0 0-2.83l-1.1-1.1a1 1 0 0 1-.32-.96l.25-1.5a2 2 0 0 0-1.55-2.27l-1.5-.25a1 1 0 0 1-.78-.62l-.55-1.4a2 2 0 0 0-2.45-.85l-1.4.56a1 1 0 0 1-1.05-.24l-1-1.1Z"
          fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"
        />
        <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    </button>
  </header>
}

// Re-export so callers don't need to import from i18n directly
// when they only need the language type.
export type { SupportedLanguage }

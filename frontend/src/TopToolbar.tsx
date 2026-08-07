// Sticky top toolbar shown above the main app body. Contains
// brand, primary nav (Dashboard is a placeholder, User Guide and
// README open a markdown popup), a passive language pill and the
// settings button (which opens the SettingsDrawer). Kept as a
// separate component so the App.tsx body stays focused on the
// load-test flow and the toolbar can be reordered or hidden
// without touching the rest of the app.
import { SUPPORTED_LANGUAGES, translate, type SupportedLanguage } from './i18n.ts'

type TopToolbarProps = {
  language: SupportedLanguage
  onOpenSettings: () => void
  onOpenDoc: (doc: 'userGuide' | 'readme') => void
}

type NavEntry = {
  /** i18n key for the visible label. */
  key: 'toolbar.nav.dashboard' | 'toolbar.nav.userGuide' | 'toolbar.nav.readme'
  /** When set, the entry opens a markdown popup instead of being a placeholder link. */
  openDoc?: 'userGuide' | 'readme'
}

const NAV_ITEMS: ReadonlyArray<NavEntry> = [
  { key: 'toolbar.nav.dashboard' },
  { key: 'toolbar.nav.userGuide', openDoc: 'userGuide' },
  { key: 'toolbar.nav.readme', openDoc: 'readme' },
]

export function TopToolbar({ language, onOpenSettings, onOpenDoc }: TopToolbarProps) {
  const active = SUPPORTED_LANGUAGES.find(entry => entry.code === language) ?? SUPPORTED_LANGUAGES[0]!
  const langLabel = active.code.toUpperCase()
  const ariaTemplate = translate(language, 'lang.pill.aria')

  return <header className="top-toolbar" role="banner">
    <div className="top-toolbar-brand">
      <span className="top-toolbar-mark" aria-hidden="true">k6</span>
      <span className="top-toolbar-name">{translate(language, 'toolbar.brand')}</span>
    </div>
    <nav className="top-toolbar-nav" aria-label="Primary">
      {NAV_ITEMS.map((item, index) =>
        item.openDoc
          ? <button
              key={item.key}
              type="button"
              className="top-toolbar-nav-link"
              onClick={() => onOpenDoc(item.openDoc!)}
            >
              {translate(language, item.key)}
            </button>
          : <a
              key={item.key}
              className={`top-toolbar-nav-link ${index === 0 ? 'is-active' : ''}`}
              href="#"
              aria-current={index === 0 ? 'page' : undefined}
              onClick={event => event.preventDefault()}
            >
              {translate(language, item.key)}
            </a>
      )}
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

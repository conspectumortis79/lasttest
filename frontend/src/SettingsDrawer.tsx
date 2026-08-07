// Slide-in settings drawer that opens from the right edge of the
// viewport. Body exposes language selection (radio group) and a
// placeholder Theme section so the drawer has more than one
// setting. Backdrop click and Escape close the drawer.
import { useEffect, useRef } from 'react'
import { SUPPORTED_LANGUAGES, translate, type SupportedLanguage } from './i18n.ts'

type SettingsDrawerProps = {
  open: boolean
  language: SupportedLanguage
  onClose: () => void
  onLanguageChange: (next: SupportedLanguage) => void
}

export function SettingsDrawer({ open, language, onClose, onLanguageChange }: SettingsDrawerProps) {
  const closeBtnRef = useRef<HTMLButtonElement | null>(null)

  // Move focus into the drawer when it opens so keyboard users
  // land on the close button and screen readers announce the
  // dialog. Restore focus on close by relying on the natural
  // return-to-caller behaviour of the browser.
  useEffect(() => {
    if (!open) return
    closeBtnRef.current?.focus()
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  return <>
    <div
      className={`drawer-backdrop ${open ? 'is-open' : ''}`}
      onClick={open ? onClose : undefined}
      aria-hidden="true"
    ></div>
    <aside
      className={`drawer ${open ? 'is-open' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-hidden={open ? 'false' : 'true'}
      aria-label={translate(language, 'drawer.title')}
    >
      <header className="drawer-header">
        <h2 className="drawer-title">{translate(language, 'drawer.title')}</h2>
        <button
          ref={closeBtnRef}
          type="button"
          className="icon-btn"
          onClick={onClose}
          aria-label="Close"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" className="icon-btn-glyph">
            <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
          </svg>
        </button>
      </header>
      <div className="drawer-body">
        <h3 className="drawer-section">{translate(language, 'drawer.section.language')}</h3>
        <div className="drawer-radio-group" role="radiogroup" aria-label={translate(language, 'drawer.section.language')}>
          {SUPPORTED_LANGUAGES.map(entry => {
            const checked = entry.code === language
            const hint = entry.hint
              ? translate(language, 'drawer.lang.hint.default' as 'drawer.lang.hint.default')
              : ''
            return <label
              key={entry.code}
              className={`drawer-radio ${checked ? 'is-selected' : ''}`}
            >
              <input
                type="radio"
                name="language"
                value={entry.code}
                checked={checked}
                onChange={() => onLanguageChange(entry.code)}
              />
              <span className="drawer-radio-text">
                <span className="drawer-radio-label">
                  <span aria-hidden="true">{entry.flag}</span> {entry.label}
                </span>
                {hint && <span className="drawer-radio-hint">{hint}</span>}
              </span>
            </label>
          })}
        </div>
      </div>
    </aside>
  </>
}

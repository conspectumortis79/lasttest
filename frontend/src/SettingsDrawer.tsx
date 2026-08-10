// Slide-in settings drawer that opens from the right edge of the
// viewport. Body exposes the language picker, a notifications
// section that drives the browser's per-run completion
// notifications, and a master switch for the bundled demo API.
// The actual Notification-Permission flow lives in App.tsx (it
// touches the global `Notification` API); the drawer just hands
// the user gesture up and renders the granted / denied state the
// parent reports. The demo-API switch talks directly to the
// `useDemoStatus()` hook because the toggle is a backend-owned
// state, not a piece of UI the parent needs to mirror.
import { useEffect, useRef } from 'react'
import { SUPPORTED_LANGUAGES, translate, type SupportedLanguage } from './i18n.ts'
import {
  computeNotificationSectionState,
  type NotificationPermissionState,
  type NotificationSettings,
} from './runNotifications.ts'
import { useDemoStatus } from './useDemoStatusState.ts'
import { usePersistence } from './persistenceStorage.ts'

type SettingsDrawerProps = {
  open: boolean
  language: SupportedLanguage
  notificationSettings: NotificationSettings
  notificationPermission: NotificationPermissionState
  onClose: () => void
  onLanguageChange: (next: SupportedLanguage) => void
  onNotificationSettingsChange: (next: NotificationSettings) => void
  /**
   * Called when the user activates the master toggle. The parent
   * asks the browser for Notification permission and only commits
   * `enabled: true` when the permission is granted. When the
   * browser denies, the parent keeps `enabled: false` and the
   * drawer surfaces the hint.
   */
  onRequestNotificationPermission: () => void
}

export function SettingsDrawer({
  open,
  language,
  notificationSettings,
  notificationPermission,
  onClose,
  onLanguageChange,
  onNotificationSettingsChange,
  onRequestNotificationPermission,
}: SettingsDrawerProps) {
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

  // Single source of truth for "what should the UI show?".
  // The pure projection in `runNotifications.ts` is unit-tested
  // so the JSX can stay a dumb formatter of the result.
  const sectionState = computeNotificationSectionState(notificationPermission)

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
          aria-label={translate(language, 'common.close')}
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
              ? translate(language, 'drawer.lang.hint.default')
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

        <h3 className="drawer-section">{translate(language, 'drawer.section.notifications')}</h3>
        <div className="drawer-checkbox-group" role="group" aria-label={translate(language, 'drawer.section.notifications')}>
          <label className={`drawer-checkbox ${notificationSettings.enabled ? 'is-selected' : ''}`}>
            <input
              type="checkbox"
              checked={notificationSettings.enabled}
              disabled={sectionState.masterDisabled}
              onChange={event => {
                if (event.target.checked) {
                  // Hand the user gesture up so App.tsx can call
                  // `Notification.requestPermission()`. The actual
                  // commit of `enabled: true` happens in the parent
                  // once the permission is `granted`.
                  onRequestNotificationPermission()
                } else {
                  onNotificationSettingsChange({ ...notificationSettings, enabled: false })
                }
              }}
            />
            <span className="drawer-checkbox-text">
              <span className="drawer-checkbox-label">{translate(language, 'drawer.notifications.enabled')}</span>
              <span className="drawer-checkbox-hint">{translate(language, 'drawer.notifications.enabled.hint')}</span>
            </span>
          </label>
          {sectionState.warningVisible
            ? <p className="drawer-checkbox-warning" role="status">
              {translate(language, 'drawer.notifications.permission.denied')}
            </p>
            : null}
        </div>

        <h3 className="drawer-section">{translate(language, 'drawer.section.demo')}</h3>
        <div className="drawer-checkbox-group" role="group" aria-label={translate(language, 'drawer.section.demo')}>
          <DemoApiSwitch language={language} />
          <SaveExecutionsSwitch language={language} />
        </div>
      </div>
    </aside>
  </>
}

/**
 * The "Demo API" master switch. Sits in the Settings drawer next
 * to the language and notifications controls. Flipping the switch
 * is the only way to enable the demo; there is no auto-detection.
 * A small "active" pill next to the switch mirrors the same
 * "demo is running" indicator that the TopToolbar shows, so the
 * user sees consistent feedback no matter where they look.
 */
function DemoApiSwitch({ language }: { language: SupportedLanguage }): React.ReactElement {
  const { status, setEnabled } = useDemoStatus()
  return <label className={`drawer-checkbox ${status.enabled ? 'is-selected' : ''}`}>
    <input
      type="checkbox"
      checked={status.enabled}
      onChange={event => { void setEnabled(event.target.checked) }}
      data-testid="settings-demo-api-switch"
    />
    <span className="drawer-checkbox-text">
      <span className="drawer-checkbox-label">{translate(language, 'drawer.demo.enabled')}</span>
      <span className="drawer-checkbox-hint">{translate(language, 'drawer.demo.enabled.hint')}</span>
    </span>
  </label>
}

/**
 * The "Ausgeführte Lasttestkonfigurationen speichern" /
 * "Save executed test configurations" toggle. Sits next to
 * the demo-API switch in the Settings drawer; both share the
 * same `drawer-checkbox` styling. When the user disables
 * this toggle, every subsequent `POST /api/test-runs` call
 * sends `persist: false` so the backend skips the timeline
 * write and the live view is the only surface that shows the
 * run. The 40-row per-endpoint retention cap is therefore
 * only enforced for runs created with persistence enabled.
 */
function SaveExecutionsSwitch({ language }: { language: SupportedLanguage }): React.ReactElement {
  const { persistRuns, setPersistRuns } = usePersistence()
  return <label className={`drawer-checkbox ${persistRuns ? 'is-selected' : ''}`}>
    <input
      type="checkbox"
      checked={persistRuns}
      onChange={event => { setPersistRuns(event.target.checked) }}
      data-testid="settings-save-executions-switch"
    />
    <span className="drawer-checkbox-text">
      <span className="drawer-checkbox-label">{translate(language, 'drawer.persistence.saveExecutions')}</span>
      <span className="drawer-checkbox-hint">{translate(language, 'drawer.persistence.saveExecutions.hint')}</span>
    </span>
  </label>
}

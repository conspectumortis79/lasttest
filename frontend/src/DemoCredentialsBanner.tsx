import { translate, type SupportedLanguage } from './i18n.ts'
import { findDemoCredentials, type DemoApiKey, type DemoBasicAuth, type DemoBearerToken, type DemoOAuth2 } from './demoCredentials.ts'

/**
 * Yellow callout banner that surfaces hardcoded demo credentials
 * (username/password for Basic auth, opaque token for Bearer,
 * API-key value for header-based apiKey, OAuth 2.0 access token)
 * directly above the pool editor of operations that ship with
 * the bundled `demo/openapi-demo.yaml`. The design is the one
 * picked from `mockups/basic-auth-hint/B-pooleditor-callout.html`:
 *  - prominent amber background so the user cannot miss it
 *  - the credentials are shown in monospace
 *  - one click on "In Felder übernehmen" populates the pool
 *    editor's input fields so the user does not have to type them
 *
 * For any operation that is not in the demo lookup table the
 * component returns `null` and the operation card stays exactly as
 * it was for the production code path. The whole feature is
 * opt-in by virtue of the lookup table — adding a new demo
 * operation only needs a new entry in `demoCredentials.ts`, no
 * UI changes here.
 */
type Props = {
  readonly operationId: string
  readonly language: SupportedLanguage
  /**
   * Populates the Basic auth username and password fields of the
   * primary payload. Wired in App.tsx to the existing
   * `updatePayloadField` helper so the same state pipeline that
   * the typed-in credentials use is reused.
   */
  readonly onApplyBasic: (username: string, password: string) => void
  /**
   * Populates the Bearer token field of the primary payload.
   */
  readonly onApplyBearer: (token: string) => void
  /**
   * Populates the API key field of the primary payload.
   */
  readonly onApplyApiKey: (key: string) => void
  /**
   * Populates the OAuth 2.0 access token field of the primary
   * payload. The wire format is identical to Bearer (`Authorization:
   * Bearer <token>` per RFC 6750) so the user types the token into
   * a dedicated input for clarity in the banner.
   */
  readonly onApplyOAuth2: (token: string) => void
}

export function DemoCredentialsBanner({ operationId, language, onApplyBasic, onApplyBearer, onApplyApiKey, onApplyOAuth2 }: Props) {
  const entry = findDemoCredentials(operationId)
  if (!entry) return null

  if (entry.kind === 'basic') {
    return <BasicAuthBanner entry={entry} language={language} onApply={onApplyBasic} />
  }
  if (entry.kind === 'bearer') {
    return <BearerBanner entry={entry} language={language} onApply={onApplyBearer} />
  }
  if (entry.kind === 'apiKey') {
    return <ApiKeyBanner entry={entry} language={language} onApply={onApplyApiKey} />
  }
  return <OAuth2Banner entry={entry} language={language} onApply={onApplyOAuth2} />
}

function BasicAuthBanner({
  entry,
  language,
  onApply,
}: {
  entry: DemoBasicAuth
  language: SupportedLanguage
  onApply: (username: string, password: string) => void
}) {
  return (
    <div className="demo-banner" role="note" aria-label={translate(language, 'demo.banner.aria')}>
      <span className="demo-banner-icon" aria-hidden="true">🔑</span>
      <div className="demo-banner-text">
        <span className="demo-banner-label">{translate(language, 'demo.banner.basic.label')}</span>
        <span className="demo-banner-creds">
          <span className="demo-banner-username">{translate(language, 'demo.banner.basic.username')}: <strong>{entry.username}</strong></span>
          <span className="demo-banner-sep" aria-hidden="true">·</span>
          <span className="demo-banner-password">{translate(language, 'demo.banner.basic.password')}: <strong>{entry.password}</strong></span>
        </span>
      </div>
      <button
        type="button"
        className="demo-banner-apply"
        onClick={() => onApply(entry.username, entry.password)}
        aria-label={translate(language, 'demo.banner.basic.apply')}
      >
        📋 {translate(language, 'demo.banner.basic.apply')}
      </button>
    </div>
  )
}

function BearerBanner({
  entry,
  language,
  onApply,
}: {
  entry: DemoBearerToken
  language: SupportedLanguage
  onApply: (token: string) => void
}) {
  return (
    <div className="demo-banner" role="note" aria-label={translate(language, 'demo.banner.aria')}>
      <span className="demo-banner-icon" aria-hidden="true">🎫</span>
      <div className="demo-banner-text">
        <span className="demo-banner-label">{translate(language, 'demo.banner.bearer.label')}</span>
        <span className="demo-banner-creds">
          <span className="demo-banner-token">{translate(language, 'demo.banner.bearer.token')}: <strong>{entry.token}</strong></span>
        </span>
      </div>
      <button
        type="button"
        className="demo-banner-apply"
        onClick={() => onApply(entry.token)}
        aria-label={translate(language, 'demo.banner.bearer.apply')}
      >
        📋 {translate(language, 'demo.banner.bearer.apply')}
      </button>
    </div>
  )
}

function ApiKeyBanner({
  entry,
  language,
  onApply,
}: {
  entry: DemoApiKey
  language: SupportedLanguage
  onApply: (key: string) => void
}) {
  return (
    <div className="demo-banner" role="note" aria-label={translate(language, 'demo.banner.aria')}>
      <span className="demo-banner-icon" aria-hidden="true">🗝️</span>
      <div className="demo-banner-text">
        <span className="demo-banner-label">{translate(language, 'demo.banner.apiKey.label')}</span>
        <span className="demo-banner-creds">
          <span className="demo-banner-token">{translate(language, 'demo.banner.apiKey.header')}: <strong>{entry.headerName}</strong></span>
          <span className="demo-banner-sep" aria-hidden="true">·</span>
          <span className="demo-banner-token">{translate(language, 'demo.banner.apiKey.token')}: <strong>{entry.key}</strong></span>
        </span>
      </div>
      <button
        type="button"
        className="demo-banner-apply"
        onClick={() => onApply(entry.key)}
        aria-label={translate(language, 'demo.banner.apiKey.apply')}
      >
        📋 {translate(language, 'demo.banner.apiKey.apply')}
      </button>
    </div>
  )
}

function OAuth2Banner({
  entry,
  language,
  onApply,
}: {
  entry: DemoOAuth2
  language: SupportedLanguage
  onApply: (token: string) => void
}) {
  return (
    <div className="demo-banner" role="note" aria-label={translate(language, 'demo.banner.aria')}>
      <span className="demo-banner-icon" aria-hidden="true">🔐</span>
      <div className="demo-banner-text">
        <span className="demo-banner-label">{translate(language, 'demo.banner.oauth2.label')}</span>
        <span className="demo-banner-creds">
          <span className="demo-banner-token">{translate(language, 'demo.banner.oauth2.flow')}: <strong>{entry.flowType}</strong></span>
          <span className="demo-banner-sep" aria-hidden="true">·</span>
          <span className="demo-banner-token">{translate(language, 'demo.banner.oauth2.scopes')}: <strong>{entry.scopes.join(', ')}</strong></span>
          <span className="demo-banner-sep" aria-hidden="true">·</span>
          <span className="demo-banner-token">{translate(language, 'demo.banner.oauth2.token')}: <strong>{entry.token}</strong></span>
        </span>
      </div>
      <button
        type="button"
        className="demo-banner-apply"
        onClick={() => onApply(entry.token)}
        aria-label={translate(language, 'demo.banner.oauth2.apply')}
      >
        📋 {translate(language, 'demo.banner.oauth2.apply')}
      </button>
    </div>
  )
}

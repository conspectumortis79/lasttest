// Wiki popup — opened from the top toolbar. The popup itself is
// a small modal with a single search field plus an "Open" button.
// When the user presses Enter (or clicks the button) the popup
// resolves the query against the bilingual glossary (see
// `wikiData.ts` + `wikiSearch.ts`) and opens the matching entry
// in a new browser window via `window.open` with a self-contained
// `data:text/html` document.
//
// Why a new window instead of an in-modal result? The brief was
// that the user wanted to read the explanation in a *separate*
// window, side by side with the running app. The data: URL keeps
// everything client-side — no backend round-trip, no extra route.
//
// The inline HTML rendered into the new window is built by
// `renderWikiWindowHtml` below. It only allows three tags
// (`<strong>`, `<em>`, `<code>`) — every other character is
// HTML-escaped. The glossary entries are bundled at build time
// (trusted content), but the escape still protects against an
// accidental `<script>` in a future entry.
//
// Live suggestions: while the user types, the popup lists up to
// 8 candidate entries below the field. Pressing Enter on a
// non-empty query resolves the exact match; on no exact match,
// it opens the first suggestion.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { SupportedLanguage } from './i18n.ts'
import { filterEntries, lookupEntry, wikiBody, wikiTitle } from './wikiSearch.ts'
import type { WikiEntry } from './wikiData.ts'

type WikiPopupProps = {
  open: boolean
  language: SupportedLanguage
  onClose: () => void
  // Pre-selected query (set by the toolbar's quick links).
  initialQuery?: string
  strings: {
    title: string
    placeholder: string
    open: string
    openHint: string
    dismiss: string
    noMatch: string
    allTermsHeading: string
    suggestionsHeading: string
    matchedOnLabel: string
  }
}

const ACTIVE_PULSE_MS = 1200

/**
 * Opens the entry in a new browser window. We use `data:` so the
 * document is fully self-contained and does not require the
 * backend to serve a route. The popup window is opened with
 * reasonable default dimensions and resizable/scrollable chrome.
 */
function openEntryInWindow(entry: WikiEntry, language: SupportedLanguage, matchedAlias: string) {
  if (typeof window === 'undefined') return
  const html = renderWikiWindowHtml(entry, language, matchedAlias)
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const features = [
    'width=720',
    'height=520',
    'resizable=yes',
    'scrollbars=yes',
  ].join(',')
  const win = window.open(url, '_blank', features)
  if (win === null) {
    // Popup blocker: fall back to navigating the current tab so
    // the user still sees the answer.
    window.location.href = url
    return
  }
  // Revoke the blob URL once the new window has loaded it, so the
  // browser can release the in-memory document. We revoke after
  // a generous delay because the window has not necessarily read
  // the URL yet when `open` returns.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, c => ESCAPE_MAP[c] ?? c)
}

/**
 * Renders an inline-tag whitelist into the wiki body. Only
 * `<strong>`, `<em>` and `<code>` survive — every other tag is
 * escaped. This is the same approach as the DocPopup markdown
 * renderer but smaller (the wiki body never contains markdown).
 */
function renderInlineTags(text: string): string {
  const stashed: string[] = []
  // Sentinel markers use a multi-character bracket pattern that
  // is not legal HTML, so the HTML-escape pass leaves them
  // untouched. We pick a distinct prefix so the substitution
  // regex is unambiguous.
  const openToken = '⦃WIKI_INLINE_'
  const closeToken = '⦄'
  let prepared = text.replace(/<(strong|em|code)>([\s\S]*?)<\/\1>/g, (_match, tag: string, inner: string) => {
    const index = stashed.length
    stashed.push(`<${tag}>${escapeHtml(inner)}</${tag}>`)
    return `${openToken}${index}${closeToken}`
  })
  prepared = escapeHtml(prepared)
  if (stashed.length > 0) {
    const pattern = openToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      + '(\\d+)'
      + closeToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    prepared = prepared.replace(
      new RegExp(pattern, 'g'),
      (_match, index: string) => stashed[Number(index)] ?? '',
    )
  }
  return prepared
}

/**
 * Builds the self-contained HTML document for the wiki result
 * window. The style block inlines the same dark palette the
 * toolbar uses, so the new window feels like part of the app
 * even though it lives outside the React tree.
 */
function renderWikiWindowHtml(entry: WikiEntry, language: SupportedLanguage, matchedAlias: string): string {
  const titleText = wikiTitle(entry, language)
  const bodyText = renderInlineTags(wikiBody(entry, language))
  const heading = language === 'de' ? 'lasttest Wiki' : 'lasttest Wiki'
  const matchedOn = language === 'de'
    ? `Aufgelöst über: <code>${escapeHtml(matchedAlias)}</code>`
    : `Matched on: <code>${escapeHtml(matchedAlias)}</code>`
  const closeLabel = language === 'de' ? 'Schließen' : 'Close'
  // No external CSS or JS — the new window is fully self-contained.
  return `<!doctype html>
<html lang="${language}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(titleText)} — ${escapeHtml(heading)}</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: #e8edf5; background: #0b1018; }
  .wrap { max-width: 720px; margin: 0 auto; padding: 28px 24px 64px; }
  .brand { font-size: 12px; font-weight: 700; color: #79e6c8; letter-spacing: .08em; text-transform: uppercase; margin-bottom: 6px; }
  h1 { margin: 0 0 12px; font-size: 24px; line-height: 1.25; color: #fff; }
  .matched { font-size: 12px; color: #93a2b8; margin-bottom: 24px; font-family: ui-monospace, Menlo, monospace; }
  .matched code { background: #1a2638; padding: 1px 6px; border-radius: 4px; color: #dbe5f3; }
  .body { font-size: 15px; line-height: 1.6; color: #dbe5f3; }
  .body strong { color: #fff; }
  .body code { background: #1a2638; padding: 1px 6px; border-radius: 4px; font-size: 13px; color: #79e6c8; font-family: ui-monospace, Menlo, monospace; }
  .actions { margin-top: 32px; display: flex; gap: 8px; }
  .actions button { padding: 8px 14px; border-radius: 7px; border: 1px solid #233049; background: #1a2638; color: #dbe5f3; font: inherit; cursor: pointer; }
  .actions button:hover { border-color: #7d63ff; color: #fff; }
</style>
</head>
<body>
<div class="wrap">
  <div class="brand">${escapeHtml(heading)}</div>
  <h1>${escapeHtml(titleText)}</h1>
  <div class="matched">${matchedOn}</div>
  <div class="body">${bodyText}</div>
  <div class="actions">
    <button type="button" onclick="window.close()">${escapeHtml(closeLabel)}</button>
  </div>
</div>
</body>
</html>`
}

export function WikiPopup({ open, language, onClose, initialQuery, strings }: WikiPopupProps) {
  const [query, setQuery] = useState(initialQuery ?? '')
  const [pulseId, setPulseId] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  // `filterEntries` returns the full browsable list. With an
  // empty query the list contains every glossary entry, sorted
  // alphabetically; with a non-empty query it contains only the
  // matching entries, ranked by relevance. The popup renders
  // this list as a scrollable column inside the modal body.
  const list = useMemo(() => filterEntries(query), [query])
  const isFiltering = query.trim() !== ''
  const exactMatch = useMemo(() => (isFiltering ? lookupEntry(query) : undefined), [isFiltering, query])

  // Reset the query when the popup is closed (so the next open is
  // fresh) and seed it from the toolbar's quick link on open.
  useEffect(() => {
    if (open) {
      setQuery(initialQuery ?? '')
      // Focus the input on next paint so the keyboard cursor is
      // already inside when the user starts typing.
      window.requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open, initialQuery])

  // Esc closes the popup.
  useEffect(() => {
    if (!open) return
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  const handleOpen = useCallback((entry: WikiEntry, matchedAlias: string) => {
    openEntryInWindow(entry, language, matchedAlias)
    setPulseId(id => id + 1)
  }, [language])

  const resolveAndOpen = useCallback(() => {
    const trimmed = query.trim()
    if (trimmed === '') return
    // Prefer an exact match. The matched-alias hint for the new
    // window is the first alias of the entry that normalises to
    // the same key as the query — falling back to the query
    // itself keeps the hint non-empty even when no alias matches.
    if (exactMatch !== undefined) {
      const matchedAlias = pickMatchedAlias(exactMatch, trimmed)
      handleOpen(exactMatch, matchedAlias)
      return
    }
    // No exact match — fall back to the first entry in the
    // filtered list (which is the highest-ranked match). When
    // the list is empty (i.e. no glossary entry contains the
    // query as a substring or prefix anywhere), pulse the input
    // to tell the user nothing matched.
    const first = list[0]
    if (first !== undefined) {
      const matchedAlias = pickMatchedAlias(first, trimmed)
      handleOpen(first, matchedAlias)
      return
    }
    setPulseId(id => id + 1)
  }, [query, exactMatch, list, handleOpen])

  // When the query changes and the input has the "no-match" pulse
  // class, clear it so the next Enter press can pulse again.
  useLayoutEffect(() => {
    const input = inputRef.current
    if (input === null) return
    input.classList.remove('wiki-popup-no-match')
  }, [query])

  // Pulse the input briefly when Enter was pressed with no match.
  useLayoutEffect(() => {
    if (pulseId === 0) return
    const input = inputRef.current
    if (input === null) return
    input.classList.add('wiki-popup-no-match')
    const timer = window.setTimeout(() => input.classList.remove('wiki-popup-no-match'), ACTIVE_PULSE_MS)
    return () => window.clearTimeout(timer)
  }, [pulseId])

  return <>
    <div
      className={`doc-popup-backdrop ${open ? 'is-open' : ''}`}
      onClick={open ? onClose : undefined}
      aria-hidden="true"
    ></div>
    <div
      className={`wiki-popup doc-popup ${open ? 'is-open' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-hidden={open ? 'false' : 'true'}
      aria-labelledby="wiki-popup-title"
    >
      <header className="doc-popup-header">
        <h2 className="doc-popup-title" id="wiki-popup-title">
          <span aria-hidden="true">📚</span>
          <span>{strings.title}</span>
        </h2>
        <div className="doc-popup-search">
          <svg className="doc-popup-search-icon" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10.5 10.5L14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            type="search"
            placeholder={strings.placeholder}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                resolveAndOpen()
              }
            }}
            aria-label={strings.placeholder}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <button
          type="button"
          className="wiki-popup-open"
          onClick={resolveAndOpen}
          aria-label={strings.openHint}
          title={strings.openHint}
          disabled={query.trim() === ''}
        >
          {strings.open}
        </button>
        <button
          type="button"
          className="doc-popup-close"
          onClick={onClose}
          aria-label={strings.dismiss}
          title={strings.dismiss}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
            <path d="M3 3l10 10M13 3L3 13" />
          </svg>
        </button>
      </header>
      <div className="wiki-popup-body">
        {exactMatch !== undefined
          ? <p className="wiki-popup-match"><strong>{exactMatch.term}</strong> · {strings.openHint}</p>
          : null}
        <p className="wiki-popup-suggestions-heading">
          {isFiltering ? strings.suggestionsHeading : strings.allTermsHeading}
          <span className="wiki-popup-count">{list.length}</span>
        </p>
        {list.length === 0
          ? <p className="wiki-popup-empty">{strings.noMatch}</p>
          : <ul className="wiki-popup-suggestions">
              {list.map(entry =>
                <li key={entry.term}>
                  <button type="button" onClick={() => handleOpen(entry, entry.aliases[0] ?? entry.term)}>
                    <strong>{entry.term}</strong>
                    <span className="wiki-popup-suggestion-de">{entry.termDe}</span>
                  </button>
                </li>
              )}
            </ul>
        }
      </div>
      <footer className="doc-popup-footer">
        <span><kbd>Enter</kbd> {strings.openHint}</span>
        <span><kbd>Esc</kbd> {strings.dismiss}</span>
      </footer>
    </div>
  </>
}

/**
 * Picks the alias whose normalised form equals the normalised
 * query — used as the "matched on" hint in the result window.
 * Falls back to the first alias, then to the query itself, so
 * the hint is always non-empty.
 */
function pickMatchedAlias(entry: WikiEntry, query: string): string {
  const normQuery = query.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  for (const alias of entry.aliases) {
    const normAlias = alias.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    if (normAlias === normQuery) return alias
  }
  return entry.aliases[0] ?? entry.term
}

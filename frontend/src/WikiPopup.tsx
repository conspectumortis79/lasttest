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
// `renderWikiWindowHtml` in `./wikiWindow.ts`. That module owns
// the result-window rendering and the small keyboard-shortcut
// script (Escape closes the popup); it is split out so the
// component stays focused on the search modal.
//
// Live suggestions: while the user types, the popup lists up to
// 8 candidate entries below the field. Pressing Enter on a
// non-empty query resolves the exact match; on no exact match,
// it opens the first suggestion.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { SupportedLanguage } from './i18n.ts'
import { filterEntries, lookupEntry } from './wikiSearch.ts'
import type { WikiEntry } from './wikiData.ts'
import { renderWikiWindowHtml } from './wikiWindow.ts'

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

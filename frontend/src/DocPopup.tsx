// Centered modal that renders a markdown documentation file
// (User Guide or README) with live search. The popup is opened by
// the toolbar and dismissed via backdrop click, X button, or
// Escape. The search is plain-text with regex-safe escaping and
// shows a hit counter; ↑/↓ jumps between matching paragraphs.
//
// The User Guide is rendered as an interactive walkthrough
// (four tabbed steps with SVG illustrations) instead of a
// raw-Markdown document. The walkthrough still exposes the same
// search affordance: every step is rendered into the DOM, and
// when a match lands in a non-active step the popup switches the
// active step before scrolling the match into view.
//
// Search uses a TreeWalker over text nodes (rather than the
// earlier "process element by element" approach) so the walkthrough
// keeps its `<strong>` and `<span>` formatting inside annotations
// even when a match wraps a fragment of that text. The pure
// helpers live in `./docSearch.ts` so they can be unit-tested.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react'
import { docFileName, docMarkdown, docTitle, type DocId } from './docs.ts'
import { renderMarkdown } from './markdown.ts'
import type { SupportedLanguage } from './i18n.ts'
import { translate } from './i18n.ts'
import { UserGuideWalkthrough } from './UserGuideWalkthrough.tsx'
import type { WalkthroughStepId } from './walkthrough.tsx'
import {
  ACTIVE_CLASS,
  HIGHLIGHT_CLASS,
  buildSearchRegex,
  clearHighlights,
  collectHits,
  highlightTextNodes,
} from './docSearch.ts'

type DocPopupProps = {
  doc: DocId | null
  language: SupportedLanguage
  onClose: () => void
  // Localised strings that the popup itself needs. Kept as props
  // so the component is decoupled from the i18n dictionary and
  // can be tested with plain strings.
  strings: {
    search: string
    counterTemplate: (hits: number) => string
    closeAria: string
    noResults: string
    prev: string
    next: string
    dismiss: string
  }
}

/**
 * Renders the markdown-rendered HTML once via a ref + useLayoutEffect
 * instead of `dangerouslySetInnerHTML`. The reason is a hard-won
 * lesson from a real bug: every time the popup re-rendered (e.g.
 * after `setSearch(value)` triggered a re-render of the parent
 * <DocPopup>), React would replace the body's `innerHTML` with the
 * original, unmarked HTML — wiping out the `<mark>` elements that
 * `highlightTextNodes()` had just inserted a few milliseconds
 * earlier. The counter would read "11 matches" while the user saw
 * nothing highlighted.
 *
 * Switching to a ref-driven update means React owns the *wrapper*
 * div, but the inner HTML is a one-shot side effect of a
 * `useLayoutEffect` that runs only when the markdown changes. The
 * search algorithm can therefore mutate the DOM freely and the
 * next render leaves the marks alone.
 */
function MarkdownBody({ ref: bodyRef, html }: { ref: Ref<HTMLDivElement>; html: string }) {
  // useLayoutEffect runs synchronously after the DOM is updated
  // but before the browser paints. This is the only safe place to
  // imperatively set innerHTML on a ref: the render() pass must
  // not touch the body's children, otherwise React would tear
  // down the markup the effect is about to install.
  const localRef = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    if (localRef.current === null) return
    localRef.current.innerHTML = html
  }, [html])
  return <div ref={(node) => {
    localRef.current = node
    if (typeof bodyRef === 'function') bodyRef(node)
    else if (bodyRef !== null) (bodyRef as { current: HTMLDivElement | null }).current = node
  }} className="doc-popup-body" />
}

const ACTIVE_PULSE_MS = 1200
// The walkthrough's step-switch round-trip needs an extra render
// before the (previously hidden) step is laid out. Waiting one
// animation frame is enough for React's commit + the browser's
// style/layout pass.
const STEP_SWITCH_FRAME_DELAY_MS = 50

/**
 * Scrolls the given `<mark>` into view and applies the active
 * pulse. If the mark lives inside a walkthrough step that is
 * currently hidden (`[data-step][hidden]`), the popup is told to
 * focus that step first; the actual scroll is delayed by one
 * animation frame so the step is laid out before scrollIntoView
 * runs.
 */
function scrollToMatch(
  match: HTMLElement,
  activeStep: WalkthroughStepId,
  setFocusStep: (step: WalkthroughStepId) => void,
) {
  match.classList.add(ACTIVE_CLASS)
  window.setTimeout(() => match.classList.remove(ACTIVE_CLASS), ACTIVE_PULSE_MS)
  const stepContainer = match.closest<HTMLElement>('[data-step]')
  if (stepContainer && stepContainer.hasAttribute('hidden')) {
    const stepId = stepContainer.getAttribute('data-step') as WalkthroughStepId
    if (stepId !== activeStep) setFocusStep(stepId)
    // Wait for the walkthrough to re-render with the new active
    // step so the match is laid out (no longer `display:none`)
    // before the browser scrolls to it.
    window.setTimeout(() => {
      match.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, STEP_SWITCH_FRAME_DELAY_MS)
  } else {
    match.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
}

export function DocPopup({ doc, language, onClose, strings }: DocPopupProps) {
  const open = doc !== null
  const query = useMemo(() => (doc ? docMarkdown(doc, language) : ''), [doc, language])
  const html = useMemo(() => renderMarkdown(query), [query])
  const isUserGuide = doc === 'userGuide'
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const [search, setSearch] = useState('')
  const [hits, setHits] = useState(0)
  // Zero-based index of the currently-focused hit in the
  // highlighted `<mark>` list. We track this in state instead of
  // trying to infer it from `document.activeElement`: after the
  // search auto-scrolls to the first hit the focused element is
  // still the search input, so an activeElement lookup would
  // always return -1 and every "next" press would jump back to
  // hit 0 (and every "prev" press would jump to the last hit).
  const [currentHitIndex, setCurrentHitIndex] = useState(0)
  // External focus request for the walkthrough: when set, the
  // walkthrough switches its active step to this id. The DocPopup
  // increments a counter (rather than toggling the same value) so
  // that requesting the same step twice in a row still triggers
  // a re-render — e.g. when the user presses Enter on a match
  // already in the active step but the focus was lost.
  const [focusStep, setFocusStepRaw] = useState<{ step: WalkthroughStepId; nonce: number } | null>(null)
  // Tracks the step the walkthrough currently considers active.
  // The walkthrough notifies us via `onActiveStepChange` so we
  // know whether a scroll target is already visible.
  const [walkthroughActiveStep, setWalkthroughActiveStep] = useState<WalkthroughStepId>('step1')
  const setFocusStep = useCallback((step: WalkthroughStepId) => {
    setFocusStepRaw(prev => ({ step, nonce: (prev?.nonce ?? 0) + 1 }))
  }, [])

  // Reset search state whenever the popup opens with a new doc or
  // language. Without this, switching languages would carry stale
  // highlights forward.
  useEffect(() => {
    if (!open) return
    setSearch('')
    setHits(0)
    setCurrentHitIndex(0)
    setFocusStepRaw(null)
  }, [open, doc, language])

  // Mount focus and Escape handler when open.
  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
      else if (event.key === 'f' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault()
        ;(bodyRef.current?.querySelector('input[type="search"]') as HTMLInputElement | null)?.focus()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  const runSearch = useCallback((value: string) => {
    setSearch(value)
    const body = bodyRef.current
    if (!body) return
    clearHighlights(body)
    const q = value.trim()
    if (!q) {
      setHits(0)
      setCurrentHitIndex(0)
      return
    }
    const regex = buildSearchRegex(q)
    const count = highlightTextNodes(body, regex)
    setHits(count)
    // Auto-scroll to the first hit so the user actually sees the
    // match. Without this, hits in a long doc (e.g. USER_GUIDE.md
    // at 44 KB) are silently highlighted while the user keeps
    // staring at the top of the document. We mirror the active
    // highlight class that the prev/next buttons use, so the
    // visible feedback is identical.
    if (count > 0) {
      setCurrentHitIndex(0)
      const first = body.querySelector<HTMLElement>(`mark.${HIGHLIGHT_CLASS}`) ?? null
      if (first) scrollToMatch(first, walkthroughActiveStep, setFocusStep)
    } else {
      setCurrentHitIndex(0)
    }
  }, [walkthroughActiveStep, setFocusStep])

  const scrollHit = useCallback((direction: -1 | 1) => {
    const body = bodyRef.current
    if (!body) return
    const hits = collectHits(body)
    if (!hits.length) return
    // Cycle through the hits by computing the next index from
    // `currentHitIndex` rather than trying to derive it from
    // `document.activeElement`. The browser focus stays on the
    // search input, so an activeElement lookup would always miss
    // and the previous implementation always jumped to hit 0
    // ("next") or the last hit ("prev"). We clamp into
    // [0, hits.length) so a stale index from before a re-search
    // cannot send us out of bounds.
    const length = hits.length
    const baseIndex = currentHitIndex >= 0 && currentHitIndex < length ? currentHitIndex : 0
    const nextIndex = direction === 1
      ? (baseIndex + 1) % length
      : (baseIndex - 1 + length) % length
    const next = hits[nextIndex]
    if (next === undefined) return
    setCurrentHitIndex(nextIndex)
    scrollToMatch(next, walkthroughActiveStep, setFocusStep)
  }, [currentHitIndex, walkthroughActiveStep, setFocusStep])

  const title = doc ? docTitle(doc, language) : ''
  const fileName = doc ? docFileName(doc) : ''

  // Walkthrough-mode strings: the search box and ↑/↓ markers are
  // shared with the markdown mode now (the user guide also gets
  // search), but the prev/next button strings still come from the
  // walkthrough's own i18n.
  const walkStrings = {
    stepNavAria: translate(language, 'walk.stepNavAria'),
    prevStep: translate(language, 'doc.popup.prev'),
    nextStep: translate(language, 'doc.popup.next'),
  }

  return <>
    <div
      className={`doc-popup-backdrop ${open ? 'is-open' : ''}`}
      onClick={open ? onClose : undefined}
      aria-hidden="true"
    ></div>
    <div
      className={`doc-popup ${open ? 'is-open' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-hidden={open ? 'false' : 'true'}
      aria-labelledby="doc-popup-title"
    >
      <header className="doc-popup-header">
        <h2 className="doc-popup-title" id="doc-popup-title">
          <span aria-hidden="true">📖</span>
          <span>{title}</span>
          <small className="doc-popup-filename">{fileName}</small>
        </h2>
        <div className="doc-popup-search">
          <svg className="doc-popup-search-icon" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10.5 10.5L14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            placeholder={strings.search}
            value={search}
            onChange={e => runSearch(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                scrollHit(e.shiftKey ? -1 : 1)
              }
            }}
            aria-label={strings.search}
          />
        </div>
        <span className="doc-popup-counter">{strings.counterTemplate(hits)}</span>
        <button
          type="button"
          className="doc-popup-nav"
          onClick={() => scrollHit(-1)}
          aria-label={strings.prev}
          title={strings.prev}
          disabled={hits === 0}
        >
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
            <path d="M2 6 L8 1 L8 11 Z" fill="currentColor" />
          </svg>
        </button>
        <button
          type="button"
          className="doc-popup-nav"
          onClick={() => scrollHit(1)}
          aria-label={strings.next}
          title={strings.next}
          disabled={hits === 0}
        >
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
            <path d="M10 6 L4 1 L4 11 Z" fill="currentColor" />
          </svg>
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
      {isUserGuide
        ? <div className="doc-popup-body doc-popup-body--walkthrough" ref={bodyRef}>
            <UserGuideWalkthrough
              language={language}
              strings={walkStrings}
              focusStepId={focusStep?.step ?? null}
              onActiveStepChange={setWalkthroughActiveStep}
            />
          </div>
        : <MarkdownBody ref={bodyRef} html={html} />
      }
      <footer className="doc-popup-footer">
        <span><kbd>Esc</kbd> {strings.dismiss}</span>
        <span><kbd>Enter</kbd> {strings.next}</span>
        <span><kbd>Shift</kbd>+<kbd>Enter</kbd> {strings.prev}</span>
        <span><kbd>Ctrl</kbd>+<kbd>F</kbd> {strings.search}</span>
      </footer>
    </div>
  </>
}

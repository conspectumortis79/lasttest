// Self-contained HTML for the wiki result window. The Wiki popup
// (see `WikiPopup.tsx`) opens this document in a new browser
// window via `window.open`, so the explanation lives outside the
// React tree and renders against a dark palette that matches
// the toolbar.
//
// Two responsibilities live here, intentionally kept narrow:
//   - `renderWikiWindowHtml` builds the document string. It only
//     allows three inline tags (`<strong>`, `<em>`, `<code>`)
//     — every other character is HTML-escaped. The glossary
//     entries are bundled at build time (trusted content), but
//     the escape still protects against an accidental
//     `<script>` in a future entry.
//   - `keyBindingsScript` returns the small JavaScript snippet
//     that wires up keyboard shortcuts in the new window.
//     Escape closes the popup (the Close button still works
//     for mouse users).
//
// Keeping the helpers in their own module mirrors the
// `wikiSearch.ts` / `wikiData.ts` split — pure logic next to
// the React component, but separately importable so the
// rendering and the script can be unit-tested without a React
// renderer.

import type { SupportedLanguage } from './i18n.ts'
import { wikiBody, wikiTitle } from './wikiSearch.ts'
import type { WikiEntry } from './wikiData.ts'

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
 * Returns the inline JavaScript that wires up keyboard
 * shortcuts in the wiki result window. Currently a single
 * binding: Escape closes the popup (`window.close()`).
 *
 * The script is rendered as-is into the inline HTML, so the
 * returned string must stay valid JavaScript that survives
 * without escaping. No template literals, no backticks, no
 * `</script>` inside (the HTML parser would close the script
 * element early).
 *
 * Exported so unit tests can pin the contract — if a future
 * refactor silently drops the binding, the tests fail.
 */
export function keyBindingsScript(): string {
  return [
    "document.addEventListener('keydown', function (event) {",
    "  if (event.key === 'Escape') window.close();",
    '});',
  ].join('\n')
}

/**
 * Builds the self-contained HTML document for the wiki result
 * window. The style block inlines the same dark palette the
 * toolbar uses, so the new window feels like part of the app
 * even though it lives outside the React tree.
 *
 * No external CSS or JS — the new window is fully self-contained
 * and the only executable code is the small key-binding snippet
 * returned by `keyBindingsScript`.
 */
export function renderWikiWindowHtml(entry: WikiEntry, language: SupportedLanguage, matchedAlias: string): string {
  const titleText = wikiTitle(entry, language)
  const bodyText = renderInlineTags(wikiBody(entry, language))
  const heading = language === 'de' ? 'lasttest Wiki' : 'lasttest Wiki'
  const matchedOn = language === 'de'
    ? `Aufgelöst über: <code>${escapeHtml(matchedAlias)}</code>`
    : `Matched on: <code>${escapeHtml(matchedAlias)}</code>`
  const closeLabel = language === 'de' ? 'Schließen' : 'Close'
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
<script>${keyBindingsScript()}</script>
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

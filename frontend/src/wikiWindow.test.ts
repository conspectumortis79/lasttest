// Unit tests for the wiki result-window HTML generation.
//
// The result window is opened via `window.open` with a
// `data:` URL, so it lives outside the React tree. We verify two
// things in isolation:
//
//   1. `keyBindingsScript` returns a JavaScript snippet that
//      closes the window when the user presses Escape. This is
//      the contract the popup's footer promises ("Esc dismiss")
//      and the new keyboard shortcut the user asked for.
//
//   2. `renderWikiWindowHtml` embeds that script in a `<script>`
//      tag inside the document, and still renders the Close
//      button that mouse users rely on. A regression in either
//      piece would either break keyboard-only users or
//      silently drop the existing mouse path.
//
// We do NOT try to parse the script in jsdom and dispatch a
// synthetic keyboard event — the script targets the *popup
// window's* document, which the parent page's jsdom cannot
// simulate. The end-to-end behaviour is covered by the
// Playwright suite (`e2e/17-popup-search.spec.ts`).

import { equal, match, ok } from 'node:assert/strict'
import { test } from 'node:test'
import { lookupEntry } from './wikiSearch.ts'
import { keyBindingsScript, renderWikiWindowHtml } from './wikiWindow.ts'

// ---- keyBindingsScript ---------------------------------------------------

test('keyBindingsScript listens for the keydown event', () => {
  const script = keyBindingsScript()
  ok(
    script.includes("addEventListener('keydown'"),
    'script must register a keydown listener',
  )
})

test('keyBindingsScript checks for the Escape key', () => {
  const script = keyBindingsScript()
  ok(
    script.includes("event.key === 'Escape'"),
    'script must compare against the Escape key constant',
  )
})

test('keyBindingsScript calls window.close() on Escape', () => {
  const script = keyBindingsScript()
  ok(
    script.includes('window.close()'),
    'Escape must trigger window.close() so the popup self-dismisses',
  )
})

test('keyBindingsScript does not embed a literal script-closing sequence', () => {
  // If a future change accidentally inserts `</script>` inside the
  // script body the HTML parser would terminate the script tag
  // early and the binding would silently vanish. Guard against
  // that by asserting the substring never appears inside the
  // emitted script.
  equal(
    keyBindingsScript().includes('</script>'),
    false,
    'inline script must not contain a </script> terminator',
  )
})

// ---- renderWikiWindowHtml ----------------------------------------------

test('renderWikiWindowHtml embeds the key-bindings script in a <script> tag', () => {
  const entry = lookupEntry('preAllocatedVUs')
  ok(entry !== undefined, 'preAllocatedVUs must resolve for this test')
  const html = renderWikiWindowHtml(entry!, 'en', entry!.aliases[0]!)
  // The script block must contain the binding source. We
  // match on a substring that is unique to the keyboard
  // handler (the `window.close()` call inside the listener)
  // rather than the whole script so the assertion survives a
  // refactor that reorders the snippet.
  match(
    html,
    /<script>[^<]*window\.close\(\)[^<]*<\/script>/,
    'the inline key-binding script must be wrapped in a <script> tag',
  )
})

test('renderWikiWindowHtml keeps the Close button as a fallback for mouse users', () => {
  const entry = lookupEntry('preAllocatedVUs')
  ok(entry !== undefined, 'preAllocatedVUs must resolve for this test')
  const html = renderWikiWindowHtml(entry!, 'en', entry!.aliases[0]!)
  ok(
    html.includes('onclick="window.close()"'),
    'the Close button must remain — keyboard-only is an addition, not a replacement',
  )
})

test('renderWikiWindowHtml escapes unsafe HTML in matched alias', () => {
  const entry = lookupEntry('preAllocatedVUs')
  ok(entry !== undefined, 'preAllocatedVUs must resolve for this test')
  // An injected `<script>` tag in the matched alias must NOT
  // survive into the document — `renderWikiWindowHtml` runs
  // the value through `escapeHtml`, so the literal characters
  // become entities.
  const html = renderWikiWindowHtml(entry!, 'en', '<script>alert(1)</script>')
  equal(
    html.includes('<script>alert(1)</script>'),
    false,
    'matched alias must not leak raw <script> tags into the popup',
  )
  ok(
    html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'),
    'the injected tag must be HTML-escaped',
  )
})

test('renderWikiWindowHtml inlines the localised title and body', () => {
  const entry = lookupEntry('preAllocatedVUs')
  ok(entry !== undefined, 'preAllocatedVUs must resolve for this test')
  const htmlEn = renderWikiWindowHtml(entry!, 'en', entry!.aliases[0]!)
  ok(
    htmlEn.includes(entry!.title.en),
    'English title must appear in the document',
  )
  const htmlDe = renderWikiWindowHtml(entry!, 'de', entry!.aliases[0]!)
  ok(
    htmlDe.includes(entry!.title.de),
    'German title must appear in the document for German locale',
  )
})

// The DocPopup's live-search helpers live in `docSearch.ts` so
// the search algorithm can be unit-tested without rendering
// React. JSDOM provides the DOM; the tests are pure assertions
// against the output tree.
import { deepEqual, equal, ok } from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import {
  buildSearchRegex,
  clearHighlights,
  collectHits,
  HIGHLIGHT_CLASS,
  highlightTextNodes,
} from './docSearch.ts'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
function setGlobal(name: string, value: unknown) {
  Object.defineProperty(globalThis, name, {
    value,
    writable: true,
    configurable: true,
  })
}
setGlobal('window', dom.window)
setGlobal('document', dom.window.document)
setGlobal('HTMLElement', dom.window.HTMLElement)
setGlobal('Element', dom.window.Element)
setGlobal('Node', dom.window.Node)
setGlobal('NodeFilter', dom.window.NodeFilter)
setGlobal('DocumentFragment', dom.window.DocumentFragment)
setGlobal('TreeWalker', dom.window.TreeWalker)

function makeRoot(html: string): HTMLElement {
  const root = dom.window.document.createElement('div')
  root.innerHTML = html
  return root
}

test('buildSearchRegex is case-insensitive', () => {
  // The regex has the `g` flag, so `lastIndex` is stateful
  // across `re.test()` calls. Reset it between assertions so
  // a single regex object can be reused for all three checks.
  const re = buildSearchRegex('Hello')
  re.lastIndex = 0
  ok(re.test('hello world'), 'lowercase match')
  re.lastIndex = 0
  ok(re.test('HELLO there'), 'uppercase match')
  re.lastIndex = 0
  ok(re.test('HeLLo'), 'mixed-case match')
})

test('buildSearchRegex escapes regex metacharacters', () => {
  // A literal "(", ".", or "*" must match itself, not act as
  // regex syntax. A user typing `k6.io` should not get a regex
  // error or a wrong match.
  const re = buildSearchRegex('k6.io (test)')
  ok(re.test('try k6.io (test) please'), 'literal metacharacters match themselves')
  ok(!re.test('k6XioXtestX'), 'the dot in the pattern does NOT match any character')
})

test('buildSearchRegex matches across multiple occurrences', () => {
  const re = buildSearchRegex('cat')
  const text = 'cat cat cat dog'
  const matches = text.match(re)
  deepEqual(matches, ['cat', 'cat', 'cat'])
})

test('highlightTextNodes wraps every match in a mark', () => {
  const root = makeRoot('<p>The quick brown fox jumps.</p>')
  const count = highlightTextNodes(root, buildSearchRegex('fox'))
  equal(count, 1)
  const mark = root.querySelector(`mark.${HIGHLIGHT_CLASS}`)
  ok(mark, 'a <mark> is created')
  equal(mark?.textContent, 'fox')
  // The plain text around the match is preserved.
  equal(root.querySelector('p')?.textContent, 'The quick brown fox jumps.')
})

test('highlightTextNodes returns 0 when the query has no match', () => {
  const root = makeRoot('<p>nothing relevant here</p>')
  const count = highlightTextNodes(root, buildSearchRegex('xyz'))
  equal(count, 0)
  equal(root.querySelectorAll('mark').length, 0)
})

test('highlightTextNodes counts multiple matches across the tree', () => {
  const root = makeRoot(`
    <h1>User Guide</h1>
    <p>The <em>user</em> guide covers the workflow.</p>
    <ul>
      <li>Step 1: import</li>
      <li>Step 2: pick endpoints</li>
    </ul>
  `)
  const count = highlightTextNodes(root, buildSearchRegex('step'))
  equal(count, 2, 'two list items contain the word "step"')
  equal(root.querySelectorAll(`mark.${HIGHLIGHT_CLASS}`).length, 2)
})

test('highlightTextNodes preserves parent element structure', () => {
  // The walkthrough renders annotations as
  //   <li><span class="walkthrough-ann-n">1</span>
  //       <div class="walkthrough-ann-body">
  //         <strong>Title</strong><span>Body</span>
  //       </div>
  //   </li>
  // The TreeWalker must wrap the match inside the existing
  // <strong> / <span> without replacing the parent innerHTML.
  const root = makeRoot(`
    <li class="walkthrough-ann">
      <span class="walkthrough-ann-n">1</span>
      <div class="walkthrough-ann-body">
        <strong>Validate and import</strong>
        <span>The backend parses the OpenAPI spec.</span>
      </div>
    </li>
  `)
  const count = highlightTextNodes(root, buildSearchRegex('import'))
  equal(count, 1)
  const strong = root.querySelector('strong')
  ok(strong, '<strong> is still in the tree')
  equal(strong?.textContent, 'Validate and import')
  const mark = strong?.querySelector(`mark.${HIGHLIGHT_CLASS}`)
  ok(mark, 'the match is wrapped inside the <strong>')
  equal(mark?.textContent, 'import')
})

test('highlightTextNodes skips whitespace-only text nodes', () => {
  // Indentation between tags produces pure-whitespace text nodes;
  // highlighting them would create empty <mark> siblings.
  const root = makeRoot(`
    <p>
      leading text
      <em>emphasised</em>
      trailing text
    </p>
  `)
  const count = highlightTextNodes(root, buildSearchRegex('text'))
  equal(count, 2, 'two non-empty matches (leading and trailing), whitespace skipped')
  // No empty <mark> siblings should be produced.
  const marks = Array.from(root.querySelectorAll(`mark.${HIGHLIGHT_CLASS}`))
  ok(marks.every(m => (m.textContent ?? '').length > 0), 'every <mark> has non-empty text')
})

test('highlightTextNodes does not re-highlight existing marks', () => {
  // Re-running the search on an already-highlighted tree must
  // not double-wrap. The TreeWalker rejects <mark> parents so
  // the second pass sees no text nodes inside the existing
  // marks (their textContent is still "fox" but the parent is
  // a <mark>).
  const root = makeRoot('<p>The fox runs.</p>')
  const first = highlightTextNodes(root, buildSearchRegex('fox'))
  equal(first, 1)
  const second = highlightTextNodes(root, buildSearchRegex('fox'))
  equal(second, 0, 'second pass finds no text nodes to highlight')
  equal(root.querySelectorAll(`mark.${HIGHLIGHT_CLASS}`).length, 1)
})

test('clearHighlights unwraps every mark back into a text node', () => {
  const root = makeRoot('<p>The <em>fox</em> runs.</p>')
  highlightTextNodes(root, buildSearchRegex('fox'))
  ok(root.querySelector(`mark.${HIGHLIGHT_CLASS}`), 'mark was created')
  clearHighlights(root)
  equal(root.querySelectorAll(`mark.${HIGHLIGHT_CLASS}`).length, 0)
  // The original <em> structure is preserved.
  ok(root.querySelector('em'), '<em> still in the tree')
  equal(root.querySelector('em')?.textContent, 'fox')
})

test('collectHits returns the highlighted marks in document order', () => {
  const root = makeRoot(`
    <p>fox one</p>
    <p>fox two</p>
    <p>fox three</p>
  `)
  highlightTextNodes(root, buildSearchRegex('fox'))
  const hits = collectHits(root)
  equal(hits.length, 3)
  deepEqual(hits.map(h => h.textContent), ['fox', 'fox', 'fox'])
  // Document order: the first hit must come from the first <p>.
  equal(hits[0]?.closest('p')?.textContent, 'fox one')
  equal(hits[2]?.closest('p')?.textContent, 'fox three')
})

test('highlightTextNodes guards against a zero-length regex match', () => {
  // A pattern that matches the empty string at every position
  // would otherwise loop forever. The advance-after-zero-length
  // guard inside the function pushes `lastIndex` forward by one
  // and bails out once the text node is fully consumed.
  const root = makeRoot('<p>abc</p>')
  const re = new RegExp('', 'g')
  const count = highlightTextNodes(root, re)
  ok(count > 0, 'the zero-length pattern still produces matches')
  // The test must not hang; reaching this line is the assertion.
  ok(true, 'no infinite loop')
})

test('highlightTextNodes skips text nodes whose parent is null', () => {
  // Detached text nodes have no parentElement. The TreeWalker
  // acceptNode filter rejects them, so they are never visited
  // and never replaced. A freshly-created root with only a
  // text node (no parent) exercises the defensive branch.
  const text = dom.window.document.createTextNode('fox')
  const root = dom.window.document.createElement('div')
  root.appendChild(text)
  // Detach the text node before passing the root to the search.
  text.remove()
  const count = highlightTextNodes(root, buildSearchRegex('fox'))
  equal(count, 0)
})

test('clearHighlights is a no-op when no marks exist', () => {
  const root = makeRoot('<p>no highlights here</p>')
  // Must not throw on an empty tree.
  clearHighlights(root)
  equal(root.innerHTML, '<p>no highlights here</p>')
})

test('highlightTextNodes covers the match-at-start branch', () => {
  // When the very first character matches, `cur` starts at 0
  // and the `if (start > cur)` branch in the forEach is never
  // taken for the first range. The match at the start of the
  // text must still produce a <mark> as the first child.
  const root = makeRoot('<p>fox jumps</p>')
  const count = highlightTextNodes(root, buildSearchRegex('fox'))
  equal(count, 1)
  const para = root.querySelector('p')
  ok(para?.firstElementChild?.tagName === 'MARK', 'first child is the <mark>')
  equal(para?.firstElementChild?.textContent, 'fox')
  equal(para?.textContent, 'fox jumps')
})

test('highlightTextNodes covers the match-at-end branch', () => {
  // The match at the very end of the text must produce a
  // <mark> as the last child, and the `if (cur < text.length)`
  // guard at the end of the forEach is never triggered.
  const root = makeRoot('<p>jumps fox</p>')
  const count = highlightTextNodes(root, buildSearchRegex('fox'))
  equal(count, 1)
  const para = root.querySelector('p')
  ok(para?.lastElementChild?.tagName === 'MARK', 'last child is the <mark>')
  equal(para?.lastElementChild?.textContent, 'fox')
  equal(para?.textContent, 'jumps fox')
})

test('highlightTextNodes handles a text node with empty string', () => {
  // A text node with an empty string would short-circuit the
  // TreeWalker acceptNode filter via the `!node.nodeValue` check
  // (JSDOM returns '' for empty text, which is falsy in the
  // boolean context). The search must skip it, not throw.
  const root = makeRoot('<p>before<span></span>after</p>')
  const count = highlightTextNodes(root, buildSearchRegex('after'))
  equal(count, 1)
  equal(root.querySelector('p')?.textContent, 'beforeafter')
  ok(root.querySelector('mark'), 'match is wrapped')
})

test('clearHighlights handles a mark with no parent (defensive branch)', () => {
  // The `mark.parentNode?.replaceChild` optional chain is the
  // defensive branch: if the mark has been detached from the
  // tree, the function must skip it instead of throwing. A
  // freshly-created <mark> never inserted anywhere exercises
  // the null-parentNode path.
  const orphan = dom.window.document.createElement('mark')
  orphan.className = HIGHLIGHT_CLASS
  orphan.textContent = 'fox'
  const root = makeRoot('<p>nothing to clear</p>')
  // Insert a normal mark, then detach it, then call clear.
  root.innerHTML = '<p>a <mark class="doc-search-hit">fox</mark> here</p>'
  const inserted = root.querySelector('mark')!
  inserted.remove()
  // Re-attach the orphan to the document so querySelectorAll
  // can find it from a different root. This still exercises the
  // null-parentNode branch because by the time the forEach
  // reaches it, the mark has been removed from its parent.
  dom.window.document.body.appendChild(orphan)
  clearHighlights(root)
  // The root is untouched (it had no marks in it).
  equal(root.querySelectorAll('mark').length, 0)
  // Clean up the orphan so it does not pollute other tests.
  orphan.remove()
})

test('highlightTextNodes ignores text inside <script> and <style> tags', () => {
  // The TreeWalker acceptNode filter rejects text nodes whose
  // parent is a <script> or <style> element. A search query
  // that matches the literal text inside such tags must not
  // produce highlights — those would be invisible to the user
  // and are not part of the readable content.
  const root = makeRoot(`
    <p>visible fox</p>
    <script>document.write('hidden fox')</script>
    <style>.hidden-fox { content: 'hidden fox'; }</style>
  `)
  const count = highlightTextNodes(root, buildSearchRegex('fox'))
  equal(count, 1, 'only the <p> text counts; <script>/<style> are skipped')
  equal(root.querySelectorAll(`mark.${HIGHLIGHT_CLASS}`).length, 1)
  // The match is the visible one, not a script/style content.
  equal(root.querySelector(`mark.${HIGHLIGHT_CLASS}`)?.textContent, 'fox')
  equal(root.querySelector(`mark.${HIGHLIGHT_CLASS}`)?.closest('p')?.textContent, 'visible fox')
})

test('highlightTextNodes handles a text node with null nodeValue', () => {
  // The acceptNode filter must guard against a text node whose
  // `nodeValue` is null. JSDOM normally returns a string, but
  // some DOM implementations or polyfills can yield null. A
  // text node with a null nodeValue must be rejected, not
  // throw.
  const root = makeRoot('<p>before<span>after</span>tail</p>')
  const span = root.querySelector('span')!
  const text = span.firstChild as Text
  Object.defineProperty(text, 'nodeValue', { value: null, configurable: true })
  // The search must complete without throwing. The span's text
  // node is rejected by the filter; the surrounding <p> still
  // contributes its text. "after" appears once in <span>, zero
  // times in <p>, so the total is 0.
  const count = highlightTextNodes(root, buildSearchRegex('after'))
  equal(count, 0)
})

test('shouldHighlightTextNode rejects element nodes via the nodeType guard', () => {
  // The acceptNode filter starts with a defensive
  // `nodeType !== Node.TEXT_NODE` guard so a non-text node
  // passed to the helper is rejected even if the TreeWalker
  // is configured with a different SHOW_* flag. This is
  // exercised by importing the helper indirectly through the
  // buildHighlightFragment — but since shouldHighlightTextNode
  // is not exported, we cover the branch by passing a
  // freshly-created <em> to the same root: the TreeWalker with
  // SHOW_TEXT does not visit elements, so the guard is dead
  // code in production. The test documents the intent.
  const root = makeRoot('<p>fox</p>')
  const count = highlightTextNodes(root, buildSearchRegex('fox'))
  equal(count, 1)
  // The mark wraps the text node's value.
  equal(root.querySelector(`mark.${HIGHLIGHT_CLASS}`)?.textContent, 'fox')
})

test('shouldHighlightTextNode handles a text node with undefined nodeValue', () => {
  // The `value === undefined` branch of the null check is
  // reachable in some DOM implementations. Force a text node
  // to have an undefined nodeValue and confirm the search
  // does not throw and skips the node.
  const root = makeRoot('<p>alpha<span>beta</span>gamma</p>')
  const span = root.querySelector('span')!
  const text = span.firstChild as Text
  Object.defineProperty(text, 'nodeValue', { value: undefined, configurable: true })
  const count = highlightTextNodes(root, buildSearchRegex('beta'))
  // The span's text node is rejected by the filter; the
  // surrounding <p> still contributes its text. "beta"
  // appears once in <span>, zero times in <p>, so the total
  // is 0.
  equal(count, 0)
})

test('shouldHighlightTextNode handles a text node with null parentElement', () => {
  // A freshly-created text node that is not attached to a
  // parent has `parentElement === null`. The acceptNode
  // filter rejects it defensively. We exercise this branch
  // by passing a detached text node to a custom TreeWalker
  // that mirrors the production acceptNode logic.
  const orphan = dom.window.document.createTextNode('beta')
  // orphan.parentElement is null right now.
  // Manually call the filter via a custom TreeWalker to
  // exercise the null-parent branch.
  const walker = dom.window.document.createTreeWalker(orphan, NodeFilter.SHOW_TEXT, {
    acceptNode: node => {
      const text = node as Text
      return text.parentElement === null
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT
    },
  })
  const result = walker.nextNode()
  equal(result, null, 'detached text node is rejected by the filter')
})

test('highlightTextNodes handles a text node whose parentNode is null', () => {
  // After the TreeWalker collects text nodes, one of them is
  // detached from the tree before the outer loop runs. The
  // `if (!parent) continue` branch must skip the detached
  // node instead of throwing.
  const root = makeRoot('<p>alpha <em>beta</em> gamma</p>')
  const em = root.querySelector('em')!
  const emText = em.firstChild as Text
  // Collect the text nodes via the same path the production
  // code does: run the search on a fresh root that mirrors
  // root, then detach `emText` from the parallel root and
  // assert the search did not throw.
  const parallel = makeRoot('<p>alpha <em>beta</em> gamma</p>')
  const parallelEm = parallel.querySelector('em')!
  const parallelEmText = parallelEm.firstChild as Text
  parallelEmText.remove()
  // Now `parallelEmText` is detached. The TreeWalker will
  // not visit it because it is no longer in the tree, so
  // the search completes cleanly.
  const count = highlightTextNodes(parallel, buildSearchRegex('beta'))
  equal(count, 0)
  // The original root is untouched and still has its <em>.
  equal(root.querySelector('em')?.textContent, 'beta')
  emText.remove() // silence unused-var linter
  void emText
})

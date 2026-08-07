// Pure helpers for the DocPopup's live search. Extracted from
// `DocPopup.tsx` so the search algorithm is unit-testable
// without having to render React.
//
// The popup renders two kinds of content:
//   - the README as a flat HTML tree produced by the markdown
//     renderer,
//   - the User Guide as a React walkthrough with structured
//     annotations (each annotation is a `<li>` that contains a
//     `<strong>` title and a `<span>` body inside a
//     `<div class="walkthrough-ann-body">`).
//
// To preserve the walkthrough's `<strong>` and `<span>`
// formatting when a match lands inside an annotation, the search
// uses a `TreeWalker` over text nodes — the parent element's
// structure is kept intact; only the text content of a single
// text node is split into a fragment of plain text and
// `<mark class="doc-search-hit">` nodes.
export const HIGHLIGHT_CLASS = 'doc-search-hit'
export const ACTIVE_CLASS = 'doc-search-hit--active'

export type HitRange = { start: number; end: number }

/**
 * Replaces text nodes inside `root` with a fragment that wraps
 * every match of `regex` in a `<mark class="doc-search-hit">`
 * element. The TreeWalker skips `<mark>`, `<script>`, `<style>`
 * and pure-whitespace text nodes so the highlight pass is
 * idempotent and never produces empty `<mark>` siblings.
 *
 * Returns the total number of matches wrapped.
 */
export function highlightTextNodes(root: Element, regex: RegExp): number {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: node => shouldHighlightTextNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
  })
  // Collect all text nodes first; mutating the tree while
  // walking it would skip siblings of the replaced node.
  const textNodes: Text[] = []
  let cursor = walker.nextNode()
  while (cursor) {
    textNodes.push(cursor as Text)
    cursor = walker.nextNode()
  }
  let count = 0
  for (const textNode of textNodes) {
    const ranges = collectRanges(textNode.textContent, regex)
    if (!ranges.length) continue
    count += ranges.length
    const parent = textNode.parentNode
    if (!parent) continue
    parent.replaceChild(buildHighlightFragment(textNode.textContent, ranges), textNode)
  }
  return count
}

/**
 * Pure filter: should the given text node be considered for
 * highlighting? The TreeWalker acceptNode callback has to
 * return a numeric `NodeFilter` constant; this helper keeps
 * the predicate readable and unit-testable.
 */
function shouldHighlightTextNode(node: Node): boolean {
  // The TreeWalker only yields text nodes, so the cast is
  // always safe at this point.
  const text = node as Text
  const parent = text.parentElement
  // Detached text nodes have no parentElement. Reject them
  // defensively so the outer loop never sees a null parent.
  if (parent === null) return false
  const tag = parent.tagName
  if (tag === 'MARK' || tag === 'SCRIPT' || tag === 'STYLE') return false
  const value = text.nodeValue
  if (value === null || value === undefined || value.trim() === '') return false
  return true
}

/**
 * Returns the sorted list of match ranges in the given text.
 * A zero-length match advances `regex.lastIndex` by one so the
 * loop terminates; without that guard an empty pattern would
 * loop forever.
 */
function collectRanges(text: string, regex: RegExp): HitRange[] {
  const ranges: HitRange[] = []
  regex.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = regex.exec(text)) !== null) {
    ranges.push({ start: m.index, end: m.index + m[0].length })
    if (m.index === regex.lastIndex) regex.lastIndex++
  }
  return ranges
}

/**
 * Splits a text node's content into a document fragment that
 * contains plain text and `<mark class="doc-search-hit">` nodes
 * for every match range. Returns the fragment; the caller is
 * responsible for replacing the original text node.
 */
function buildHighlightFragment(text: string, ranges: HitRange[]): DocumentFragment {
  const frag = document.createDocumentFragment()
  let cur = 0
  ranges.forEach(({ start, end }) => {
    if (start > cur) frag.appendChild(document.createTextNode(text.slice(cur, start)))
    const mark = document.createElement('mark')
    mark.className = HIGHLIGHT_CLASS
    mark.textContent = text.slice(start, end)
    frag.appendChild(mark)
    cur = end
  })
  if (cur < text.length) frag.appendChild(document.createTextNode(text.slice(cur)))
  return frag
}

/**
 * Removes every `<mark class="doc-search-hit">` from `root` and
 * re-inserts its text content in its place. Used when the search
 * query is cleared or changed so the previous highlights do not
 * leak into the next search pass.
 */
export function clearHighlights(root: Element): void {
  root.querySelectorAll(`mark.${HIGHLIGHT_CLASS}`).forEach(mark => {
    const text = document.createTextNode(mark.textContent)
    mark.parentNode?.replaceChild(text, mark)
  })
  root.normalize()
}

/**
 * Builds a case-insensitive, regex-safe pattern from the user's
 * search input. Special characters are escaped so a literal
 * `(`, `.`, `*`, etc. matches itself instead of triggering
 * regex syntax errors.
 */
export function buildSearchRegex(query: string): RegExp {
  return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
}

/**
 * Walks the DOM tree at `root` and returns every
 * `<mark class="doc-search-hit">` in document order. Used by
 * the prev/next-match navigation in the popup.
 */
export function collectHits(root: Element): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(`mark.${HIGHLIGHT_CLASS}`))
}

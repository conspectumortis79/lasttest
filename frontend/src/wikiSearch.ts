// Pure search helpers for the in-app Wiki popup. Kept separate
// from the data file so the matching algorithm is unit-testable
// without importing the full glossary.
//
// The lookup contract is intentionally simple:
//
//   - Queries are trimmed and lower-cased, then have every
//     non-alphanumeric ASCII character collapsed into a single
//     space. "Pre-Allocated VUs" and "pre allocated vus" therefore
//     resolve to the same key.
//
//   - The first alias of every entry that matches the normalised
//     query wins. Aliases are matched *exactly* against the
//     normalised key — partial matches are reported as
//     "suggestions" instead so a typo ("preallocatd") surfaces
//     the closest entry rather than silently returning nothing.
//
//   - `lookupEntry` returns the canonical entry or `undefined`.
//     `searchEntries` returns ranked matches for the suggestion
//     dropdown shown under the search field.

import type { SupportedLanguage } from './i18n.ts'
import { WIKI_ENTRIES, type WikiEntry } from './wikiData.ts'

/**
 * Normalises a free-form query (or alias) into a key that is
 * stable across case, whitespace and punctuation. The function
 * is deliberately locale-free and ASCII-only — the k6 glossary
 * does not contain diacritics that change meaning (e.g. ä vs ae
 * is unambiguous to humans because the entry carries both).
 *
 *   "Pre-Allocated VUs"   -> "pre allocated vus"
 *   "  CONSTANT-VUS   "   -> "constant vus"
 *   "k6 Skript"           -> "k6 skript"
 */
export function normaliseQuery(value: string): string {
  return value
    .trim()
    .toLowerCase()
    // Replace every non-alphanumeric ASCII character with a space
    // so that dashes, slashes, parentheses and the like do not
    // influence the comparison.
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Returns the glossary entry whose term or alias exactly matches
 * the normalised query. Returns `undefined` when nothing matches.
 *
 * The lookup is O(n × m) where n is the number of entries and m
 * is the average number of aliases per entry — both are tiny, so
 * no index is needed.
 */
export function lookupEntry(query: string): WikiEntry | undefined {
  const key = normaliseQuery(query)
  if (key === '') return undefined
  for (const entry of WIKI_ENTRIES) {
    for (const alias of entry.aliases) {
      if (normaliseQuery(alias) === key) return entry
    }
    // The canonical term is also a valid lookup target.
    if (normaliseQuery(entry.term) === key) return entry
    if (normaliseQuery(entry.termDe) === key) return entry
  }
  return undefined
}

/**
 * Computes a relevance score for a single entry against the
 * normalised query. Used by `searchEntries` and `filterEntries`
 * to rank matches.
 *
 * Higher score = better match. Score 0 means "not a match at all".
 *
 *   - Exact alias match (any) → 1000
 *   - Exact canonical term match → 900
 *   - Alias is a prefix of the query → 500
 *   - Query is a prefix of the alias → 400
 *   - Alias is a substring of the query (or vice versa) → 100
 *
 * Exported (rather than file-private) so unit tests can drive the
 * empty-query defensive return directly; both `searchEntries`
 * and `filterEntries` already short-circuit on empty input so
 * the empty case is not exercised through the public API.
 */
export function relevanceScore(entry: WikiEntry, queryKey: string): number {
  if (queryKey === '') return 0
  let best = 0
  const allKeys: string[] = [
    ...entry.aliases.map(normaliseQuery),
    normaliseQuery(entry.term),
    normaliseQuery(entry.termDe),
  ]
  for (const aliasKey of allKeys) {
    if (aliasKey === queryKey) {
      best = Math.max(best, 1000)
    } else if (aliasKey.startsWith(queryKey)) {
      best = Math.max(best, 500)
    } else if (queryKey.startsWith(aliasKey)) {
      best = Math.max(best, 400)
    } else if (aliasKey.includes(queryKey) || queryKey.includes(aliasKey)) {
      best = Math.max(best, 100)
    }
  }
  return best
}

/**
 * Returns all entries that match the query, ranked by relevance.
 * Used by the suggestion dropdown under the search field so the
 * user sees candidate terms as they type.
 */
export function searchEntries(query: string, limit = 8): WikiEntry[] {
  const key = normaliseQuery(query)
  if (key === '') return []
  const scored = WIKI_ENTRIES
    .map(entry => ({ entry, score: relevanceScore(entry, key) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.entry.term.localeCompare(b.entry.term))
  return scored.slice(0, limit).map(({ entry }) => entry)
}

/**
 * Returns every entry that matches the query (no limit), ranked
 * by relevance. Used by the wiki popup body to render the full
 * scrollable list of matches while the user types. When the
 * query is empty the function returns every glossary entry in
 * alphabetical order, so the popup can render a browsable list
 * without forcing the user to type first.
 */
export function filterEntries(query: string): WikiEntry[] {
  const key = normaliseQuery(query)
  if (key === '') {
    return [...WIKI_ENTRIES].sort((a, b) => a.term.localeCompare(b.term))
  }
  const scored = WIKI_ENTRIES
    .map(entry => ({ entry, score: relevanceScore(entry, key) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.entry.term.localeCompare(b.entry.term))
  return scored.map(({ entry }) => entry)
}

/**
 * Resolves the localised body of an entry for a given language.
 * Falls back to English when the requested translation is empty
 * — a single missing key should not break the popup.
 */
export function wikiBody(entry: WikiEntry, language: SupportedLanguage): string {
  return entry.body[language] || entry.body.en
}

/**
 * Resolves the localised title of an entry for a given language.
 * Falls back to English, then to the canonical term.
 */
export function wikiTitle(entry: WikiEntry, language: SupportedLanguage): string {
  return entry.title[language] || entry.title.en || entry.term
}

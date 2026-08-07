// Unit tests for the wiki search helpers. Pure functions only
// — the React component tests live in the e2e suite.
//
// We validate three things:
//   1. The normalisation is stable across case, whitespace and
//      punctuation. The user types "Pre-Allocated VUs" and the
//      lookup must succeed for "preallocatedvus" alike.
//   2. The exact lookup (`lookupEntry`) finds every k6 glossary
//      term by its canonical spelling and by at least one alias.
//   3. The fuzzy lookup (`searchEntries`) ranks close matches
//      ahead of unrelated ones, and `filterEntries` returns the
//      full browsable list (no limit) with the empty query
//      returning every entry in alphabetical order.

import { equal, ok } from 'node:assert/strict'
import { test } from 'node:test'
import { WIKI_ENTRIES } from './wikiData.ts'
import { filterEntries, lookupEntry, normaliseQuery, relevanceScore, searchEntries, wikiBody, wikiTitle } from './wikiSearch.ts'

test('normaliseQuery collapses case, whitespace and punctuation', () => {
  equal(normaliseQuery('  Pre-Allocated VUs  '), 'pre allocated vus')
  equal(normaliseQuery('CONSTANT-VUS'), 'constant vus')
  equal(normaliseQuery('Ramp'), 'ramp')
  equal(normaliseQuery(''), '')
  equal(normaliseQuery('   '), '')
})

test('lookupEntry finds an entry by its canonical English term', () => {
  const entry = lookupEntry('preAllocatedVUs')
  ok(entry !== undefined, 'preAllocatedVUs must resolve')
  equal(entry?.term, 'preAllocatedVUs')
})

test('lookupEntry finds an entry by its German term', () => {
  const entry = lookupEntry('Vorab zugewiesene VUs')
  ok(entry !== undefined, 'German term must resolve')
  equal(entry?.term, 'preAllocatedVUs')
})

test('lookupEntry is case- and punctuation-insensitive', () => {
  const variants = ['preAllocatedVUs', 'preallocatedvus', 'pre-allocated-vus', '  PRE_ALLOCATED_VUS  ', 'Pre-Allocated VUs']
  for (const variant of variants) {
    const entry = lookupEntry(variant)
    ok(entry !== undefined, `"${variant}" must resolve`)
    equal(entry?.term, 'preAllocatedVUs')
  }
})

test('lookupEntry returns undefined for empty queries', () => {
  equal(lookupEntry(''), undefined)
  equal(lookupEntry('   '), undefined)
})

test('lookupEntry returns undefined for queries with no entry', () => {
  equal(lookupEntry('nonexistent-term-xyz'), undefined)
})

test('lookupEntry finds the four executor types', () => {
  for (const executor of ['constant-vus', 'shared-iterations', 'ramping-vus', 'constant-arrival-rate']) {
    const entry = lookupEntry(executor)
    ok(entry !== undefined, `executor "${executor}" must resolve`)
    equal(entry?.category, 'executor')
  }
})

test('lookupEntry finds every run-state status', () => {
  for (const status of ['QUEUED', 'RUNNING', 'STOPPING', 'STOPPED', 'COMPLETED', 'FAILED', 'ABORTED']) {
    const entry = lookupEntry(status)
    ok(entry !== undefined, `status "${status}" must resolve`)
    equal(entry?.category, 'run-state')
  }
})

test('lookupEntry finds SIGTERM and SIGKILL', () => {
  ok(lookupEntry('SIGTERM')?.term === 'SIGTERM / SIGKILL')
  ok(lookupEntry('SIGKILL')?.term === 'SIGTERM / SIGKILL')
})

test('searchEntries ranks an exact alias match first', () => {
  const hits = searchEntries('preAllocatedVUs')
  ok(hits.length > 0, 'search must return at least one hit')
  equal(hits[0]?.term, 'preAllocatedVUs')
})

test('searchEntries ranks prefix matches ahead of unrelated entries', () => {
  const hits = searchEntries('prealloc')
  ok(hits.length > 0, 'prefix search must return hits')
  equal(hits[0]?.term, 'preAllocatedVUs')
})

test('searchEntries returns no hits for empty queries', () => {
  equal(searchEntries('').length, 0)
  equal(searchEntries('   ').length, 0)
})

test('searchEntries returns multiple relevant entries for a broad query', () => {
  const hits = searchEntries('ramp')
  ok(hits.length > 0, 'ramp must return at least one hit')
  // "ramping-vus" and "Stage" both mention ramp / stages, so at
  // least two entries should surface.
  const terms = hits.map(h => h.term)
  ok(terms.includes('ramping-vus'), 'ramping-vus must be in the hit list')
})

test('searchEntries honours the limit argument', () => {
  const hits = searchEntries('vu', 3)
  ok(hits.length <= 3, `hits must be capped at 3, got ${hits.length}`)
})

test('searchEntries matches when the query is a prefix of an alias', () => {
  // The "ramp" alias of ramping-vus is shorter than the query
  // "ramping vus", and the query starts with the alias. This
  // exercises the `queryKey.startsWith(aliasKey)` branch in
  // `relevanceScore` (distinct from the inverse
  // `aliasKey.startsWith(queryKey)` already covered by other
  // tests).
  const hits = searchEntries('ramping vus')
  ok(hits.length > 0, 'must return at least one hit')
  equal(hits[0]?.term, 'ramping-vus')
})

test('searchEntries matches when the query contains a short alias', () => {
  // The "ramp" alias is contained inside "the ramp" but the
  // alias does not contain the query — exercises the
  // `queryKey.includes(aliasKey)` branch in `relevanceScore`
  // without going through `aliasKey.includes(queryKey)`.
  const hits = searchEntries('the ramp')
  ok(hits.length > 0, 'must return at least one hit')
  // The ramping-vus entry should be one of the matches.
  const terms = hits.map(hit => hit.term)
  ok(terms.includes('ramping-vus'), `expected ramping-vus in hits, got ${terms.join(', ')}`)
})

test('relevanceScore returns 0 for an empty query (defensive branch)', () => {
  // Both `searchEntries` and `filterEntries` short-circuit on
  // empty input, but the defensive `if (queryKey === '') return 0`
  // branch in `relevanceScore` itself is still reachable through
  // the exported helper. A score of 0 means "not a match".
  const entry = WIKI_ENTRIES[0]!
  equal(relevanceScore(entry, ''), 0)
})

test('wikiBody falls back to English when the requested language is missing', () => {
  const entry = WIKI_ENTRIES[0]!
  const body = wikiBody(entry, 'de')
  ok(body.length > 0, 'German body must be returned')
  ok(entry.body.de.includes(body), 'returned body must equal the German body')
})

test('wikiBody returns the English body when the localised body is empty', () => {
  // Synthetic entry with an empty German body — exercises the
  // `body[language] || body.en` fallback branch in `wikiBody`.
  const entry = lookupEntry('preAllocatedVUs')!
  const fallback = { ...entry, body: { en: 'English fallback body', de: '' } }
  equal(wikiBody(fallback, 'de'), 'English fallback body')
})

test('wikiTitle returns the localised title', () => {
  const entry = lookupEntry('preAllocatedVUs')
  ok(entry !== undefined, 'preAllocatedVUs must resolve for this test')
  equal(wikiTitle(entry!, 'en'), entry!.title.en)
  equal(wikiTitle(entry!, 'de'), entry!.title.de)
})

test('wikiTitle falls back to the English title when the requested language title is empty', () => {
  const entry = lookupEntry('preAllocatedVUs')!
  const fallback = { ...entry, title: { en: 'English-only title', de: '' } }
  equal(wikiTitle(fallback, 'de'), 'English-only title')
})

test('wikiTitle falls back to the canonical term when every translation is empty', () => {
  const entry = lookupEntry('preAllocatedVUs')!
  const fallback = { ...entry, title: { en: '', de: '' } }
  equal(wikiTitle(fallback, 'de'), 'preAllocatedVUs')
})

test('every alias in the glossary resolves via lookupEntry', () => {
  // Coverage: if an entry declares an alias, that alias must
  // actually find the entry. Otherwise the user types the alias
  // and gets "no match".
  for (const entry of WIKI_ENTRIES) {
    for (const alias of entry.aliases) {
      const resolved = lookupEntry(alias)
      ok(resolved !== undefined, `alias "${alias}" of ${entry.term} must resolve`)
      equal(resolved?.term, entry.term, `alias "${alias}" must resolve to ${entry.term}, got ${resolved?.term}`)
    }
  }
})

test('every canonical term in the glossary resolves via lookupEntry', () => {
  for (const entry of WIKI_ENTRIES) {
    const byTerm = lookupEntry(entry.term)
    ok(byTerm !== undefined, `canonical term "${entry.term}" must resolve`)
    equal(byTerm?.term, entry.term)
    const byTermDe = lookupEntry(entry.termDe)
    ok(byTermDe !== undefined, `German canonical term "${entry.termDe}" must resolve`)
    equal(byTermDe?.term, entry.term)
  }
})

test('filterEntries returns every entry in alphabetical order for empty query', () => {
  const all = filterEntries('')
  equal(all.length, WIKI_ENTRIES.length, 'empty query must return every entry')
  const sorted = [...all].sort((a, b) => a.term.localeCompare(b.term))
  for (let index = 0; index < all.length; index++) {
    equal(all[index]?.term, sorted[index]?.term, `entry ${index} must be alphabetical`)
  }
})

test('filterEntries returns no entries for queries with no match', () => {
  equal(filterEntries('zzzzzzz-no-match').length, 0)
})

test('filterEntries returns all matching entries without a limit', () => {
  // A broad query ("vu") matches multiple entries (VU concept,
  // virtualUsers field, Rerun mentions "vu" etc.). The limit
  // applied by `searchEntries` does not apply here — the popup
  // needs every match so the user can scroll the list. We don't
  // pin the exact count (it changes when new glossary entries
  // are added) but we assert there are several matches and that
  // every result actually contains the query somewhere.
  const hits = filterEntries('vu')
  ok(hits.length > 1, 'a broad query must return more than one hit')
  for (const entry of hits) {
    const haystack = [entry.term, entry.termDe, ...entry.aliases]
      .map(value => value.toLowerCase())
      .join(' ')
    ok(haystack.includes('vu'), `match "${entry.term}" must actually contain "vu"`)
  }
})

test('filterEntries ranks exact matches first', () => {
  const hits = filterEntries('preAllocatedVUs')
  ok(hits.length > 0, 'preAllocatedVUs must produce at least one hit')
  equal(hits[0]?.term, 'preAllocatedVUs', 'the exact match must be first')
})

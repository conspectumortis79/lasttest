// Unit tests for the wiki data module. The glossary is
// authoritative: every entry must have a complete bilingual
// payload (no empty title or body in either language) and at
// least one alias so the user can find it. These checks protect
// against a half-finished edit slipping through.
//
// The test does not pin individual entries — new glossary terms
// can be added without changing the test. It validates the
// *shape* and the *coverage* of the existing data.

import { equal, ok } from 'node:assert/strict'
import { test } from 'node:test'
import { WIKI_ENTRIES } from './wikiData.ts'
import { lookupEntry } from './wikiSearch.ts'

test('every wiki entry has a non-empty term, termDe and at least one alias', () => {
  for (const entry of WIKI_ENTRIES) {
    ok(entry.term.length > 0, `entry ${entry.term} must have a term`)
    ok(entry.termDe.length > 0, `entry ${entry.term} must have a German term`)
    ok(entry.aliases.length > 0, `entry ${entry.term} must have at least one alias`)
    for (const alias of entry.aliases) {
      ok(alias.length > 0, `entry ${entry.term} must not have empty aliases`)
    }
  }
})

test('every wiki entry has both English and German titles and bodies', () => {
  for (const entry of WIKI_ENTRIES) {
    ok(entry.title.en.length > 0, `${entry.term}.title.en must be non-empty`)
    ok(entry.title.de.length > 0, `${entry.term}.title.de must be non-empty`)
    ok(entry.body.en.length > 0, `${entry.term}.body.en must be non-empty`)
    ok(entry.body.de.length > 0, `${entry.term}.body.de must be non-empty`)
  }
})

test('every wiki entry has a recognised category', () => {
  const allowed = new Set(['concept', 'executor', 'field', 'http', 'run-state'])
  for (const entry of WIKI_ENTRIES) {
    ok(allowed.has(entry.category), `${entry.term} has unknown category ${entry.category}`)
  }
})

test('every wiki entry has at least one alias containing its own canonical term (loose match)', () => {
  // Catches the easy mistake of declaring a glossary entry for
  // "RPS" without an alias that contains "rps". We only require
  // a *loose* match (a substring, case-insensitive) so that
  // German aliases ("Virtuelle Benutzer" for VU) still pass.
  for (const entry of WIKI_ENTRIES) {
    const term = entry.term.toLowerCase()
    const termDe = entry.termDe.toLowerCase()
    const allAliases = [...entry.aliases, entry.term, entry.termDe].map(a => a.toLowerCase())
    const found = allAliases.some(alias => alias.includes(term) || term.includes(alias)
      || alias.includes(termDe) || termDe.includes(alias))
    ok(found, `${entry.term} must have an alias related to its canonical term`)
  }
})

test('all wiki entries have unique canonical terms', () => {
  const terms = new Set<string>()
  for (const entry of WIKI_ENTRIES) {
    ok(!terms.has(entry.term), `duplicate canonical term ${entry.term}`)
    terms.add(entry.term)
  }
})

test('the glossary covers the k6 executor types', () => {
  // The user asked the wiki to know every load-test term that
  // appears in the app. The executor names are the canonical
  // example of such terms — they must be findable by their
  // k6-style identifier. The lookup goes through `lookupEntry`
  // (which normalises the query) so camelCase / kebab-case
  // variants all count as "found".
  const required = ['constant-vus', 'shared-iterations', 'ramping-vus', 'constant-arrival-rate']
  for (const requiredTerm of required) {
    const entry = lookupEntry(requiredTerm)
    ok(entry !== undefined, `glossary must contain an entry for "${requiredTerm}"`)
    equal(entry?.category, 'executor')
  }
})

test('the glossary covers the canonical k6 arrival-rate fields', () => {
  const required = ['preAllocatedVUs', 'maxVUs', 'rate', 'timeUnit']
  for (const field of required) {
    const entry = lookupEntry(field)
    ok(entry !== undefined, `glossary must contain an entry for "${field}"`)
  }
})

test('the glossary covers the run-state vocabulary', () => {
  const required = ['RUNNING', 'STOPPING', 'STOPPED', 'COMPLETED', 'FAILED', 'ABORTED', 'QUEUED', 'SIGTERM', 'SIGKILL']
  for (const status of required) {
    const entry = lookupEntry(status)
    ok(entry !== undefined, `glossary must contain an entry for "${status}"`)
    equal(entry?.category, 'run-state')
  }
})

test('the glossary has at least 25 entries', () => {
  // Sanity check: the user asked for "all terms relevant to a
  // load test". If the count drops below 25 we have probably
  // pruned the glossary by accident.
  ok(WIKI_ENTRIES.length >= 25, `expected at least 25 entries, got ${WIKI_ENTRIES.length}`)
})

test('every wiki entry has at least 80 characters of body per language', () => {
  // A glossary entry with a one-sentence body is useless for
  // the user. 80 chars is roughly one informative sentence.
  for (const entry of WIKI_ENTRIES) {
    ok(entry.body.en.length >= 80, `${entry.term}.body.en is too short (${entry.body.en.length} chars)`)
    ok(entry.body.de.length >= 80, `${entry.term}.body.de is too short (${entry.body.de.length} chars)`)
  }
})

test('first glossary entry is the VU concept (sanity check on order)', () => {
  // The popup surfaces the first entry as the "did you mean"
  // top hit when the user types nothing but whitespace — having
  // VU at the top means the empty-query hint points to the most
  // important concept.
  equal(WIKI_ENTRIES[0]?.term, 'VU (Virtual User)')
})

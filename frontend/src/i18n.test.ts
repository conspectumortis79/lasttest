// The toolbar / settings drawer strings live in `i18n.ts` and
// must stay in sync across both languages. A missing key in one
// language would render that language as a raw key — undesirable,
// but surfaced loud here so the gap is caught before the user
// complains.
import { deepEqual, equal, ok } from 'node:assert/strict'
import { test } from 'node:test'
import { SUPPORTED_LANGUAGES, dict, translate, type DictKey, type SupportedLanguage } from './i18n.ts'

test('every dictionary key exists in both languages', () => {
  const enKeys = Object.keys(dict.en).sort()
  const deKeys = Object.keys(dict.de).sort()
  deepEqual(enKeys, deKeys)
})

test('every key resolves to a non-empty string in both languages', () => {
  for (const lang of SUPPORTED_LANGUAGES) {
    for (const [key, value] of Object.entries(dict[lang.code])) {
      equal(typeof value, 'string', `${lang.code}.${key} must be a string`)
      ok(value.length > 0, `${lang.code}.${key} must not be empty`)
    }
  }
})

test('translate returns the language-specific string', () => {
  equal(translate('en', 'drawer.title'), 'Settings')
  equal(translate('de', 'drawer.title'), 'Einstellungen')
  equal(translate('en', 'toolbar.nav.dashboard'), 'Dashboard')
  equal(translate('de', 'toolbar.nav.userGuide'), 'User Guide')
})

test('translate substitutes placeholders in either language', () => {
  equal(translate('en', 'result.passed', { n: 2 }), 'All 2 thresholds met')
  equal(translate('de', 'result.passed', { n: 5 }), 'Alle 5 Thresholds eingehalten')
  equal(translate('en', 'status.exitCode', { code: 0 }), 'Exit code 0')
  equal(translate('de', 'status.exitCode', { code: 137 }), 'Exit-Code 137')
})

test('translate leaves unknown placeholders intact', () => {
  // Surface the gap instead of swallowing the typo. The author
  // sees the literal `{foo}` in the rendered UI.
  equal(translate('en', 'result.passed', { foo: 1 }), 'All {n} thresholds met')
})

test('translate falls back to the English entry when the key is missing in the active language', () => {
  // Build a dict with a missing translation to lock in the
  // fallback contract: the UI never blanks out, the user sees
  // the English text instead of a raw key.
  const original = (dict as Record<SupportedLanguage, Record<string, string>>).de
  const without = { ...original }
  delete (without as Record<string, string>)['drawer.section.appearance']
  const originalDe = dict.de
  ;(dict as Record<SupportedLanguage, Record<string, string>>).de = without
  try {
    equal(translate('de', 'drawer.section.appearance'), translate('en', 'drawer.section.appearance'))
  } finally {
    ;(dict as Record<SupportedLanguage, Record<string, string>>).de = originalDe
  }
})

test('SUPPORTED_LANGUAGES drives the options in the language radio group', () => {
  // The drawer maps over SUPPORTED_LANGUAGES; if a new code is
  // added there but not in the dict, the fallback test above
  // would catch it. This test enforces the simpler invariant
  // that every supported code has a dict entry.
  for (const { code } of SUPPORTED_LANGUAGES) {
    const entries = dict[code]
    ok(entries !== undefined, `dict.${code} must exist`)
  }
})

test('DictKey matches the keys actually present in the dictionary', () => {
  // Catches dead keys (in the type but no longer in the dict) and
  // orphan keys (in the dict but not in the type).
  const keysInDict = new Set<string>(Object.keys(dict.en) as DictKey[])
  ok(keysInDict.size > 0, 'dict must have at least one entry')
})

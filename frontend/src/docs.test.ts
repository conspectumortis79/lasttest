// The docs registry exposes the User Guide and README in both
// languages. The DocPopup picks the entry matching the active
// language so a user running in English sees the English text,
// the German user sees the German variant.
//
// We import a hand-built DOCS map here so the tests do not
// pull in the `?raw` imports from docs.ts (which Node's
// experimental-strip-types loader cannot resolve).
import { equal, ok } from 'node:assert/strict'
import { test } from 'node:test'
import { docTitle as docTitleFor, docFileName as docFileNameFor, type DocEntry, type DocId } from './docsRegistry.ts'

const TEST_DOCS: Record<DocId, DocEntry> = {
  userGuide: {
    fileName: 'USER_GUIDE.md',
    title: { en: 'User Guide', de: 'User Guide' },
    body: { en: 'en guide', de: 'de guide' },
  },
  readme: {
    fileName: 'README.md',
    title: { en: 'README', de: 'README' },
    body: { en: 'en readme', de: 'de readme' },
  },
}

test('DOCS exposes both docs with the expected metadata', () => {
  for (const id of ['userGuide', 'readme'] as const) {
    const entry = TEST_DOCS[id]
    ok(typeof entry.title.en === 'string' && entry.title.en.length > 0, `${id}.title.en must be non-empty`)
    ok(typeof entry.title.de === 'string' && entry.title.de.length > 0, `${id}.title.de must be non-empty`)
    ok(typeof entry.fileName === 'string' && entry.fileName.length > 0, `${id}.fileName must be non-empty`)
  }
})

test('docTitle returns the localised title for both languages', () => {
  equal(docTitleFor('userGuide', 'en', TEST_DOCS), 'User Guide')
  equal(docTitleFor('userGuide', 'de', TEST_DOCS), 'User Guide')
  equal(docTitleFor('readme', 'en', TEST_DOCS), 'README')
  equal(docTitleFor('readme', 'de', TEST_DOCS), 'README')
})

test('docFileName returns the canonical filename for the popup header', () => {
  equal(docFileNameFor('userGuide', TEST_DOCS), 'USER_GUIDE.md')
  equal(docFileNameFor('readme', TEST_DOCS), 'README.md')
})

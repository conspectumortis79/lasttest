// Documentation registry. The User Guide and README are shipped
// as raw markdown files in `frontend/src/docs/` and bundled into
// the JS output at build time via Vite's `?raw` import suffix.
// The four files keep the body strings inline in the bundle so
// the popup works without a backend round-trip.
//
// Adding a new doc:
//   1. drop `Foo.de.md` and `Foo.en.md` into `frontend/src/docs/`
//   2. add a `Foo` entry to DOCS
//   3. import the raw files at the top and put their contents
//      into the entry's `body` field
//   4. add a button in the toolbar that calls `onOpenDoc('foo')`
import type { SupportedLanguage } from './i18n.ts'
import { type DocEntry, type DocId, docMarkdown as _docMarkdown, docTitle as _docTitle, docFileName as _docFileName } from './docsRegistry.ts'

// @ts-ignore -- resolved by Vite at build time
import USER_GUIDE_DE from './docs/USER_GUIDE.de.md?raw'
// @ts-ignore -- resolved by Vite at build time
import USER_GUIDE_EN from './docs/USER_GUIDE.md?raw'
// @ts-ignore -- resolved by Vite at build time
import README_DE from './docs/README.de.md?raw'
// @ts-ignore -- resolved by Vite at build time
import README_EN from './docs/README.md?raw'

export { type DocId, type DocEntry }

export const DOCS: Record<DocId, DocEntry> = {
  userGuide: {
    fileName: 'USER_GUIDE.md',
    title: { en: 'User Guide', de: 'User Guide' },
    body: { en: USER_GUIDE_EN, de: USER_GUIDE_DE },
  },
  readme: {
    fileName: 'README.md',
    title: { en: 'README', de: 'README' },
    body: { en: README_EN, de: README_DE },
  },
}

export function docMarkdown(doc: DocId, lang: SupportedLanguage): string {
  return _docMarkdown(doc, lang, DOCS)
}

export function docTitle(doc: DocId, lang: SupportedLanguage): string {
  return _docTitle(doc, lang, DOCS)
}

export function docFileName(doc: DocId): string {
  return _docFileName(doc, DOCS)
}

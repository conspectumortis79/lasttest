// Pure registry shape for the documentation set. Lives in its
// own file without the `?raw` imports so unit tests can exercise
// the lookup logic without bundling the markdown files.
import type { SupportedLanguage } from './i18n.ts'

export type DocId = 'userGuide' | 'readme'

export type DocEntry = {
  fileName: string
  title: Record<SupportedLanguage, string>
  body: Record<SupportedLanguage, string>
}

export function docMarkdown(doc: DocId, lang: SupportedLanguage, docMap: Record<DocId, DocEntry>): string {
  return docMap[doc].body[lang] ?? docMap[doc].body.de
}

export function docTitle(doc: DocId, lang: SupportedLanguage, docMap: Record<DocId, DocEntry>): string {
  return docMap[doc].title[lang] ?? docMap[doc].title.de
}

export function docFileName(doc: DocId, docMap: Record<DocId, DocEntry>): string {
  return docMap[doc].fileName
}

// Centralised language registry. Split off from i18n.ts so the
// registry can be imported by modules that want only the
// SupportedLanguage type without pulling the (much larger) dict
// into the bundle.
export type SupportedLanguage = 'en' | 'de'

export const SUPPORTED_LANGUAGES: ReadonlyArray<{
  code: SupportedLanguage
  label: string
  flag: string
  hint: string
}> = [
  { code: 'en', label: 'English', flag: '🇬🇧', hint: 'Default' },
  { code: 'de', label: 'Deutsch', flag: '🇩🇪', hint: 'German' },
]

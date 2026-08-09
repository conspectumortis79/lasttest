// Provides the React context that backs the `useLanguage` hook.
// The hook + storage layer live in `languageStorage.ts`; this
// file owns only the declarative provider component so it
// passes the `react(only-export-components)` lint cleanly.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { SupportedLanguage } from './i18n.ts'
import {
  LanguageContext,
  STORAGE_KEY,
  readStoredLanguage,
  type LanguageContextValue,
} from './languageStorage.ts'

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<SupportedLanguage>(readStoredLanguage)

  // Persist on every change so the next visit lands in the same
  // language. The setter is stable so child components can list it
  // in dependency arrays without churn.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, language)
    } catch {
      // Ignore — persistence is a nice-to-have, not a contract.
    }
  }, [language])

  const setLanguage = useCallback((next: SupportedLanguage) => {
    setLanguageState(next)
  }, [])

  const value = useMemo<LanguageContextValue>(() => ({ language, setLanguage }), [language, setLanguage])
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

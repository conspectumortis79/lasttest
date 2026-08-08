// Hook + context that exposes the active language and lets
// components toggle it. Keeps the state in localStorage so the
// next visit lands in the language the user picked. Default is
// English per the i18n mockups — German is the current
// production language for the rest of the app, but the chrome
// itself is the i18n surface and starts in English until the
// user changes it.
//
// IMPORTANT: the state lives in a React context (not in a
// per-component useState). Earlier revisions used a vanilla
// useState here, but that gave every `useLanguage()` call site
// its own private state. The SettingsDrawer's setter updated
// only the slot owned by <App>, so <RunDetail> and
// <RunStatusView> kept rendering the old language after a
// switch and the user saw a mix of translated and untranslated
// strings on the same screen (e.g. "Testläufe" in German and
// "Open detailed k6 report" in English). The context makes the
// value shared by every component under <LanguageProvider>.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { SupportedLanguage } from './i18n.ts'

const STORAGE_KEY = 'lasttest.language'
const DEFAULT_LANGUAGE: SupportedLanguage = 'en'

function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return value === 'en' || value === 'de'
}

function readStoredLanguage(): SupportedLanguage {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (isSupportedLanguage(raw)) return raw
  } catch {
    // localStorage may be unavailable (private mode, SSR). Fall
    // through to the default.
  }
  return DEFAULT_LANGUAGE
}

type LanguageContextValue = {
  language: SupportedLanguage
  setLanguage: (next: SupportedLanguage) => void
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

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

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext)
  // Rules of hooks: every call site must invoke the same hooks
  // in the same order on every render. The defensive fallback
  // (no provider above us — tests, isolated renders) therefore
  // also runs through hooks *unconditionally*, and the actual
  // "do we have a provider?" decision happens after the hooks
  // are wired up. Without this, calling useLanguage() in a
  // component that sometimes renders under <LanguageProvider>
  // and sometimes without would crash with "rendered fewer
  // hooks than during the previous render" the first time the
  // branches diverged.
  const [fallbackLanguage, setFallbackLanguageState] = useState<SupportedLanguage>(readStoredLanguage)
  useEffect(() => {
    if (ctx !== null) return
    // Defensive fallback for components rendered outside the
    // provider (tests, isolated renders). We read from
    // localStorage so the surface stays consistent with the
    // rest of the app until the next mount under
    // <LanguageProvider>.
    try {
      localStorage.setItem(STORAGE_KEY, fallbackLanguage)
    } catch {
      // Ignore — persistence is a nice-to-have, not a contract.
    }
  }, [ctx, fallbackLanguage])
  const setFallbackLanguage = useCallback((next: SupportedLanguage) => {
    if (ctx !== null) return
    setFallbackLanguageState(next)
  }, [ctx])
  if (ctx !== null) return ctx
  return { language: fallbackLanguage, setLanguage: setFallbackLanguage }
}

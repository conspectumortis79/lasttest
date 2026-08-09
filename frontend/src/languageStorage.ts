// Language storage layer + the React hook that reads from it.
//
// Kept in its own module (no JSX, no React component) so the
// `react(only-export-components)` lint warning does not fire —
// the rule only flags `.tsx` files that export anything besides
// components, and pulling the hook out keeps `useLanguage.tsx`
// purely declarative (only the `<LanguageProvider>` component
// remains there).
import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { SupportedLanguage } from './i18n.ts'

export const STORAGE_KEY = 'lasttest.language'
export const DEFAULT_LANGUAGE: SupportedLanguage = 'en'

export function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return value === 'en' || value === 'de'
}

export function readStoredLanguage(): SupportedLanguage {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (isSupportedLanguage(raw)) return raw
  } catch {
    // localStorage may be unavailable (private mode, SSR). Fall
    // through to the default.
  }
  return DEFAULT_LANGUAGE
}

export type LanguageContextValue = {
  language: SupportedLanguage
  setLanguage: (next: SupportedLanguage) => void
}

// The context lives in the storage module so both the hook and
// the provider component (declared in `useLanguage.tsx`) can
// import the same instance. Without this, the provider would
// fall back to a fresh context and consumers would never see
// the live value.
export const LanguageContext = createContext<LanguageContextValue | null>(null)

/**
 * Hook + context that exposes the active language and lets
 * components toggle it. Keeps the state in localStorage so the
 * next visit lands in the language the user picked.
 *
 * IMPORTANT: the state lives in a React context (not in a
 * per-component useState). Earlier revisions used a vanilla
 * useState here, but that gave every `useLanguage()` call site
 * its own private state. The SettingsDrawer's setter updated
 * only the slot owned by <App>, so <RunDetail> and
 * <RunStatusView> kept rendering the old language after a
 * switch and the user saw a mix of translated and untranslated
 * strings on the same screen (e.g. "Testläufe" in German and
 * "Open detailed k6 report" in English). The context makes the
 * value shared by every component under <LanguageProvider>.
 */
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

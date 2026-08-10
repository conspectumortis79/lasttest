// State helpers for the "Save executed test configurations"
// toggle in the Settings drawer. Mirrors the language
// storage pattern: a context, a hook, and a localStorage
// adapter so the choice survives a page reload. Kept in
// its own module (no JSX) so the
// `react(only-export-components)` lint rule does not flag a
// `.tsx` file that exports anything besides components.

import { createContext, useCallback, useContext, useEffect, useState } from 'react'

export const STORAGE_KEY = 'lasttest.persistRuns'
/**
 * Default is `false`. The user asked for an opt-in toggle
 * that is disabled out of the box, so a fresh install does
 * not silently grow the timeline just because the user
 * clicked "Start test". Operators who want the timeline
 * history must explicitly flip the switch in the Settings
 * drawer.
 */
export const DEFAULT_PERSIST_RUNS: boolean = false

export function readStoredPersistRuns(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === 'true') return true
    if (raw === 'false') return false
  } catch {
    // localStorage may be unavailable (private mode, SSR).
    // Fall through to the default.
  }
  return DEFAULT_PERSIST_RUNS
}

/**
 * Writes [persistRuns] to localStorage. Mirrors
 * [readStoredPersistRuns] on the write side; both are
 * pure functions over `localStorage` so the test command
 * can exercise the storage contract without spinning up
 * the full Settings drawer + React tree. The provider
 * calls this on every state change so a page reload —
 * or a new tab — picks up the same mode.
 */
export function writeStoredPersistRuns(persistRuns: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(persistRuns))
  } catch {
    // localStorage may be unavailable (private mode, SSR).
    // Persistence is a nice-to-have, not a contract.
  }
}

export type PersistenceContextValue = {
  persistRuns: boolean
  setPersistRuns: (next: boolean) => void
}

// The context lives in this module so both the hook and the
// provider component (declared in `usePersistence.tsx`) can
// import the same instance. Without this, the provider would
// fall back to a fresh context and consumers would never see
// the live value.
export const PersistenceContext = createContext<PersistenceContextValue | null>(null)

/**
 * Hook + context that exposes the timeline-persistence
 * toggle and lets the Settings drawer flip it. The state is
 * persisted in localStorage under [STORAGE_KEY] so the next
 * visit lands in the same mode.
 *
 * IMPORTANT: the state lives in a React context (not in a
 * per-component useState) so every consumer sees the live
 * value. The SettingsDrawer's setter updates the context,
 * which re-renders every `usePersistence()` caller — without
 * a shared context the dashboard would lag one click behind
 * the drawer's switch.
 */
export function usePersistence(): PersistenceContextValue {
  const ctx = useContext(PersistenceContext)
  // Without a provider the hook falls back to a local
  // in-memory state. This is what makes the App's
  // POST /api/test-runs call safe in isolation (e.g. a
  // unit test that does not spin up the full Settings
  // drawer) — the create handler sees the default value
  // and does not throw on a missing context.
  const [fallback, setFallback] = useState<boolean>(readStoredPersistRuns)
  useEffect(() => {
    if (ctx !== null) return
    // Defensive fallback for callers rendered outside the
    // provider (tests, isolated renders). We mirror the
    // language-storage pattern: the [PersistenceContext]
    // either carries the live value or stays null, and
    // every hook call resolves to a sensible default
    // through the same code path.
  }, [ctx])
  const setFallbackPersistRuns = useCallback((next: boolean) => {
    setFallback(next)
  }, [])

  if (ctx) return ctx
  return { persistRuns: fallback, setPersistRuns: setFallbackPersistRuns }
}

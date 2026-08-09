// State helpers for the bundled-demo-API toggle. Kept in its
// own module so `useDemoStatus.tsx` can stay purely declarative
// (React components only) — moving the hook + context here
// resolves the `react(only-export-components)` lint warning
// that fires when a `.tsx` file exports anything besides
// components.
import { createContext, useCallback, useContext, useState } from 'react'
import type { DemoStatus } from './demoStatus.ts'

export type DemoStatusContextValue = {
  status: DemoStatus
  setEnabled: (next: boolean) => Promise<void>
}

// The context lives in this module so both the hook and the
// provider component (declared in `useDemoStatus.tsx`) can
// import the same instance. Without this, the provider would
// fall back to a fresh context and consumers would never see
// the live value.
export const DemoStatusContext = createContext<DemoStatusContextValue | null>(null)

/**
 * Hook + context that exposes the bundled demo-API status and
 * lets the Settings drawer flip it. The state is owned by the
 * backend (`DemoControllerToggle`); the hook mirrors the
 * backend's view so the toolbar, the drawer and the traffic
 * dashboard all see the same `enabled` flag without each one
 * issuing its own `fetch`.
 */
export function useDemoStatus(): DemoStatusContextValue {
  const ctx = useContext(DemoStatusContext)
  // Without a provider the hook falls back to a local in-memory
  // state. This is what makes `<DemoTrafficPage />` safe to
  // render in isolation (e.g. from a unit test that does not
  // spin up the full app) — the page sees a sensible default
  // and the toolbar-style reads do not crash.
  const [fallback, setFallback] = useState<DemoStatus>({ enabled: false, loaded: true })
  const setFallbackEnabled = useCallback(async (next: boolean) => {
    setFallback({ enabled: next, loaded: true })
  }, [])

  if (ctx) return ctx
  return { status: fallback, setEnabled: setFallbackEnabled }
}

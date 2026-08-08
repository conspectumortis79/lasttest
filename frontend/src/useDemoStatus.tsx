// Hook + context that exposes the bundled demo-API status and
// lets the Settings drawer flip it. The state is owned by the
// backend (`DemoControllerToggle`); the hook mirrors the
// backend's view so the toolbar, the drawer and the traffic
// dashboard all see the same `enabled` flag without each one
// issuing its own `fetch`.
//
// Persistence mirrors the `useLanguage` pattern: the user's
// last choice lives in `localStorage` under a stable key so a
// page refresh / app restart restores the same state. The
// backend is the source of truth while the page is open, the
// localStorage value is the source of truth across restarts.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  fetchDemoStatus,
  readStoredDemoEnabled,
  setDemoEnabled as setDemoEnabledOnServer,
  writeStoredDemoEnabled,
  type DemoStatus,
} from './demoStatus.ts'

type DemoStatusContextValue = {
  status: DemoStatus
  setEnabled: (next: boolean) => Promise<void>
}

const DemoStatusContext = createContext<DemoStatusContextValue | null>(null)

export function DemoStatusProvider({ children }: { children: ReactNode }) {
  // `useState` is seeded from `localStorage` so the very first
  // render reflects the user's last choice. The flag flips to
  // `true` after the first backend roundtrip — until then, the
  // auto-loading effect in `LoadTestApp` stays idle and waits
  // for the backend to confirm the choice.
  const [status, setStatus] = useState<DemoStatus>(() => ({
    enabled: readStoredDemoEnabled(),
    loaded: false,
  }))

  const setEnabled = useCallback(async (next: boolean) => {
    // Optimistic update: the UI flips the badge / switch the
    // moment the user clicks. The real write happens in the
    // background; the dashboard's polling loop reconciles the
    // backend-reported state on the next tick, so the UI never
    // gets stuck on a stale value when the write fails.
    setStatus(prev => ({ enabled: next, loaded: prev.loaded }))
    const reported = await setDemoEnabledOnServer(next)
    setStatus({ enabled: reported.enabled, loaded: true })
  }, [])

  // On every change of the boolean we mirror it into
  // `localStorage`. The effect is intentionally simple — a
  // single setter call, no debouncing — because the value
  // changes at most once per user gesture.
  useEffect(() => {
    writeStoredDemoEnabled(status.enabled)
  }, [status.enabled])

  useEffect(() => {
    // The first effect synchronises the backend with the value
    // we read from `localStorage` (e.g. the user enabled the
    // demo, refreshed the page, and the backend came up with
    // the toggle off). Without this step the toolbar would
    // show the link, the drawer would show the switch on, but
    // the controller would 404 every request.
    let cancelled = false
    void (async () => {
      try {
        const local = readStoredDemoEnabled()
        const backend = await fetchDemoStatus()
        if (cancelled) return
        if (local !== backend.enabled) {
          // `local` wins — the user toggled it that way, the
          // backend just has not been told yet. We push the
          // value through `setEnabled` so the optimistic
          // state in the provider and the backend line up.
          await setDemoEnabledOnServer(local)
        }
        setStatus({ enabled: local, loaded: true })
      } catch {
        if (cancelled) return
        // The backend is unreachable; the in-memory state
        // remains the localStorage value, the toolbar / drawer
        // still show the right thing for this session.
        setStatus({ enabled: readStoredDemoEnabled(), loaded: true })
      }
    })()
    return () => { cancelled = true }
  }, [])

  const value = useMemo<DemoStatusContextValue>(() => ({ status, setEnabled }), [status, setEnabled])
  return <DemoStatusContext.Provider value={value}>{children}</DemoStatusContext.Provider>
}

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

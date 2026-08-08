import { useEffect, useState } from 'react'
import type { TestRun } from './k6Report.ts'

// Keep a local "now" timestamp that is refreshed every 500 ms while
// at least one entity is "live". The hook is split in two:
//
//   • `useLiveClock(live: boolean)` is the reusable primitive —
//     it ticks whenever `live` flips to true, stops when it flips
//     to false. Drives everything from the dashboard grid (which
//     has to tick when *any* run is in flight) to per-row
//     stopwatches.
//   • `useRunClock(run)` is a thin compatibility wrapper that
//     derives the `live` boolean from a single `TestRun`. The
//     existing callers (the detail card, the live status view)
//     keep their original signature; the new grid code goes
//     straight to `useLiveClock` so it can drive a global
//     ticker independent of the focused run.
//
// Extracted into its own file so the React components stay clean
// under `only-export-components`.

const TICK_INTERVAL_MS = 500

export function useLiveClock(live: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!live) return
    const timer = window.setInterval(() => setNow(Date.now()), TICK_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [live])
  return now
}

export function useRunClock(run: TestRun | undefined): number {
  const live = run != null && (run.status === 'QUEUED' || run.status === 'RUNNING')
  return useLiveClock(live)
}

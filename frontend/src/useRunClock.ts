import { useEffect, useState } from 'react'
import type { TestRun } from './k6Report.ts'

// Keep a local "now" timestamp that is refreshed every 500 ms while
// the run is QUEUED or RUNNING. Once the run reaches a terminal state
// (COMPLETED / FAILED) the ticker is stopped so no invisible re-renders
// happen after the run has ended.
//
// Extracted into its own file so the React components in
// `runStatusView.tsx` stay clean under `only-export-components`.

const TICK_INTERVAL_MS = 500

export function useRunClock(run: TestRun | undefined): number {
  const [now, setNow] = useState(() => Date.now())
  const isLive = run != null && (run.status === 'QUEUED' || run.status === 'RUNNING')
  useEffect(() => {
    if (!isLive) return
    const timer = window.setInterval(() => setNow(Date.now()), TICK_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [isLive])
  return now
}

import { useEffect, useState } from 'react'
import type { TestRun } from './k6Report.ts'

// Halten einen eigenen „now"-Timestamp, der im 500-ms-Takt aktualisiert
// wird, solange der Run in QUEUED oder RUNNING ist. Sobald der Run
// terminal ist (COMPLETED / FAILED), wird der Ticker gestoppt, damit
// nach dem Ende keine unsichtbaren Re-Renders mehr passieren.
//
// Ausgelagert in eine eigene Datei, damit die React-Komponenten in
// `runStatusView.tsx` unter `only-export-components` sauber bleiben.

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

// Pure helper that fetches the per-operation "× N" statistics from
// the backend. The dashboard renders one of these as a small badge
// next to each endpoint, so the user can see at a glance which
// operations have been exercised before.
//
// The endpoint is `/api/operations/stats` and returns one
// [OperationStats] entry per (method, path) pair. The hook polls
// on the same cadence as the run dashboard so the count stays in
// sync with new runs.

import { useCallback, useEffect, useState } from 'react'
import { translate, type SupportedLanguage } from './i18n.ts'

/**
 * The backend's `TestRunStatus` is an enum on the JVM side; on the
 * wire it serialises to the literal string ("QUEUED", "RUNNING",
 * "COMPLETED", etc.). The frontend types [TestRun.status] as plain
 * `string` for forward-compat with statuses the server may add in
 * later releases (see k6Report.ts:186). We do the same here so
 * the dashboard does not have to know every status the backend
 * can emit.
 */
export type OperationStats = {
  method: string
  path: string
  testCount: number
  lastStatus: string
  lastTestAt: string
  lastRunId: string
}

type Options = {
  /** Polling interval in ms. 0 disables polling. Default 5 s. */
  intervalMs?: number
  language?: SupportedLanguage
}

/**
 * Subscribes to the operation-statistics feed. The hook returns the
 * current snapshot and a [refresh] callback the caller can invoke
 * to force a re-fetch (used by the "Start k6 run" handler so the
 * × N count updates immediately after the run is queued).
 */
export function useOperationStats(
  options: Options = {},
): {
  stats: OperationStats[]
  isLoading: boolean
  error: string
  refresh: () => void
} {
  const intervalMs = options.intervalMs ?? 5_000
  const [stats, setStats] = useState<OperationStats[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (intervalMs <= 0) return
    const timer = window.setInterval(() => setTick(value => value + 1), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    fetch('/api/operations/stats')
      .then(async response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return (await response.json()) as OperationStats[]
      })
      .then(data => {
        if (cancelled) return
        setStats(data)
        setError('')
      })
      .catch(reason => {
        if (cancelled) return
        setError(translate(options.language ?? 'en', 'lastRuns.fetchError', { reason: String(reason) }))
      })
      .finally(() => {
        if (cancelled) return
        setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [tick, options.language])

  const refresh = useCallback(() => setTick(value => value + 1), [])

  return { stats, isLoading, error, refresh }
}

/**
 * Looks up the "× N" test count for a single (method, path) pair.
 * Returns 0 if the endpoint has not been seen before. The dashboard
 * uses this to render the badge text without having to thread the
 * whole list through props.
 */
export function findTestCount(
  stats: OperationStats[],
  method: string,
  path: string,
): number {
  const match = stats.find(entry => entry.method === method && entry.path === path)
  return match?.testCount ?? 0
}

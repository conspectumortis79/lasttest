// Loader and type definitions for the demo-traffic dashboard. The
// dashboard polls a small JSON endpoint while a k6 run is in flight
// and shows the requests that actually reached the bundled demo
// API. The endpoint is read-only; the interceptor populates the
// storage on the server side, this module only fetches snapshots.

/**
 * One captured demo-API request. The fields mirror the server-side
 * `DemoTrafficEntryResponse` shape so the consumer does not have to
 * translate between camelCase and snake_case.
 */
export type DemoTrafficEntry = {
  /** ISO-8601 UTC timestamp. */
  timestamp: string
  /** HTTP method, upper-case. */
  method: string
  /** Request path without query string. */
  path: string
  /** Raw query string (without leading `?`) or `null` when absent. */
  queryString: string | null
  /** Response status code. */
  status: number
  /** `User-Agent` header value or `null` when not sent. */
  userAgent: string | null
  /** Value of the `X-Lasttest-Run-Id` header or `null` when not
   *  driven by a k6 run. The dashboard uses this to filter. */
  runId: string | null
}

/**
 * Wire envelope returned by `GET /api/demo-traffic/requests`.
 * `count` is the actual number of entries returned (post-limit,
 * post-filter) so the dashboard can show "showing N of M" without
 * an extra round-trip.
 */
export type DemoTrafficResponse = {
  runId: string | null
  limit: number
  count: number
  entries: DemoTrafficEntry[]
}

/**
 * Empty response used as the initial state of the dashboard and
 * as the fallback for any error path. `count: 0` and an empty
 * `entries` array keep the render tree stable.
 */
export const EMPTY_DEMO_TRAFFIC: DemoTrafficResponse = {
  runId: null,
  limit: 500,
  count: 0,
  entries: [],
}

/**
 * Fetches the current demo traffic snapshot. Returns
 * [EMPTY_DEMO_TRAFFIC] on any error so the dashboard can fall back
 * gracefully — a transient backend hiccup must not blank out the
 * whole page.
 *
 * @param runId optional filter; when set, only entries with that
 *              run id are returned. When omitted, the global
 *              stream comes back.
 */
export async function fetchDemoTraffic(runId?: string | undefined): Promise<DemoTrafficResponse> {
  try {
    const params = new URLSearchParams()
    if (runId && runId.trim() !== '') params.set('runId', runId.trim())
    const query = params.toString()
    const url = `/api/demo-traffic/requests${query ? `?${query}` : ''}`
    const response = await fetch(url)
    if (!response.ok) return EMPTY_DEMO_TRAFFIC
    const data = (await response.json()) as DemoTrafficResponse
    return data
  } catch {
    return EMPTY_DEMO_TRAFFIC
  }
}

/**
 * Outcome of [clearDemoTraffic]. The dashboard uses the
 * discriminated `kind` to decide whether to swap its local state
 * for the server's empty envelope (`cleared`) or to surface an
 * error message (`failed`). The `response` field is only populated
 * on success; on failure the caller keeps whatever it had before.
 */
export type ClearDemoTrafficResult =
  | { kind: 'cleared', response: DemoTrafficResponse }
  | { kind: 'failed' }

/**
 * Drops every captured demo request and returns the empty
 * envelope the server emits after the wipe. Mirrors the
 * [fetchDemoTraffic] contract: a network failure is reported via
 * the discriminated `kind` instead of throwing, so the dashboard
 * can keep its current state and show an error message without
 * leaving the polling loop in a torn state.
 */
export async function clearDemoTraffic(): Promise<ClearDemoTrafficResult> {
  try {
    const response = await fetch('/api/demo-traffic/requests', { method: 'DELETE' })
    if (!response.ok) return { kind: 'failed' }
    const data = (await response.json()) as DemoTrafficResponse
    return { kind: 'cleared', response: data }
  } catch {
    return { kind: 'failed' }
  }
}

/**
 * Formats an ISO-8601 timestamp as the dashboard's compact
 * "HH:MM:SS.mmm" string. Sub-second precision matters for high-RPS
 * smoke tests where two requests can land within the same wall-
 * clock second; without milliseconds, the table would show
 * duplicates that hide the actual call rate.
 *
 * The hour/minute/second parts are rendered in the **user's local
 * time zone** — i.e. whatever the browser host is configured to —
 * so the column matches the wall-clock time the user sees on
 * their machine. The wire format itself stays ISO-8601 UTC (server
 * emits `Instant.now().toString()`), only the rendered time is
 * local. The millisecond part is timezone-independent (the same
 * instant always has the same `.mmm` value), so we read it via
 * `getUTCMilliseconds()` for convenience.
 */
export function formatTrafficTimestamp(timestamp: string): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return timestamp
  const time = date.toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const millis = date.getUTCMilliseconds().toString().padStart(3, '0')
  return `${time}.${millis}`
}

/**
 * Groups status codes into CSS-friendly buckets so the table can
 * colour the status cell without re-implementing the
 * "200 vs 4xx vs 5xx" rule. The exact codes follow the same
 * tracking list the k6 script generator uses for the per-status
 * counters (see `DefaultK6ScriptGenerator`), so a code that the
 * generator tracks is also one the dashboard can colour.
 */
export function statusBucket(status: number): 'success' | 'redirect' | 'client-error' | 'server-error' | 'other' {
  if (status >= 200 && status < 300) return 'success'
  if (status >= 300 && status < 400) return 'redirect'
  if (status >= 400 && status < 500) return 'client-error'
  if (status >= 500 && status < 600) return 'server-error'
  return 'other'
}

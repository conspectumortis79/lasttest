type ReportParameterValue = { name: string, location: string, value: string }

type ReportPayload = {
  parameterValues: ReportParameterValue[]
  requestBodyJson?: string
  bearerTokenConfigured?: boolean
  basicAuthConfigured?: boolean
  apiKeyConfigured?: boolean
  oauth2TokenConfigured?: boolean
}

type ReportPayloadUsage = {
  /** Zero-based index into the operation's `payloads` list. */
  index: number
  /** How many times k6 actually picked this payload during the run. */
  count: number
}

/**
 * Reads the per-payload call counters from a k6 summary. The k6
 * generator emits one counter per payload index per operation
 * (`lt_payload_<i>_<safe>`); the export exposes them under
 * `metrics.<name>.count`. Returns an empty array when no counters
 * are present (single-payload runs, legacy runs, or runs that
 * crashed before any iteration).
 */
export function extractPayloadUsage(run: TestRun, operationId: string): ReportPayloadUsage[] {
  const raw = run.summary?.raw
  if (typeof raw !== 'string' || raw.length === 0) return []
  let summary: { metrics?: Record<string, { count?: number }> }
  try {
    summary = JSON.parse(raw) as { metrics?: Record<string, { count?: number }> }
  } catch {
    return []
  }
  const prefix = `lt_payload_`
  const suffix = `_${operationId}`
  const usages: ReportPayloadUsage[] = []
  for (const [name, value] of Object.entries(summary.metrics ?? {})) {
    if (!name.startsWith(prefix) || !name.endsWith(suffix)) continue
    const middle = name.slice(prefix.length, name.length - suffix.length)
    // parseInt returns NaN for non-numeric middles. Both `NaN` and
    // negative integers are out of range, so we guard with a single
    // `Number.isInteger && >= 0` check.
    const index = Number.parseInt(middle, 10)
    if (!Number.isInteger(index) || index < 0) continue
    // `value.count` is typed `number | undefined`. Guarding with
    // Number.isFinite first (which accepts number | undefined in
    // our local cast below) and falling back to zero mirrors the
    // behaviour we want without leaning on `as`.
    const rawCount: number | undefined = value.count
    const count = typeof rawCount === 'number' && Number.isFinite(rawCount) ? rawCount : 0
    usages.push({ index, count })
  }
  usages.sort((a, b) => a.index - b.index)
  return usages
}

export type ReportOperation = {
  operationId: string
  method: string
  path: string
  summary: string
  parameterValues: ReportParameterValue[]
  requestBodyJson?: string
  bearerTokenConfigured: boolean
  /**
   * True when at least one payload in the run had a non-blank
   * Basic auth username or password. The report uses this to
   * render the "Basic auth: configured / not configured" line.
   * Older reports (pre-Basic-auth feature) won't carry this
   * field; the default of `false` keeps the rendering in line
   * with the historical behaviour.
   */
  basicAuthConfigured?: boolean
  /**
   * True when at least one payload in the run had a non-blank
   * API key. The report uses this to render the "API key:
   * configured / not configured" line.
   */
  apiKeyConfigured?: boolean
  /**
   * True when at least one payload in the run had a non-blank
   * OAuth 2.0 access token. The report uses this to render the
   * "OAuth 2.0: configured / not configured" line.
   */
  oauth2TokenConfigured?: boolean
  /**
   * All payloads that were configured for this endpoint at the time
   * the run was started. The report lists every entry so the user
   * can see exactly which datasets k6 cycled through or sampled
   * from. Empty for legacy runs that pre-date the pool feature —
   * the report falls back to the flat `parameterValues` /
   * `requestBodyJson` fields in that case.
   */
  payloads: ReportPayload[]
}

type ReportPayloadStrategy = 'sequential' | 'random'

/**
 * Renders the human-readable label for the payload strategy the run
 * was started with. Falls back to a sensible default for legacy runs
 * that pre-date the pool feature.
 */
export function renderPayloadStrategyLabel(strategy: ReportPayloadStrategy | string | null | undefined): string {
  switch (strategy) {
    case 'random':
      return 'Zufällig'
    case 'sequential':
    case null:
    case undefined:
      return 'Sequenziell'
    default:
      return strategy
  }
}

/**
 * One-line description of the strategy so the user can see at a
 * glance what the generator actually did during the run.
 */
export function renderPayloadStrategyHelp(strategy: ReportPayloadStrategy | string | null | undefined): string {
  switch (strategy) {
    case 'random':
      return 'Pro Iteration ein zufälliger Payload aus dem Pool des Endpunkts.'
    case 'sequential':
      return '1, 2, …, letzter, dann wieder 1 — Round-Robin mit Wrap-Around.'
    case null:
    case undefined:
      return 'Standard-Verhalten: jeder Endpunkt mit einem einzigen Datensatz.'
    default:
      return ''
  }
}

// Wire shape of a load profile. Mirrors `LoadProfile` from
// `./loadProfile.ts` but stays a structural type so the report module
// does not need to depend on the editor-side helper. Adding a new
// executor only requires extending this union, the serialiser and the
// renderer — the report only reads the discriminator and the fields it
// already knows about.
//
// We accept both spellings for `type`: `RAMPING_VUS` (as serialised
// by the backend) and `ramping-vus` (kebab-case, executor name). A
// normalising `type` below ensures that all downstream switch
// statements can work case-insensitively.
export type ReportLoadProfile = {
  type: 'ramping-vus' | 'RAMPING_VUS' | 'constant-vus' | 'CONSTANT_VUS' | 'shared-iterations' | 'SHARED_ITERATIONS' | 'constant-arrival-rate' | 'CONSTANT_ARRIVAL_RATE' | 'ramping-arrival-rate' | 'RAMPING_ARRIVAL_RATE'
  virtualUsers?: number
  durationSeconds?: number
  iterations?: number
  startVUs?: number
  stages?: ReportLoadStage[]
  rate?: number
  startRate?: number
  timeUnitSeconds?: number
  preAllocatedVUs?: number
  maxVUs?: number
}

export type ReportLoadStage = { target: number, durationSeconds: number }

type TestRunConfiguration = {
  apiTitle: string
  apiVersion: string
  baseUrl: string
  loadProfile: ReportLoadProfile
  /**
   * Echo of the load profile's payload strategy at the time the run
   * was started. `null` (or missing on the wire) means the run was
   * started before the pool feature shipped; the report renders
   * those as `Sequenziell` (default) with a note that the pool is
   * not in play.
   */
  payloadStrategy?: ReportPayloadStrategy | string | null
  operations: ReportOperation[]
}

export type TestRun = {
  id: string
  /**
   * Lifecycle state. The known values are exported from the
   * backend (`TestRunStatus` in Kotlin):
   *   QUEUED, RUNNING, STOPPING          (in-flight)
   *   COMPLETED, FAILED, STOPPED, ABORTED (terminal)
   * The status is intentionally typed as `string` here because
   * older clients may receive runs whose status was added after
   * they were last deployed; the dashboard routes on `===` checks
   * against the documented literals below.
   */
  status: string
  createdAt: string
  startedAt?: string
  finishedAt?: string
  exitCode?: number
  configuration?: TestRunConfiguration
  summary?: { raw: string }
  /**
   * Raw (truncated) k6 output. Populated by the backend in both the
   * success and failure cases so the UI can always show the
   * "k6 console" block. `null` if k6 could not be started at all
   * (the diagnosis is then in `error`).
   */
  consoleOutput?: string
  error?: string
  /**
   * Wall-clock instant at which the user asked for cancellation.
   * Set together with [cancelledByForce] when the run was stopped
   * or aborted by the operator (rather than having run its full
   * course). `undefined` for runs that were never cancelled.
   */
  cancelledAt?: string
  /**
   * `true` if the user forced the run to abort (SIGKILL), `false`
   * for a graceful stop (SIGTERM that was honoured by k6). Only
   * meaningful in combination with [cancelledAt].
   */
  cancelledByForce?: boolean
  /**
   * Echoed snapshot of the request that started this run. The
   * frontend does not read it — the rerun endpoint takes care of
   * that server-side — but the field is included so debugging
   * tools and future features can inspect what produced the run
   * without having to call a second endpoint.
   */
  originalRequest?: unknown
}

// Failure categories surfaced by summarizeFailure. The ordering is
// significant: each predicate runs in order so that a more specific
// signal (e.g. a k6-binary problem) wins over a more generic one
// (e.g. unknown error text) when both could match.
type FailureCategory =
  | 'k6-missing' // H. Java IOException: "Cannot run program \"k6\""
  | 'tls' // B. CERT_AUTHORITY_INVALID, x509, PKIX, certificate verify failed
  | 'unreachable' // A. ERR_CONNECTION_REFUSED, "connection refused"
  | 'dns' // A-variant. ENOTFOUND, EAI_AGAIN — distinguished from above
  | 'timeout' // C. context deadline exceeded, i/o timeout
  | 'script' // G. ReferenceError, GoError, "script exception"
  | 'server5xx' // D. summary shows a majority of 5xx responses
  | 'threshold-latency' // E. http_req_duration p(95) > 1000 ms
  | 'threshold-failure-rate' // F. http_req_failed.value > 0.05
  | 'unknown' // I. fallback when nothing else matches

type FailureSummary = {
  category: FailureCategory
  // Short headline shown next to the status badge, e.g. "Target unreachable".
  diagnosis: string
  // Concrete value the user can act on, e.g. "Connection refused on http://127.0.0.1:1".
  detail: string
  // Bullet points explaining the conclusion with concrete evidence drawn
  // from run.error and run.summary. Empty when there is nothing useful.
  reasons: string[]
}

// One labelled value in the metric row beneath the status badge.
type MetricItem = {
  label: string
  value: string
  severity: 'normal' | 'error' | 'warn' | 'muted'
}

export type K6Metric = {
  avg?: number
  min?: number
  med?: number
  max?: number
  'p(90)'?: number
  'p(95)'?: number
  count?: number
  rate?: number
  value?: number
  passes?: number
  fails?: number
  thresholds?: Record<string, boolean>
}

export type K6Summary = {
  metrics: Record<string, K6Metric>
  root_group?: {
    checks?: Record<string, { name: string, passes: number, fails: number }>
  }
}

export function parseK6Summary(run: TestRun): K6Summary | undefined {
  if (!run.summary?.raw) return undefined
  try {
    const parsed: unknown = JSON.parse(run.summary.raw)
    if (!isRecord(parsed) || !isRecord(parsed.metrics)) return undefined
    return parsed as K6Summary
  } catch {
    return undefined
  }
}

export function metric(summary: K6Summary, name: string): K6Metric {
  return summary.metrics[name] ?? {}
}

export function completedRequestCount(summary: K6Summary): number | undefined {
  const count = metric(summary, 'http_reqs').count
  return count != null && Number.isFinite(count) ? count : undefined
}

// Per-operation status-code counts extracted from the Counter metrics
// generated by `DefaultK6ScriptGenerator`. The metric name format is
// `lt_status_{<code>|err|other}_<operationId>`, where `<code>` is one
// of TRACKED_STATUS_CODES (e.g. 200, 401, 429) and `err` covers
// network errors (status === 0). `other` catches any status code
// that the generator did not pre-declare, so unexpected responses
// still surface in the report.
//
// k6's --summary-export does NOT expose tagged sub-metrics, which is
// why the generator declares one Counter per (operation, code) tuple
// rather than tagging a single Counter per operation.
export const TRACKED_STATUS_CODES = [
  200, 201, 202, 204, // 2xx success
  301, 302, 304, // 3xx redirect
  400, 401, 403, 404, 409, 422, 429, // 4xx client error
  500, 502, 503, 504, // 5xx server error
] as const
type TrackedStatusCode = (typeof TRACKED_STATUS_CODES)[number]

export const FALLBACK_CODES = ['err', 'other'] as const
type FallbackCode = (typeof FALLBACK_CODES)[number]

// Every column the report knows about. We keep `err` last so the
// status-code columns stay grouped and the fallback columns visually
// detach from the main grid.
export const ALL_STATUS_CODES = [...TRACKED_STATUS_CODES, ...FALLBACK_CODES] as const

type StatusDistributionRow = {
  operationId: string
  // Indexed by string for ergonomic lookup in the React component.
  // Numeric keys are the tracked status codes, `"err"` and `"other"`
  // are the fallback buckets.
  counts: Record<string, number>
  total: number
}

// Build the row for a single operation. Counts default to 0 so the
// table is fully populated even when a particular code never fired.
export function statusDistribution(summary: K6Summary, operationIds: string[]): StatusDistributionRow[] {
  return operationIds.map(operationId => {
    const counts: Record<string, number> = {}
    let total = 0
    for (const code of ALL_STATUS_CODES) {
      const name = `lt_status_${code}_${operationId}`
      const value = metric(summary, name).count
      const safe = value != null && Number.isFinite(value) ? value : 0
      counts[String(code)] = safe
      total += safe
    }
    return { operationId, counts, total }
  })
}

// Returns the subset of status codes that fired at least once across
// all rows, keeping the original code order so the table columns stay
// stable between runs. Fallback columns (`err`, `other`) are included
// by default because the detailed report wants to render them even
// when they never fired (a column header labelled "err" with a 0 in
// the row is the user's signal "no network failures during this
// run"). Surfaces that already show empty cells (the mini bar grid
// on the Übersicht tab) opt out via `{ includeFallbacks: false }`
// so a clean 200-only run does not also render two empty grey
// cells — but `err` / `other` still surface when they actually
// fired, so a network-failure-only run shows the user the err cell.
export function activeStatusCodes(
  rows: StatusDistributionRow[],
  options: { includeFallbacks?: boolean } = {},
): (TrackedStatusCode | FallbackCode)[] {
  const includeFallbacks = options.includeFallbacks ?? true
  const seen = new Set<string>()
  for (const row of rows) {
    for (const [code, count] of Object.entries(row.counts)) {
      if (count > 0) seen.add(code)
    }
  }
  return ALL_STATUS_CODES.filter(code => {
    const key = String(code)
    if (FALLBACK_CODES.includes(code as FallbackCode)) {
      // Fallback columns render either when the caller asked
      // for them unconditionally (default, detailed report)
      // or when the run actually produced network / unknown
      // responses (mini grid, which suppresses the always-on
      // empty cell but still surfaces real failures).
      return includeFallbacks || seen.has(key)
    }
    return seen.has(key)
  })
}

// Aggregate bucket for the overview's mini bar grid. One row per
// status code that fired in the run, regardless of which endpoint
// produced it. The bar grid renders the rows in the same order
// [activeStatusCodes] would have produced so the dashboard and the
// detailed report stay visually consistent.
export type StatusCodeTotal = {
  code: string
  count: number
}

// Build the aggregated status-code totals across every operation
// in the run. The function takes the rows from [statusDistribution]
// (one per operation) and sums the per-code counts so the overview
// tab can render a single, run-wide bar grid without having to
// re-parse the k6 summary. Without this helper the mini grid would
// either need its own summary traversal (duplicate work) or show
// one grid per endpoint (visually noisy on multi-endpoint runs).
//
// The mini bar grid only shows codes that actually fired: a clean
// 200-only run must not also surface empty `err` and `other`
// cells. The detailed report keeps the opposite behaviour
// (always show the fallback columns) and calls
// [activeStatusCodes] directly.
export function statusCodeTotals(rows: StatusDistributionRow[]): StatusCodeTotal[] {
  const totals: Record<string, number> = {}
  for (const code of ALL_STATUS_CODES) totals[String(code)] = 0
  for (const row of rows) {
    for (const [code, count] of Object.entries(row.counts)) {
      totals[code] = (totals[code] ?? 0) + count
    }
  }
  return statusCodeTotalsFromMap(rows, totals)
}

// Extracted helper: given an already-populated `totals` map, emit
// the run-wide list. Splitting the two pieces means the test
// suite can exercise the `count === undefined` fallback branch
// by feeding a `totals` map that is missing the entry the
// helper looks up — without having to monkey-patch the
// pre-population loop in production code.
export function statusCodeTotalsFromMap(
  rows: StatusDistributionRow[],
  totals: Record<string, number>,
): StatusCodeTotal[] {
  return activeStatusCodes(rows, { includeFallbacks: false }).map(code => {
    const count = totals[String(code)] ?? 0
    return { code: String(code), count }
  })
}

// Returns the run-wide request count, summed over every
// operation. Mirrors what [statusCodeTotals] renders in the
// mini grid's "Gesamt" header; pulling it out into a helper
// keeps the React component focused on the presentation
// layer instead of re-doing the sum on every render.
export function totalRequestCount(rows: StatusDistributionRow[]): number {
  let total = 0
  for (const row of rows) total += row.total
  return total
}

export function checkSuccessRate(summary: K6Summary): number | undefined {
  const checks = metric(summary, 'checks')
  const total = (checks.passes ?? 0) + (checks.fails ?? 0)
  return total > 0 ? (checks.passes ?? 0) / total * 100 : undefined
}

export function formatNumber(value: number | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return '–'
  return new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value)
}

export function formatInteger(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return '–'
  return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(value)
}

export function formatBytes(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return '–'
  const units = ['B', 'KiB', 'MiB', 'GiB']
  let amount = value
  let unit = units[0]
  for (const candidate of units) {
    unit = candidate
    if (amount < 1024 || candidate === units.at(-1)) break
    amount /= 1024
  }
  return `${formatNumber(amount)} ${unit}`
}

export function formatTimestamp(value: string | undefined): string {
  if (!value) return '–'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '–'
  return new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'Europe/Berlin',
  }).format(date)
}

export function k6ScriptUrl(runId: string): string {
  return `/api/test-runs/${encodeURIComponent(runId)}/script`
}

export function k6ScriptDownloadName(runId: string): string {
  return `lasttest-${runId}.js`
}

export function manualK6Command(configuration: TestRunConfiguration | undefined, runId: string): string {
  const baseUrl = configuration?.baseUrl ?? 'https://target.example'
  return `k6 run -e BASE_URL=${JSON.stringify(baseUrl)} ${k6ScriptDownloadName(runId)}`
}

// Total runtime of a load profile, in seconds. Used by the report to show
// how long the k6 run was actually scheduled for. For constant-vus and
// arrival-rate this is just the explicit duration; for shared-iterations
// we return undefined because the test stops as soon as the last iteration
// completes, which the user already sees via the "completed at" timestamp.
//
// Normalises the `type` to kebab-case so the switch works
// case-insensitively (`RAMPING_VUS` from the backend becomes
// `ramping-vus`).
function normalizedType(profile: ReportLoadProfile): string {
  return profile.type.toLowerCase().replace(/_/g, '-')
}

export function profileTotalSeconds(profile: ReportLoadProfile): number | undefined {
  switch (normalizedType(profile)) {
    case 'constant-vus':
      return profile.durationSeconds ?? 0
    case 'constant-arrival-rate':
      return profile.durationSeconds ?? 0
    case 'ramping-vus':
      return (profile.stages ?? []).reduce((sum, stage) => sum + stage.durationSeconds, 0)
    case 'ramping-arrival-rate':
      return (profile.stages ?? []).reduce((sum, stage) => sum + stage.durationSeconds, 0)
    case 'shared-iterations':
      return undefined
    default:
      return undefined
  }
}

export function profileSummary(profile: ReportLoadProfile): string {
  switch (normalizedType(profile)) {
    case 'constant-vus':
      return `Konstante Last · ${profile.virtualUsers ?? '?'} VUs über ${profile.durationSeconds ?? '?'} s`
    case 'shared-iterations':
      return `Burst-Modus · ${profile.iterations ?? '?'} Iterationen`
    case 'ramping-vus': {
      const stages = profile.stages ?? []
      const peak = stages.reduce((max, stage) => Math.max(max, stage.target), profile.startVUs ?? 0)
      return `Ramping-VUs · ${stages.length} Stages, Spitze ${peak} VUs`
    }
    case 'constant-arrival-rate':
      return `Constant-Arrival-Rate · ${profile.rate ?? '?'} Anfragen/${profile.timeUnitSeconds ?? '?'}s über ${profile.durationSeconds ?? '?'} s`
    default:
      return 'Unbekanntes Lastprofil'
  }
}

// ---- Runtime display -------------------------------------------------------
//
// Pure helpers that compute the user-visible time from
// `startedAt`/`finishedAt` and the load profile. `now` is an optional
// parameter so tests can run deterministically — the UI passes its
// own tick state so the display updates without polling.

const ZERO_SECONDS = 0
const SECONDS_PER_MINUTE = 60
const SECONDS_PER_HOUR = 3600

// Seconds as "MM:SS" or "H:MM:SS" (e.g. "01:23", "1:02:03").
// Negative or NaN values render as "–". `null` is accepted (not
// just `undefined`) because the body short-circuits via `seconds
// == null`, which is true for both. Callers that have an explicit
// `null` (e.g. from a JSON field that was `null` on the wire) can
// pass it through without an extra `?? undefined` at the call site.
export function formatDurationSeconds(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '–'
  const total = Math.floor(seconds)
  const hours = Math.floor(total / SECONDS_PER_HOUR)
  const minutes = Math.floor((total % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE)
  const remainder = total % SECONDS_PER_MINUTE
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(remainder)}`
  return `${pad(minutes)}:${pad(remainder)}`
}

// Seconds as "X min Y s" / "Y s" / "H h M min S s". Used for the
// long form in cards and hint texts — more compact than "MM:SS" and
// easier to read in longer prose. Segments with value 0 are skipped
// so that "1 h 0 min 0 s" becomes "1 h". Accepts `null` for the same
// reason as `formatDurationSeconds` (see comment there).
export function formatDurationHuman(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '–'
  const total = Math.floor(seconds)
  if (total < SECONDS_PER_MINUTE) return `${total} s`
  const hours = Math.floor(total / SECONDS_PER_HOUR)
  const minutes = Math.floor((total % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE)
  const remainder = total % SECONDS_PER_MINUTE
  const parts: string[] = []
  if (hours > 0) parts.push(`${hours} h`)
  if (minutes > 0) parts.push(`${minutes} min`)
  if (remainder > 0) parts.push(`${remainder} s`)
  return parts.join(' ')
}

function pad(value: number): string {
  return value.toString().padStart(2, '0')
}

function parseTimestamp(value: string | undefined): number | undefined {
  if (!value) return undefined
  const milliseconds = new Date(value).getTime()
  return Number.isFinite(milliseconds) ? milliseconds : undefined
}

// Seconds since `startedAt`. Returns `undefined` while the run has
// not started yet (e.g. QUEUED). `now` is the reference (default
// Date.now()), injected via parameter so tests stay deterministic
// and the UI hook can pass in its own tick.
export function runElapsedSeconds(run: TestRun, now: number = Date.now()): number | undefined {
  const started = parseTimestamp(run.startedAt)
  if (started == null) return undefined
  const finished = parseTimestamp(run.finishedAt) ?? now
  return Math.max(ZERO_SECONDS, (finished - started) / 1000)
}

// Remaining seconds according to the load profile. Returns `undefined`
// when the run has not started yet or the profile has no predictable
// total duration (e.g. shared-iterations). While running, it is
// computed against `now`; once finished, against `finishedAt`, so
// downstream status displays never go negative.
export function runRemainingSeconds(run: TestRun, now: number = Date.now()): number | undefined {
  if (!run.configuration) return undefined
  const total = profileTotalSeconds(run.configuration.loadProfile)
  if (total == null) return undefined
  const elapsed = runElapsedSeconds(run, now)
  if (elapsed == null) return undefined
  return Math.max(ZERO_SECONDS, total - elapsed)
}

// ---- Failure analysis ------------------------------------------------------
//
// k6 writes typical GoError messages to stdout that contain the
// actual reason for a failed run. We parse the most important
// patterns and return a typed `FailureReason` so the UI can show a
// precise label and a targeted recommendation — instead of just the
// first (often generic) line.
//
// To extend: add another pattern in `matchFailurePattern` as a
// regular expression with `kind`, `buildSummary` and `buildDetail`.

export type FailureKind =
  | 'dns'
  | 'connection-refused'
  | 'connection-timeout'
  | 'tls'
  | 'http'
  | 'script'
  | 'process'
  | 'unknown'

export type FailureReason = {
  kind: FailureKind
  summary: string
  detail: string
  hint?: string
}

const FAILURE_HINT_BY_KIND: Record<Exclude<FailureKind, 'unknown'>, string> = {
  dns: 'Prüfe, ob der Hostname in der Base-URL korrekt geschrieben ist und ob DNS aus dem k6-Container erreichbar ist.',
  'connection-refused': 'Der Zielport ist nicht offen oder die Anwendung läuft nicht. Prüfe Firewall, Portweiterleitung und ob der Dienst gestartet ist.',
  'connection-timeout': 'Die Anfrage hat das Zeitlimit überschritten. Prüfe Routing, Firewall und ob das Ziel auf eingehende Verbindungen antwortet.',
  tls: 'Prüfe das Zertifikat des Ziels (Gültigkeit, Aussteller, Hostname). Eventuell fehlt eine CA oder das Zertifikat ist abgelaufen.',
  http: 'Der Server hat mit einem HTTP-Fehler geantwortet. Prüfe den Statuscode in der k6-Konsolenausgabe.',
  script: 'Das generierte k6-Skript enthält einen Fehler. Prüfe die k6-Konsolenausgabe auf die genaue Stelle.',
  process: 'k6 konnte nicht gestartet werden. Prüfe, ob die k6-Binary installiert und im PATH verfügbar ist.',
}

type FailurePattern = {
  kind: Exclude<FailureKind, 'unknown'>
  regex: RegExp
  buildSummary: (match: RegExpMatchArray) => string
  buildDetail: (match: RegExpMatchArray) => string
}

// Order matters: the first matching pattern wins. The script and
// HTTP patterns are therefore placed last because they are very
// broad.
const FAILURE_PATTERNS: readonly FailurePattern[] = [
  {
    kind: 'dns',
    // k6 v0.x / v1.x: "dial tcp[:PORT]: lookup HOST: <reason>"
    // k6 v2.x: "lookup HOST on <resolver>:<port>: <reason>" (Go's pure DNS error, no dial prefix)
    regex: /(?:dial tcp(?::\d+)?:\s*)?lookup ([^\s:]+)(?:\s+on\s+[0-9.:a-fA-F[\]]+)?:\s*(no such host|Temporary failure in name resolution|Server misbehaving)/i,
    buildSummary: match => `DNS-Auflösung fehlgeschlagen für „${match[1]}".`,
    buildDetail: match => `k6 konnte den Hostnamen ${match[1]} nicht auflösen (${match[2]}).`,
  },
  {
    kind: 'connection-refused',
    regex: /dial tcp ([0-9.]+|\[[0-9a-fA-F:]+\]|[^:]+):(\d+):\s*connect: connection refused/i,
    buildSummary: match => `Verbindung abgelehnt (${match[1]}:${match[2]}).`,
    buildDetail: match => `k6 hat „connection refused" von ${match[1]}:${match[2]} erhalten — der Zielport antwortet nicht.`,
  },
  {
    kind: 'connection-timeout',
    regex: /dial tcp ([0-9.]+|\[[0-9a-fA-F:]+\]|[^:]+):(\d+):\s*(i\/o timeout|context deadline exceeded)/i,
    buildSummary: match => `Verbindungs-Timeout zu ${match[1]}:${match[2]}.`,
    buildDetail: match => `k6 hat innerhalb des Zeitlimits keine Antwort von ${match[1]}:${match[2]} erhalten.`,
  },
  {
    kind: 'tls',
    regex: /x509:\s*([^\n]+)/i,
    buildSummary: match => `TLS-Handshake fehlgeschlagen: ${match[1].trim()}.`,
    buildDetail: match => `Das TLS-Zertifikat des Ziels wurde abgelehnt (${match[1].trim()}).`,
  },
  {
    kind: 'http',
    regex: /http response error.*?status code (\d{3})/i,
    buildSummary: match => `HTTP-Fehler ${match[1]} vom Server.`,
    buildDetail: match => `k6 hat einen HTTP-Status ${match[1]} als Fehler gewertet (Threshold oder harter Fehler).`,
  },
  {
    kind: 'script',
    regex: /(?:GoError: )?([^\n:]+\.js):(\d+):\d+\s+([^\n]+)/,
    buildSummary: match => `Skript-Fehler in ${match[1]} (Zeile ${match[2]}): ${match[3].trim()}`,
    buildDetail: match => `${match[1]}:${match[2]} — ${match[3].trim()}`,
  },
  {
    kind: 'process',
    regex: /(?:Cannot find k6|Cannot run program "?'?k6"?'?|k6: command not found|no such file or directory)/i,
    buildSummary: () => 'k6 konnte nicht gestartet werden.',
    buildDetail: () => 'Die k6-Binary wurde nicht gefunden oder ist nicht ausführbar.',
  },
] as const

// Takes the first non-empty line, strips an "ERRO[<seconds>]" prefix
// (which k6 prepends to every error message) and returns the cleaned
// text. The caller has already ensured that the input contains at
// least one non-whitespace character — so "empty" here is only a
// defensive fallback.
export function extractErrorLine(text: string): string {
  // We search from the end for the last non-empty line. This skips
  // recurring time-series output errors at the start of the k6
  // output and grabs the last, usually final, error.
  const lines = text.split(/\r?\n/).reverse()
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    const stripped = trimmed.replace(/^ERRO\[\d+\]\s*/, '')
    if (stripped.length > 0) return stripped
  }
  return text.trim()
}

export function summariseFailure(error: string | undefined | null): FailureReason | undefined {
  if (!error) return undefined
  const trimmed = error.trim()
  if (trimmed.length === 0) return undefined
  // We scan the error lines from the end because k6 output usually
  // starts with time-series output errors (e.g. InfluxDB writes)
  // and only later contains the actual test request errors. The
  // last error is the one that matters.
  const lines = trimmed.split(/\r?\n/).reverse()
  for (const pattern of FAILURE_PATTERNS) {
    for (const line of lines) {
      const match = line.match(pattern.regex)
      if (match) {
        return {
          kind: pattern.kind,
          summary: pattern.buildSummary(match),
          detail: pattern.buildDetail(match),
          hint: FAILURE_HINT_BY_KIND[pattern.kind],
        }
      }
    }
  }
  return {
    kind: 'unknown',
    summary: 'Test fehlgeschlagen.',
    detail: extractErrorLine(trimmed),
  }
}

// ---- SVG renderer for the ramp chart ---------------------------------------
//
// Pure functions with no React dependency so they can be unit-tested.
// They return strings that are embedded in an <svg>. The plot area
// is normalised to [0..width]×[0..height]; the caller adds axis
// padding (we compute internally against the plot area, not the
// viewBox).

export type RampPlot = {
  width: number
  height: number
  // Domain (in seconds, VUs/RPS)
  maxSeconds: number
  maxValue: number
  // Target line
  sollPoints: Array<{ seconds: number, value: number }>
  // Optional: actual line
  istPoints?: Array<{ seconds: number, value: number }>
}

const PLOT_PADDING = 4

function plotValue(plot: RampPlot, seconds: number, value: number): { x: number, y: number } {
  const x = (seconds / plot.maxSeconds) * (plot.width - 2 * PLOT_PADDING) + PLOT_PADDING
  const y = plot.height - PLOT_PADDING - (value / plot.maxValue) * (plot.height - 2 * PLOT_PADDING)
  return { x, y }
}

export function buildSollPath(plot: RampPlot): string {
  if (plot.sollPoints.length === 0) return ''
  return plot.sollPoints.map((point, index) => {
    const { x, y } = plotValue(plot, point.seconds, point.value)
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
  }).join(' ')
}

export function buildIstPath(plot: RampPlot): string {
  if (!plot.istPoints || plot.istPoints.length === 0) return ''
  return plot.istPoints.map((point, index) => {
    const { x, y } = plotValue(plot, point.seconds, point.value)
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
  }).join(' ')
}

// Converts ISO-8601 timestamps + values into plot points, normalising
// to `t0` (first timestamp = 0 s). When [ist] is empty, the function
// returns an object without `istPoints`, so the renderer only draws
// the target line.
export function buildRampPlot(
  profile: ReportLoadProfile,
  istVus: ReadonlyArray<{ time: string, value: number }>,
  options: { width: number, height: number } = { width: 720, height: 220 },
): RampPlot {
  const istVusSafe = istVus ?? []
  const maxSeconds = profileTotalSeconds(profile) ?? 60
  const sollPoints = buildSollPoints(profile)
  const peakSoll = sollPoints.reduce((max, point) => Math.max(max, point.value), 0)
  const peakIst = istVusSafe.reduce((max, point) => Math.max(max, point.value), 0)
  const maxValue = Math.max(peakSoll, peakIst, 1) * 1.1
  const t0 = istVusSafe.length > 0 ? new Date(istVusSafe[0].time).getTime() : 0
  const istPoints = istVusSafe.map(point => ({
    seconds: Math.max(0, (new Date(point.time).getTime() - t0) / 1000),
    value: point.value,
  }))
  const plot: RampPlot = {
    width: options.width,
    height: options.height,
    maxSeconds,
    maxValue,
    sollPoints,
  }
  if (istPoints.length > 0) plot.istPoints = istPoints
  return plot
}

function buildSollPoints(profile: ReportLoadProfile): Array<{ seconds: number, value: number }> {
  switch (normalizedType(profile)) {
    case 'ramping-vus': {
      const points: Array<{ seconds: number, value: number }> = []
      const stages = profile.stages ?? []
      let cursor = 0
      let previous = profile.startVUs ?? 0
      for (const stage of stages) {
        points.push({ seconds: cursor, value: previous })
        cursor += stage.durationSeconds
        points.push({ seconds: cursor, value: stage.target })
        previous = stage.target
      }
      return points
    }
    case 'ramping-arrival-rate': {
      // Same shape as `ramping-vus` but the y-axis unit is
      // requests/second, not VUs. The previous report left
      // this executor unhandled so the chart dropped the
      // target line entirely; with it, the user can finally
      // compare a spike/stress/soak test (lead-stress is the
      // main preset that uses this executor) against the
      // measured RPS — which is the whole point of using
      // arrival-rate in the first place.
      const points: Array<{ seconds: number, value: number }> = []
      const stages = profile.stages ?? []
      let cursor = 0
      let previous = profile.startRate ?? 0
      for (const stage of stages) {
        points.push({ seconds: cursor, value: previous })
        cursor += stage.durationSeconds
        points.push({ seconds: cursor, value: stage.target })
        previous = stage.target
      }
      return points
    }
    case 'constant-vus': {
      const vus = profile.virtualUsers ?? 0
      const duration = profile.durationSeconds ?? 0
      return [
        { seconds: 0, value: vus },
        { seconds: duration, value: vus },
      ]
    }
    case 'constant-arrival-rate': {
      // For the ramp chart, when using arrival-rate we show the
      // rate as a horizontal line so that actual (RPS) and target
      // (rate) are directly comparable.
      const rate = profile.rate ?? 0
      const duration = profile.durationSeconds ?? 0
      return [
        { seconds: 0, value: rate },
        { seconds: duration, value: rate },
      ]
    }
    case 'shared-iterations':
      // No meaningful target line because the duration is not predictable.
      return []
    default:
      return []
  }
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined
  if (!clipboard?.writeText) return false
  try {
    await clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export function operationDisplayPath(operation: ReportOperation): string {
  let path = operation.path
  for (const parameter of operation.parameterValues.filter(value => value.location === 'path')) {
    path = path.replace(`{${parameter.name}}`, parameter.value || `{${parameter.name}}`)
  }
  const query = operation.parameterValues
    .filter(value => value.location === 'query' && value.value.trim() !== '')
    .map(value => `${value.name}=${value.value}`)
    .join('&')
  return path + (query ? `?${query}` : '')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Failure-rate threshold above which a run is reported as failed.
const FAILURE_RATE_THRESHOLD = 0.05
// Latency threshold (in ms) above which a run is reported as failed.
export const LATENCY_THRESHOLD_MS = 1000
// Share of 5xx responses above which the failure is classified as a
// server-error run rather than a generic threshold failure.
const SERVER_ERROR_SHARE = 0.05

// Aggregated per-operation counts of all status codes plus the network
// (`err`) and unexpected (`other`) buckets. Used to summarise the
// run's failure shape in a few words.
type AggregateBucket = { code: string; count: number; operationId: string }

function aggregateStatusCodes(summary: K6Summary): AggregateBucket[] {
  const buckets: AggregateBucket[] = []
  for (const metricName of Object.keys(summary.metrics)) {
    const match = /^lt_status_(.+?)_(.+)$/.exec(metricName)
    if (!match) continue
    const code = match[1]
    const operationId = match[2]
    const value = summary.metrics[metricName].count
    if (value == null || !Number.isFinite(value) || value <= 0) continue
    buckets.push({ code, operationId, count: value })
  }
  return buckets
}

function countByStatusFamily(buckets: AggregateBucket[], familyPrefix: string): number {
  return buckets
    .filter(bucket => bucket.code.startsWith(familyPrefix))
    .reduce((sum, bucket) => sum + bucket.count, 0)
}

function networkErrorCount(buckets: AggregateBucket[]): number {
  return buckets
    .filter(bucket => bucket.code === 'err')
    .reduce((sum, bucket) => sum + bucket.count, 0)
}

// Largest single bucket of a given code family. Returns undefined when
// the family never fired.
function dominantBucket(buckets: AggregateBucket[], code: string): AggregateBucket | undefined {
  let best: AggregateBucket | undefined
  for (const bucket of buckets) {
    if (bucket.code !== code) continue
    if (!best || bucket.count > best.count) best = bucket
  }
  return best
}

// Most frequent error code across all per-operation buckets. Skips 2xx
// success codes so the headline reflects what actually failed.
function dominantErrorCode(buckets: AggregateBucket[]): AggregateBucket | undefined {
  let best: AggregateBucket | undefined
  for (const bucket of buckets) {
    if (bucket.code === '200' || bucket.code === '201' || bucket.code === '202' || bucket.code === '204') continue
    if (!best || bucket.count > best.count) best = bucket
  }
  return best
}

function hostnameFromUrl(value: string): string | undefined {
  try {
    return new URL(value).hostname
  } catch {
    return undefined
  }
}

// First non-empty line of the k6 output, truncated to keep the detail row
// on a single line in the UI. Returns undefined only when the input is empty
// or whitespace-only, which cannot happen for real k6 failures.
function shortErrorExcerpt(errorText: string): string | undefined {
  // split() always returns at least one element, so firstLine is always a string.
  const firstLine = errorText.split(/\r?\n/, 1)[0].trim()
  if (firstLine.length === 0) return undefined
  // 160 chars is roughly the width of a line in the UI; longer excerpts get
  // truncated to keep the detail row on a single line.
  if (firstLine.length <= 160) return firstLine
  return `${firstLine.slice(0, 159)}…`
}

// Classifies a failed run into a FailureCategory. The order of the
// predicates is significant — see FailureCategory.
function failureCategory(run: TestRun, summary: K6Summary | undefined): FailureCategory {
  const errorText = run.error ?? ''

  if (/Cannot run program/i.test(errorText)) {
    return 'k6-missing'
  }
  if (/CERT_|x509|PKIX|certificate verify failed|ERR_TLS/i.test(errorText)) {
    return 'tls'
  }
  if (/ERR_CONNECTION_REFUSED|connection refused/i.test(errorText)) {
    return 'unreachable'
  }
  if (/ENOTFOUND|EAI_AGAIN/i.test(errorText)) {
    return 'dns'
  }
  if (/deadline exceeded|i\/o timeout|context deadline/i.test(errorText)) {
    return 'timeout'
  }
  if (/script exception|ReferenceError|GoError/i.test(errorText)) {
    return 'script'
  }

  // No parseable error text → fall back to summary-driven categories.
  if (summary) {
    const totalRequests = completedRequestCount(summary) ?? 0
    if (totalRequests > 0) {
      const buckets = aggregateStatusCodes(summary)
      const fiveXxCount = countByStatusFamily(buckets, '5')
      const failureRate = metric(summary, 'http_req_failed').value ?? 0
      const p95 = metric(summary, 'http_req_duration')['p(95)'] ?? 0

      if (fiveXxCount / totalRequests > SERVER_ERROR_SHARE) {
        return 'server5xx'
      }
      if (p95 > LATENCY_THRESHOLD_MS) {
        return 'threshold-latency'
      }
      if (failureRate > FAILURE_RATE_THRESHOLD) {
        return 'threshold-failure-rate'
      }
    }
  }

  return 'unknown'
}

// Human-readable diagnosis + detail + bullet list for a given run.
export function summarizeFailure(run: TestRun): FailureSummary {
  const summary = parseK6Summary(run)
  const category = failureCategory(run, summary)
  const baseUrl = run.configuration?.baseUrl
  const errorText = run.error ?? ''
  const buckets = summary ? aggregateStatusCodes(summary) : []
  const totalRequests = summary ? completedRequestCount(summary) ?? 0 : 0
  const networkErrors = networkErrorCount(buckets)
  const failureRate = summary ? metric(summary, 'http_req_failed').value ?? 0 : 0
  const failureRatePercent = failureRate * 100
  const p95 = summary ? metric(summary, 'http_req_duration')['p(95)'] : undefined
  const excerpt = shortErrorExcerpt(errorText)

  switch (category) {
    case 'k6-missing':
      return {
        category,
        diagnosis: 'k6 konnte nicht gestartet werden',
        detail: 'Cannot run program „k6“ — Binary fehlt im Container',
        reasons: [
          'Java-ProcessBuilder hat das k6-Binary nicht gefunden.',
          'Prüfe, ob das Docker-Image korrekt gebaut wurde (k6 muss aus grafana/k6:latest stagen).',
          'Im Selbst-Setup: ist k6 auf dem PATH?',
        ],
      }
    case 'tls': {
      const target = baseUrl ?? 'Ziel'
      return {
        category,
        diagnosis: 'TLS-Handshake fehlgeschlagen',
        detail: 'Zertifikat wird nicht vertraut (self-signed oder interne CA)',
        reasons: [
          `${target} liefert ein Zertifikat, dem die JVM (und damit Go's crypto/tls) nicht vertraut.`,
          'Hint: TrustStore über LASTTEST_TRUSTSTORE_PATH setzen (siehe USER_GUIDE §13.1). Für k6 zusätzlich SSL_CERT_FILE.',
          'Bereits der erste Request schlug fehl — kein einziger Statuscode erreicht.',
        ],
      }
    }
    case 'unreachable': {
      const reasonsList: string[] = []
      if (baseUrl) reasonsList.push(`${baseUrl} lehnt TCP-Verbindungen ab (Connection refused).`)
      if (networkErrors > 0) reasonsList.push(`Alle ${totalRequests || networkErrors} Requests schlugen fehl — Status 0 (kein HTTP-Response erhalten).`)
      reasonsList.push(`Threshold http_req_failed (5 %) gerissen — tatsächlich ${failureRatePercent.toFixed(0)} %.`)
      return {
        category,
        diagnosis: 'Ziel nicht erreichbar',
        detail: baseUrl ? `Connection refused auf ${baseUrl}` : 'Connection refused',
        reasons: reasonsList,
      }
    }
    case 'dns': {
      const hostnameFromBaseUrl = baseUrl ? hostnameFromUrl(baseUrl) : undefined
      const hostFromError = (() => {
        const match = /ENOTFOUND\s+(\S+)/.exec(errorText)
        return match?.[1]
      })()
      const host = hostFromError ?? hostnameFromBaseUrl ?? 'Zielhost'
      const reasonsList: string[] = [
        `Host ${host} konnte nicht via DNS aufgelöst werden.`,
        'Container-Egress: läuft docker compose in einem Netzwerk ohne DNS-Forwarder?',
      ]
      if (networkErrors > 0) reasonsList.push(`Alle ${totalRequests || networkErrors} Requests schlugen fehl — Status 0 (kein HTTP-Response).`)
      return {
        category,
        diagnosis: 'DNS-Auflösung fehlgeschlagen',
        detail: `${host} nicht gefunden (ENOTFOUND)`,
        reasons: reasonsList,
      }
    }
    case 'timeout': {
      const p95Text = `${formatNumber(p95, 0)} ms`
      const reasonsList: string[] = []
      reasonsList.push(`Threshold http_req_duration p(95) < ${LATENCY_THRESHOLD_MS} ms gerissen — gemessen ${p95Text}.`)
      const fiveXx = countByStatusFamily(buckets, '5')
      if (fiveXx > 0) reasonsList.push(`${fiveXx} von ${totalRequests} Requests mit HTTP 5xx (Gateway Timeout).`)
      reasonsList.push(`Threshold http_req_failed (5 %) ${fiveXx > 0 ? 'knapp gehalten — ' + formatNumber(failureRatePercent, 1) + ' %' : 'gerissen — ' + formatNumber(failureRatePercent, 1) + ' %'}.`)
      return {
        category,
        diagnosis: 'Antwortzeit zu hoch',
        detail: `p(95) ${p95Text} über Threshold (${formatNumber(LATENCY_THRESHOLD_MS / 1000, 1)} s) — 30 s Timeout gerissen`,
        reasons: reasonsList,
      }
    }
    case 'server5xx': {
      const dominant = dominantBucket(buckets, '502') ?? dominantBucket(buckets, '500') ?? dominantErrorCode(buckets)!
      const fiveXxBuckets = buckets
        .filter(b => b.code.startsWith('5'))
        .sort((a, b) => b.count - a.count)
        .slice(0, 3)
      const reasonsList: string[] = []
      reasonsList.push(`Threshold http_req_failed (5 %) gerissen — tatsächlich ${failureRatePercent.toFixed(0)} %.`)
      for (const bucket of fiveXxBuckets) {
        reasonsList.push(`Endpunkt ${bucket.operationId} antwortete ${bucket.count}× mit HTTP ${bucket.code}.`)
      }
      if (p95 != null && Number.isFinite(p95)) reasonsList.push(`Latenz unauff\u00e4llig (p(95) ${Math.round(p95)} ms) — der Server ist erreichbar und antwortet, nur nicht korrekt.`)
      return {
        category,
        diagnosis: 'Viele Server-Fehler (5xx)',
        detail: `Häufigster Fehlercode: ${dominant.code} — ${dominant.count}\u00d7 von ${totalRequests} Requests`,
        reasons: reasonsList,
      }
    }
    case 'threshold-failure-rate': {
      const dominant = dominantErrorCode(buckets)!
      const fourXx = countByStatusFamily(buckets, '4')
      const reasonsList: string[] = []
      reasonsList.push(`Threshold http_req_failed (5 %) gerissen — tatsächlich ${failureRatePercent.toFixed(0)} %.`)
      if (dominant.code === '401') {
        reasonsList.push(`Endpunkt ${dominant.operationId} antwortete ${dominant.count}\u00d7 mit HTTP 401 — Bearer-Token pr\u00fcfen.`)
        reasonsList.push('Hinweis: 401 trotz konfiguriertem Token deutet auf falsches Pr\u00e4fix oder abgelaufenes Token hin.')
      } else if (dominant.code === '403') {
        reasonsList.push(`Endpunkt ${dominant.operationId} antwortete ${dominant.count}\u00d7 mit HTTP 403 — fehlende Berechtigung pr\u00fcfen.`)
      } else if (fourXx > 0) {
        reasonsList.push(`Endpunkt ${dominant.operationId} antwortete ${dominant.count}\u00d7 mit HTTP ${dominant.code}.`)
      }
      return {
        category,
        diagnosis: 'Hohe Client-Fehlerrate (4xx)',
        detail: `Häufigster Fehlercode: ${dominant.code} — ${dominant.count}\u00d7 von ${totalRequests} Requests`,
        reasons: reasonsList,
      }
    }
    case 'threshold-latency': {
      const p95Text = `${formatNumber(p95, 0)} ms`
      return {
        category,
        diagnosis: 'Antwortzeit zu hoch',
        detail: `p(95) ${p95Text} über Threshold (${formatNumber(LATENCY_THRESHOLD_MS / 1000, 1)} s)`,
        reasons: [
          `Threshold http_req_duration p(95) < ${LATENCY_THRESHOLD_MS} ms gerissen — gemessen ${p95Text}.`,
          `Fehlerrate unauff\u00e4llig (${formatNumber(failureRatePercent, 1)} %).`,
        ],
      }
    }
    case 'script': {
      const fileMatch = /at\s+(?:file:\/\/\/)?(\S+\.js):(\d+)/.exec(errorText)
      const fileRef = fileMatch ? `${fileMatch[1]}:${fileMatch[2]}` : undefined
      // `excerpt` is always defined for script errors (regex matches require
      // a non-empty errorText), but TypeScript can't prove this.
      const detail = fileRef ? `${excerpt!} in ${fileRef}` : excerpt!
      return {
        category,
        diagnosis: 'k6-Skriptfehler',
        detail,
        reasons: [
          'Skript konnte nicht initialisiert werden — keine einzige Iteration wurde ausgeführt.',
          'Wahrscheinliche Ursache: OpenAPI-Definition enthält ein Feld, das lasttest nicht ins k6-Skript gemappt hat. Spezifikation gegen Demo vergleichen.',
        ],
      }
    }
    default:
      // The [failureCategory] helper only ever returns one of the
      // explicit categories above. The `unknown` bucket is the
      // catch-all fall-through — we do not split it into a separate
      // `case 'unknown':` because that would create a second,
      // unreachable branch (TypeScript also flags this as
      // dead code) and inflate the branch-coverage denominator
      // for no behavioural gain.
      return {
        category: 'unknown',
        diagnosis: excerpt ? 'k6-Lauf fehlgeschlagen' : 'Unbekannter Fehler',
        detail: excerpt ?? 'Siehe k6-Konsolenausgabe für Details.',
        reasons: excerpt
          ? [`Erste Fehlerzeile: ${excerpt}`]
          : ['Der Lauf ist fehlgeschlagen, aber die Diagnose steht nicht in run.error.'],
      }
  }
}

// Builds the row of labelled metric values that sits between the
// status badge and the run ID. The exact contents vary by failure
// category because some failure shapes need different highlights
// (e.g. a network failure cares about request counts but not about
// p95, a server-error 5xx cares about 2xx vs 5xx counts but not
// about throughput).
export function buildMetricRow(
  run: TestRun,
  summary: K6Summary | undefined,
  failure: FailureSummary,
): MetricItem[] {
  // RUNNING / QUEUED runs have no settled metrics to show yet, so the
  // caller skips the entire row.
  if (run.status === 'RUNNING' || run.status === 'QUEUED') {
    return []
  }
  const totalRequests = summary ? completedRequestCount(summary) : undefined
  const failureRateValue = summary ? metric(summary, 'http_req_failed').value : undefined
  const failureRatePercent = failureRateValue != null && Number.isFinite(failureRateValue) ? failureRateValue * 100 : undefined
  const p95 = summary ? metric(summary, 'http_req_duration')['p(95)'] : undefined
  const throughput = summary ? metric(summary, 'http_reqs').rate : undefined
  const dataReceived = summary ? metric(summary, 'data_received').count : undefined
  const buckets = summary ? aggregateStatusCodes(summary) : []
  const twoXx = countByStatusFamily(buckets, '2')
  const fourXx = countByStatusFamily(buckets, '4')
  const fiveXx = countByStatusFamily(buckets, '5')
  const networkErrors = networkErrorCount(buckets)

  const items: MetricItem[] = []
  items.push({ label: 'Requests', value: totalRequests != null ? formatInteger(totalRequests) : '–', severity: 'normal' })

  if (failure.category === 'unreachable' || failure.category === 'dns') {
    items.push({ label: 'p(95)', value: '–', severity: 'muted' })
  } else if (p95 != null && Number.isFinite(p95)) {
    items.push({ label: 'p(95)', value: `${formatNumber(p95, 0)} ms`, severity: p95 > LATENCY_THRESHOLD_MS ? 'error' : 'normal' })
  } else {
    items.push({ label: 'p(95)', value: '–', severity: 'muted' })
  }

  if (failure.category === 'k6-missing' || failure.category === 'script') {
    items.push({ label: 'Fehlerquote', value: '–', severity: 'muted' })
    if (failure.category === 'script') {
      items.push({ label: 'Hinweis', value: 'Skript brach vor dem ersten Request ab', severity: 'warn' })
    } else {
      items.push({ label: 'Hinweis', value: 'Skript-Ausführung nicht möglich', severity: 'warn' })
    }
    return items
  }

  if (failureRatePercent != null && Number.isFinite(failureRatePercent)) {
    items.push({ label: 'Fehlerquote', value: `${formatNumber(failureRatePercent, failureRatePercent % 1 === 0 ? 0 : 1)} %`, severity: failureRatePercent > 5 ? 'error' : 'normal' })
  } else {
    items.push({ label: 'Fehlerquote', value: '–', severity: 'muted' })
  }

  if (failure.category === 'unreachable' || failure.category === 'dns') {
    if (networkErrors > 0) {
      items.push({ label: 'Status 0 (Netzwerkfehler)', value: `${formatInteger(networkErrors)}\u00d7`, severity: 'error' })
    }
  } else if (failure.category === 'server5xx') {
    if (fiveXx > 0) items.push({ label: '5xx', value: `${formatInteger(fiveXx)}\u00d7`, severity: 'error' })
    if (twoXx > 0) items.push({ label: '2xx', value: `${formatInteger(twoXx)}\u00d7`, severity: 'normal' })
  } else if (failure.category === 'threshold-failure-rate') {
    if (fourXx > 0) items.push({ label: '4xx', value: `${formatInteger(fourXx)}\u00d7`, severity: 'error' })
  } else if (failure.category === 'timeout') {
    if (fiveXx > 0) items.push({ label: 'Status 504', value: `${formatInteger(fiveXx)}\u00d7`, severity: 'error' })
  }

  if (failure.category !== 'unreachable' && failure.category !== 'dns') {
    if (throughput != null && Number.isFinite(throughput) && throughput > 0) {
      items.push({ label: 'Durchsatz', value: `${formatNumber(throughput)} /s`, severity: 'normal' })
    }
    if (dataReceived != null && Number.isFinite(dataReceived) && dataReceived > 0) {
      items.push({ label: 'Daten empfangen', value: formatBytes(dataReceived), severity: 'normal' })
    }
  }
  return items
}

// Convenience: human-readable status hint used while a run is still
// running or waiting. Mirrors the wording of the original report card.
export function progressHint(run: TestRun): string | undefined {
  if (run.status === 'RUNNING') {
    const started = run.startedAt ? new Date(run.startedAt).getTime() : undefined
    const duration = run.configuration?.loadProfile?.durationSeconds
    if (started != null && Number.isFinite(started) && duration != null) {
      const elapsed = Math.max(0, Math.floor((Date.now() - started) / 1000))
      const remaining = Math.max(0, duration - elapsed)
      return `läuft seit ${elapsed} s · voraussichtlich noch ${remaining} s`
    }
    return 'läuft'
  }
  if (run.status === 'QUEUED') {
    return 'wartet auf Executor (Pool-Größe: 2)'
  }
  return undefined
}

// ---- Threshold summary for the result banner --------------------------------
//
// Decides whether the just-finished run is a pass or a fail, and which
// metrics crossed the configured thresholds. The UI uses this to render
// the "Alle N Thresholds eingehalten / N Thresholds verletzt" banner
// above the summary cards. The list of failed metrics uses the same
// k6 metric names the user wrote in their load profile, so the banner
// ties back to the test definition instead of inventing new labels.
type ThresholdSummary = {
  /** True when the run completed and no configured threshold was crossed. */
  passed: boolean
  /**
   * Names of every k6 metric whose threshold was crossed. Empty when
   * `passed` is true. Returned in the same order the metrics appear
   * in the k6 summary so the banner is deterministic across renders.
   */
  failedMetrics: string[]
}

export function summariseThresholds(run: TestRun): ThresholdSummary {
  // A run that is still queued, running, or that did not produce a
  // k6 summary has no settled thresholds to evaluate yet. We return
  // `passed: false` so the UI does not accidentally flash a green
  // banner before the data is in.
  if (run.status !== 'COMPLETED' && run.status !== 'FAILED') {
    return { passed: false, failedMetrics: [] }
  }
  const summary = parseK6Summary(run)
  if (!summary) {
    return { passed: false, failedMetrics: [] }
  }
  const failed: string[] = []
  // Only inspect the two metrics the project actually configures as
  // thresholds (see TestRunReport.tsx :: <Threshold name="…">). Any
  // other metric crossing a threshold configured by the user in the
  // load profile is intentionally ignored here — those surface via
  // the k6 report link, not the result banner.
  const failureRate = metric(summary, 'http_req_failed').value
  if (failureRate != null && Number.isFinite(failureRate) && failureRate > FAILURE_RATE_THRESHOLD) {
    failed.push('http_req_failed')
  }
  const p95 = metric(summary, 'http_req_duration')['p(95)']
  if (p95 != null && Number.isFinite(p95) && p95 > LATENCY_THRESHOLD_MS) {
    failed.push('http_req_duration')
  }
  return { passed: failed.length === 0, failedMetrics: failed }
}

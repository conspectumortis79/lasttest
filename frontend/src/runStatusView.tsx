import {
  completedRequestCount,
  checkSuccessRate,
  formatDurationHuman,
  formatDurationSeconds,
  formatInteger,
  formatNumber,
  formatTimestamp,
  LATENCY_THRESHOLD_MS,
  metric,
  parseK6Summary,
  runElapsedSeconds,
  runRemainingSeconds,
  summariseFailure,
  summariseThresholds,
  type FailureKind,
  type FailureReason,
  type TestRun,
} from './k6Report.ts'
import { translate, type SupportedLanguage } from './i18n.ts'
import { useLanguage } from './languageStorage.ts'
import { xForSeconds } from './liveRampChartLayout.ts'
import type { RampPoint } from './runStatusViewLogic.ts'

// Imports from React are bundled below so the file stays compact
// and does not get mixed up with the exported type block.

// ---- RunProgress -----------------------------------------------------------
//
// While QUEUED/RUNNING we show the user how long the test has been
// running and — if the load profile has a predictable total duration —
// how many seconds remain. For `shared-iterations` we deliberately
// omit the remaining time because it is indeterminate.

type RunProgressProps = {
  run: TestRun
  now: number
}

function RunProgress({ run, now }: RunProgressProps) {
  const { language: lang } = useLanguage()
  const elapsed = runElapsedSeconds(run, now)
  const remaining = runRemainingSeconds(run, now)
  return <div className="run-progress" role="status" aria-live="polite">
    <div className="run-progress-cell">
      <span>{translate(lang, 'runProgress.runningSince')}</span>
      <strong>{formatDurationSeconds(elapsed)}</strong>
      <small>{translate(lang, 'runProgress.since', { time: formatTimestamp(run.startedAt) })}</small>
    </div>
    <div className="run-progress-cell">
      <span>{translate(lang, 'runProgress.remaining')}</span>
      <strong>{remaining == null ? translate(lang, 'runProgress.remainingUndefined') : formatDurationSeconds(remaining)}</strong>
      <small>{remaining == null ? translate(lang, 'runProgress.remainingOpenDuration') : translate(lang, 'runProgress.remainingPlanned', { duration: formatDurationHuman(remaining) })}</small>
    </div>
    <div className="run-progress-cell">
      <span>{translate(lang, 'runProgress.started')}</span>
      <strong>{formatTimestamp(run.startedAt)}</strong>
      <small>{translate(lang, 'runProgress.runId')} <code>{run.id.slice(0, 8)}</code></small>
    </div>
  </div>
}

// ---- RunSummary ------------------------------------------------------------
//
// Right after a short load test (smoke / load) finishes, users want
// to see the key metrics without having to open the full report. We
// therefore render the same core cards as the report, but more
// compact and without the threshold box.
//
// As soon as k6 is done (COMPLETED, FAILED, STOPPED or ABORTED),
// the card gets a pass/fail/stopped/aborted header on top and a run
// foot with run ID and report link at the bottom. While k6 is
// still running (RUNNING/QUEUED), `RunProgress` keeps being shown
// unchanged. STOPPING keeps showing the progress cells too because
// the user explicitly asked for a stop and should see the status
// play out, not a blank card.

type RunSummaryProps = {
  run: TestRun
  lang: SupportedLanguage
}

function RunSummary({ run, lang }: RunSummaryProps) {
  const summary = parseK6Summary(run)
  if (!summary) {
    return <div className="run-summary-empty">{translate(lang, 'result.noData')}</div>
  }
  const checks = metric(summary, 'checks')
  const requests = metric(summary, 'http_reqs')
  const failed = metric(summary, 'http_req_failed')
  const duration = metric(summary, 'http_req_duration')
  const requestCount = completedRequestCount(summary)
  const checkRate = checkSuccessRate(summary)
  const failureRate = failed.value == null ? undefined : failed.value * 100
  const p95 = duration['p(95)']
  const p95Pass = p95 != null && Number.isFinite(p95) && p95 < LATENCY_THRESHOLD_MS
  const failureRatePass = failureRate != null && failureRate < 5
  const checksPass = checkRate === 100
  const noRequests = requestCount == null || requestCount === 0
  const threshold = summariseThresholds(run)
  const passed = threshold.passed
  const failedNames = threshold.failedMetrics

  return <>
    <ResultHeader passed={passed} run={run} lang={lang} />
    <ThresholdNotice passed={passed} failedMetrics={failedNames} run={run} lang={lang} />
    {noRequests && <div className="run-summary-empty warning">{translate(lang, 'result.noRequests')}</div>}
    <div className="run-summary-cards">
      <SummaryCard label={translate(lang, 'summary.checksRate')} value={formatPercentage(checkRate)} detail={translate(lang, 'summary.checksDetail', { passed: formatInteger(checks.passes), failed: formatInteger(checks.fails) })} status={checksPass ? 'pass' : 'fail'} />
      <SummaryCard label={translate(lang, 'summary.failureRate')} value={formatPercentage(failureRate)} detail={translate(lang, 'summary.requestsDetail', { count: formatInteger(requestCount ?? 0) })} status={failureRatePass ? 'pass' : 'fail'} />
      <SummaryCard label={translate(lang, 'summary.p95')} value={p95 != null && Number.isFinite(p95) ? `${formatNumber(p95)} ms` : '–'} detail={translate(lang, 'summary.p95.threshold')} status={p95Pass ? 'pass' : 'fail'} />
      <SummaryCard label={translate(lang, 'summary.requests')} value={formatInteger(requests.count)} detail={`${formatNumber(requests.rate)}/s`} />
      <SummaryCard label={translate(lang, 'summary.iterations')} value={formatInteger(metric(summary, 'iterations').count)} detail={`${formatNumber(metric(summary, 'iterations').rate)}/s`} />
      <SummaryCard label={translate(lang, 'summary.runtime')} value={formatDurationHuman(runElapsedSeconds(run, parseFinishedAt(run)))} detail={translate(lang, 'summary.exitCodeSuffix', { code: String(run.exitCode ?? '–') })} />
    </div>
  </>
}

// ---- ResultHeader -----------------------------------------------------------
//
// Shows the terminal status as a pill. COMPLETED runs are PASSED
// (threshold met) or FAILED (threshold violated). STOPPED and
// ABORTED are user-initiated and have their own pills so the user
// sees immediately that the run was cut short, not failed.

type ResultHeaderProps = {
  passed: boolean | null
  run: TestRun
  lang: SupportedLanguage
}

function ResultHeader({ passed, run, lang }: ResultHeaderProps) {
  const pill =
    run.status === 'STOPPED'
      ? { className: 'is-stopped', text: translate(lang, 'status.STOPPED') }
      : run.status === 'ABORTED'
        ? { className: 'is-aborted', text: translate(lang, 'status.ABORTED') }
        : passed
          ? { className: 'is-pass', text: translate(lang, 'status.COMPLETED') }
          : { className: 'is-fail', text: translate(lang, 'status.FAILED') }
  return <div className="run-result-head">
    <span className={`status-badge ${pill.className}`}>{pill.text}</span>
    <span className="run-result-exit">{translate(lang, 'status.exitCode', { code: String(run.exitCode ?? '–') })}</span>
    {run.cancelledAt && <span className="run-result-stop-reason">
      {run.cancelledByForce
        ? translate(lang, 'status.cancelled.sigkill', { time: formatTimestamp(run.cancelledAt) })
        : translate(lang, 'status.cancelled.sigterm', { time: formatTimestamp(run.cancelledAt) })
      }
    </span>}
  </div>
}

// ---- ThresholdNotice --------------------------------------------------------
//
// The compact line under the header: "All N thresholds met" or
// "N thresholds violated: <metric>, <metric>". On FAILED, the affected
// metrics are rendered as <code> tags so it is clear which configured
// thresholds are involved.

type ThresholdNoticeProps = {
  passed: boolean | null
  failedMetrics: string[]
  run: TestRun
  lang: SupportedLanguage
}

function ThresholdNotice({ passed, failedMetrics, run, lang }: ThresholdNoticeProps) {
  // User-stopped runs get their own headline so the user does not
  // see "All 2 thresholds met" on a run that never reached the
  // planned duration.
  if (run.status === 'STOPPED') {
    return <div className="run-notice is-stopped" role="status">
      <span className="run-notice-check" aria-hidden="true">■</span>
      <span>{translate(lang, 'result.stopped.notice')}</span>
      <span className="run-notice-detail">
        {passed
          ? translate(lang, 'result.stopped.thresholdsMet')
          : failedMetrics.length === 0
            ? translate(lang, 'result.stopped.thresholdsUnknown')
            : translate(lang, 'result.stopped.thresholdsViolated', { n: failedMetrics.length })
        }
      </span>
    </div>
  }
  if (run.status === 'ABORTED') {
    return <div className="run-notice is-aborted" role="alert">
      <span className="run-notice-check" aria-hidden="true">⚠</span>
      <span>{translate(lang, 'result.aborted.notice')}</span>
      <span className="run-notice-detail">{translate(lang, 'result.aborted.detail')}</span>
    </div>
  }
  if (passed) {
    return <div className="run-notice is-pass" role="status">
      <span className="run-notice-check" aria-hidden="true">✓</span>
      <span>{translate(lang, 'result.passed', { n: 2 })}:
        <code>http_req_duration</code>, <code>http_req_failed</code>
      </span>
      <span className="run-notice-detail">{translate(lang, 'result.runDuration', { duration: formatDurationHuman(runElapsedSeconds(run, parseFinishedAt(run))) })}</span>
    </div>
  }
  const metricChips = failedMetrics.map((name, i) => (
    <span key={name} className="run-notice-chips">
      {i > 0 && <span className="run-notice-sep">, </span>}
      <code>{name}</code>
    </span>
  ))
  return <div className="run-notice is-fail" role="alert">
    <span className="run-notice-check" aria-hidden="true">✗</span>
    <span>
      <strong>{failedMetrics.length}</strong>{' '}
      {failedMetrics.length === 1 ? translate(lang, 'result.failed', { n: failedMetrics.length }) : translate(lang, 'result.failed_plural', { n: failedMetrics.length })}
      : {metricChips}
    </span>
    <span className="run-notice-detail">{translate(lang, 'result.runDuration', { duration: formatDurationHuman(runElapsedSeconds(run, parseFinishedAt(run))) })}</span>
  </div>
}

// ---- ResultFoot removed ----------------------------------------------------
//
// The k6 report used to have its own "Ausführlicher
// k6-Testbericht" button in the ResultHeader row. That entry
// point was removed when the run detail got its own "K6
// Bericht öffnen" tab — the tab opens the same `/?report=`
// URL in a new tab and is the single source of truth for
// the report link. The console output, JSON raw data and
// generated k6 script are reached via the dashboard's
// run-detail tabs (console / script), not via the report
// page itself.

function parseFinishedAt(run: TestRun): number {
  const finished = new Date(run.finishedAt ?? '').getTime()
  return Number.isFinite(finished) ? finished : Date.now()
}

function formatPercentage(value: number | undefined): string {
  return value == null ? '–' : `${formatNumber(value)} %`
}

function SummaryCard({ label, value, detail, status = 'normal' }: { label: string, value: string, detail: string, status?: 'pass' | 'fail' | 'normal' }) {
  return <div className={`run-summary-card ${status === 'normal' ? '' : `is-${status}`}`}>
    <span>{label}</span>
    <strong>{value}</strong>
    <small>{detail}</small>
  </div>
}

// ---- RunFailure ------------------------------------------------------------
//
// Instead of showing only the first (often generic) k6 error line, we
// try to recognise a typed cause via `summariseFailure`. The UI then
// shows a coloured label, a concise summary, the technical detail
// and — if known — a targeted recommendation.

// "Hard" infrastructure failures that make the threshold metrics
// meaningless (the run never reached the application logic). For
// these we displace the summary cards so the user sees the actual
// root cause. `http`/`unknown` are intentionally excluded: the server
// actually answered, the threshold numbers are still informative.
const HARD_FAILURE_KINDS: ReadonlySet<FailureKind> = new Set<FailureKind>([
  'dns',
  'connection-refused',
  'connection-timeout',
  'tls',
  'script',
  'process',
])

type RunFailureProps = {
  run: TestRun
  reason: FailureReason
  lang: SupportedLanguage
}

function RunFailure({ run, reason, lang }: RunFailureProps) {
  return <>
    <ResultHeader passed={false} run={run} lang={lang} />
    <ThresholdNotice passed={false} failedMetrics={summariseThresholds(run).failedMetrics} run={run} lang={lang} />
    <div className={`run-failure kind-${reason.kind}`} role="alert">
      <div className="run-failure-head">
        <span className="run-failure-label">{labelForFailure(reason.kind, lang)}</span>
        <strong>{reason.summary}</strong>
      </div>
      <p className="run-failure-detail">{reason.detail}</p>
      {reason.hint && <p className="run-failure-hint">{reason.hint}</p>}
    </div>
  </>
}

function labelForFailure(kind: FailureKind, lang: SupportedLanguage): string {
  const map = {
    dns: { en: 'DNS resolution', de: 'DNS-Auflösung' },
    'connection-refused': { en: 'Connection refused', de: 'Verbindung abgelehnt' },
    'connection-timeout': { en: 'Connection timeout', de: 'Verbindungs-Timeout' },
    tls: { en: 'TLS error', de: 'TLS-Fehler' },
    http: { en: 'HTTP error', de: 'HTTP-Fehler' },
    script: { en: 'Script error', de: 'Skript-Fehler' },
    process: { en: 'k6 missing', de: 'k6 nicht verfügbar' },
    unknown: { en: 'Error', de: 'Fehler' },
  } as const
  return map[kind][lang]
}

// ---- RunStatusView ---------------------------------------------------------
//
// Bundles the three views defined above into a single component that
// renders the appropriate slot based on status. This way every call
// site (App.tsx and TestRunReport.tsx) only has to mount a single
// component and pass the current `now` from the `useRunClock` hook.

type RunStatusViewProps = {
  run: TestRun
  now: number
  /**
   * Optional override for the failure analysis. Useful when the call
   * site has already preprocessed `run.error` (e.g. to truncate it).
   */
  reasonOverride?: FailureReason
}

export function RunStatusView({ run, now, reasonOverride }: RunStatusViewProps) {
  // The report reacts to the live language choice. Reading the
  // hook here means the user can flip the language in the
  // settings drawer while looking at a finished run and the
  // threshold notice / summary cards re-render immediately.
  const { language: lang } = useLanguage()
  if (run.status === 'RUNNING' || run.status === 'QUEUED') {
    return <RunProgress run={run} now={now} />
  }
  // STOPPING sits between RUNNING and a terminal state: the user
  // asked for a graceful stop, k6 is finishing its current
  // iterations, and the backend will flip the run to STOPPED
  // (or ABORTED after the grace period) once the process exits.
  // We keep showing the progress cells so the dashboard does not
  // blank out exactly when the user is watching for the stop to
  // land.
  if (run.status === 'STOPPING') {
    return <RunProgress run={run} now={now} />
  }
  if (run.status === 'COMPLETED') {
    return <RunSummary run={run} lang={lang} />
  }
  if (run.status === 'STOPPED') {
    // Graceful stop acknowledged by k6: same shape as COMPLETED
    // but with a STOPPED pill so the user can tell that the run
    // did not run for its planned duration.
    return <RunSummary run={run} lang={lang} />
  }
  if (run.status === 'ABORTED') {
    // SIGKILL by the user — there are partial metrics at best
    // but no full threshold pass. Show the typed failure block
    // if we can recognise one (usually `process` — k6 was
    // killed), otherwise fall back to a hand-rolled placeholder
    // so the call to RunFailure stays type-safe when no
    // classification was possible (e.g. error text was empty).
    const reason = reasonOverride ?? summariseFailure(run.error)
    if (reason) return <RunFailure run={run} reason={reason} lang={lang} />
    const placeholder = {
      kind: 'process' as const,
      summary: translate(lang, 'summary.runtime') === 'Runtime' ? 'k6 aborted' : 'k6 abgebrochen',
      detail: translate(lang, 'result.aborted.detail'),
      hint: 'Wenn die k6-Ausgabe unvollständig erscheint, ist das erwartet — der Prozess wurde sofort beendet.',
    }
    return <RunFailure run={run} reason={placeholder} lang={lang} />
  }
  if (run.status === 'FAILED') {
    // A FAILED run can have two very different causes:
    //   a) k6 violated thresholds — then we have real metrics and we
    //      show the summary cards with red colouring.
    //   b) k6 failed internally (e.g. DNS, connection refused, TLS,
    //      script error) — there are still metrics (e.g.
    //      http_req_failed.value=1), but the run was technically
    //      not successful. In that case we prioritise the typed
    //      failure block so the user sees the actual cause (DNS,
    //      connection refused, …) and is not distracted by
    //      threshold cards.
    const reason = reasonOverride ?? summariseFailure(run.error)
    // Only infrastructure failures (DNS, connection, script, process,
    // TLS) displace the threshold cards — for `http`/`unknown` the
    // server actually answered, so the threshold metrics are
    // meaningful and should stay visible.
    const hardFailure = reason && HARD_FAILURE_KINDS.has(reason.kind)
    if (hardFailure) return <RunFailure run={run} reason={reason} lang={lang} />
    const threshold = summariseThresholds(run)
    if (threshold.failedMetrics.length > 0) {
      return <RunSummary run={run} lang={lang} />
    }
    if (reason) return <RunFailure run={run} reason={reason} lang={lang} />
  }
  return null
}

// ---- formatWallClockTick -----------------------------------------------
//
// Formats a tick on the wall-clock x-axis. `startMs` is the epoch
// millisecond timestamp of the run's startedAt (or null when the
// run is still QUEUED and has no startedAt yet). `sec` is the
// offset from startMs in seconds. Returns HH:MM:SS in the
// browser's local time, or the generic "Xs" ticker when startMs
// is null / invalid so the chart still has labels.
//
// Kept local to [runStatusView] because the only callers are the
// ramp chart and the status-codes sparkline — both live below the
// Overview tab. The same formatter is duplicated inside
// [StatusCodesTimeline] to avoid the cross-module hop.
function formatWallClockTick(startMs: number | null, sec: number): string {
  if (startMs == null || !Number.isFinite(startMs)) {
    return `${Math.round(sec)} s`
  }
  const d = new Date(startMs + sec * 1000)
  const hh = d.getHours().toString().padStart(2, '0')
  const mm = d.getMinutes().toString().padStart(2, '0')
  const ss = d.getSeconds().toString().padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

// ---- LiveRampChart ------------------------------------------------------
//
// Renders the "Auslastung (Soll vs Ist)" SVG for an in-flight
// run. The planned VU curve is interpolated linearly from the
// load profile (constant-vus = flat line at the target; ramping
// = a smooth ramp; shared-iterations = no planned line). The
// "Ist" polyline is composed of the most recent VU samples
// reported by the polling loop in [useRunClock]; the yellow
// cursor is the last sample position. When the run is too
// short to have a sample yet, the chart still renders the
// planned line so the user sees the target up front.

type LiveRampChartProps = {
  planned: RampPoint[]
  actual: RampPoint[]
  totalDurationSeconds: number
  // Seconds since the run's `startedAt` stamp. `undefined` while
  // the run is still QUEUED — the parent component keeps the
  // value undefined so we render the same "–" dash that every
  // other queued-only surface uses instead of a "00:00" that
  // flickers with every 500 ms tick.
  elapsedSeconds: number | undefined
  /**
   * Peak of the planned curve. Drives the y-axis range so the
   * planned line always reaches the top of the chart. The unit
   * (VUs or RPS) is declared separately via [unit] — the same
   * numeric value with `unit = 'rate'` scales a 50-req/s line
   * the same way it would scale a 50-VU line.
   */
  targetValue: number
  /**
   * What the y-axis is showing. Picked by the parent's
   * [computeRampChartParams] from the executor type. Drives the
   * legend label so a 50-req/s arrival-rate test no longer
   * shows up as "VUs" on the dashboard.
   */
  unit: 'vus' | 'rate' | 'none'
  /**
   * Optional absolute timestamps used to keep the SVG x-axis
   * aligned to the wall clock even when the run was started
   * minutes ago. Defaults to "since run start" when omitted.
   */
  windowStartMs?: number
  windowEndMs?: number
  /**
   * ISO-8601 timestamp of the run's `startedAt`. When set, the
   * x-axis below the chart renders wall-clock time labels
   * (HH:MM:SS) instead of the generic "0 s … 30 s" tickers so
   * the user can cross-reference the chart with logs,
   * dashboards, or other tools that show the same wall clock.
   * Falls back to "since run start" when the run is still
   * QUEUED (no startedAt yet).
   */
  startedAtIso?: string | null
}

export function LiveRampChart({
  planned,
  actual,
  totalDurationSeconds,
  elapsedSeconds,
  targetValue,
  unit,
  windowStartMs,
  windowEndMs,
  startedAtIso,
}: LiveRampChartProps) {
  const { language: lang } = useLanguage()
  // SVG viewport. The viewBox is fixed so the chart scales with
  // its container while the data points stay in absolute
  // coordinates (0 = start, 600 = end of run).
  const W = 600
  const H = 140
  const padX = 0
  const padY = 10
  // Map a data value to the chart's y axis. Clamp to the target
  // so a runaway measured value still produces a visible curve
  // (the polyline will just touch the top edge).
  const yMax = Math.max(targetValue, 1)
  const yFor = (vus: number): number => {
    const clamped = Math.max(0, Math.min(yMax, vus))
    return padY + (1 - clamped / yMax) * (H - padY * 2)
  }
  // Project a "seconds since run start" value onto the SVG x
  // axis. The pure helper in [liveRampChartLayout.ts] handles
  // the window-start / window-end / total-duration logic and
  // the [0, 1] clamping; this component only owns the
  // viewport dimensions. `p.t` is documented in [RampPoint] as
  // "seconds since the run started", so we pass it through
  // unchanged (the previous `p.t * 1000` combined two
  // different unit bugs that collapsed every polyline onto
  // x = padX — see the test in `liveRampChartLayout.test.ts`).
  const xFor = (sec: number): number => xForSeconds(sec, {
    W,
    padX,
    windowStartMs,
    windowEndMs,
    totalDurationSeconds,
  })
  // Build the polyline strings. Empty arrays render an empty
  // path so the SVG stays valid.
  const plannedPoints = planned
    .map(p => `${xFor(p.t)},${yFor(p.planned)}`)
    .join(' ')
  const actualSamples = actual.filter(p => Number.isFinite(p.actual))
  const actualPoints = actualSamples
    .map(p => `${xFor(p.t)},${yFor(p.actual)}`)
    .join(' ')
  const lastActual = actualSamples[actualSamples.length - 1]
  const cursorX = lastActual ? xFor(lastActual.t) : null
  const cursorY = lastActual ? yFor(lastActual.actual) : null
  // Grid lines at 25 / 50 / 75 / 100 % of the y range.
  const grid = [0.25, 0.5, 0.75, 1].map(f => (
    <line key={f} x1={0} x2={W} y1={padY + f * (H - padY * 2)} y2={padY + f * (H - padY * 2)} stroke="#1a2435" strokeWidth={1} />
  ))
  // Y axis labels at the same four levels. The previous
  // version drove the y-position with the same fraction `f`
  // it used for the value, so the top label (f = 1) landed at
  // y = H - padY (the bottom of the chart) and the bottom
  // label (f = 0) landed at y = padY (the top of the chart) —
  // i.e. the y-axis was upside-down. SVG y grows downward, so
  // a high data value (f = 1) must sit at a *small* y, not a
  // large one. The fix is to invert the position fraction
  // while keeping the value fraction unchanged, which gives a
  // monotonically-decreasing y across a monotonically-increasing
  // value (0 at the bottom, yMax at the top). The same
  // orientation also matches [buildRampPlot] in `k6Report.ts`
  // so the live tab and the report render the same chart.
  const yLabels = [1, 0.75, 0.5, 0.25, 0].map(f => {
    const v = Math.round(yMax * f)
    const y = padY + (1 - f) * (H - padY * 2) + 3
    return <text key={f} x={4} y={y} fill="#4f6179" fontSize="9" fontFamily='"SFMono-Regular", Consolas, monospace'>{v}</text>
  })
  const elapsedLabel = formatDurationSeconds(elapsedSeconds)
  return <div className="ramp-tab">
    <div className="ramp-tab-head">
      <div className="ramp-tab-title">{translate(lang, 'runStatus.live.rampTitle')}</div>
      <div className="ramp-tab-meta">
        {translate(lang, 'runStatus.live.runningFor', { elapsed: '' })} <strong style={{ color: '#dbe5f3' }}>{elapsedLabel}</strong>
        {' · '}
        {actualSamples.length > 0
          ? translate(lang, 'runStatus.live.samples', { n: actualSamples.length })
          : translate(lang, 'runStatus.live.noSamples')}
      </div>
    </div>
    <svg className="ramp-tab-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      {grid}
      {yLabels}
      {plannedPoints && <polyline fill="none" stroke="#5fcb95" strokeWidth={2} points={plannedPoints} />}
      {actualPoints && <polyline fill="none" stroke="#4f8bff" strokeWidth={2} points={actualPoints} />}
      {cursorX != null && cursorY != null && (
        <circle cx={cursorX} cy={cursorY} r={4} fill="#fbbf24" stroke="#0c131e" strokeWidth={2} />
      )}
      <line x1={0} y1={H - padY} x2={W} y2={H - padY} stroke="#293950" />
    </svg>
    {/*
      Wall-clock time axis. Five ticks (start, three quarters, end)
      so the chart stays readable on both 30-second smoke tests
      and 30-minute soak tests. The first tick is left-aligned,
      the last is right-aligned, the middle three are evenly
      spaced — the same layout used by the status-code sparklines
      below so the two surfaces align visually.
    */}
    <div className="ramp-tab-axis">
      {[
        { sec: 0, align: 'start' as const },
        { sec: totalDurationSeconds * 0.25, align: 'center' as const },
        { sec: totalDurationSeconds * 0.5, align: 'center' as const },
        { sec: totalDurationSeconds * 0.75, align: 'center' as const },
        { sec: totalDurationSeconds, align: 'end' as const },
      ].map(({ sec, align }) => {
        const startMs = startedAtIso ? Date.parse(startedAtIso) : null
        const label = formatWallClockTick(startMs, sec)
        return (
          <span key={`t-${sec}`} style={{ textAlign: align }}>{label}</span>
        )
      })}
    </div>
    <div className="ramp-tab-legend">
      <span className="l-ist">{translate(lang, 'runStatus.live.legend.actual')}</span>
      <span className="l-soll">{translate(lang, 'runStatus.live.legend.planned')}</span>
      {cursorX != null && <span className="l-now">{translate(lang, 'runStatus.live.legend.now')}</span>}
      {/* The y-axis unit label is rendered on the right of the
          legend so the user always knows whether the curve is
          showing VUs (constant-vus / ramping-vus /
          shared-iterations) or requests per second
          (constant-arrival-rate / ramping-arrival-rate, which
          covers the lead-stress, spike and soak presets). The
          label is hidden when the executor has no planned
          line to scale to. */}
      {unit !== 'none' && <span className="l-unit">{unit === 'rate' ? translate(lang, 'runStatus.live.legend.yAxisRps') : translate(lang, 'runStatus.live.legend.yAxisVUs')}</span>}
    </div>
  </div>
}

// ---- LiveBanner ---------------------------------------------------------
//
// Sits above the RunProgress grid while a run is in flight. Shows
// the method+path being tested, the load profile, a pulsing dot
// and the Stop / Abort (SIGKILL) buttons. Matches the mockup's
// "Live · Lasttest läuft" header — the user should see the run
// state at a glance without having to scroll the page.
type LiveBannerProps = {
  run: TestRun
  onStop: (runId: string, force: boolean) => void
  disabled?: boolean
}

export function LiveBanner({ run, onStop, disabled }: LiveBannerProps) {
  const { language: lang } = useLanguage()
  const method = run.configuration?.operations?.[0]?.method ?? '–'
  const path = run.configuration?.operations?.[0]?.path ?? '–'
  const profile = run.configuration?.loadProfile
  return <div className="live-banner" role="status" aria-live="polite">
    <span className="live-dot" aria-hidden="true" />
    <div>
      <div className="live-label">{translate(lang, 'runStatus.liveBanner.label')}</div>
      <div className="live-op">{method} {path}</div>
    </div>
    <div className="live-meta">
      {translate(lang, 'runStatus.liveBanner.profile')} <strong style={{ color: '#dbe5f3' }}>{profile?.type ?? '–'} · {profile?.virtualUsers ?? '–'} VUs · {profile?.durationSeconds ?? '–'}s</strong><br />
      <span style={{ color: '#6b7c95', fontFamily: '"SFMono-Regular", Consolas, monospace' }}>
        {translate(lang, 'runStatus.liveBanner.p95')}
      </span>
    </div>
    <div className="live-actions">
      <button
        type="button"
        className="btn-stop"
        onClick={() => onStop(run.id, false)}
        disabled={disabled}
        title="k6 freundlich beenden (SIGTERM)"
      >
        <span className="icon">■</span>Stoppen
      </button>
      <button
        type="button"
        className="btn-abort"
        onClick={() => onStop(run.id, true)}
        disabled={disabled}
        title="k6 sofort beenden (SIGKILL)"
      >
        Abbrechen
      </button>
    </div>
    <span className="run-list-hint" style={{ display: 'none' }}>{lang}</span>
  </div>
}

// ---- AktionenTab --------------------------------------------------------
//
// Renders the right-click menu items as full-width cards so the
// user does not have to remember the right-click gesture to find
// the actions. The cards are grouped by category (Steuern / Teilen
// & Export / Bereinigen) and a small badge explains why an action
// is disabled. Each card wires directly to a callback so the
// caller can decide whether to issue the API call, copy to the
// clipboard, or open a new tab.
type AktionenTabProps = {
  run: TestRun
  onStop: (runId: string, force: boolean) => void
  onRerun: (runId: string) => void
  onCopyRunId: (runId: string) => void
  onCopyReportLink: (runId: string) => void
  onOpenReport: (runId: string) => void
  onDownloadScript: (runId: string) => void
  onExportMetrics: (runId: string) => void
  onRemove: (runId: string) => void
  onRemoveAllOtherFailed: (runId: string) => void
}

export function AktionenTab({
  run,
  onStop,
  onRerun,
  onCopyRunId,
  onCopyReportLink,
  onOpenReport,
  onDownloadScript,
  onExportMetrics,
  onRemove,
  onRemoveAllOtherFailed,
}: AktionenTabProps) {
  const { language: lang } = useLanguage()
  // The disabled flags mirror the conditions the right-click
  // popup used to enforce. The mockup re-uses the same logic so
  // the two UIs stay in lockstep; the only place that can
  // diverge is the i18n key for the "why is this disabled?"
  // reason, which is rendered as a small state badge.
  const inFlight = run.status === 'RUNNING' || run.status === 'STOPPING' || run.status === 'QUEUED'
  const terminal = !inFlight
  const hasSummary = typeof run.summary?.raw === 'string' && run.summary.raw.length > 0
  const reportUrl = `/?report=${encodeURIComponent(run.id)}`
  return <div className="aktionen">
    {/* Steuern: in-flight Aktionen (nur verfügbar solange der Lauf läuft) */}
    <div className="aktionen-group">
      <div className="aktionen-group-head">
        <div className="title">{translate(lang, 'runStatus.actions.controls.title')}</div>
        <div className="sub">{translate(lang, 'runStatus.actions.controls.sub')}</div>
        <div className="line" />
      </div>
      <div className="aktionen-grid">
        <button type="button" className="aktion-card" onClick={() => onStop(run.id, false)} disabled={!inFlight}>
          <div className="icon">■</div>
          <div className="body">
            <div className="label">{translate(lang, 'runStatus.actions.controls.stop.label', { shortcut: 'S', state: translate(lang, 'runStatus.actions.controls.stop.state') })}</div>
            <div className="desc">{translate(lang, 'runStatus.actions.controls.stop.desc')}</div>
          </div>
          <div className="chev">▸</div>
        </button>
        <button type="button" className="aktion-card" onClick={() => onStop(run.id, true)} disabled={!inFlight}>
          <div className="icon">✕</div>
          <div className="body">
            <div className="label">{translate(lang, 'runStatus.actions.controls.abort.label', { shortcut: '⇧S', state: translate(lang, 'runStatus.actions.controls.abort.state') })}</div>
            <div className="desc">{translate(lang, 'runStatus.actions.controls.abort.desc')}</div>
          </div>
          <div className="chev">▸</div>
        </button>
        <button type="button" className="aktion-card" onClick={() => onRerun(run.id)} disabled={!terminal}>
          <div className="icon">↻</div>
          <div className="body">
            <div className="label">{translate(lang, 'runStatus.actions.controls.rerun.label', { state: inFlight ? translate(lang, 'runStatus.actions.controls.rerun.state') : '' })}</div>
            <div className="desc">{translate(lang, 'runStatus.actions.controls.rerun.desc')}</div>
          </div>
          <div className="chev">▸</div>
        </button>
      </div>
    </div>

    {/* Teilen & Export */}
    <div className="aktionen-group">
      <div className="aktionen-group-head">
        <div className="title">{translate(lang, 'runStatus.actions.share.title')}</div>
        <div className="sub">{translate(lang, 'runStatus.actions.share.sub')}</div>
        <div className="line" />
      </div>
      <div className="aktionen-grid">
        <button type="button" className="aktion-card" onClick={() => onCopyRunId(run.id)}>
          <div className="icon">⎘</div>
          <div className="body">
            <div className="label">{translate(lang, 'runStatus.actions.share.runId.label', { shortcut: '⌘C' })}</div>
            <div className="desc">{translate(lang, 'runStatus.actions.share.runId.desc', { id: run.id.slice(0, 12) })}</div>
          </div>
          <div className="chev">▸</div>
        </button>
        <button type="button" className="aktion-card" onClick={() => onCopyReportLink(run.id)}>
          <div className="icon">🔗</div>
          <div className="body">
            <div className="label">{translate(lang, 'runStatus.actions.share.reportLink.label')}</div>
            <div className="desc">{translate(lang, 'runStatus.actions.share.reportLink.desc', { url: reportUrl })}</div>
          </div>
          <div className="chev">▸</div>
        </button>
        <button type="button" className="aktion-card" onClick={() => onOpenReport(run.id)}>
          <div className="icon">↗</div>
          <div className="body">
            <div className="label">{translate(lang, 'runStatus.actions.share.openReport.label', { shortcut: '⌘↩' })}</div>
            <div className="desc">{translate(lang, 'runStatus.actions.share.openReport.desc')}</div>
          </div>
          <div className="chev">▸</div>
        </button>
        <button type="button" className="aktion-card" onClick={() => onDownloadScript(run.id)} disabled={!terminal}>
          <div className="icon">{'{}'}</div>
          <div className="body">
            <div className="label">{translate(lang, 'runStatus.actions.share.downloadScript.label', { state: inFlight ? translate(lang, 'runStatus.actions.share.downloadScript.state') : '' })}</div>
            <div className="desc">{translate(lang, 'runStatus.actions.share.downloadScript.desc', { id: run.id.slice(0, 8) })}</div>
          </div>
          <div className="chev">▸</div>
        </button>
        <button type="button" className="aktion-card" onClick={() => onExportMetrics(run.id)} disabled={!terminal || !hasSummary}>
          <div className="icon">⤓</div>
          <div className="body">
            <div className="label">{translate(lang, 'runStatus.actions.share.exportSummary.label', { state: !hasSummary ? translate(lang, 'runStatus.actions.share.exportSummary.state') : (inFlight ? translate(lang, 'runStatus.actions.share.downloadScript.state') : '') })}</div>
            <div className="desc">{translate(lang, 'runStatus.actions.share.exportSummary.desc', { id: run.id.slice(0, 8) })}</div>
          </div>
          <div className="chev">▸</div>
        </button>
      </div>
    </div>

    {/* Bereinigen */}
    <div className="aktionen-group">
      <div className="aktionen-group-head">
        <div className="title">{translate(lang, 'runStatus.actions.cleanup.title')}</div>
        <div className="sub">{translate(lang, 'runStatus.actions.cleanup.sub')}</div>
        <div className="line" />
      </div>
      <div className="aktionen-grid full">
        <button type="button" className="aktion-card danger" onClick={() => onRemove(run.id)} disabled={inFlight}>
          <div className="icon">🗑</div>
          <div className="body">
            <div className="label">{translate(lang, 'runStatus.actions.cleanup.remove.label', { shortcut: 'Del', state: inFlight ? translate(lang, 'runStatus.actions.cleanup.remove.state') : '' })}</div>
            <div className="desc">{translate(lang, 'runStatus.actions.cleanup.remove.desc')}</div>
          </div>
          <div className="chev">▸</div>
        </button>
        <button type="button" className="aktion-card danger" onClick={() => onRemoveAllOtherFailed(run.id)} disabled={inFlight}>
          <div className="icon">🗑</div>
          <div className="body">
            <div className="label">{translate(lang, 'runStatus.actions.cleanup.removeOthers.label', { state: inFlight ? translate(lang, 'runStatus.actions.cleanup.removeOthers.state') : '' })}</div>
            <div className="desc">{translate(lang, 'runStatus.actions.cleanup.removeOthers.desc')}</div>
          </div>
          <div className="chev">▸</div>
        </button>
      </div>
    </div>
  </div>
}

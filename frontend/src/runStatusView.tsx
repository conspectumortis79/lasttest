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

export function RunProgress({ run, now }: RunProgressProps) {
  const elapsed = runElapsedSeconds(run, now)
  const remaining = runRemainingSeconds(run, now)
  return <div className="run-progress" role="status" aria-live="polite">
    <div className="run-progress-cell">
      <span>Läuft seit</span>
      <strong>{formatDurationSeconds(elapsed)}</strong>
      <small>Seit {formatTimestamp(run.startedAt)}</small>
    </div>
    <div className="run-progress-cell">
      <span>Noch</span>
      <strong>{remaining == null ? '–' : formatDurationSeconds(remaining)}</strong>
      <small>{remaining == null ? 'Profil mit offener Dauer' : `Geplant: ${formatDurationHuman(remaining)}`}</small>
    </div>
    <div className="run-progress-cell">
      <span>Gestartet</span>
      <strong>{formatTimestamp(run.startedAt)}</strong>
      <small>Run-ID <code>{run.id.slice(0, 8)}</code></small>
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
}

export function RunSummary({ run }: RunSummaryProps) {
  const summary = parseK6Summary(run)
  if (!summary) {
    return <div className="run-summary-empty">No k6 evaluation data is available (summary missing).</div>
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
    <ResultHeader passed={passed} run={run} />
    <ThresholdNotice passed={passed} failedMetrics={failedNames} run={run} />
    {noRequests && <div className="run-summary-empty warning">No HTTP request was completed. The target was unreachable from the k6 container or did not respond in time.</div>}
    <div className="run-summary-cards">
      <SummaryCard label="Checks erfolgreich" value={formatPercentage(checkRate)} detail={`${formatInteger(checks.passes)} bestanden, ${formatInteger(checks.fails)} fehlgeschlagen`} status={checksPass ? 'pass' : 'fail'} />
      <SummaryCard label="HTTP-Fehlerrate" value={formatPercentage(failureRate)} detail={`${formatInteger(requestCount ?? 0)} Requests`} status={failureRatePass ? 'pass' : 'fail'} />
      <SummaryCard label="p(95) Antwortzeit" value={p95 != null && Number.isFinite(p95) ? `${formatNumber(p95)} ms` : '–'} detail="Grenzwert: < 1.000 ms" status={p95Pass ? 'pass' : 'fail'} />
      <SummaryCard label="HTTP Requests" value={formatInteger(requests.count)} detail={`${formatNumber(requests.rate)}/s`} />
      <SummaryCard label="Iterationen" value={formatInteger(metric(summary, 'iterations').count)} detail={`${formatNumber(metric(summary, 'iterations').rate)}/s`} />
      <SummaryCard label="Laufzeit" value={formatDurationHuman(runElapsedSeconds(run, parseFinishedAt(run)))} detail={`Exit-Code ${run.exitCode ?? '–'}`} />
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
}

function ResultHeader({ passed, run }: ResultHeaderProps) {
  const pill =
    run.status === 'STOPPED'
      ? { className: 'is-stopped', text: 'STOPPED' }
      : run.status === 'ABORTED'
        ? { className: 'is-aborted', text: 'ABORTED' }
        : passed
          ? { className: 'is-pass', text: 'PASSED' }
          : { className: 'is-fail', text: 'FAILED' }
  return <div className="run-result-head">
    <span className={`status-badge ${pill.className}`}>{pill.text}</span>
    <span className="run-result-exit">Exit-Code {run.exitCode ?? '–'}</span>
    {run.cancelledAt && <span className="run-result-stop-reason">
      {run.cancelledByForce ? 'Abgebrochen (SIGKILL)' : 'Gestoppt (SIGTERM)'} um {formatTimestamp(run.cancelledAt)}
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
}

function ThresholdNotice({ passed, failedMetrics, run }: ThresholdNoticeProps) {
  // User-stopped runs get their own headline so the user does not
  // see "All 2 thresholds met" on a run that never reached the
  // planned duration.
  if (run.status === 'STOPPED') {
    return <div className="run-notice is-stopped" role="status">
      <span className="run-notice-check" aria-hidden="true">■</span>
      <span>Vom Benutzer gestoppt — die geplante Laufzeit wurde nicht erreicht.</span>
      <span className="run-notice-detail">
        Bisherige Thresholds: {passed ? 'eingehalten' : failedMetrics.length === 0 ? 'unbekannt' : `${failedMetrics.length} verletzt`}
      </span>
    </div>
  }
  if (run.status === 'ABORTED') {
    // ABORTED runs do not have a clean summary. Tell the user
    // up-front that the numbers are partial so they do not
    // mistake the cards below for a full result.
    return <div className="run-notice is-aborted" role="alert">
      <span className="run-notice-check" aria-hidden="true">⚠</span>
      <span>Vom Benutzer abgebrochen — k6 wurde per SIGKILL beendet.</span>
      <span className="run-notice-detail">Es liegen ggf. nur Teilkennzahlen vor; Threshold-Bewertung ist nicht aussagekräftig.</span>
    </div>
  }
  if (passed) {
    return <div className="run-notice is-pass" role="status">
      <span className="run-notice-check" aria-hidden="true">✓</span>
      <span>Alle <strong>2</strong> Thresholds eingehalten:
        <code>http_req_duration</code>, <code>http_req_failed</code>
      </span>
      <span className="run-notice-detail">Testdauer {formatDurationHuman(runElapsedSeconds(run, parseFinishedAt(run)))}</span>
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
    <span><strong>{failedMetrics.length}</strong> Threshold{failedMetrics.length === 1 ? '' : 's'} verletzt: {metricChips}</span>
    <span className="run-notice-detail">Testdauer {formatDurationHuman(runElapsedSeconds(run, parseFinishedAt(run)))}</span>
  </div>
}

// ---- ResultFoot removed ----------------------------------------------------
//
// The report button has moved to the card header in App.tsx
// (`.result-header-actions`) and sits there in its own row,
// right-aligned directly under the run ID. The k6 console output
// and the k6 JSON raw-data details therefore regain the full card
// width in `.result-extras`.

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
}

export function RunFailure({ run, reason }: RunFailureProps) {
  return <>
    <ResultHeader passed={false} run={run} />
    <ThresholdNotice passed={false} failedMetrics={summariseThresholds(run).failedMetrics} run={run} />
    <div className={`run-failure kind-${reason.kind}`} role="alert">
      <div className="run-failure-head">
        <span className="run-failure-label">{labelForFailure(reason.kind)}</span>
        <strong>{reason.summary}</strong>
      </div>
      <p className="run-failure-detail">{reason.detail}</p>
      {reason.hint && <p className="run-failure-hint">{reason.hint}</p>}
    </div>
  </>
}

function labelForFailure(kind: FailureKind): string {
  switch (kind) {
    case 'dns': return 'DNS-Auflösung'
    case 'connection-refused': return 'Verbindung abgelehnt'
    case 'connection-timeout': return 'Verbindungs-Timeout'
    case 'tls': return 'TLS-Fehler'
    case 'http': return 'HTTP-Fehler'
    case 'script': return 'Skript-Fehler'
    case 'process': return 'k6 nicht verfügbar'
    case 'unknown': return 'Fehler'
  }
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
    return <RunSummary run={run} />
  }
  if (run.status === 'STOPPED') {
    // Graceful stop acknowledged by k6: same shape as COMPLETED
    // but with a STOPPED pill so the user can tell that the run
    // did not run for its planned duration.
    return <RunSummary run={run} />
  }
  if (run.status === 'ABORTED') {
    // SIGKILL by the user — there are partial metrics at best
    // but no full threshold pass. Show the typed failure block
    // if we can recognise one (usually `process` — k6 was
    // killed), otherwise fall back to a hand-rolled placeholder
    // so the call to RunFailure stays type-safe when no
    // classification was possible (e.g. error text was empty).
    const reason = reasonOverride ?? summariseFailure(run.error)
    if (reason) return <RunFailure run={run} reason={reason} />
    const placeholder = {
      kind: 'process' as const,
      summary: 'k6 abgebrochen',
      detail: 'Der Prozess wurde per SIGKILL beendet, bevor eine Auswertung möglich war.',
      hint: 'Wenn die k6-Ausgabe unvollständig erscheint, ist das erwartet — der Prozess wurde sofort beendet.',
    }
    return <RunFailure run={run} reason={placeholder} />
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
    if (hardFailure) return <RunFailure run={run} reason={reason} />
    const threshold = summariseThresholds(run)
    if (threshold.failedMetrics.length > 0) {
      return <RunSummary run={run} />
    }
    if (reason) return <RunFailure run={run} reason={reason} />
  }
  return null
}

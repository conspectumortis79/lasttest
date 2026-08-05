import {
  completedRequestCount,
  checkSuccessRate,
  formatDurationHuman,
  formatDurationSeconds,
  formatInteger,
  formatNumber,
  formatTimestamp,
  metric,
  parseK6Summary,
  runElapsedSeconds,
  runRemainingSeconds,
  summariseFailure,
  type FailureKind,
  type FailureReason,
  type TestRun,
} from './k6Report.ts'

// Importe von React werden unten gebündelt, damit die Datei kompakt
// bleibt und sich nicht mit dem exportierten Typ-Block vermischt.

// ---- RunProgress -----------------------------------------------------------
//
// Während QUEUED/RUNNING zeigen wir dem Nutzer, wie lange der Test
// bereits läuft und — falls das Lastprofil eine vorhersagbare Gesamtdauer
// hat — wie viele Sekunden noch verbleiben. Für `shared-iterations`
// lassen wir die Restzeit bewusst weg, weil sie unbestimmt ist.

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
// Direkt nach Abschluss eines kurzen Lasttests (Smoke / Load) wollen
// die Nutzer:innen die wichtigsten Kennzahlen sehen, ohne den
// ausführlichen Report öffnen zu müssen. Wir rendern deshalb dieselben
// Kern-Cards wie im Report, aber kompakter und ohne Schwellwert-Box.

type RunSummaryProps = {
  run: TestRun
}

export function RunSummary({ run }: RunSummaryProps) {
  const summary = parseK6Summary(run)
  if (!summary) {
    return <div className="run-summary-empty">Es liegen keine k6-Auswertungsdaten vor (Summary fehlt).</div>
  }
  const checks = metric(summary, 'checks')
  const requests = metric(summary, 'http_reqs')
  const failed = metric(summary, 'http_req_failed')
  const duration = metric(summary, 'http_req_duration')
  const requestCount = completedRequestCount(summary)
  const checkRate = checkSuccessRate(summary)
  const failureRate = failed.value == null ? undefined : failed.value * 100
  const noRequests = requestCount == null || requestCount === 0

  return <>
    {noRequests && <div className="run-summary-empty warning">Keine HTTP-Anfrage wurde abgeschlossen. Das Ziel war aus dem k6-Container nicht erreichbar oder antwortete nicht rechtzeitig.</div>}
    <div className="run-summary-cards">
      <SummaryCard label="Checks erfolgreich" value={formatPercentage(checkRate)} detail={`${formatInteger(checks.passes)} bestanden, ${formatInteger(checks.fails)} fehlgeschlagen`} success={checkRate === 100} />
      <SummaryCard label="HTTP-Fehlerrate" value={formatPercentage(failureRate)} detail={`${formatInteger(requestCount ?? 0)} Requests`} success={failureRate != null && failureRate < 5} />
      <SummaryCard label="p(95) Antwortzeit" value={`${formatNumber(duration['p(95)'])} ms`} detail="Grenzwert: < 1.000 ms" success={(duration['p(95)'] ?? Number.POSITIVE_INFINITY) < 1000} />
      <SummaryCard label="HTTP Requests" value={formatInteger(requests.count)} detail={`${formatNumber(requests.rate)}/s`} />
      <SummaryCard label="Iterationen" value={formatInteger(metric(summary, 'iterations').count)} detail={`${formatNumber(metric(summary, 'iterations').rate)}/s`} />
      <SummaryCard label="Laufzeit" value={formatDurationHuman(runElapsedSeconds(run, parseFinishedAt(run)))} detail={`Exit-Code ${run.exitCode ?? '–'}`} />
    </div>
  </>
}

function parseFinishedAt(run: TestRun): number {
  const finished = new Date(run.finishedAt ?? '').getTime()
  return Number.isFinite(finished) ? finished : Date.now()
}

function formatPercentage(value: number | undefined): string {
  return value == null ? '–' : `${formatNumber(value)} %`
}

function SummaryCard({ label, value, detail, success = false }: { label: string, value: string, detail: string, success?: boolean }) {
  return <div className="run-summary-card">
    <span>{label}</span>
    <strong className={success ? 'success' : ''}>{value}</strong>
    <small>{detail}</small>
  </div>
}

// ---- RunFailure ------------------------------------------------------------
//
// Statt nur die erste (oft generische) k6-Fehlerzeile anzuzeigen,
// versuchen wir über `summariseFailure` eine typisierte Ursache zu
// erkennen. Die UI zeigt dann ein farbiges Label, eine prägnante
// Zusammenfassung, das technische Detail und — falls bekannt — eine
// gezielte Handlungsempfehlung.

type RunFailureProps = {
  run: TestRun
  reason: FailureReason
}

export function RunFailure({ reason }: RunFailureProps) {
  return <div className={`run-failure kind-${reason.kind}`} role="alert">
    <div className="run-failure-head">
      <span className="run-failure-label">{labelForFailure(reason.kind)}</span>
      <strong>{reason.summary}</strong>
    </div>
    <p className="run-failure-detail">{reason.detail}</p>
    {reason.hint && <p className="run-failure-hint">{reason.hint}</p>}
  </div>
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
// Bündelt die drei oben definierten Sichten in einer einzigen Komponente,
// die den passenden Slot je nach Status rendert. So muss jede Aufrufstelle
// (App.tsx und TestRunReport.tsx) nur eine einzige Komponente einbinden
// und übergibt das aktuelle `now` aus dem `useRunClock`-Hook.

type RunStatusViewProps = {
  run: TestRun
  now: number
  /**
   * Optionales Override der Fehleranalyse. Nützlich, wenn die Aufrufstelle
   * das `run.error` schon vorverarbeitet hat (z. B. um es zu kürzen).
   */
  reasonOverride?: FailureReason
}

export function RunStatusView({ run, now, reasonOverride }: RunStatusViewProps) {
  if (run.status === 'RUNNING' || run.status === 'QUEUED') {
    return <RunProgress run={run} now={now} />
  }
  if (run.status === 'COMPLETED') {
    return <RunSummary run={run} />
  }
  if (run.status === 'FAILED') {
    const reason = reasonOverride ?? summariseFailure(run.error)
    if (reason) return <RunFailure run={run} reason={reason} />
  }
  return null
}

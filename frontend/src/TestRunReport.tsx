import { useEffect, useState, type ReactNode } from 'react'
import {
  activeStatusCodes,
  buildIstPath,
  buildRampPlot,
  buildSollPath,
  checkSuccessRate,
  completedRequestCount,
  copyTextToClipboard,
  FALLBACK_CODES,
  formatBytes,
  formatInteger,
  formatNumber,
  formatTimestamp,
  k6ScriptDownloadName,
  k6ScriptUrl,
  manualK6Command,
  metric,
  operationDisplayPath,
  parseK6Summary,
  profileSummary,
  profileTotalSeconds,
  renderPayloadStrategyHelp,
  renderPayloadStrategyLabel,
  statusDistribution,
  type K6Metric,
  type K6Summary,
  type RampPlot,
  type ReportLoadProfile,
  type ReportLoadStage,
  type ReportOperation,
  type TestRun,
} from './k6Report.ts'
import { EMPTY_TIME_SERIES, fetchTimeSeries, type TimeSeriesResponse } from './timeSeries.ts'
import { RunStatusView } from './runStatusView.tsx'
import { useRunClock } from './useRunClock.ts'

type TestRunReportPageProps = {
  runId: string
}

export function TestRunReportPage({ runId }: TestRunReportPageProps) {
  const [run, setRun] = useState<TestRun>()
  const [generatedScript, setGeneratedScript] = useState<string>()
  const [scriptError, setScriptError] = useState('')
  const [error, setError] = useState('')
  // Time-series from InfluxDB. Only loaded once, as soon as the run
  // is COMPLETED. EMPTY_TIME_SERIES means "not yet loaded or not
  // available" — the RampCard then renders only the target line.
  const [timeSeries, setTimeSeries] = useState<TimeSeriesResponse>(EMPTY_TIME_SERIES)
  const [timeSeriesLoaded, setTimeSeriesLoaded] = useState(false)
  // Live tick for the runtime display during QUEUED/RUNNING. Provides
  // a millisecond-precise timestamp to <RunStatusView> so that
  // "Running since" / "Remaining" update without polling.
  const runNow = useRunClock(run)

  useEffect(() => {
    const previousTitle = document.title
    document.title = `k6-Testbericht ${runId}`
    return () => { document.title = previousTitle }
  }, [runId])

  useEffect(() => {
    let cancelled = false
    let timer: number | undefined

    async function load() {
      try {
        const response = await fetch(`/api/test-runs/${encodeURIComponent(runId)}`)
        if (!response.ok) throw new Error(response.status === 404 ? 'Der Testlauf wurde nicht gefunden.' : 'Der Testbericht konnte nicht geladen werden.')
        const loaded: TestRun = await response.json()
        if (cancelled) return
        setRun(loaded)
        setError('')
        if (['QUEUED', 'RUNNING'].includes(loaded.status)) timer = window.setTimeout(load, 1000)
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Der Testbericht konnte nicht geladen werden.')
      }
    }

    load()
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [runId])

  useEffect(() => {
    let cancelled = false

    async function loadScript() {
      try {
        const response = await fetch(k6ScriptUrl(runId))
        if (!response.ok) throw new Error(response.status === 404 ? 'Das generierte k6-Skript wurde nicht gefunden.' : 'Das generierte k6-Skript konnte nicht geladen werden.')
        const script = await response.text()
        if (!cancelled) {
          setGeneratedScript(script)
          setScriptError('')
        }
      } catch (cause) {
        if (!cancelled) setScriptError(cause instanceof Error ? cause.message : 'Das generierte k6-Skript konnte nicht geladen werden.')
      }
    }

    loadScript()
    return () => { cancelled = true }
  }, [runId])

  // Polling of the time series: once after COMPLETED. Earlier
  // statuses (QUEUED/RUNNING) do not yield useful data from InfluxDB
  // anyway; FAILED runs are uninteresting for the load curve.
  useEffect(() => {
    if (!run) return
    if (run.status !== 'COMPLETED') return
    if (timeSeriesLoaded) return
    let cancelled = false
    fetchTimeSeries(runId).then(data => {
      if (cancelled) return
      setTimeSeries(data)
      setTimeSeriesLoaded(true)
    })
    return () => { cancelled = true }
  }, [run, runId, timeSeriesLoaded])

  if (error) return <ReportShell><div className="report-alert failure">{error}</div></ReportShell>
  if (!run) return <ReportShell><div className="report-loading">Testbericht wird geladen …</div></ReportShell>

  const summary = parseK6Summary(run)
  return <ReportShell>
    <ReportHeader run={run} />
    {summary
      ? <CompletedReport run={run} summary={summary} generatedScript={generatedScript} scriptError={scriptError} timeSeries={timeSeries} />
      : <PendingOrFailedReport run={run} generatedScript={generatedScript} scriptError={scriptError} now={runNow} />}
  </ReportShell>
}

function ReportShell({ children }: { children: ReactNode }) {
  return <main className="report-page">
    <div className="report-toolbar">
      <a href="/">← Zur Anwendung</a>
      <button type="button" onClick={() => window.print()}>Drucken / als PDF speichern</button>
    </div>
    {children}
  </main>
}

function ReportHeader({ run }: { run: TestRun }) {
  const configuration = run.configuration
  return <>
    <div className="report-brand">
      <div className="report-logo">k6</div>
      <div><strong>lasttest</strong><span>Swagger/OpenAPI-basierter Lasttest</span></div>
    </div>
    <div className="report-title-row">
      <div>
        <span className="report-eyebrow">k6-Testbericht</span>
        <h1>{configuration?.apiTitle ?? 'Testlauf'}</h1>
        <p>{configuration ? `${configuration.apiVersion} · ${configuration.baseUrl}` : `Run-ID ${run.id}`}</p>
      </div>
      <div className={`report-status ${run.status.toLowerCase()}`}>{run.status}</div>
    </div>
  </>
}

function CompletedReport({
  run,
  summary,
  generatedScript,
  scriptError,
  timeSeries,
}: {
  run: TestRun
  summary: K6Summary
  generatedScript?: string
  scriptError: string
  timeSeries: TimeSeriesResponse
}) {
  const checks = metric(summary, 'checks')
  const requests = metric(summary, 'http_reqs')
  const failed = metric(summary, 'http_req_failed')
  const duration = metric(summary, 'http_req_duration')
  const iterations = metric(summary, 'iterations')
  const requestCount = completedRequestCount(summary)
  const checkRate = checkSuccessRate(summary)
  const failureRate = failed.value == null ? undefined : failed.value * 100
  const durationThresholdPassed = (duration['p(95)'] ?? Number.POSITIVE_INFINITY) < 1000
  const failureThresholdPassed = (failed.value ?? Number.POSITIVE_INFINITY) < 0.05

  return <>
    <section className="report-section">
      <h2>Zusammenfassung</h2>
      {requestCount == null || requestCount === 0
        ? <div className="report-alert failure">Keine HTTP-Anfrage wurde abgeschlossen. Das Ziel war aus dem k6-Container nicht erreichbar oder antwortete nicht rechtzeitig. Prüfe DNS, Firewall, Proxy und den Zugriff aus dem Container.</div>
        : null}
      <div className="report-cards">
        <ReportCard label="Checks erfolgreich" value={formatPercentage(checkRate)} detail={`${formatInteger(checks.passes)} bestanden, ${formatInteger(checks.fails)} fehlgeschlagen`} success={checkRate === 100} />
        <ReportCard label="HTTP-Fehlerrate" value={formatPercentage(failureRate)} detail={`${formatInteger(requestCount)} Requests insgesamt`} success={failureRate != null && failureRate < 5} />
        <ReportCard label="p(95) Antwortzeit" value={`${formatNumber(duration['p(95)'])} ms`} detail="Grenzwert: < 1.000 ms" success={durationThresholdPassed} />
        <ReportCard label="HTTP Requests" value={formatInteger(requests.count)} detail={`${formatNumber(requests.rate)} Requests/s`} />
        <ReportCard label="Iterationen" value={formatInteger(iterations.count)} detail={`${formatNumber(iterations.rate)} Iterationen/s`} />
        <ReportCard label="Maximale Antwortzeit" value={`${formatNumber(duration.max)} ms`} detail={`Durchschnitt ${formatNumber(duration.avg)} ms`} />
      </div>

      <h3>Thresholds</h3>
      <div className="report-thresholds">
        <Threshold passed={durationThresholdPassed} name="http_req_duration">p(95) = {formatNumber(duration['p(95)'])} ms &lt; 1.000 ms</Threshold>
        <Threshold passed={failureThresholdPassed} name="http_req_failed">Rate = {formatPercentage(failureRate)} &lt; 5 %</Threshold>
      </div>

      <h3>Laufdaten</h3>
      <div className="report-info-grid">
        <ReportInfo label="Status" value={run.status} />
        <ReportInfo label="Exit-Code" value={run.exitCode?.toString() ?? '–'} />
        <ReportInfo label="Erstellt" value={formatTimestamp(run.createdAt)} />
        <ReportInfo label="Gestartet" value={formatTimestamp(run.startedAt)} />
        <ReportInfo label="Beendet" value={formatTimestamp(run.finishedAt)} />
        <ReportInfo label="Run-ID" value={run.id} code />
      </div>
    </section>

    <TestConfiguration run={run} />
    {run.configuration && <RampSection profile={run.configuration.loadProfile} timeSeries={timeSeries} />}
    <StatusCodeDistribution summary={summary} run={run} />
    <DetailedMetrics summary={summary} />
    <RawResults run={run} generatedScript={generatedScript} scriptError={scriptError} />
  </>
}

function formatPercentage(value: number | undefined): string {
  return value == null ? '–' : `${formatNumber(value)} %`
}

function ReportCard({ label, value, detail, success = false }: { label: string, value: string, detail: string, success?: boolean }) {
  return <div className="report-card">
    <span>{label}</span>
    <strong className={success ? 'success' : ''}>{value}</strong>
    <small>{detail}</small>
  </div>
}

function Threshold({ passed, name, children }: { passed: boolean, name: string, children: ReactNode }) {
  return <div className={`report-threshold ${passed ? 'passed' : 'failed'}`}>
    <strong>{passed ? '✓' : '✕'} {name}</strong>
    <span>{children}</span>
  </div>
}

function ReportInfo({ label, value, code = false, help }: { label: string, value: string, code?: boolean, help?: string }) {
  return <div className="report-info">
    <span>{label}</span>
    {code ? <code>{value}</code> : <strong>{value}</strong>}
    {help && <small className="report-info-help">{help}</small>}
  </div>
}

function TestConfiguration({ run }: { run: TestRun }) {
  const configuration = run.configuration
  return <section className="report-section">
    <h2>Testkonfiguration</h2>
    {!configuration ? <div className="report-alert">Für diesen älteren Testlauf sind keine Konfigurationsdaten gespeichert.</div> : <>
      <div className="report-info-grid">
        <ReportInfo label="API-Titel" value={configuration.apiTitle} />
        <ReportInfo label="API-Version" value={configuration.apiVersion || '–'} />
        <ReportInfo label="Base URL" value={configuration.baseUrl} code />
        <ReportInfo label="Lastprofil" value={profileSummary(configuration.loadProfile)} />
        <ReportInfo
          label="Geplante Laufzeit"
          value={(() => {
            const total = profileTotalSeconds(configuration.loadProfile)
            return total == null ? 'Bis zur letzten Antwort' : `${total} Sekunden`
          })()}
        />
        <ReportInfo label="Ausgewählte Operationen" value={configuration.operations.length.toString()} />
        <ReportInfo
          label="Payload-Strategie"
          value={renderPayloadStrategyLabel(configuration.payloadStrategy)}
          help={renderPayloadStrategyHelp(configuration.payloadStrategy)}
        />
      </div>
      <h3>Getestete Endpunkte</h3>
      <div className="report-operations">
        {configuration.operations.map(operation => <ReportOperationCard key={operation.operationId} operation={operation} />)}
      </div>
    </>}
  </section>
}

function ReportOperationCard({ operation }: { operation: ReportOperation }) {
  // When the run was started with the pool feature, `payloads` carries
  // every dataset the generator cycled through or sampled from. The
  // report lists all of them so the user can see exactly which request
  // shapes hit the target. When `payloads` is empty (legacy runs that
  // pre-date the pool feature) we fall back to the flat fields, which
  // keep rendering exactly like before.
  const hasPool = operation.payloads.length > 1
  const singlePayloadFallback = operation.payloads.length === 0
  return <article className="report-operation">
    <div className="report-operation-title">
      <span className={`method ${operation.method.toLowerCase()}`}>{operation.method}</span>
      <code>{operationDisplayPath(operation)}</code>
      {hasPool && <span className="report-operation-pill">{operation.payloads.length} Payloads im Pool</span>}
    </div>
    <p><strong>{operation.operationId}</strong>{operation.summary ? ` · ${operation.summary}` : ''}</p>
    {hasPool ? (
      <div className="report-payload-list">
        {operation.payloads.map((payload, index) => (
          <div key={index} className="report-payload-card">
            <h4>Payload {index + 1}</h4>
            {payload.parameterValues.length > 0 && <div className="report-parameter-list">
              {payload.parameterValues.map(parameter => <div key={`${parameter.location}:${parameter.name}`}>
                <span>{parameter.location}</span><strong>{parameter.name}</strong><code>{parameter.value || 'leer / nicht gesendet'}</code>
              </div>)}
            </div>}
            <p>Bearer-Token: <strong>{payload.bearerTokenConfigured === true ? 'konfiguriert (aus Sicherheitsgründen ausgeblendet)' : 'nicht konfiguriert'}</strong></p>
            {payload.requestBodyJson != null && <details><summary>JSON Request-Body</summary><pre>{payload.requestBodyJson || 'Kein Request-Body gesendet'}</pre></details>}
          </div>
        ))}
      </div>
    ) : (
      <>
        {operation.parameterValues.length > 0 && <div className="report-parameter-list">
          {operation.parameterValues.map(parameter => <div key={`${parameter.location}:${parameter.name}`}>
            <span>{parameter.location}</span><strong>{parameter.name}</strong><code>{parameter.value || 'leer / nicht gesendet'}</code>
          </div>)}
        </div>}
        <p>Bearer-Token: <strong>{operation.bearerTokenConfigured ? 'konfiguriert (aus Sicherheitsgründen ausgeblendet)' : 'nicht konfiguriert'}</strong></p>
        {operation.requestBodyJson != null && <details><summary>JSON Request-Body</summary><pre>{operation.requestBodyJson || 'Kein Request-Body gesendet'}</pre></details>}
        {singlePayloadFallback && <p className="report-legacy-note">Hinweis: Dieser Testlauf wurde vor dem Payload-Pool-Feature gestartet; die oben gezeigten Werte entsprechen dem einzelnen Datensatz, der an den Endpunkt gesendet wurde.</p>}
      </>
    )}
  </article>
}

function StatusCodeDistribution({ summary, run }: { summary: K6Summary, run: TestRun }) {
  const operationIds = run.configuration?.operations.map(operation => operation.operationId) ?? []
  if (operationIds.length === 0) return null
  const rows = statusDistribution(summary, operationIds)
  // Only show status codes that actually fired. Fallback columns
  // (`err`, `other`) are always rendered so the user sees network
  // errors and unexpected codes even when they never appeared.
  const columns = activeStatusCodes(rows)
  if (columns.length === 0) return null
  const totals: Record<string, number> = {}
  for (const code of columns) totals[String(code)] = 0
  let grandTotal = 0
  for (const row of rows) {
    for (const code of columns) {
      totals[String(code)] += row.counts[String(code)] ?? 0
    }
    grandTotal += row.total
  }
  return <section className="report-section">
    <h2>Statuscode-Verteilung</h2>
    <p className="report-section-intro">
      Exakte HTTP-Antwortcodes pro Endpunkt. „err" steht für Netzwerk- oder Verbindungsfehler
      (Status 0, z. B. Verbindungsabbruch, DNS-Fehler oder TLS-Handshake fehlgeschlagen).
      „other" sammelt Antworten mit Statuscodes, die nicht in der vordefinierten Liste enthalten sind.
    </p>
    <div className="report-table-scroll">
      <table className="report-table status-distribution">
        <thead>
          <tr>
            <th>Endpunkt</th>
            {columns.map(code => <th key={String(code)} className={headerClassForCode(String(code))}>{renderCodeHeader(String(code))}</th>)}
            <th>Summe</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => <tr key={row.operationId}>
            <th scope="row"><code>{row.operationId}</code></th>
            {columns.map(code => {
              const key = String(code)
              const count = row.counts[key] ?? 0
              return <td key={key} className={cellClassForCode(key, count)}>{formatInteger(count)}</td>
            })}
            <td><strong>{formatInteger(row.total)}</strong></td>
          </tr>)}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Gesamt</th>
            {columns.map(code => <td key={String(code)}><strong>{formatInteger(totals[String(code)])}</strong></td>)}
            <td><strong>{formatInteger(grandTotal)}</strong></td>
          </tr>
        </tfoot>
      </table>
    </div>
  </section>
}

// Header label: numeric codes stay numeric; `err` and `other` keep
// their symbolic names so the user can spot them at a glance.
function renderCodeHeader(code: string): string {
  return code
}

// ----- Payload-Strategie-Labels -----------------------------------------
// Implementation lives in `./k6Report.ts` so the helper is unit-tested
// and covered by the npm test coverage gate.

function headerClassForCode(code: string): string {
  if (FALLBACK_CODES.includes(code as typeof FALLBACK_CODES[number])) return `status-header-${code}`
  if (code.startsWith('4') || code.startsWith('5')) return `status-header-${code[0]}xx`
  return ''
}

function cellClassForCode(code: string, count: number): string {
  if (count === 0) return 'status-empty'
  if (FALLBACK_CODES.includes(code as typeof FALLBACK_CODES[number])) return `status-${code}`
  const firstDigit = code[0]
  if (firstDigit === '4' || firstDigit === '5') return `status-${firstDigit}xx`
  return ''
}

const durationMetrics: Array<[string, string]> = [
  ['HTTP Request Duration', 'http_req_duration'],
  ['HTTP Waiting', 'http_req_waiting'],
  ['HTTP Sending', 'http_req_sending'],
  ['HTTP Receiving', 'http_req_receiving'],
  ['HTTP Connecting', 'http_req_connecting'],
  ['TLS Handshake', 'http_req_tls_handshaking'],
  ['HTTP Blocked', 'http_req_blocked'],
  ['Iteration Duration', 'iteration_duration'],
]

function DetailedMetrics({ summary }: { summary: K6Summary }) {
  const requests = metric(summary, 'http_reqs')
  const iterations = metric(summary, 'iterations')
  const checks = metric(summary, 'checks')
  const received = metric(summary, 'data_received')
  const sent = metric(summary, 'data_sent')
  return <section className="report-section">
    <h2>Detaillierte k6-Metriken</h2>
    <div className="report-table-scroll">
      <table className="report-table">
        <thead><tr><th>Metrik</th><th>Ø</th><th>Minimum</th><th>Median</th><th>p(90)</th><th>p(95)</th><th>Maximum</th></tr></thead>
        <tbody>{durationMetrics.map(([label, name]) => <DurationRow key={name} label={label} value={metric(summary, name)} />)}</tbody>
      </table>
    </div>
    <div className="report-cards compact">
      <ReportCard label="HTTP Requests" value={formatInteger(requests.count)} detail={`${formatNumber(requests.rate)}/s`} />
      <ReportCard label="Iterationen" value={formatInteger(iterations.count)} detail={`${formatNumber(iterations.rate)}/s`} />
      <ReportCard label="Checks" value={formatInteger((checks.passes ?? 0) + (checks.fails ?? 0))} detail={`${formatInteger(checks.passes)} erfolgreich`} />
      <ReportCard label="Daten empfangen" value={formatBytes(received.count)} detail={`${formatBytes(received.rate)}/s`} />
      <ReportCard label="Daten gesendet" value={formatBytes(sent.count)} detail={`${formatBytes(sent.rate)}/s`} />
    </div>
  </section>
}

function DurationRow({ label, value }: { label: string, value: K6Metric }) {
  return <tr>
    <th>{label}</th>
    <td>{formatNumber(value.avg)} ms</td>
    <td>{formatNumber(value.min)} ms</td>
    <td>{formatNumber(value.med)} ms</td>
    <td>{formatNumber(value['p(90)'])} ms</td>
    <td>{formatNumber(value['p(95)'])} ms</td>
    <td>{formatNumber(value.max)} ms</td>
  </tr>
}

function RawResults({
  run,
  generatedScript,
  scriptError,
}: {
  run: TestRun
  generatedScript?: string
  scriptError: string
}) {
  return <section className="report-section report-raw">
    <h2>Rohdaten</h2>
    {run.error && <details><summary>Vollständige k6-Konsolenausgabe</summary><pre>{run.error}</pre></details>}
    {run.summary && <details><summary>Vollständiger k6-JSON-Export</summary><pre>{formatJson(run.summary.raw)}</pre></details>}
    <GeneratedK6Script run={run} generatedScript={generatedScript} scriptError={scriptError} />
  </section>
}

function GeneratedK6Script({
  run,
  generatedScript,
  scriptError,
}: {
  run: TestRun
  generatedScript?: string
  scriptError: string
}) {
  const command = manualK6Command(run.configuration, run.id)
  return <>
    <details className="report-script">
      <summary>Generiertes k6-Testskript</summary>
      {scriptError && <div className="report-alert failure">{scriptError}</div>}
      {!generatedScript && !scriptError && <div className="report-loading">k6-Testskript wird geladen …</div>}
      {generatedScript && <>
        <div className="script-warning"><strong>Sicherheitshinweis:</strong> Das exportierte Skript kann konfigurierte Header und Bearer-Tokens enthalten. Bitte sicher verwahren.</div>
        <pre data-testid="generated-k6-script">{generatedScript}</pre>
        <div className="script-actions">
          <a
            className="script-download"
            href={k6ScriptUrl(run.id)}
            download={k6ScriptDownloadName(run.id)}
          >k6-Testskript herunterladen (.js) ↓</a>
        </div>
        <div className="script-command">
          <div className="script-command-header">
            <span>Manueller Start</span>
            <CopyButton
              text={command}
              label="Befehl kopieren"
              copiedLabel="Kopiert ✓"
              ariaLabel="Manuellen k6-Startbefehl in die Zwischenablage kopieren"
              copiedAriaLabel="k6-Startbefehl in die Zwischenablage kopiert"
            />
          </div>
          <code>{command}</code>
        </div>
      </>}
    </details>
  </>
}

function PendingOrFailedReport({
  run,
  generatedScript,
  scriptError,
  now,
}: {
  run: TestRun
  generatedScript?: string
  scriptError: string
  now: number
}) {
  return <section className="report-section">
    <h2>Testlauf</h2>
    <div className={`report-alert ${run.status === 'FAILED' ? 'failure' : ''}`}>
      Status: <strong>{run.status}</strong>. {['QUEUED', 'RUNNING'].includes(run.status)
        ? 'Die Ansicht aktualisiert sich automatisch.'
        : run.status === 'FAILED'
          ? 'Die Analyse der Fehlerursache findest du direkt unter diesem Hinweis.'
          : 'Es ist kein k6-Summary verfügbar.'}
    </div>
    <RunStatusView run={run} now={now} />
    <TestConfiguration run={run} />
    {run.error && <pre>{run.error}</pre>}
    <GeneratedK6Script run={run} generatedScript={generatedScript} scriptError={scriptError} />
  </section>
}

function formatJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

// ---- Load profile & Ramp chart -------------------------------------------
//
// The target line (purple) is computed deterministically from the stages.
// The actual line (orange) comes from the InfluxDB stream and is only
// visible when the backend was able to deliver time-series data.

function RampSection({ profile, timeSeries }: { profile: ReportLoadProfile, timeSeries: TimeSeriesResponse }) {
  return <section className="report-section">
    <h2>Lastprofil &amp; Lastverlauf</h2>
    <p className="report-section-intro">
      Diese Sektion zeigt, welches Profil k6 gefahren ist und welche Last dabei aufgebaut wurde.
      Die Soll-Linie (lila) wird direkt aus deinen konfigurierten Stages abgeleitet. Die Ist-Linie
      (orange, gestrichelt) stammt aus dem Live-Stream nach InfluxDB.
    </p>
    <RampCard profile={profile} timeSeries={timeSeries} />
    <StagesDetail profile={profile} />
  </section>
}

function RampCard({ profile, timeSeries }: { profile: ReportLoadProfile, timeSeries: TimeSeriesResponse }) {
  const plot = buildRampPlot(profile, timeSeries.vus, { width: 720, height: 200 })
  const sollPath = buildSollPath(plot)
  const istPath = buildIstPath(plot)
  const hasIst = istPath.length > 0
  const peakSoll = peakFromSoll(profile)
  const peakIst = hasIst ? timeSeries.vus.reduce((max, point) => Math.max(max, point.value), 0) : undefined
  return <div className="ramp-card">
    <div className="ramp-header">
      <div className="ramp-title">
        <h3>Geplanter Lastverlauf</h3>
        <small>· Soll aus Stages, Ist aus InfluxDB</small>
      </div>
      <div className="ramp-legend">
        <span><span className="swatch soll" />Geplant (Soll)</span>
        <span><span className="swatch ist" />Tatsächlich (Ist)</span>
      </div>
    </div>
    <div className="ramp-svg-wrap">
      <RampSvg plot={plot} sollPath={sollPath} istPath={istPath} hasIst={hasIst} />
    </div>
    <div className="ramp-callout">
      <div>
        <span>Geplante Spitze</span>
        <strong>{formatInteger(peakSoll)} VUs</strong>
        <small>Aus Stages berechnet</small>
      </div>
      <div>
        <span>Tatsächliche Spitze</span>
        <strong style={hasIst ? undefined : { color: '#93370d' }}>
          {hasIst ? `${formatInteger(peakIst)} VUs` : '–'}
        </strong>
        <small>{hasIst ? 'Aus InfluxDB (max vus)' : 'Noch keine Daten aus InfluxDB'}</small>
      </div>
      <div>
        <span>Datenpunkte</span>
        <strong>{formatInteger(timeSeries.vus.length)}</strong>
        <small>Aus dem k6-Stream</small>
      </div>
    </div>
  </div>
}

function RampSvg({ plot, sollPath, istPath, hasIst }: { plot: RampPlot, sollPath: string, istPath: string, hasIst: boolean }) {
  // We render the SVG in a fixed viewBox and let the browser scale
  // it to 100% width via CSS. Y-ticks (5 pieces) and X-ticks
  // (5 pieces) are labelled automatically; the exact scale is not
  // critical because the renderer only provides a qualitative
  // visualisation.
  const top = 20
  const bottom = plot.height
  const left = 0
  const right = plot.width
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(fraction => ({
    fraction,
    value: Math.round(plot.maxValue * fraction),
  }))
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map(fraction => ({
    fraction,
    seconds: Math.round(plot.maxSeconds * fraction),
  }))
  return <svg className="ramp-svg" viewBox={`0 0 ${plot.width} ${plot.height + 40}`} role="img" aria-label="Ramp-Grafik: Soll- und Ist-Verlauf">
    <rect x="0" y="0" width={plot.width} height={plot.height + 40} fill="#fff" />
    {yTicks.map(tick => {
      const y = top + (1 - tick.fraction) * (bottom - top)
      return <g key={`y-${tick.fraction}`}>
        <line x1={left} y1={y} x2={right} y2={y} stroke="#eaecf0" strokeDasharray={tick.fraction === 0 ? '0' : '3,3'} />
        <text x="6" y={y - 4} fontSize="11" fill="#667085">{tick.value}</text>
      </g>
    })}
    {xTicks.map(tick => {
      const x = tick.fraction * plot.width
      return <text key={`x-${tick.fraction}`} x={x} y={plot.height + 34} fontSize="11" fill="#667085" textAnchor="middle">
        {tick.seconds} s
      </text>
    })}
    {sollPath && <g transform={`translate(0, ${top})`}>
      <path d={sollPath} fill="none" stroke="#7d63ff" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
    </g>}
    {hasIst && <g transform={`translate(0, ${top})`}>
      <path d={istPath} fill="none" stroke="#f79009" strokeWidth="2" strokeLinejoin="round" strokeDasharray="5,3" opacity="0.85" />
    </g>}
  </svg>
}

function StagesDetail({ profile }: { profile: ReportLoadProfile }) {
  if (profile.type.toLowerCase().replace(/_/g, '-') !== 'ramping-vus') return null
  const stages = profile.stages ?? []
  return <>
    <h3>Stages im Detail</h3>
    <div className="report-table-scroll">
      <table className="report-table" aria-label="Stages des Lastprofils">
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>#</th>
            <th>Ziel-VUs</th>
            <th>Dauer (s)</th>
            <th style={{ textAlign: 'left' }}>Beschreibung</th>
          </tr>
        </thead>
        <tbody>
          {stages.map((stage: ReportLoadStage, index: number) => {
            const previous = (index === 0 ? profile.startVUs : stages[index - 1]?.target) ?? 0
            const delta = stage.target - previous
            const description = delta === 0
              ? 'Plateau'
              : delta > 0
                ? `+${delta} VUs (Rampe auf ${stage.target})`
                : `${delta} VUs (Rampe auf ${stage.target})`
            return <tr key={index}>
              <th scope="row" style={{ textAlign: 'left' }}>{index + 1}</th>
              <td>{stage.target}</td>
              <td>{stage.durationSeconds}</td>
              <td style={{ textAlign: 'left' }}>{description}</td>
            </tr>
          })}
        </tbody>
      </table>
    </div>
  </>
}

function peakFromSoll(profile: ReportLoadProfile): number {
  const type = profile.type.toLowerCase().replace(/_/g, '-')
  switch (type) {
    case 'ramping-vus':
      return (profile.stages ?? []).reduce((max, stage) => Math.max(max, stage.target), profile.startVUs ?? 0)
    case 'constant-vus':
      return profile.virtualUsers ?? 0
    case 'constant-arrival-rate':
      return profile.rate ?? 0
    case 'shared-iterations':
      return profile.virtualUsers ?? 0
    default:
      return 0
  }
}


type CopyButtonProps = {
  text: string
  label: string
  copiedLabel: string
  ariaLabel: string
  copiedAriaLabel: string
}

function CopyButton({ text, label, copiedLabel, ariaLabel, copiedAriaLabel }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timeout = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(timeout)
  }, [copied])

  async function handleClick() {
    if (await copyTextToClipboard(text)) setCopied(true)
  }

  return (
    <button
      type="button"
      className={copied ? 'script-copy copied' : 'script-copy'}
      aria-label={copied ? copiedAriaLabel : ariaLabel}
      onClick={handleClick}
    >
      {copied ? copiedLabel : label}
    </button>
  )
}

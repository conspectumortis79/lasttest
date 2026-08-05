import { useEffect, useState, type ReactNode } from 'react'
import {
  checkSuccessRate,
  completedRequestCount,
  copyTextToClipboard,
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
  type K6Metric,
  type K6Summary,
  type ReportOperation,
  type TestRun,
} from './k6Report.ts'

type TestRunReportPageProps = {
  runId: string
}

export function TestRunReportPage({ runId }: TestRunReportPageProps) {
  const [run, setRun] = useState<TestRun>()
  const [generatedScript, setGeneratedScript] = useState<string>()
  const [scriptError, setScriptError] = useState('')
  const [error, setError] = useState('')

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

  if (error) return <ReportShell><div className="report-alert failure">{error}</div></ReportShell>
  if (!run) return <ReportShell><div className="report-loading">Testbericht wird geladen …</div></ReportShell>

  const summary = parseK6Summary(run)
  return <ReportShell>
    <ReportHeader run={run} />
    {summary
      ? <CompletedReport run={run} summary={summary} generatedScript={generatedScript} scriptError={scriptError} />
      : <PendingOrFailedReport run={run} generatedScript={generatedScript} scriptError={scriptError} />}
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
}: {
  run: TestRun
  summary: K6Summary
  generatedScript?: string
  scriptError: string
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

function ReportInfo({ label, value, code = false }: { label: string, value: string, code?: boolean }) {
  return <div className="report-info">
    <span>{label}</span>
    {code ? <code>{value}</code> : <strong>{value}</strong>}
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
        <ReportInfo label="Modus" value={configuration.useIterations ? `${configuration.virtualUsers} parallele Anfragen (so schnell wie möglich)` : 'Virtuelle Benutzer über Zeit'} />
        <ReportInfo label="Virtuelle Benutzer" value={configuration.virtualUsers.toString()} />
        {configuration.useIterations
          ? <ReportInfo label="Geplante Anfragen" value={configuration.virtualUsers.toString()} />
          : <ReportInfo label="Testdauer" value={`${configuration.durationSeconds} Sekunden`} />}
        <ReportInfo label="Ausgewählte Operationen" value={configuration.operations.length.toString()} />
      </div>
      <h3>Getestete Endpunkte</h3>
      <div className="report-operations">
        {configuration.operations.map(operation => <ReportOperationCard key={operation.operationId} operation={operation} />)}
      </div>
    </>}
  </section>
}

function ReportOperationCard({ operation }: { operation: ReportOperation }) {
  return <article className="report-operation">
    <div className="report-operation-title">
      <span className={`method ${operation.method.toLowerCase()}`}>{operation.method}</span>
      <code>{operationDisplayPath(operation)}</code>
    </div>
    <p><strong>{operation.operationId}</strong>{operation.summary ? ` · ${operation.summary}` : ''}</p>
    {operation.parameterValues.length > 0 && <div className="report-parameter-list">
      {operation.parameterValues.map(parameter => <div key={`${parameter.location}:${parameter.name}`}>
        <span>{parameter.location}</span><strong>{parameter.name}</strong><code>{parameter.value || 'leer / nicht gesendet'}</code>
      </div>)}
    </div>}
    <p>Bearer-Token: <strong>{operation.bearerTokenConfigured ? 'konfiguriert (aus Sicherheitsgründen ausgeblendet)' : 'nicht konfiguriert'}</strong></p>
    {operation.requestBodyJson != null && <details><summary>JSON Request-Body</summary><pre>{operation.requestBodyJson || 'Kein Request-Body gesendet'}</pre></details>}
  </article>
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
}: {
  run: TestRun
  generatedScript?: string
  scriptError: string
}) {
  return <section className="report-section">
    <h2>Testlauf</h2>
    <div className={`report-alert ${run.status === 'FAILED' ? 'failure' : ''}`}>
      Status: <strong>{run.status}</strong>. {['QUEUED', 'RUNNING'].includes(run.status) ? 'Die Ansicht aktualisiert sich automatisch.' : 'Es ist kein k6-Summary verfügbar.'}
    </div>
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

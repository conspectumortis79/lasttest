import { useEffect, useState, type ReactNode } from 'react'
import {
  activeStatusCodes,
  buildIstPath,
  buildRampPlot,
  buildSollPath,
  checkSuccessRate,
  completedRequestCount,
  copyTextToClipboard,
  extractPayloadUsage,
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
import { translate } from './i18n.ts'
import { useLanguage } from './useLanguage.tsx'

type TestRunReportPageProps = {
  runId: string
}

export function TestRunReportPage({ runId }: TestRunReportPageProps) {
  const { language } = useLanguage()
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
    document.title = `${translate(language, 'report.eyebrow')} ${runId}`
    return () => { document.title = previousTitle }
  }, [runId, language])

  useEffect(() => {
    let cancelled = false
    let timer: number | undefined

    async function load() {
      try {
        const response = await fetch(`/api/test-runs/${encodeURIComponent(runId)}`)
        if (!response.ok) throw new Error(response.status === 404 ? translate(language, 'error.reportNotFound') : translate(language, 'error.reportLoad'))
        const loaded: TestRun = await response.json()
        if (cancelled) return
        setRun(loaded)
        setError('')
        if (['QUEUED', 'RUNNING'].includes(loaded.status)) timer = window.setTimeout(load, 1000)
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : translate(language, 'error.reportLoad'))
      }
    }

    load()
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [runId, language])

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
  if (!run) return <ReportShell><div className="report-loading">{translate(language, 'report.loading')}</div></ReportShell>

  const summary = parseK6Summary(run)
  return <ReportShell>
    <ReportHeader run={run} />
    {summary
      ? <CompletedReport run={run} summary={summary} generatedScript={generatedScript} scriptError={scriptError} timeSeries={timeSeries} />
      : <PendingOrFailedReport run={run} generatedScript={generatedScript} scriptError={scriptError} now={runNow} />}
  </ReportShell>
}

function ReportShell({ children }: { children: ReactNode }) {
  const { language } = useLanguage()
  return <main className="report-page">
    <div className="report-toolbar">
      <a href="/">← {language === 'de' ? 'Zur Anwendung' : 'Back to app'}</a>
      <button type="button" onClick={() => window.print()}>{translate(language, 'report.print')}</button>
    </div>
    {children}
  </main>
}

function ReportHeader({ run }: { run: TestRun }) {
  const { language: lang } = useLanguage()
  const configuration = run.configuration
  return <>
    <div className="report-brand">
      <div className="report-logo">k6</div>
      <div><strong>{translate(lang, 'report.brand')}</strong><span>{translate(lang, 'report.brand.tagline')}</span></div>
    </div>
    <div className="report-title-row">
      <div>
        <span className="report-eyebrow">{translate(lang, 'report.eyebrow')}</span>
        <h1>{configuration?.apiTitle ?? translate(lang, 'report.testRun')}</h1>
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
  const { language: lang } = useLanguage()
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
      <h2>{translate(lang, 'report.section.summary')}</h2>
      {requestCount == null || requestCount === 0
        ? <div className="report-alert failure">{translate(lang, 'result.noRequests')}</div>
        : null}
      <div className="report-cards">
        <ReportCard label={translate(lang, 'summary.checksRate')} value={formatPercentage(checkRate)} detail={translate(lang, 'summary.checksDetail', { passed: formatInteger(checks.passes), failed: formatInteger(checks.fails) })} success={checkRate === 100} />
        <ReportCard label={translate(lang, 'summary.failureRate')} value={formatPercentage(failureRate)} detail={translate(lang, 'summary.requestsDetail', { count: formatInteger(requestCount) })} success={failureRate != null && failureRate < 5} />
        <ReportCard label={translate(lang, 'summary.p95')} value={`${formatNumber(duration['p(95)'])} ms`} detail={translate(lang, 'summary.p95.threshold')} success={durationThresholdPassed} />
        <ReportCard label={translate(lang, 'summary.requests')} value={formatInteger(requests.count)} detail={`${formatNumber(requests.rate)} Requests/s`} />
        <ReportCard label={translate(lang, 'summary.iterations')} value={formatInteger(iterations.count)} detail={`${formatNumber(iterations.rate)} Iterationen/s`} />
        <ReportCard label={translate(lang, 'summary.maxResponse')} value={`${formatNumber(duration.max)} ms`} detail={`${lang === 'en' ? 'Average' : 'Durchschnitt'} ${formatNumber(duration.avg)} ms`} />
      </div>

      <h3>{translate(lang, 'report.section.thresholds')}</h3>
      <div className="report-thresholds">
        <Threshold passed={durationThresholdPassed} name="http_req_duration">p(95) = {formatNumber(duration['p(95)'])} ms &lt; 1.000 ms</Threshold>
        <Threshold passed={failureThresholdPassed} name="http_req_failed">Rate = {formatPercentage(failureRate)} &lt; 5 %</Threshold>
      </div>

      <h3>{translate(lang, 'report.section.runtime')}</h3>
      <div className="report-info-grid">
        <ReportInfo label={translate(lang, 'report.runtime.status')} value={run.status} />
        <ReportInfo label={translate(lang, 'report.runtime.exitCode')} value={run.exitCode?.toString() ?? '–'} />
        <ReportInfo label={translate(lang, 'report.runtime.created')} value={formatTimestamp(run.createdAt)} />
        <ReportInfo label={translate(lang, 'report.runtime.started')} value={formatTimestamp(run.startedAt)} />
        <ReportInfo label={translate(lang, 'report.runtime.finished')} value={formatTimestamp(run.finishedAt)} />
        <ReportInfo label={translate(lang, 'report.runtime.runId')} value={run.id} code />
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
  const { language: lang } = useLanguage()
  const configuration = run.configuration
  return <section className="report-section">
    <h2>{translate(lang, 'report.section.config')}</h2>
    {!configuration ? <div className="report-alert">{translate(lang, 'report.section.config.missing')}</div> : <>
      <div className="report-info-grid">
        <ReportInfo label={translate(lang, 'report.config.apiTitle')} value={configuration.apiTitle} />
        <ReportInfo label={translate(lang, 'report.config.apiVersion')} value={configuration.apiVersion || '–'} />
        <ReportInfo label={translate(lang, 'report.config.baseUrl')} value={configuration.baseUrl} code />
        <ReportInfo label={translate(lang, 'report.config.loadProfile')} value={profileSummary(configuration.loadProfile)} />
        <ReportInfo
          label={translate(lang, 'report.config.duration')}
          value={(() => {
            const total = profileTotalSeconds(configuration.loadProfile)
            return total == null ? translate(lang, 'report.config.durationOpen') : translate(lang, 'report.config.durationSeconds', { seconds: total })
          })()}
        />
        <ReportInfo label={translate(lang, 'report.config.operationCount')} value={configuration.operations.length.toString()} />
        <ReportInfo
          label={translate(lang, 'report.config.payloadStrategy')}
          value={renderPayloadStrategyLabel(configuration.payloadStrategy)}
          help={renderPayloadStrategyHelp(configuration.payloadStrategy)}
        />
      </div>
      <h3>{translate(lang, 'report.section.endpoints')}</h3>
      <div className="report-operations">
        {configuration.operations.map(operation => <ReportOperationCard key={operation.operationId} operation={operation} run={run} />)}
      </div>
    </>}
  </section>
}

function ReportOperationCard({ operation, run }: { operation: ReportOperation, run: TestRun }) {
  const { language: lang } = useLanguage()
  // When the run was started with the pool feature, `payloads` carries
  // every dataset the generator cycled through or sampled from. The
  // report lists all of them so the user can see exactly which request
  // shapes hit the target. When `payloads` is empty (legacy runs that
  // pre-date the pool feature) we fall back to the flat fields, which
  // keep rendering exactly like before.
  const hasPool = operation.payloads.length > 1
  const singlePayloadFallback = operation.payloads.length === 0
  // Per-payload call counts read straight from the k6 summary. The
  // generator emits one `lt_payload_<i>_<opId>` counter per entry in
  // the pool; the report renders them next to the configured payload
  // cards so the user can verify the strategy at a glance.
  const usage = extractPayloadUsage(run, operation.operationId)
  const totalCalls = usage.reduce((sum, entry) => sum + entry.count, 0)
  return <article className="report-operation">
    <div className="report-operation-title">
      <span className={`method ${operation.method.toLowerCase()}`}>{operation.method}</span>
      <code>{operationDisplayPath(operation)}</code>
      {hasPool && <span className="report-operation-pill">{translate(lang, 'report.pool.payloads', { n: operation.payloads.length })}</span>}
    </div>
    <p><strong>{operation.operationId}</strong>{operation.summary ? ` · ${operation.summary}` : ''}</p>
    {hasPool && usage.length > 0 && (
      <div className="report-payload-usage">
        <h4>{translate(lang, 'report.distribution.title')}</h4>
        <p className="report-payload-usage-hint">
          {translate(lang, 'report.distribution.hint')}
        </p>
        <table className="report-table report-usage-table">
          <thead>
            <tr>
              <th>{translate(lang, 'report.distribution.col.payload')}</th>
              {operation.payloads[0]?.parameterValues.length ? <th>{translate(lang, 'report.distribution.col.params')}</th> : null}
              <th>{translate(lang, 'report.distribution.col.calls')}</th>
              <th>{translate(lang, 'report.distribution.col.share')}</th>
            </tr>
          </thead>
          <tbody>
            {usage.map(entry => {
              const payload = operation.payloads[entry.index]
              const calls = entry.count
              const percent = totalCalls > 0 ? (calls / totalCalls) * 100 : 0
              return (
                <tr key={entry.index}>
                  <th scope="row">{translate(lang, 'report.distribution.payload', { n: entry.index + 1 })}</th>
                  {payload?.parameterValues.length ? (
                    <td>
                      {payload.parameterValues.map(v => `${v.name}=${v.value}`).join(', ') || translate(lang, 'report.distribution.params.empty')}
                    </td>
                  ) : null}
                  <td><strong>{calls}</strong></td>
                  <td>
                    <div className="report-usage-bar-row">
                      <span className="report-usage-percent">{percent.toFixed(0)} %</span>
                      <span className="report-usage-bar" style={{ width: `${percent}%` }} aria-hidden="true"></span>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">{translate(lang, 'report.distribution.total')}</th>
              {operation.payloads[0]?.parameterValues.length ? <td></td> : null}
              <td><strong>{totalCalls}</strong></td>
              <td>100 %</td>
            </tr>
          </tfoot>
        </table>
      </div>
    )}
    {hasPool ? (
      // Multi-payload path: the call distribution table above
      // already shows parameter values, call counts and the share
      // per payload, so the per-payload cards (which used to
      // duplicate the same information in a much larger layout) are
      // intentionally omitted. The body / token configuration is
      // still available via the flat fields on the operation card
      // when the user needs it.
      null
    ) : (
      <>
        {operation.parameterValues.length > 0 && <div className="report-parameter-list">
          {operation.parameterValues.map(parameter => <div key={`${parameter.location}:${parameter.name}`}>
            <span>{parameter.location}</span><strong>{parameter.name}</strong><code>{parameter.value || translate(lang, 'report.payload.params.empty')}</code>
          </div>)}
        </div>}
        <div className="report-auth-list">
          <p className="report-auth-heading">{translate(lang, 'report.payload.auth.heading')}</p>
          <ul>
            <li>
              <strong>
                {operation.bearerTokenConfigured
                  ? translate(lang, 'report.payload.bearer.configured')
                  : translate(lang, 'report.payload.bearer.notConfigured')}
              </strong>
            </li>
            {operation.basicAuthConfigured && (
              <li>
                <strong>{translate(lang, 'report.payload.basic.configured')}</strong>
              </li>
            )}
            {!operation.basicAuthConfigured && (
              <li>
                {translate(lang, 'report.payload.basic.notConfigured')}
              </li>
            )}
            <li>
              <strong>
                {operation.apiKeyConfigured
                  ? translate(lang, 'report.payload.apiKey.configured')
                  : translate(lang, 'report.payload.apiKey.notConfigured')}
              </strong>
            </li>
            <li>
              <strong>
                {operation.oauth2TokenConfigured
                  ? translate(lang, 'report.payload.oauth2.configured')
                  : translate(lang, 'report.payload.oauth2.notConfigured')}
              </strong>
            </li>
          </ul>
        </div>
        {operation.requestBodyJson != null && <details><summary>{translate(lang, 'report.payload.jsonSummary')}</summary><pre>{operation.requestBodyJson || translate(lang, 'report.payload.jsonEmpty')}</pre></details>}
        {singlePayloadFallback && <p className="report-legacy-note">{translate(lang, 'report.legacy.hint')}</p>}
      </>
    )}
  </article>
}

function StatusCodeDistribution({ summary, run }: { summary: K6Summary, run: TestRun }) {
  const { language: lang } = useLanguage()
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
    <h2>{translate(lang, 'report.statusCode.title')}</h2>
    <p className="report-section-intro">
      {translate(lang, 'report.statusCode.intro')}
    </p>
    <div className="report-table-scroll">
      <table className="report-table status-distribution">
        <thead>
          <tr>
            <th>{translate(lang, 'report.statusCode.col.endpoint')}</th>
            {columns.map(code => <th key={String(code)} className={headerClassForCode(String(code))}>{renderCodeHeader(String(code))}</th>)}
            <th>{translate(lang, 'report.statusCode.col.sum')}</th>
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
            <th scope="row">{translate(lang, 'report.statusCode.total')}</th>
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
  const { language: lang } = useLanguage()
  const iterations = metric(summary, 'iterations')
  const checks = metric(summary, 'checks')
  const received = metric(summary, 'data_received')
  const sent = metric(summary, 'data_sent')
  return <section className="report-section">
    <h2>{translate(lang, 'report.metrics.title')}</h2>
    <div className="report-table-scroll">
      <table className="report-table">
        <thead><tr><th>{translate(lang, 'report.metrics.col.metric')}</th><th>{translate(lang, 'report.metrics.col.avg')}</th><th>{translate(lang, 'report.metrics.col.min')}</th><th>{translate(lang, 'report.metrics.col.median')}</th><th>{translate(lang, 'report.metrics.col.p90')}</th><th>{translate(lang, 'report.metrics.col.p95')}</th><th>{translate(lang, 'report.metrics.col.max')}</th></tr></thead>
        <tbody>{durationMetrics.map(([label, name]) => <DurationRow key={name} label={label} value={metric(summary, name)} />)}</tbody>
      </table>
    </div>
    <div className="report-cards compact">
      <ReportCard label={translate(lang, 'summary.requests')} value={formatInteger(requests.count)} detail={`${formatNumber(requests.rate)}/s`} />
      <ReportCard label={translate(lang, 'summary.iterations')} value={formatInteger(iterations.count)} detail={`${formatNumber(iterations.rate)}/s`} />
      <ReportCard label={translate(lang, 'summary.checks')} value={formatInteger((checks.passes ?? 0) + (checks.fails ?? 0))} detail={`${formatInteger(checks.passes)} ${lang === 'en' ? 'passed' : 'erfolgreich'}`} />
      <ReportCard label={translate(lang, 'report.metrics.dataReceived')} value={formatBytes(received.count)} detail={`${formatBytes(received.rate)}/s`} />
      <ReportCard label={translate(lang, 'report.metrics.dataSent')} value={formatBytes(sent.count)} detail={`${formatBytes(sent.rate)}/s`} />
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
  const { language: lang } = useLanguage()
  return <section className="report-section report-raw">
    <h2>{translate(lang, 'report.rawData')}</h2>
    {run.error && <details><summary>{translate(lang, 'report.console')}</summary><pre>{run.error}</pre></details>}
    {run.summary && <details><summary>{translate(lang, 'report.json')}</summary><pre>{formatJson(run.summary.raw)}</pre></details>}
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
  const { language: lang } = useLanguage()
  const command = manualK6Command(run.configuration, run.id)
  return <>
    <details className="report-script">
      <summary>{translate(lang, 'report.script')}</summary>
      {scriptError && <div className="report-alert failure">{scriptError}</div>}
      {!generatedScript && !scriptError && <div className="report-loading">{translate(lang, 'common.loading')}</div>}
      {generatedScript && <>
        <div className="script-warning"><strong>{translate(lang, 'report.script.warning', { strong: 'strong' })}</strong> {translate(lang, 'report.script.warningBody')}</div>
        <pre data-testid="generated-k6-script">{generatedScript}</pre>
        <div className="script-actions">
          <a
            className="script-download"
            href={k6ScriptUrl(run.id)}
            download={k6ScriptDownloadName(run.id)}
          >{translate(lang, 'report.script.download')} (.js) ↓</a>
        </div>
        <div className="script-command">
          <div className="script-command-header">
            <span>{translate(lang, 'report.manualStart')}</span>
            <CopyButton
              text={command}
              label={translate(lang, 'report.command.copy')}
              copiedLabel={translate(lang, 'report.command.copied')}
              ariaLabel={translate(lang, 'report.command.copyAria')}
              copiedAriaLabel={translate(lang, 'report.command.copiedAria')}
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
  const { language: lang } = useLanguage()
  return <section className="report-section">
    <h2>{translate(lang, 'report.testRun')}</h2>
    <div className={`report-alert ${run.status === 'FAILED' ? 'failure' : ''}`}>
      {translate(lang, 'report.status', { status: run.status })}, {['QUEUED', 'RUNNING'].includes(run.status)
        ? translate(lang, 'report.autoRefresh')
        : run.status === 'FAILED'
          ? translate(lang, 'report.seeAnalysis')
          : translate(lang, 'result.noData')}
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
  const { language: lang } = useLanguage()
  return <section className="report-section">
    <h2>{translate(lang, 'report.ramp.sectionTitle')}</h2>
    <p className="report-section-intro">
      {translate(lang, 'report.ramp.intro')}
    </p>
    <RampCard profile={profile} timeSeries={timeSeries} />
    <StagesDetail profile={profile} />
  </section>
}

function RampCard({ profile, timeSeries }: { profile: ReportLoadProfile, timeSeries: TimeSeriesResponse }) {
  const { language: lang } = useLanguage()
  const plot = buildRampPlot(profile, timeSeries.vus, { width: 720, height: 200 })
  const sollPath = buildSollPath(plot)
  const istPath = buildIstPath(plot)
  const hasIst = istPath.length > 0
  const peakSoll = peakFromSoll(profile)
  const peakIst = hasIst ? timeSeries.vus.reduce((max, point) => Math.max(max, point.value), 0) : undefined
  return <div className="ramp-card">
    <div className="ramp-header">
      <div className="ramp-title">
        <h3>{translate(lang, 'report.ramp.title')}</h3>
        <small>{translate(lang, 'report.ramp.sourceHint')}</small>
      </div>
      <div className="ramp-legend">
        <span><span className="swatch soll" />{translate(lang, 'report.ramp.soll')}</span>
        <span><span className="swatch ist" />{translate(lang, 'report.ramp.ist')}</span>
      </div>
    </div>
    <div className="ramp-svg-wrap">
      <RampSvg plot={plot} sollPath={sollPath} istPath={istPath} hasIst={hasIst} />
    </div>
    <div className="ramp-callout">
      <div>
        <span>{translate(lang, 'report.ramp.peakSoll')}</span>
        <strong>{formatInteger(peakSoll)} {translate(lang, 'report.ramp.vus')}</strong>
        <small>{translate(lang, 'report.ramp.peakSollDetail')}</small>
      </div>
      <div>
        <span>{translate(lang, 'report.ramp.peakIst')}</span>
        <strong style={hasIst ? undefined : { color: '#93370d' }}>
          {hasIst ? `${formatInteger(peakIst)} ${translate(lang, 'report.ramp.vus')}` : '–'}
        </strong>
        <small>{hasIst ? translate(lang, 'report.ramp.peakIstDetail') : translate(lang, 'report.ramp.peakIstDetailEmpty')}</small>
      </div>
      <div>
        <span>{translate(lang, 'report.ramp.dataPoints')}</span>
        <strong>{formatInteger(timeSeries.vus.length)}</strong>
        <small>{translate(lang, 'report.ramp.dataPointsDetail')}</small>
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
  const { language: lang } = useLanguage()
  if (profile.type.toLowerCase().replace(/_/g, '-') !== 'ramping-vus') return null
  const stages = profile.stages ?? []
  return <>
    <h3>{translate(lang, 'report.ramp.stagesTitle')}</h3>
    <div className="report-table-scroll">
      <table className="report-table" aria-label={translate(lang, 'report.ramp.stagesAria')}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>{translate(lang, 'report.ramp.stagesCol.index')}</th>
            <th>{translate(lang, 'report.ramp.stagesCol.target')}</th>
            <th>{translate(lang, 'report.ramp.stagesCol.duration')}</th>
            <th style={{ textAlign: 'left' }}>{translate(lang, 'report.ramp.stagesCol.description')}</th>
          </tr>
        </thead>
        <tbody>
          {stages.map((stage: ReportLoadStage, index: number) => {
            const previous = (index === 0 ? profile.startVUs : stages[index - 1]?.target) ?? 0
            const delta = stage.target - previous
            const description = delta === 0
              ? translate(lang, 'report.ramp.plateau')
              : delta > 0
                ? translate(lang, 'report.ramp.rampUp', { delta, target: stage.target })
                : translate(lang, 'report.ramp.rampDown', { delta, target: stage.target })
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

import { useEffect, useState } from 'react'
import './App.css'
import { TestRunReportPage } from './TestRunReport.tsx'
import {
  buildMetricRow,
  parseK6Summary,
  summarizeFailure,
  type TestRun,
} from './k6Report.ts'
import { RunStatusView } from './runStatusView.tsx'
import { useRunClock } from './useRunClock.ts'
import { LoadProfileEditor } from './LoadProfileEditor.tsx'
import {
  defaultLoadProfile,
  serialiseLoadProfile,
  validateLoadProfile,
  type LoadProfile,
} from './loadProfile.ts'
// MAX_DURATION_SECONDS / MAX_VIRTUAL_USERS werden in App.tsx nicht mehr
// direkt benötigt — die Limits leben jetzt im LoadProfileEditor.
import {
  buildOperationConfigurations,
  createOperationSettings,
  hasMultipleServers,
  isOperationValid,
  parameterKey,
  validateOperationSettings,
  validateParameterValue,
  validateRequestBody,
  type ImportedSpecification,
  type Operation,
  type OperationSettings,
  type ParameterSchema,
  type RequestBodySchema,
} from './operationConfiguration.ts'
import { type FetchedSpecification, validateSpecificationUrl } from './specificationSource.ts'
import { fetchWithRetry } from './retryFetch.ts'

type ImportResponse = ImportedSpecification & { message?: string }

const sample = `openapi: 3.0.3
info:
  title: Beispiel API
  version: 1.0.0
servers:
  - url: https://test.k6.io
paths:
  /:
    get:
      operationId: homepage
      parameters:
        - name: locale
          in: query
          required: false
          schema:
            type: string
            example: de
      responses:
        '200': { description: OK }
`

function App() {
  const reportRunId = new URLSearchParams(window.location.search).get('report')
  return reportRunId ? <TestRunReportPage runId={reportRunId} /> : <LoadTestApp />
}

function LoadTestApp() {
  const [specification, setSpecification] = useState(sample)
  const [specificationUrl, setSpecificationUrl] = useState('')
  const [imported, setImported] = useState<ImportedSpecification>()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [operationSettings, setOperationSettings] = useState<Record<string, OperationSettings>>({})
  const [baseUrl, setBaseUrl] = useState('')
  const [loadProfile, setLoadProfile] = useState<LoadProfile>(defaultLoadProfile())
  const [run, setRun] = useState<TestRun>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [lastFetched, setLastFetched] = useState<FetchedSpecification | undefined>()
  // Lokaler Ticker für die Laufzeit-Anzeige. Tickt nur, solange der
  // Run in QUEUED oder RUNNING ist; der Hook gibt das aktuelle
  // `now` an <RunStatusView> weiter.
  const runNow = useRunClock(run)

  useEffect(() => {
    let cancelled = false

    async function loadDemo() {
      // Retry mit Backoff, damit ein noch hochfahrendes Backend nicht zu
      // ECONNREFUSED-Einträgen im Vite-Proxy-Log führt. Bei dauerhaftem
      // Fehlschlag (z. B. Backend antwortet mit 5xx) bleibt das eingebettete
      // Sample im Textarea stehen.
      try {
        const response = await fetchWithRetry(
          '/api/demo-specification',
          undefined,
          { maxAttempts: 10, delayMs: 500, shouldRetry: response => !response.ok },
        )
        if (!response.ok) return
        const content = await response.text()
        if (!cancelled && content.trim() !== '') setSpecification(content)
      } catch {
        // Fallback auf eingebettetes Sample, falls Backend nicht erreichbar ist.
      }
    }

    loadDemo()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!run || !['QUEUED', 'RUNNING'].includes(run.status)) return
    const timer = window.setTimeout(async () => {
      const response = await fetch(`/api/test-runs/${run.id}`)
      if (response.ok) setRun(await response.json())
    }, 1000)
    return () => window.clearTimeout(timer)
  }, [run])

  async function fetchSpecFromUrl(url: string): Promise<FetchedSpecification> {
    const response = await fetch('/api/specifications/fetch-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.message ?? 'Abruf fehlgeschlagen')
    return data as FetchedSpecification
  }

  async function importSpecification() {
    setBusy(true)
    setError('')
    setRun(undefined)
    const trimmedUrl = specificationUrl.trim()
    let activeSpecification = specification
    try {
      if (trimmedUrl !== '') {
        const urlError = validateSpecificationUrl(trimmedUrl)
        if (urlError) throw new Error(urlError)
        const fetched = await fetchSpecFromUrl(trimmedUrl)
        setSpecification(fetched.content)
        activeSpecification = fetched.content
        setLastFetched(fetched)
      } else {
        setLastFetched(undefined)
      }
      const response = await fetch('/api/specifications/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ specification: activeSpecification }),
      })
      const data: ImportResponse = await response.json()
      if (!response.ok) throw new Error(data.message)
      setImported(data)
      setBaseUrl(data.baseUrl)
      const nonDestructive = data.operations.filter(operation => !operation.destructive)
      setSelected(new Set(nonDestructive.length > 0 ? [nonDestructive[0].operationId] : []))
      setOperationSettings(createOperationSettings(data.operations))
      setCollapsed(new Set(data.operations.map(operation => operation.operationId)))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Import fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  async function startTest() {
    if (!imported) return
    const profileError = validateLoadProfile(loadProfile)
    if (profileError) {
      setError(profileError)
      return
    }
    setBusy(true)
    setError('')
    try {
      const operationConfigurations = buildOperationConfigurations(imported.operations, selected, operationSettings)
      const response = await fetch('/api/test-runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          specification,
          baseUrl,
          operationIds: [...selected],
          operationConfigurations,
          loadProfile: serialiseLoadProfile(loadProfile),
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message)
      setRun(data)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Test konnte nicht gestartet werden')
    } finally {
      setBusy(false)
    }
  }

  function toggle(id: string) {
    setSelected(current => {
      if (current.has(id)) return new Set<string>()
      return new Set([id])
    })
  }

  function toggleExpanded(id: string) {
    setCollapsed(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function updateSettings(operationId: string, update: (settings: OperationSettings) => OperationSettings) {
    setOperationSettings(current => {
      const settings = current[operationId]
      if (!settings) return current
      return { ...current, [operationId]: update(settings) }
    })
  }

  function updateParameter(operationId: string, key: string, value: string) {
    updateSettings(operationId, settings => ({
      ...settings,
      parameterValues: { ...settings.parameterValues, [key]: value },
    }))
  }

  function updateRequestBody(operationId: string, requestBodyJson: string) {
    updateSettings(operationId, settings => ({ ...settings, requestBodyJson }))
  }

  function updateBearerToken(operationId: string, bearerToken: string) {
    updateSettings(operationId, settings => ({ ...settings, bearerToken }))
  }

  return <main>
    <header>
      <div className="mark">k6</div>
      <div><h1>lasttest</h1><p>Swagger / OpenAPI importieren. Endpunkte konfigurieren. Last messen.</p></div>
    </header>

    <section className="card">
      <div className="step">1</div>
      <h2>Swagger / OpenAPI-Dokumentation</h2>
      <label className="url-import">
        <span className="url-label">URL zur Swagger-UI oder OpenAPI-Spezifikation</span>
        <input
          type="url"
          placeholder="https://api.example.com/swagger-ui oder http://localhost:8286/demo-swagger-ui"
          aria-label="URL zur Swagger-UI oder OpenAPI-Spezifikation"
          value={specificationUrl}
          onChange={event => setSpecificationUrl(event.target.value)}
          spellCheck={false}
        />
        <small>
          Wird beim „Validieren &amp; importieren“ geladen. Die Spezifikation wird zusätzlich in den Textbereich
          übernommen und kann vor dem Import noch bearbeitet werden.
        </small>
      </label>
      <textarea className="specification-textarea" aria-label="Swagger / OpenAPI-Dokumentation" value={specification} onChange={event => setSpecification(event.target.value)} spellCheck={false} />
      <div className="actions">
        <label className="upload">Datei öffnen<input type="file" accept=".yaml,.yml,.json" onChange={async event => {
          const file = event.target.files?.[0]
          if (file) setSpecification(await file.text())
        }} /></label>
        <button onClick={importSpecification} disabled={busy}>Validieren & importieren</button>
      </div>
      {lastFetched && (
        <p className="fetched-info" aria-live="polite">
          Geladen aus <code>{lastFetched.resolvedUrl}</code>
          {lastFetched.source === 'swagger-ui' ? ' (über Swagger-UI)' : ' (direkt)'}.
        </p>
      )}
    </section>

    {error && <div className="error" role="alert">{error}</div>}

    {imported && <>
      <section className="card">
        <div className="step">2</div>
        <h2>{imported.title} <small>v{imported.version}</small></h2>
        <p>{imported.operations.length} Operationen erkannt. Parameter, JSON-Body und Bearer-Token können je Endpunkt angepasst werden.</p>
        <div className="operations">
          {imported.operations.map(operation => <OperationEditor
            key={operation.operationId}
            operation={operation}
            selected={selected.has(operation.operationId)}
            settings={operationSettings[operation.operationId]}
            expanded={!collapsed.has(operation.operationId)}
            onToggle={() => toggle(operation.operationId)}
            onToggleExpand={() => toggleExpanded(operation.operationId)}
            onParameterChange={(key, value) => updateParameter(operation.operationId, key, value)}
            onRequestBodyChange={value => updateRequestBody(operation.operationId, value)}
            onBearerTokenChange={value => updateBearerToken(operation.operationId, value)}
          />)}
        </div>
      </section>

      <section className="card">
        <div className="step">3</div>
        <h2>Lastprofil</h2>
        {hasMultipleServers(imported.servers) && (
          <div className="server-selector">
            <label htmlFor="base-url-select">Server auswählen</label>
            <select
              id="base-url-select"
              value={baseUrl}
              onChange={event => setBaseUrl(event.target.value)}
            >
              {(() => {
                const known = imported.servers.some(server => server.url === baseUrl)
                const options = imported.servers.map(server => (
                  <option key={server.url} value={server.url}>
                    {server.url}{server.description ? ` — ${server.description}` : ''}
                  </option>
                ))
                if (!known && baseUrl) {
                  options.push(<option key="__custom__" value={baseUrl}>{baseUrl} — Eigene URL</option>)
                }
                return options
              })()}
            </select>
            <small>Die Eingabe unten überschreibt die Auswahl und erlaubt eigene URLs.</small>
          </div>
        )}
        <div className="grid">
          <label>Base URL<input value={baseUrl} onChange={event => setBaseUrl(event.target.value)} /></label>
        </div>
        <LoadProfileEditor profile={loadProfile} onChange={setLoadProfile} disabled={busy} />
        {(() => {
          const selectedOperation = imported.operations.find(operation => selected.has(operation.operationId))
          const selectedValidation = selectedOperation
            ? validateOperationSettings(selectedOperation, operationSettings[selectedOperation.operationId])
            : undefined
          const hasValidationErrors = selectedValidation !== undefined && !isOperationValid(selectedValidation)
          const hint = !selectedOperation
            ? undefined
            : hasValidationErrors
              ? 'Bitte korrigiere die rot markierten Eingaben, bevor der Lasttest startet.'
              : selectedOperation.hasRequestBody
                ? 'JSON-Body und Parameter werden gegen die OpenAPI-Spezifikation geprüft.'
                : 'Parameter werden gegen die OpenAPI-Spezifikation geprüft.'
          return <>
            {hasValidationErrors && <div className="error validation-summary" role="alert">{hint}</div>}
            {!hasValidationErrors && hint && <p className="validation-hint">{hint}</p>}
            <button className="start" onClick={startTest} disabled={busy || selected.size === 0 || hasValidationErrors}>k6-Lasttest starten</button>
          </>
        })()}
      </section>
    </>}

    {run && <section className="card result">
      <header className="result-header">
        <div className="result-header-top">
          <div className="step">4</div>
          <h2>Testlauf</h2>
          {/* Run-ID sitzt immer oben rechts in der Karte, sowohl während
              k6 läuft als auch im Ergebnis. Direkt darunter (rechtsbündig)
              erscheint der Report-Button, sobald der Test beendet ist
              (COMPLETED oder FAILED) — unabhängig davon, ob k6 Output
              oder einen Summary geliefert hat. So bekommen die Details
              unten die volle Kartenbreite, und der Report-Link ist auch
              dann verfügbar, wenn ein sauberer Run ohne Summary
              zurueckkommt. Waehrend RUNNING/QUEUED bleibt der Button
              korrekterweise weg (Negativfall). */}
          <span className="result-run-id">Run-ID: <code>{run.id}</code></span>
        </div>
        {(run.status === 'COMPLETED' || run.status === 'FAILED') && (
          <div className="result-header-actions">
            <a className="report-btn" href={`/?report=${encodeURIComponent(run.id)}`} target="_blank" rel="noreferrer">Ausführlicher K6-Testbericht</a>
          </div>
        )}
      </header>
      <TestRunSummary run={run} />
      <RunStatusView run={run} now={runNow} />
      {/* Untere Zeile: k6-Konsolenausgabe + k6-JSON-Rohdaten. Nimmt jetzt
          die volle Kartenbreite, weil der Report-Button oben in den
          Header gewandert ist. Nur sichtbar, wenn k6 überhaupt Output
          oder einen Summary geliefert hat. */}
      {((run.consoleOutput ?? run.error) || run.summary) && <div className="result-extras">
        <div className="result-extras-details">
          {(run.consoleOutput ?? run.error) && <details><summary>k6-Konsolenausgabe</summary><pre>{run.consoleOutput ?? run.error}</pre></details>}
          {run.summary && <details><summary>k6-JSON-Rohdaten</summary><pre>{run.summary.raw}</pre></details>}
        </div>
      </div>}
    </section>}
  </main>
}

type TestRunSummaryProps = {
  run: TestRun
}

function TestRunSummary({ run }: TestRunSummaryProps) {
  const summary = parseK6Summary(run)
  const failure = summarizeFailure(run)
  const metricItems = buildMetricRow(run, summary, failure)
  // Sobald k6 fertig ist, übernimmt <RunStatusView> die komplette
  // Ergebnisdarstellung (Badge + Threshold-Notice + Karten + Run-Foot).
  // Wir blenden dann hier oben die Metrik-Zeile und die Fehlerursachen
  // Sobald k6 fertig ist, übernimmt <RunStatusView> die komplette
  // Ergebnisdarstellung (PASSED/FAILED-Pille + Exit-Code in der
  // `ResultHeader`-Zeile, Threshold-Notice, Karten, Run-Foot). Hier
  // oben blenden wir dann sowohl die Status-Pille als auch die
  // Fehlerursachen aus, damit nichts doppelt erscheint. Für
  // RUNNING/QUEUED bleibt die Status-Pille sichtbar; den Zeit-Hint
  // (`läuft seit …`) blenden wir weiterhin aus, weil die drei Cells
  // unten (LÄUFT SEIT / NOCH / GESTARTET) dieselbe Information
  // übersichtlicher zeigen.
  const isFinished = run.status === 'COMPLETED' || run.status === 'FAILED'

  return (
    <>
      {!isFinished && <div className="status-row">
        <div className={`status ${run.status.toLowerCase()}`}>{run.status}</div>
        {run.status === 'FAILED' && (
          <>
            <span className="status-diagnosis">{failure.diagnosis}</span>
            <span className="status-detail">{failure.detail}</span>
          </>
        )}
      </div>}
      {!isFinished && metricItems.length > 0 && (
        <ul className="metric-row">
          {metricItems.map(item => (
            <li key={item.label} className={`metric-item metric-${item.severity}`}>
              <span className="metric-label">{item.label}</span>
              <span className="metric-value">{item.value}</span>
            </li>
          ))}
        </ul>
      )}
      {!isFinished && run.status === 'FAILED' && failure.reasons.length > 0 && (
        <ul className="failure-reasons">
          {failure.reasons.map(reason => <li key={reason}>{reason}</li>)}
        </ul>
      )}
    </>
  )
}

type OperationEditorProps = {
  operation: Operation
  selected: boolean
  settings?: OperationSettings
  expanded: boolean
  onToggle: () => void
  onToggleExpand: () => void
  onParameterChange: (key: string, value: string) => void
  onRequestBodyChange: (value: string) => void
  onBearerTokenChange: (value: string) => void
}

function OperationEditor({
  operation,
  selected,
  expanded,
  settings,
  onToggle,
  onToggleExpand,
  onParameterChange,
  onRequestBodyChange,
  onBearerTokenChange,
}: OperationEditorProps) {
  if (!settings) return null

  return <article className={`operation-card ${selected ? 'selected' : ''} ${expanded ? 'expanded' : ''}`}>
    {operation.destructive && <span className="destructive-badge" title="Schreibender Endpunkt">schreibend</span>}

    <label className="operation-heading">
      <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Endpunkt ${operation.method} ${operation.path} auswählen`} />
      <span className={`method ${operation.method.toLowerCase()}`}>{operation.method}</span>
      <code>{operation.path}</code>
    </label>
    <div className="operation-meta">
      <span className="operation-id" aria-label={`Operation ${operation.operationId}`}>{operation.operationId}</span>
      {operation.summary && <p className="operation-summary">{operation.summary}</p>}
    </div>

    <button
      type="button"
      className="expand-toggle"
      onClick={onToggleExpand}
      aria-expanded={expanded}
      aria-label={expanded ? 'Endpunkt einklappen' : 'Endpunkt aufklappen'}
      title={expanded ? 'Einklappen' : 'Aufklappen'}
    >
      <svg className="chevron" viewBox="0 0 12 12" aria-hidden="true">
        {expanded
          ? <path d="M1 2 L6 10 L11 2 L6 6 Z" fill="currentColor" />
          : <path d="M2 1 L10 6 L2 11 L6 6 Z" fill="currentColor" />}
      </svg>
    </button>

    {expanded && <div className="configuration-grid">
      {operation.parameters.map(parameter => {
        const key = parameterKey(parameter)
        const value = settings.parameterValues[key] ?? ''
        const validation = validateParameterValue(value, parameter.schema)
        const errorMessage = validation.valid ? undefined : validation.message
        const errorId = errorMessage ? `${operation.operationId}-${parameter.name}-error` : undefined
        return <label className={`parameter-box ${errorMessage ? 'has-error' : ''}`} key={key}>
          <span className="field-heading">
            <strong>{parameter.name}</strong>
            <code>{parameter.location}</code>
            {parameter.schema && <span className="type-hint">{formatParameterType(parameter.schema)}</span>}
            {parameter.required && <em>Pflicht</em>}
          </span>
          {errorMessage && <div className="parameter-error" role="alert" id={errorId}>{errorMessage}</div>}
          <input
            aria-label={`${operation.operationId}: ${parameter.name}`}
            aria-invalid={errorMessage ? true : undefined}
            aria-describedby={errorId}
            value={value}
            onChange={event => onParameterChange(key, event.target.value)}
          />
        </label>
      })}

      {operation.hasRequestBody && (() => {
        const bodyResult = validateRequestBody(settings.requestBodyJson, operation.requestBodySchema, operation.requestBodyRequired)
        const bodyError = bodyResult.valid ? undefined : bodyResult.message
        const bodyErrorId = bodyError ? `${operation.operationId}-body-error` : undefined
        return <label className={`parameter-box body-box ${bodyError ? 'has-error' : ''}`}>
          <span className="field-heading">
            <strong>JSON Request-Body</strong>
            <code>body</code>
            {operation.requestBodySchema && <span className="type-hint">{formatRequestBodyType(operation.requestBodySchema)}</span>}
            {operation.requestBodyRequired && <em>Pflicht</em>}
          </span>
          {bodyError && <div className="parameter-error" role="alert" id={bodyErrorId}>{bodyError}</div>}
          <textarea
            className="request-body"
            aria-label={`${operation.operationId}: JSON Request-Body`}
            aria-invalid={bodyError ? true : undefined}
            aria-describedby={bodyErrorId}
            value={settings.requestBodyJson}
            onChange={event => onRequestBodyChange(event.target.value)}
            spellCheck={false}
          />
        </label>
      })()}

      <label className={`parameter-box auth-box ${operation.bearerAuth ? 'documented-auth' : ''}`}>
        <span className="field-heading">
          <strong>Bearer-Token</strong>
          <code>Authorization</code>
          {operation.bearerAuth && <em>Swagger / OpenAPI Auth</em>}
        </span>
        <input
          type="password"
          autoComplete="off"
          aria-label={`${operation.operationId}: Bearer-Token`}
          placeholder={operation.bearerAuth ? 'Token ohne „Bearer “' : 'Optional für diesen Endpunkt'}
          value={settings.bearerToken}
          onChange={event => onBearerTokenChange(event.target.value)}
        />
      </label>
    </div>}
  </article>
}

function formatParameterType(schema: ParameterSchema): string {
  if (schema.enum) return `${schema.type} enum`
  if (schema.format) return schema.format
  return schema.type
}

function formatRequestBodyType(schema: RequestBodySchema): string {
  const requiredCount = schema.required?.length ?? 0
  if (requiredCount === 0) return 'object'
  return `object · ${requiredCount} Pflicht`
}

export default App

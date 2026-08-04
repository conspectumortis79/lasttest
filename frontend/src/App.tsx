import { useEffect, useState } from 'react'
import './App.css'
import { TestRunReportPage } from './TestRunReport.tsx'
import { type TestRun } from './k6Report.ts'
import { MAX_DURATION_SECONDS, MAX_VIRTUAL_USERS, validateLoadProfile } from './loadProfile.ts'
import {
  buildOperationConfigurations,
  createOperationSettings,
  parameterKey,
  type ImportedSpecification,
  type Operation,
  type OperationSettings,
} from './operationConfiguration.ts'

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
  const [imported, setImported] = useState<ImportedSpecification>()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [operationSettings, setOperationSettings] = useState<Record<string, OperationSettings>>({})
  const [baseUrl, setBaseUrl] = useState('')
  const [vus, setVus] = useState(1)
  const [duration, setDuration] = useState(10)
  const [run, setRun] = useState<TestRun>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!run || !['QUEUED', 'RUNNING'].includes(run.status)) return
    const timer = window.setTimeout(async () => {
      const response = await fetch(`/api/test-runs/${run.id}`)
      if (response.ok) setRun(await response.json())
    }, 1000)
    return () => window.clearTimeout(timer)
  }, [run])

  async function importSpecification() {
    setBusy(true)
    setError('')
    setRun(undefined)
    try {
      const response = await fetch('/api/specifications/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ specification }),
      })
      const data: ImportResponse = await response.json()
      if (!response.ok) throw new Error(data.message)
      setImported(data)
      setBaseUrl(data.baseUrl)
      setSelected(new Set(data.operations.filter(operation => !operation.destructive).map(operation => operation.operationId)))
      setOperationSettings(createOperationSettings(data.operations))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Import fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  async function startTest() {
    if (!imported) return
    const profileError = validateLoadProfile(vus, duration)
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
          virtualUsers: vus,
          durationSeconds: duration,
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
      <textarea aria-label="Swagger / OpenAPI-Dokumentation" value={specification} onChange={event => setSpecification(event.target.value)} spellCheck={false} />
      <div className="actions">
        <label className="upload">Datei öffnen<input type="file" accept=".yaml,.yml,.json" onChange={async event => {
          const file = event.target.files?.[0]
          if (file) setSpecification(await file.text())
        }} /></label>
        <button onClick={importSpecification} disabled={busy}>Validieren & importieren</button>
      </div>
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
            onToggle={() => toggle(operation.operationId)}
            onParameterChange={(key, value) => updateParameter(operation.operationId, key, value)}
            onRequestBodyChange={value => updateRequestBody(operation.operationId, value)}
            onBearerTokenChange={value => updateBearerToken(operation.operationId, value)}
          />)}
        </div>
      </section>

      <section className="card">
        <div className="step">3</div>
        <h2>Lastprofil</h2>
        <div className="grid">
          <label>Base URL<input value={baseUrl} onChange={event => setBaseUrl(event.target.value)} /></label>
          <label>Virtual Users<input type="number" min="1" max={MAX_VIRTUAL_USERS} step="1" value={vus} aria-describedby="virtual-users-hint" onChange={event => setVus(Number(event.target.value))} /><small id="virtual-users-hint">1 bis {MAX_VIRTUAL_USERS}</small></label>
          <label>Dauer (Sekunden)<input type="number" min="1" max={MAX_DURATION_SECONDS} step="1" value={duration} aria-describedby="duration-hint" onChange={event => setDuration(Number(event.target.value))} /><small id="duration-hint">1 bis {MAX_DURATION_SECONDS} Sekunden</small></label>
        </div>
        <button className="start" onClick={startTest} disabled={busy || selected.size === 0}>k6-Lasttest starten</button>
      </section>
    </>}

    {run && <section className="card result">
      <div className="step">4</div>
      <h2>Testlauf</h2>
      <div className={`status ${run.status.toLowerCase()}`}>{run.status}</div>
      <p>Run-ID: <code>{run.id}</code></p>
      <a className="report-link" href={`/?report=${encodeURIComponent(run.id)}`} target="_blank" rel="noreferrer">Ausführlichen k6-Testbericht in neuem Tab öffnen ↗</a>
      {run.error && <details><summary>k6-Konsolenausgabe</summary><pre>{run.error}</pre></details>}
      {run.summary && <details><summary>k6-JSON-Rohdaten</summary><pre>{run.summary.raw}</pre></details>}
    </section>}
  </main>
}

type OperationEditorProps = {
  operation: Operation
  selected: boolean
  settings?: OperationSettings
  onToggle: () => void
  onParameterChange: (key: string, value: string) => void
  onRequestBodyChange: (value: string) => void
  onBearerTokenChange: (value: string) => void
}

function OperationEditor({
  operation,
  selected,
  settings,
  onToggle,
  onParameterChange,
  onRequestBodyChange,
  onBearerTokenChange,
}: OperationEditorProps) {
  if (!settings) return null

  return <article className={`operation-card ${selected ? 'selected' : ''}`}>
    <label className="operation-heading">
      <input type="checkbox" checked={selected} onChange={onToggle} />
      <span className={`method ${operation.method.toLowerCase()}`}>{operation.method}</span>
      <code>{operation.path}</code>
      <span className="operation-summary">{operation.summary}</span>
      {operation.destructive && <b>schreibend</b>}
    </label>

    <div className="configuration-grid">
      {operation.parameters.map(parameter => {
        const key = parameterKey(parameter)
        return <label className="parameter-box" key={key}>
          <span className="field-heading">
            <strong>{parameter.name}</strong>
            <code>{parameter.location}</code>
            {parameter.required && <em>Pflicht</em>}
          </span>
          <input
            aria-label={`${operation.operationId}: ${parameter.name}`}
            value={settings.parameterValues[key] ?? ''}
            onChange={event => onParameterChange(key, event.target.value)}
          />
        </label>
      })}

      {operation.hasRequestBody && <label className="parameter-box body-box">
        <span className="field-heading">
          <strong>JSON Request-Body</strong>
          <code>body</code>
          {operation.requestBodyRequired && <em>Pflicht</em>}
        </span>
        <textarea
          className="request-body"
          aria-label={`${operation.operationId}: JSON Request-Body`}
          value={settings.requestBodyJson}
          onChange={event => onRequestBodyChange(event.target.value)}
          spellCheck={false}
        />
      </label>}

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
    </div>
  </article>
}

export default App

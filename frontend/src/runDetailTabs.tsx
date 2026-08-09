// Tab content for the run-detail panel. Each exported component
// matches one of the tabs in [App.tsx :: RunDetail] and renders
// the data the user expects to see when they click it. The
// components are pure presentational: they take a [TestRun] (and
// optionally the clock tick for in-flight displays) and emit
// HTML. The parent component owns the tab state and the
// polling; the tabs only render the latest snapshot.
//
// The previous implementation had placeholder hints pointing
// the user to the `/?report=<id>` page. Those were misleading:
// the data the user wants is *right here* in the run snapshot
// we already have in the React tree. The pages produced by
// [TestRunReport.tsx] still exist for the deep dive, but the
// quick read is on the dashboard itself.

import { useEffect, useState } from 'react'
import { useLanguage } from './languageStorage.ts'
import { translate, type SupportedLanguage } from './i18n.ts'
import {
  copyTextToClipboard,
  formatTimestamp,
  k6ScriptDownloadName,
  k6ScriptUrl,
  manualK6Command,
  parseK6Summary,
  type TestRun,
} from './k6Report.ts'
import { isInFlight } from './runDashboard.ts'

// =====================================================================
// ConsoleTab — full k6 console output
// =====================================================================

export function ConsoleTab({ run }: { run: TestRun }) {
  const { language } = useLanguage()
  const text = run.consoleOutput ?? run.error
  if (!text || text.length === 0) {
    return <EmptyState
      title={translate(language, 'detail.console.empty.title')}
      hint={translate(language, 'detail.console.empty.hint')}
    />
  }
  return <div className="console-tab">
    <div className="console-tab-head">
      <span className="console-tab-label">{translate(language, 'report.console')}</span>
      <span className="console-tab-meta">
        {translate(language, 'detail.console.charCount', { n: text.length.toLocaleString(language) })}
      </span>
    </div>
    <pre className="console-tab-output">{text}</pre>
  </div>
}

// =====================================================================
// ThresholdsTab — full table of every configured k6 threshold
// =====================================================================

type ThresholdRow = {
  metric: string
  condition: string
  measured: string
  status: 'pass' | 'fail' | 'pending'
}

export function ThresholdsTab({ run }: { run: TestRun }) {
  const { language } = useLanguage()
  const summary = parseK6Summary(run)
  // Build the row list from the k6 summary. The two thresholds
  // the project ships out of the box are listed explicitly so
  // the table is meaningful even when the user has not added
  // their own. Any user-defined threshold surfaces via the
  // `metrics.*.thresholds` block of the k6 summary. The k6 metric
  // names themselves are technical and stay untranslated; the
  // condition / measured / status columns are translated via the
  // i18n dict.
  const rows: ThresholdRow[] = []
  const inFlight = isInFlight(run.status)
  // http_req_failed
  if (summary?.metrics?.['http_req_failed']?.value != null) {
    const rate = summary.metrics['http_req_failed'].value as number
    rows.push({
      metric: 'http_req_failed',
      condition: translate(language, 'detail.thresholds.condition.rate'),
      measured: `${(rate * 100).toFixed(2)} %`,
      status: rate < 0.05 ? 'pass' : 'fail',
    })
  } else if (inFlight) {
    rows.push({
      metric: 'http_req_failed',
      condition: translate(language, 'detail.thresholds.condition.rate'),
      measured: translate(language, 'detail.thresholds.measured.empty'),
      status: 'pending',
    })
  }
  // http_req_duration p(95)
  const p95 = summary?.metrics?.['http_req_duration']?.['p(95)'] as number | undefined
  if (p95 != null && Number.isFinite(p95)) {
    rows.push({
      metric: 'http_req_duration',
      condition: translate(language, 'detail.thresholds.condition.p95'),
      measured: `${Math.round(p95)} ms`,
      status: p95 < 1000 ? 'pass' : 'fail',
    })
  } else if (inFlight) {
    rows.push({
      metric: 'http_req_duration',
      condition: translate(language, 'detail.thresholds.condition.p95'),
      measured: translate(language, 'detail.thresholds.measured.empty'),
      status: 'pending',
    })
  }
  // user-defined thresholds (passes through whatever the k6
  // script generator wrote into the summary JSON)
  for (const [name, value] of Object.entries(summary?.metrics ?? {})) {
    const thresholds = (value as { thresholds?: Record<string, boolean> }).thresholds
    if (!thresholds) continue
    for (const [expr, ok] of Object.entries(thresholds)) {
      const label = `${name} · ${expr}`
      const measured = formatMetricMeasurement(value, language)
      rows.push({
        metric: label,
        condition: ok ? translate(language, 'detail.thresholds.condition.inRange') : translate(language, 'detail.thresholds.condition.outOfRange'),
        measured,
        status: ok ? 'pass' : 'fail',
      })
    }
  }
  if (rows.length === 0) {
    return <EmptyState
      title={translate(language, 'detail.thresholds.empty.title')}
      hint={inFlight
        ? translate(language, 'detail.thresholds.empty.hint.inFlight')
        : translate(language, 'detail.thresholds.empty.hint.terminal')}
    />
  }
  return <div className="thresholds-tab">
    <div className="thresholds-tab-head">
      <span className="thresholds-tab-title">{translate(language, 'detail.thresholds.title', { n: rows.length })}</span>
      <span className={`thresholds-pill ${rows.some(r => r.status === 'fail') ? 'is-fail' : 'is-pass'}`}>
        {rows.some(r => r.status === 'fail') ? translate(language, 'detail.thresholds.pill.anyFail') : translate(language, 'detail.thresholds.pill.allPass')}
      </span>
    </div>
    <table className="thresholds-table">
      <thead>
        <tr>
          <th>{translate(language, 'detail.thresholds.col.metric')}</th>
          <th>{translate(language, 'detail.thresholds.col.condition')}</th>
          <th>{translate(language, 'detail.thresholds.col.measured')}</th>
          <th>{translate(language, 'detail.thresholds.col.status')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(row => (
          <tr key={row.metric + row.condition} className={`thresholds-row is-${row.status}`}>
            <td className="thresholds-metric"><code>{row.metric}</code></td>
            <td className="thresholds-condition">{row.condition}</td>
            <td className="thresholds-measured"><code>{row.measured}</code></td>
            <td>
              <span className={`thresholds-status-pill is-${row.status}`}>
                {row.status === 'pass'
                  ? translate(language, 'detail.thresholds.kind.pass')
                  : row.status === 'fail'
                    ? translate(language, 'detail.thresholds.kind.fail')
                    : translate(language, 'detail.thresholds.kind.pending')}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
}

/**
 * Renders the measured value of a k6 metric in a compact
 * human-readable form. Picks the most informative field: count
 * + rate for counters, p(95) for timers, value for gauges. The
 * empty / pending cell uses the i18n dash so the column stays
 * consistent in both languages.
 */
function formatMetricMeasurement(value: unknown, language: SupportedLanguage): string {
  const v = value as { count?: number, rate?: number, value?: number, 'p(95)'?: number, avg?: number, max?: number }
  if (v['p(95)'] != null) return `${Math.round(v['p(95)'] as number)} ms`
  if (v.avg != null) return `∅ ${Math.round(v.avg as number)} ms`
  if (v.max != null) return `max ${Math.round(v.max as number)} ms`
  if (v.count != null && v.rate != null) return `${v.count} · ${(v.rate as number).toFixed(1)}/s`
  if (v.count != null) return `${v.count}`
  if (v.value != null) return String(v.value)
  return translate(language, 'detail.thresholds.measured.empty')
}

// =====================================================================
// ConfigTab — full configuration echo
// =====================================================================

export function ConfigTab({ run }: { run: TestRun }) {
  const { language } = useLanguage()
  const config = run.configuration
  if (!config) {
    return <EmptyState
      title={translate(language, 'detail.config.empty.title')}
      hint={translate(language, 'detail.config.empty.hint')}
    />
  }
  const profile = config.loadProfile
  const profileLine = profile
    ? `${profile.type} · ${profile.virtualUsers ?? '–'} VUs · ${profile.durationSeconds != null ? profile.durationSeconds + 's' : 'open-ended'}`
    : '–'
  return <div className="config-tab">
    <div className="config-section">
      <div className="config-section-title">{translate(language, 'detail.config.section.api')}</div>
      <div className="config-grid">
        <ConfigRow k={translate(language, 'detail.config.field.apiTitle')} v={config.apiTitle} />
        <ConfigRow k={translate(language, 'detail.config.field.apiVersion')} v={config.apiVersion} />
        <ConfigRow k={translate(language, 'detail.config.field.baseUrl')} v={config.baseUrl} mono />
      </div>
    </div>
    <div className="config-section">
      <div className="config-section-title">{translate(language, 'detail.config.section.profile')}</div>
      <div className="config-grid">
        <ConfigRow k={translate(language, 'detail.config.field.profileType')} v={profile?.type ?? '–'} mono />
        <ConfigRow k={translate(language, 'detail.config.field.vus')} v={profile?.virtualUsers != null ? String(profile.virtualUsers) : '–'} mono />
        <ConfigRow k={translate(language, 'detail.config.field.duration')} v={profile?.durationSeconds != null ? `${profile.durationSeconds} s` : translate(language, 'detail.config.field.duration.openEnded')} mono />
        {profile?.iterations != null && <ConfigRow k={translate(language, 'detail.config.field.iterations')} v={String(profile.iterations)} mono />}
        {profile?.stages && profile.stages.length > 0 && (
          <ConfigRow k={translate(language, 'detail.config.field.stages')} v={profile.stages.map(s => `${s.target} VUs / ${s.durationSeconds}s`).join(' · ')} mono />
        )}
        <ConfigRow k={translate(language, 'detail.config.field.summary')} v={profileLine} />
      </div>
    </div>
    <div className="config-section">
      <div className="config-section-title">{translate(language, 'detail.config.section.operations', { n: config.operations.length })}</div>
      <div className="config-operations">
        {config.operations.map(op => (
          <div key={op.operationId} className="config-operation">
            <div className="config-operation-head">
              <span className={`config-operation-method method-${op.method.toLowerCase()}`}>{op.method}</span>
              <code className="config-operation-path">{op.path}</code>
              <span className="config-operation-id">{op.operationId}</span>
              <span className="config-operation-payloads">
                {translate(language, op.payloads.length === 1 ? 'detail.config.payloads.one' : 'detail.config.payloads.many', { n: op.payloads.length })}
              </span>
            </div>
            {op.summary && <div className="config-operation-summary">{op.summary}</div>}
            <div className="config-operation-flags">
              {op.bearerTokenConfigured && <span className="config-flag is-on">{translate(language, 'detail.config.flag.bearer')}</span>}
              {op.basicAuthConfigured && <span className="config-flag is-on">{translate(language, 'detail.config.flag.basic')}</span>}
              {op.apiKeyConfigured && <span className="config-flag is-on">{translate(language, 'detail.config.flag.apiKey')}</span>}
              {op.oauth2TokenConfigured && <span className="config-flag is-on">{translate(language, 'detail.config.flag.oauth2')}</span>}
              {!op.bearerTokenConfigured && !op.basicAuthConfigured && !op.apiKeyConfigured && !op.oauth2TokenConfigured && (
                <span className="config-flag">{translate(language, 'detail.config.flag.noAuth')}</span>
              )}
              {op.requestBodyJson && <span className="config-flag is-on">{translate(language, 'detail.config.flag.requestBody')}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
    <div className="config-section">
      <div className="config-section-title">{translate(language, 'detail.config.section.runMeta')}</div>
      <div className="config-grid">
        <ConfigRow k={translate(language, 'detail.config.field.runId')} v={run.id} mono />
        <ConfigRow k={translate(language, 'detail.config.field.status')} v={run.status} mono />
        <ConfigRow k={translate(language, 'detail.config.field.created')} v={formatTimestamp(run.createdAt)} />
        {run.startedAt && <ConfigRow k={translate(language, 'detail.config.field.started')} v={formatTimestamp(run.startedAt)} />}
        {run.finishedAt && <ConfigRow k={translate(language, 'detail.config.field.finished')} v={formatTimestamp(run.finishedAt)} />}
        {run.exitCode != null && <ConfigRow k={translate(language, 'detail.config.field.exitCode')} v={String(run.exitCode)} mono />}
      </div>
    </div>
    <div className="config-section-hint">
      {translate(language, 'configTab.deepDive', { url: '/?report=' + run.id })}
    </div>
  </div>
}

function ConfigRow({ k, v, mono }: { k: string, v: string, mono?: boolean }) {
  return <div className="config-row">
    <span className="config-row-k">{k}</span>
    <span className={`config-row-v ${mono ? 'is-mono' : ''}`}>{v}</span>
  </div>
}

// =====================================================================
// FailureTab — typed diagnosis
// =====================================================================

export function FailureTab({ run }: { run: TestRun }) {
  const { language } = useLanguage()
  if (run.status !== 'FAILED' && run.status !== 'ABORTED') {
    return <EmptyState
      title={translate(language, 'detail.failure.empty.title')}
      hint={run.status === 'COMPLETED'
        ? translate(language, 'detail.failure.empty.hint.success')
        : translate(language, 'detail.failure.empty.hint.pending')}
    />
  }
  const reason = summarizeFailure(run)
  if (!reason) {
    return <EmptyState
      title={translate(language, 'detail.failure.empty.title')}
      hint={translate(language, 'detail.failure.empty.hint.unknown')}
    />
  }
  return <div className="failure-tab">
    <div className={`failure-tab-card kind-${reason.category}`}>
      <div className="failure-tab-head">
        <span className={`failure-tab-label kind-${reason.category}`}>{labelForFailure(reason.category, language)}</span>
        <strong className="failure-tab-summary">{reason.diagnosis}</strong>
      </div>
      <p className="failure-tab-detail">{reason.detail}</p>
      {reason.reasons.length > 0 && (
        <ul className="failure-tab-reasons">
          {reason.reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      )}
    </div>
    {run.error && <div className="failure-tab-error">
      <div className="failure-tab-error-label">{translate(language, 'detail.failure.errorLabel')}</div>
      <pre className="failure-tab-error-pre">{run.error}</pre>
    </div>}
  </div>
}

// Looks the human-readable failure category up in the i18n
// dict under the `detail.failure.category.*` namespace. Keeping
// the labels in the central i18n file (instead of a hard-coded
// `Record<string, ...>`) means the rest of the chrome can reuse
// them and the English / German entries stay in lock-step with
// the rest of the dashboard.
function labelForFailure(
  category: string,
  language: SupportedLanguage,
): string {
  const key = `detail.failure.category.${category.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())}` as const
  return translate(language, key as Parameters<typeof translate>[1])
}

// Re-export the failure summariser so callers in this file (and
// the [App] component) can use a single import. Pulled in lazily
// from [k6Report] to avoid pulling the full k6 summary parser
// into a hot path.
import { summarizeFailure } from './k6Report.ts'

// =====================================================================
// EmptyState — shared "no data yet" placeholder
// =====================================================================

function EmptyState({ title, hint }: { title: string, hint: string }) {
  return <div className="run-tab-empty">
    <div className="run-tab-empty-title">{title}</div>
    <div className="run-tab-empty-hint">{hint}</div>
  </div>
}

// =====================================================================
// K6ScriptTab — download / inspect / run the generated k6 script
// =====================================================================
//
// Renders the actual k6 script that was generated for the current
// run alongside the manual start command and a short reference
// card for k6's most common CLI flags. The script text is fetched
// from `/api/test-runs/{id}/script` the first time the tab is
// mounted; while the request is in flight the user sees a
// placeholder. The run-detail tab is the single source of truth
// for the script and its download link — the printable report
// (`TestRunReport.tsx`) intentionally omits the script so the
// two surfaces don't drift. The fetch logic here is the only
// place where the script body is rendered, which keeps the
// "no stale copy from a different run" guarantee local.
//
// Why this lives in `runDetailTabs.tsx` and not next to the
// existing download in `App.tsx`: the k6-script tab is a
// first-class run-detail surface with its own body, copy button
// and command widget. Pulling the JSX inline into `App.tsx`
// would push the file past the size where the React tree stays
// readable; the existing tabs (console / thresholds / config /
// failure) already follow this same separation.

const K6_DOCS_URL = 'https://grafana.com/docs/k6/latest/using-k6/'

export function K6ScriptTab({ run }: { run: TestRun }) {
  const { language: lang } = useLanguage()
  const [script, setScript] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [copied, setCopied] = useState<'script' | 'command' | null>(null)

  // The script is fetched on mount and whenever the user switches
  // to a different run. Re-fetching on `run.id` change is
  // important: the tab body must not keep showing the previous
  // run's script when the user clicks a different badge in the
  // [LastRunsPanel]. Caching the response on the client would
  // shave one round-trip but would also make the cache a new
  // surface for staleness bugs, so the request is plain and the
  // server-side cache (H2) does the work.
  useEffect(() => {
    let cancelled = false
    setScript(undefined)
    setError(undefined)
    async function load() {
      try {
        const response = await fetch(k6ScriptUrl(run.id))
        if (!response.ok) {
          throw new Error(response.status === 404
            ? translate(lang, 'detail.script.error.hint')
            : translate(lang, 'detail.script.error.hint'))
        }
        const text = await response.text()
        if (!cancelled) setScript(text)
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : translate(lang, 'detail.script.error.hint'))
        }
      }
    }
    load()
    return () => { cancelled = true }
  }, [run.id, lang])

  // Reset the "copied" badge whenever the run changes — the
  // visible label should always reflect the current run's
  // command, not the one the user copied two minutes ago.
  useEffect(() => { setCopied(null) }, [run.id])

  const command = manualK6Command(run.configuration, run.id)
  const downloadName = k6ScriptDownloadName(run.id)
  const downloadHref = k6ScriptUrl(run.id)

  async function handleCopyScript() {
    if (!script) return
    if (await copyTextToClipboard(script)) setCopied('script')
  }
  async function handleCopyCommand() {
    if (await copyTextToClipboard(command)) setCopied('command')
  }

  // Tiny copy-feedback timeout: flip the "copied" pill back to
  // the idle label after 1.5 s. Mirrors [CopyButton] in
  // [TestRunReport.tsx] so the two surfaces behave identically.
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(null), 1500)
    return () => window.clearTimeout(timer)
  }, [copied])

  return <div className="k6-script-tab">
    <div className="k6-script-tab-head">
      <h3 className="k6-script-tab-title">{translate(lang, 'detail.script.heading')}</h3>
      <p className="k6-script-tab-intro">{translate(lang, 'detail.script.intro')}</p>
    </div>

    <section className="k6-script-section">
      <div className="k6-script-section-head">
        <h4 className="k6-script-section-title">{translate(lang, 'detail.script.heading')}</h4>
        <div className="k6-script-section-actions">
          <a
            className="k6-script-download"
            href={downloadHref}
            download={downloadName}
            aria-label={translate(lang, 'detail.script.download')}
          >{translate(lang, 'detail.script.download')} ↓</a>
          <button
            type="button"
            className={`k6-script-copy ${copied === 'script' ? 'copied' : ''}`}
            onClick={handleCopyScript}
            disabled={!script}
            aria-label={translate(lang, 'detail.script.copy')}
          >{copied === 'script' ? translate(lang, 'detail.script.copied') : translate(lang, 'detail.script.copy')}</button>
        </div>
      </div>
      <div className="k6-script-warning">
        <strong>{translate(lang, 'detail.script.warning.title')}:</strong>{' '}
        {translate(lang, 'detail.script.warning.body')}
      </div>
      {error && <div className="k6-script-error">
        <div className="k6-script-error-title">{translate(lang, 'detail.script.error.title')}</div>
        <div className="k6-script-error-hint">{error}</div>
      </div>}
      {!error && !script && <div className="k6-script-loading">{translate(lang, 'detail.script.loading')}</div>}
      {script && <pre className="k6-script-pre" data-testid="k6-script-source">{script}</pre>}
    </section>

    <section className="k6-script-section">
      <h4 className="k6-script-section-title">{translate(lang, 'detail.script.manualTitle')}</h4>
      <p className="k6-script-section-intro">{translate(lang, 'detail.script.manualIntro')}</p>
      <div className="k6-script-command">
        <code data-testid="k6-script-command">{command}</code>
        <button
          type="button"
          className={`k6-script-copy ${copied === 'command' ? 'copied' : ''}`}
          onClick={handleCopyCommand}
          aria-label={translate(lang, 'detail.script.copyCommand')}
        >{copied === 'command' ? translate(lang, 'detail.script.copiedCommand') : translate(lang, 'detail.script.copyCommand')}</button>
      </div>
    </section>

    <section className="k6-script-section">
      <h4 className="k6-script-section-title">{translate(lang, 'detail.script.prereqTitle')}</h4>
      <p className="k6-script-section-intro">{translate(lang, 'detail.script.prereq.intro')}</p>
      <a
        className="k6-script-external-link"
        href="https://grafana.com/docs/k6/latest/set-up/install-k6/"
        target="_blank"
        rel="noopener noreferrer"
      >{translate(lang, 'detail.script.prereq.install')} ↗</a>
    </section>

    <section className="k6-script-section">
      <h4 className="k6-script-section-title">{translate(lang, 'detail.script.docsTitle')}</h4>
      <p className="k6-script-section-intro">{translate(lang, 'detail.script.docsIntro')}</p>
      <ul className="k6-script-cmd-list">
        <li>
          <strong>{translate(lang, 'detail.script.docs.run')}:</strong>{' '}
          <code>k6 run {downloadName}</code>
          <div className="k6-script-cmd-desc">{translate(lang, 'detail.script.docs.runDesc')}</div>
        </li>
        <li>
          <strong>{translate(lang, 'detail.script.docs.out')}:</strong>{' '}
          <code>k6 run --out json=result.json {downloadName}</code>
          <div className="k6-script-cmd-desc">{translate(lang, 'detail.script.docs.outDesc')}</div>
        </li>
        <li>
          <strong>{translate(lang, 'detail.script.docs.env')}:</strong>{' '}
          <code>k6 run -e BASE_URL=https://staging.example.com {downloadName}</code>
          <div className="k6-script-cmd-desc">{translate(lang, 'detail.script.docs.envDesc')}</div>
        </li>
        <li>
          <strong>{translate(lang, 'detail.script.docs.cloud')}:</strong>{' '}
          <code>k6 run --out cloud {downloadName}</code>
          <div className="k6-script-cmd-desc">{translate(lang, 'detail.script.docs.cloudDesc')}</div>
        </li>
      </ul>
      <a
        className="k6-script-external-link"
        href={K6_DOCS_URL}
        target="_blank"
        rel="noopener noreferrer"
      >{translate(lang, 'detail.script.docs.link')} ↗</a>
    </section>
  </div>
}


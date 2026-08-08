// Dashboard page that shows the requests that hit the bundled
// demo API. The page is meant to live in its own browser tab so
// the user can start a load test in another tab and watch the
// traffic stream in here — no "go to lasttest, click here, wait
// for the badge" ceremony required.
//
// Two modes:
//  - `/?demo-traffic`        — global stream, polls forever.
//  - `/?demo-traffic=<id>`   — filtered to a single run, stops
//                              polling once the run is terminal.
//
// The polling loop is the only piece of stateful behaviour on
// the page. It is intentionally trivial: load snapshot, decide
// whether to keep going, sleep, repeat. The stop decision lives
// in one helper so the conditions (no runId vs. terminal run)
// are colocated and easy to reason about.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  EMPTY_DEMO_TRAFFIC,
  fetchDemoTraffic,
  formatTrafficTimestamp,
  statusBucket,
  type DemoTrafficEntry,
  type DemoTrafficResponse,
} from './demoTraffic.ts'
import { translate } from './i18n.ts'
import { useLanguage } from './useLanguage.tsx'
import { useDemoStatus } from './useDemoStatus.tsx'

type DemoTrafficPageProps = {
  /**
   * Optional run id filter. When set, the page fetches
   * `/api/demo-traffic/requests?runId=<id>` and stops polling once
   * the run is in a terminal state. When omitted, the global
   * stream is polled without a stop condition.
   */
  runId?: string | undefined
}

const POLL_INTERVAL_MS: number = 1000
const TERMINAL_STATUSES: ReadonlyArray<string> = ['COMPLETED', 'FAILED', 'STOPPED', 'ABORTED']

export function DemoTrafficPage({ runId }: DemoTrafficPageProps) {
  const [snapshot, setSnapshot] = useState<DemoTrafficResponse>(EMPTY_DEMO_TRAFFIC)
  const [error, setError] = useState<string>('')
  // `isLive` is the visual heartbeat of the dashboard. It is set
  // to true the moment the first successful poll returns, and
  // never goes false again until the page is unmounted (or the
  // loop explicitly stops for a filtered run). The page header
  // uses it to render the pulsing "• Live" badge so the user can
  // see at a glance that the stream is open.
  const [isLive, setIsLive] = useState<boolean>(false)
  // Stash the latest `runId` in a ref so the polling effect does
  // not need it as a dependency — that way the loop is started
  // exactly once per page mount, and the helper that decides
  // whether to stop reads the freshest value.
  const runIdRef = useRef<string | undefined>(runId)
  runIdRef.current = runId
  // Read the demo-API status up front. The page short-circuits
  // to a "demo is off" hint when the toggle is off, so the user
  // does not stare at an empty table. The hook has to be called
  // unconditionally before any `return` statements — React
  // Hooks must run in the same order on every render.
  const { status: demoStatus } = useDemoStatus()

  useEffect(() => {
    // Reset state when the URL filter changes — switching from
    // "run A" to "run B" must not show stale entries from A. The
    // polling loop itself picks up the new filter on the next
    // tick; we do not tear it down here.
    setSnapshot(EMPTY_DEMO_TRAFFIC)
    setError('')
    setIsLive(false)
  }, [runId])

  useEffect(() => {
    let cancelled = false
    let timer: number | undefined

    async function loadOnce(): Promise<void> {
      const data = await fetchDemoTraffic(runIdRef.current)
      if (cancelled) return
      setSnapshot(data)
      setError('')
      setIsLive(true)
    }

    async function shouldStopPolling(): Promise<boolean> {
      // The global stream never stops on its own — that is the
      // whole point of "open the dashboard, start a load test in
      // another tab, watch what comes in".
      const activeRunId = runIdRef.current
      if (!activeRunId) return false
      try {
        const response = await fetch(`/api/test-runs/${encodeURIComponent(activeRunId)}`)
        if (!response.ok) return true
        const run = (await response.json()) as { status: string }
        return TERMINAL_STATUSES.includes(run.status)
      } catch {
        return true
      }
    }

    async function tick(): Promise<void> {
      await loadOnce()
      if (cancelled) return
      const stop = await shouldStopPolling()
      if (cancelled) return
      if (stop) return
      timer = window.setTimeout(tick, POLL_INTERVAL_MS)
    }

    tick()
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [])

  if (error) {
    return (
      <PageShell>
        <div className="report-alert failure">{error}</div>
      </PageShell>
    )
  }

  if (!demoStatus.enabled) {
    return (
      <PageShell>
        <PageHeader runId={runId ?? null} snapshot={snapshot} isLive={false} />
        <DemoOffHint />
      </PageShell>
    )
  }

  return (
    <PageShell>
      <PageHeader runId={runId ?? null} snapshot={snapshot} isLive={isLive} />
      {snapshot.count === 0
        ? <EmptyState runId={runId ?? null} />
        : <TrafficTable entries={snapshot.entries} />}
    </PageShell>
  )
}

function PageShell({ children }: { children: ReactNode }): ReactNode {
  const { language } = useLanguage()
  return (
    <main className="report-page">
      <div className="report-toolbar">
        <a href="/">← {language === 'de' ? 'Zur Anwendung' : 'Back to app'}</a>
        <button type="button" onClick={() => window.print()}>
          {translate(language, 'report.print')}
        </button>
      </div>
      {children}
    </main>
  )
}

function PageHeader({
  runId,
  snapshot,
  isLive,
}: {
  runId: string | null
  snapshot: DemoTrafficResponse
  isLive: boolean
}): ReactNode {
  const { language: lang } = useLanguage()
  return (
    <>
      <div className="report-brand">
        <div className="report-logo" aria-hidden="true">k6</div>
        <div>
          <strong>{translate(lang, 'demoTraffic.brand')}</strong>
          <span>{translate(lang, 'demoTraffic.brand.tagline')}</span>
        </div>
      </div>
      <div className="report-title-row">
        <div>
          <span className="report-eyebrow">{translate(lang, 'demoTraffic.eyebrow')}</span>
          <h1>
            {translate(lang, 'demoTraffic.title')}
            {' '}
            <span
              className={`demo-traffic-live-badge ${isLive ? 'is-live' : 'is-loading'}`}
              aria-live="polite"
              title={isLive ? translate(lang, 'demoTraffic.live.tooltip') : translate(lang, 'demoTraffic.loading.tooltip')}
            >
              <span className="demo-traffic-live-dot" aria-hidden="true" />
              {isLive ? translate(lang, 'demoTraffic.live') : translate(lang, 'demoTraffic.loading')}
            </span>
          </h1>
          <p>
            {runId
              ? translate(lang, 'demoTraffic.subtitle.run', { id: runId })
              : translate(lang, 'demoTraffic.subtitle.global')}
            {' · '}
            {translate(lang, 'demoTraffic.count', { count: snapshot.count, limit: snapshot.limit })}
          </p>
        </div>
      </div>
    </>
  )
}

function DemoOffHint(): ReactNode {
  // The dashboard short-circuited because the demo is off.
  // Instead of an empty table we surface a clear hint that
  // points the user at the Settings drawer — that is the only
  // place that flips the toggle. A `curl` against the demo API
  // does not work either when the toggle is off (the controller
  // returns 404), so the hint deliberately does not advertise
  // it.
  const { language: lang } = useLanguage()
  return (
    <section className="report-section demo-traffic-section">
      <div className="demo-traffic-empty">
        <h2>{translate(lang, 'demoTraffic.off.title')}</h2>
        <p>{translate(lang, 'demoTraffic.off.body')}</p>
      </div>
    </section>
  )
}

function EmptyState({ runId }: { runId: string | null }): ReactNode {
  // The empty state is the first thing a user sees when they open
  // the dashboard in a fresh install — it is also the very first
  // thing they see *after* a run finishes if no further requests
  // arrive. The card therefore has two jobs:
  //  1. confirm that the dashboard is alive and waiting (so the
  //     user does not think the page is broken);
  //  2. give a concrete recipe for generating traffic (open the
  //     lasttest app, import the bundled demo, hit start) so the
  //     user does not have to guess.
  const { language: lang } = useLanguage()
  const filtered = runId !== null
  return (
    <section className="report-section demo-traffic-section">
      <div className="demo-traffic-empty">
        <h2>{translate(lang, 'demoTraffic.empty.title')}</h2>
        {filtered
          ? <p>{translate(lang, 'demoTraffic.empty.filtered', { id: runId })}</p>
          : <p>{translate(lang, 'demoTraffic.empty.body')}</p>}
        <ol className="demo-traffic-empty-steps">
          <li>{translate(lang, 'demoTraffic.empty.step1')}</li>
          <li>{translate(lang, 'demoTraffic.empty.step2')}</li>
          <li>{translate(lang, 'demoTraffic.empty.step3')}</li>
        </ol>
        <p className="demo-traffic-empty-curl">
          <code>{`curl -i ${window.location.origin}/demo-api/products`}</code>
        </p>
        <p className="demo-traffic-empty-hint">{translate(lang, 'demoTraffic.empty.hint')}</p>
      </div>
    </section>
  )
}

function TrafficTable({ entries }: { entries: DemoTrafficEntry[] }): ReactNode {
  const { language: lang } = useLanguage()
  return (
    <section className="report-section demo-traffic-section">
      <h2>{translate(lang, 'demoTraffic.section.entries')}</h2>
      <div className="demo-traffic-table-wrapper">
        <table className="demo-traffic-table">
          <thead>
            <tr>
              <th scope="col">{translate(lang, 'demoTraffic.col.time')}</th>
              <th scope="col">{translate(lang, 'demoTraffic.col.method')}</th>
              <th scope="col">{translate(lang, 'demoTraffic.col.path')}</th>
              <th scope="col">{translate(lang, 'demoTraffic.col.status')}</th>
              <th scope="col">{translate(lang, 'demoTraffic.col.userAgent')}</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, index) => <TrafficRow key={`${entry.timestamp}-${index}`} entry={entry} />)}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function TrafficRow({ entry }: { entry: DemoTrafficEntry }): ReactNode {
  const fullPath = entry.queryString ? `${entry.path}?${entry.queryString}` : entry.path
  const bucket = statusBucket(entry.status)
  return (
    <tr className={`demo-traffic-row demo-traffic-row-${bucket}`}>
      <td className="demo-traffic-cell-time">{formatTrafficTimestamp(entry.timestamp)}</td>
      <td className={`demo-traffic-cell-method demo-traffic-method-${entry.method.toLowerCase()}`}>{entry.method}</td>
      <td className="demo-traffic-cell-path" title={fullPath}>{fullPath}</td>
      <td className={`demo-traffic-cell-status demo-traffic-status-${bucket}`}>{entry.status}</td>
      <td className="demo-traffic-cell-user-agent" title={entry.userAgent ?? ''}>
        {entry.userAgent ?? '—'}
      </td>
    </tr>
  )
}

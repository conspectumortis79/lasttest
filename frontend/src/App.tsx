import { useEffect, useRef, useState } from 'react'
import {
  isTerminalRun,
  pickActiveRunId,
  pickActiveRunIdAfterStart,
  removeAllOtherFailed,
  removeRun,
} from './runDashboard.ts'
import {
  detectTerminalTransitions,
  loadNotificationSettings,
  saveNotificationSettings,
  type NotificationPermissionState,
  type NotificationSettings,
} from './runNotifications.ts'
import './App.css'
import { TestRunReportPage } from './TestRunReport.tsx'
import {
  buildMetricRow,
  copyTextToClipboard,
  parseK6Summary,
  summarizeFailure,
  type TestRun,
} from './k6Report.ts'
import { buildRunMenuItems, type MenuItem } from './runMenuItems.ts'
import { MenuItemIcon } from './runMenuIcons.tsx'
import { TopToolbar, type ToolbarDocId } from './TopToolbar.tsx'
import { SettingsDrawer } from './SettingsDrawer.tsx'
import { DocPopup } from './DocPopup.tsx'
import { WikiPopup } from './WikiPopup.tsx'
import { useLanguage, LanguageProvider } from './useLanguage.tsx'
import { translate, formatters, type SupportedLanguage } from './i18n.ts'
import { RunStatusView } from './runStatusView.tsx'
import { useRunClock } from './useRunClock.ts'
import { LoadProfileEditor } from './LoadProfileEditor.tsx'
import {
  defaultLoadProfile,
  serialiseLoadProfile,
  validateLoadProfile,
  type LoadProfile,
} from './loadProfile.ts'
// MAX_DURATION_SECONDS / MAX_VIRTUAL_USERS are no longer needed
// directly in App.tsx — the limits now live in LoadProfileEditor.
import {
  buildOperationConfigurations,
  createOperationSettings,
  hasApiKeyAuth,
  hasBasicAuth,
  hasBearerAuth,
  hasMultipleServers,
  hasOAuth2Auth,
  isOperationValid,
  parameterInputKind,
  parameterKey,
  parameterSelectOptions,
  validateOperationSettings,
  validateParameterValue,
  validateRequestBody,
  type ImportedSpecification,
  type Operation,
  type OperationPayload,
  type OperationSettings,
} from './operationConfiguration.ts'
import { type FetchedSpecification, validateSpecificationUrl } from './specificationSource.ts'
import { DemoCredentialsBanner } from './DemoCredentialsBanner.tsx'
import { fetchWithRetry } from './retryFetch.ts'

type ImportResponse = ImportedSpecification & { message?: string }

/**
 * Reads the current browser-level Notification permission. Falls
 * back to `'default'` when `Notification` is not available (SSR,
 * older browsers, jsdom). The loaded value feeds the disabled
 * state of the Settings drawer so the user sees the actual
 * browser state, not a stale cached value.
 */
function getNotificationPermission(): NotificationPermissionState {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return 'default'
  return Notification.permission as NotificationPermissionState
}

/**
 * Fires one browser notification per terminal transition. The
 * function is purely side-effecting; it never touches React
 * state. Skips silently when the tab is in the foreground
 * (the user can already see the badge colour change) and when
 * the browser has not granted permission.
 *
 * The title / body are localised via the synchronous `translate`
 * helper so the notification copy matches the active language
 * even when the user switched languages mid-run.
 */
function fireTerminalNotifications(
  transitions: { runId: string, kind: 'COMPLETED' | 'FAILED', status: TestRun['status'] }[],
  language: SupportedLanguage,
): void {
  if (transitions.length === 0) return
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return
  if (Notification.permission !== 'granted') return
  if (!document.hidden) return
  for (const entry of transitions) {
    if (entry.kind === 'COMPLETED') {
      // eslint-disable-next-line no-new
      new Notification(translate(language, 'notification.completed.title'), {
        body: translate(language, 'notification.completed.body', { id: entry.runId }),
        tag: `lasttest-run-${entry.runId}`,
      })
    } else {
      // eslint-disable-next-line no-new
      new Notification(translate(language, 'notification.failed.title'), {
        body: translate(language, 'notification.failed.body', { id: entry.runId, status: entry.status }),
        tag: `lasttest-run-${entry.runId}`,
      })
    }
  }
}

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
  return (
    <LanguageProvider>
      {reportRunId ? <TestRunReportPage runId={reportRunId} /> : <LoadTestApp />}
    </LanguageProvider>
  )
}

function LoadTestApp() {
  // i18n chrome (toolbar + settings drawer). The hook lives here
  // — not in a deeper component — so the toolbar and drawer share
  // the same language state and stay in sync.
  const { language, setLanguage } = useLanguage()
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Browser-Notification settings. The settings live next to the
  // drawer in App.tsx so the polling effect below can react to
  // `in-flight → terminal` transitions on every refresh tick.
  // Persistence mirrors the language hook: localStorage, versioned
  // key, defaults on parse failure. The permission state is read
  // from the browser on mount and refreshed after the user asks
  // for permission.
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>(
    () => loadNotificationSettings(typeof localStorage !== 'undefined' ? localStorage : null),
  )
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermissionState>(
    () => getNotificationPermission(),
  )

  // Persist notification settings as soon as the user toggles
  // anything. Mirror the language hook's failure-tolerance — a
  // missing or full localStorage must not break the UI.
  useEffect(() => {
    saveNotificationSettings(notificationSettings, typeof localStorage !== 'undefined' ? localStorage : null)
  }, [notificationSettings])

  /**
   * Asks the browser for Notification permission and, on
   * `granted`, flips the master toggle to `true`. The user
   * gesture originates in the Settings drawer (the master
   * checkbox) — the actual `requestPermission()` call must run
   * synchronously inside that handler, which is why the drawer
   * forwards the gesture to this callback instead of asking
   * directly.
   */
  async function handleRequestNotificationPermission() {
    if (typeof window === 'undefined' || typeof Notification === 'undefined') return
    let permission: NotificationPermission = 'default'
    try {
      permission = await Notification.requestPermission()
    } catch {
      // Some browsers (Safari prior to 16, embedded WebViews)
      // throw rather than return 'denied'. Treat the throw as
      // a denial and leave the toggle off.
      permission = 'denied'
    }
    setNotificationPermission(permission as NotificationPermissionState)
    if (permission === 'granted') {
      setNotificationSettings({ ...notificationSettings, enabled: true })
    }
  }
  // Popup state for the top-toolbar nav buttons. `openDoc` is the
  // id of the popup currently shown (`'userGuide'`, `'readme'`,
  // `'wiki'`); `wikiInitialQuery` lets the toolbar seed the wiki
  // search with a pre-filled term so a future "Help on this
  // term" affordance can deep-link into the glossary.
  const [openDoc, setOpenDoc] = useState<ToolbarDocId | null>(null)
  const [wikiInitialQuery, setWikiInitialQuery] = useState<string>('')
  const handleOpenDoc = (doc: ToolbarDocId, initialQuery?: string) => {
    if (doc === 'wiki') setWikiInitialQuery(initialQuery ?? '')
    setOpenDoc(doc)
  }
  const [specification, setSpecification] = useState(sample)
  const [specificationUrl, setSpecificationUrl] = useState('')
  const [imported, setImported] = useState<ImportedSpecification>()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [operationSettings, setOperationSettings] = useState<Record<string, OperationSettings>>({})
  const [baseUrl, setBaseUrl] = useState('')
  const [loadProfile, setLoadProfile] = useState<LoadProfile>(defaultLoadProfile())
  // Map of every run the user has started in this session, keyed
  // by run id. The dashboard shows one card per run; the run that
  // is currently being polled is the one the user can see live.
  // Multiple runs are polled in parallel via a single useEffect
  // that runs whenever the set of run ids changes.
  const [runs, setRuns] = useState<Record<string, TestRun>>({})
  // Id of the run the user is currently inspecting. Defaults to
  // the most recently started run; the dashboard lets the user
  // switch focus to any other run.
  const [activeRunId, setActiveRunId] = useState<string | undefined>(undefined)
  const run = activeRunId !== undefined ? runs[activeRunId] : undefined
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [lastFetched, setLastFetched] = useState<FetchedSpecification | undefined>()
  // Local ticker for the runtime display. It only ticks while the
  // run is QUEUED or RUNNING; the hook forwards the current `now`
  // to <RunStatusView>.
  const runNow = useRunClock(run)
  // Right-click context menu on a run badge. `null` when no menu
  // is open. `position` keeps the menu at the cursor location;
  // `menuRef` lets us detect outside clicks.
  const [runMenu, setRunMenu] = useState<{ runId: string, x: number, y: number } | null>(null)
  const runMenuRef = useRef<HTMLDivElement | null>(null)
  // Surfaces API failures from the cancel / force-cancel / rerun
  // actions in the global error banner, since the menu itself has
  // no place to render a message.
  const [runActionError, setRunActionError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function loadDemo() {
      // Retry with backoff so that a backend still starting up does
      // not produce ECONNREFUSED entries in the Vite proxy log. On
      // persistent failure (e.g. backend responds with 5xx), the
      // embedded sample in the textarea remains.
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
        // Fallback to the embedded sample if the backend is not reachable.
      }
    }

    loadDemo()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!runMenu) return
    function handlePointer(event: MouseEvent) {
      // Close on any click outside the floating menu. The badge's
      // own contextmenu is captured by onContextMenu above so it
      // only fires when the menu is already closed.
      if (runMenuRef.current && !runMenuRef.current.contains(event.target as Node)) {
        setRunMenu(null)
      }
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setRunMenu(null)
    }
    window.addEventListener('mousedown', handlePointer)
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('mousedown', handlePointer)
      window.removeEventListener('keydown', handleKey)
    }
  }, [runMenu])

  useEffect(() => {
    // Multi-run polling: keep refreshing every run that has not
    // yet reached a terminal state, so the dashboard reflects
    // status changes (QUEUED → RUNNING → STOPPING → STOPPED for
    // a graceful stop, RUNNING → ABORTED for a force abort,
    // RUNNING → COMPLETED/FAILED for a normal exit) for every
    // run the user started. STOPPING *must* be in the set, or
    // the user clicks "Stop", the badge freezes on STOPPING,
    // and the STOPPING → STOPPED transition is never observed.
    // The canonical terminal-state predicate lives in
    // `runDashboard.ts` (single source of truth, unit-tested).
    const pendingIds = Object.entries(runs)
      .filter(([, run]) => !isTerminalRun(run.status))
      .map(([id]) => id)
    if (pendingIds.length === 0) return
    const timer = window.setTimeout(async () => {
      const updated = await Promise.all(
        pendingIds.map(async id => {
          const response = await fetch(`/api/test-runs/${id}`)
          if (!response.ok) return null
          return (await response.json()) as TestRun
        }),
      )
      setRuns(current => {
        // Build the next snapshot first, then diff it against
        // the current one. The pure helper in
        // `runNotifications.ts` returns at most one entry per run
        // and ignores post-terminal follow-up transitions
        // (STOPPED → ABORTED) so the user gets exactly one
        // notification per run.
        const next = { ...current }
        for (const run of updated) {
          if (run !== null) next[run.id] = run
        }
        const transitions = detectTerminalTransitions(current, next, notificationSettings)
        fireTerminalNotifications(transitions, language)
        return next
      })
    }, 1000)
    return () => window.clearTimeout(timer)
  }, [runs, notificationSettings, language])

  async function fetchSpecFromUrl(url: string): Promise<FetchedSpecification> {
    const response = await fetch('/api/specifications/fetch-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.message ?? translate(language, 'error.fetchFailed'))
    return data as FetchedSpecification
  }

  async function importSpecification() {
    setBusy(true)
    setError('')
    // Importing a new spec invalidates the previous test runs: the
    // operations may have changed and the report pages would render
    // against the wrong configuration.
    setRuns({})
    setActiveRunId(undefined)
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
      setError(cause instanceof Error ? cause.message : translate(language, 'error.importFailed'))
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
      // Add the new run to the dashboard and focus it so the user
      // immediately sees the live status. The map shape keeps
      // parallel runs in their own slots without overwriting each
      // other. The active-run selection rule lives in
      // [pickActiveRunIdAfterStart] (unit-tested) so the focus
      // logic stays observable in isolation: the run the user just
      // started always wins the selection, even when an older
      // (finished) run was still focused.
      const nextRuns = { ...runs, [data.id]: data }
      setRuns(nextRuns)
      setActiveRunId(pickActiveRunIdAfterStart(nextRuns, data.id, activeRunId))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : translate(language, 'error.startTestFailed'))
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

  /**
   * Edits a single field on a single payload inside the pool of one
   * operation. The legacy `parameterValues` / `requestBodyJson` /
   * `bearerToken` flat fields stay in sync with `payloads[0]` so the
   * rest of the pipeline (validation, k6 config builder) keeps
   * working without further changes. The Basic auth fields are
   * mirrored in the same way so the wire shape stays consistent.
   */
  function updatePayloadField(
    operationId: string,
    payloadIndex: number,
    field: 'parameterValues' | 'requestBodyJson' | 'bearerToken' | 'basicAuthUsername' | 'basicAuthPassword' | 'apiKey' | 'oauth2Token',
    patch: Record<string, string> | string,
  ) {
    updateSettings(operationId, settings => {
      const next = settings.payloads.map((payload, index) => {
        if (index !== payloadIndex) return payload
        if (field === 'parameterValues' && typeof patch === 'object') {
          return { ...payload, parameterValues: { ...payload.parameterValues, ...patch } }
        }
        if (field === 'requestBodyJson' && typeof patch === 'string') {
          return { ...payload, requestBodyJson: patch }
        }
        if (field === 'bearerToken' && typeof patch === 'string') {
          return { ...payload, bearerToken: patch }
        }
        if (field === 'basicAuthUsername' && typeof patch === 'string') {
          return { ...payload, basicAuthUsername: patch }
        }
        if (field === 'basicAuthPassword' && typeof patch === 'string') {
          return { ...payload, basicAuthPassword: patch }
        }
        if (field === 'apiKey' && typeof patch === 'string') {
          return { ...payload, apiKey: patch }
        }
        if (field === 'oauth2Token' && typeof patch === 'string') {
          return { ...payload, oauth2Token: patch }
        }
        return payload
      })
      const primary = next[0] ?? settings.payloads[0]
      return {
        ...settings,
        payloads: next,
        parameterValues: { ...primary.parameterValues },
        requestBodyJson: primary.requestBodyJson,
        bearerToken: primary.bearerToken,
        basicAuthUsername: primary.basicAuthUsername,
        basicAuthPassword: primary.basicAuthPassword,
        apiKey: primary.apiKey,
        oauth2Token: primary.oauth2Token,
      }
    })
  }

  function addPayload(operationId: string) {
    updateSettings(operationId, settings => {
      const seed = settings.payloads[0]
      const clone: OperationPayload = {
        parameterValues: { ...seed.parameterValues },
        requestBodyJson: seed.requestBodyJson,
        bearerToken: seed.bearerToken,
        basicAuthUsername: seed.basicAuthUsername,
        basicAuthPassword: seed.basicAuthPassword,
        apiKey: seed.apiKey,
        oauth2Token: seed.oauth2Token,
      }
      return { ...settings, payloads: [...settings.payloads, clone] }
    })
  }

  function removePayload(operationId: string, payloadIndex: number) {
    updateSettings(operationId, settings => {
      // Invariant: at least one payload must remain so the legacy
      // single-dataset layout and the validation pipeline keep
      // working. Removing the last payload is a no-op.
      if (settings.payloads.length <= 1) return settings
      const next = settings.payloads.filter((_, index) => index !== payloadIndex)
      const primary = next[0]
      return {
        ...settings,
        payloads: next,
        parameterValues: { ...primary.parameterValues },
        requestBodyJson: primary.requestBodyJson,
        bearerToken: primary.bearerToken,
        basicAuthUsername: primary.basicAuthUsername,
        basicAuthPassword: primary.basicAuthPassword,
        apiKey: primary.apiKey,
        oauth2Token: primary.oauth2Token,
      }
    })
  }

  // ---- Right-click context menu actions ----------------------------
  //
  // The badge opens the menu via `onContextMenu`. Each menu item
  // routes through these handlers so the menu stays purely
  // declarative. The full set of possible items lives in
  // `runMenuItems.ts`, keeping the look-up table unit-testable
  // without rendering React.

  /**
   * Opens the run-badge context menu at the cursor position. The
   * underlying button click is preserved (single-click to focus
   // the run); `preventDefault` only suppresses the browser's
   // own context menu.
   */
  function openRunMenu(event: React.MouseEvent, runId: string) {
    event.preventDefault()
    setRunActionError('')
    setRunMenu({ runId, x: event.clientX, y: event.clientY })
  }

  /**
   * Routes a menu item to the matching action. Most actions are
   // local (clipboard, navigation, state update); cancel / rerun
   // hit the backend through `fetch`. Errors are surfaced via
   // `runActionError` so the user sees the failure in the same
   // banner as the rest of the dashboard.
   */
  async function runMenuAction(run: TestRun, item: MenuItem) {
    setRunMenu(null)
    switch (item.action) {
      case 'focus':
        setActiveRunId(run.id)
        return
      case 'copy-run-id':
        await safeClipboard(run.id)
        return
      case 'copy-report-link': {
        const url = `${window.location.origin}/?report=${encodeURIComponent(run.id)}`
        await safeClipboard(url)
        return
      }
      case 'open-report':
        window.open(`/?report=${encodeURIComponent(run.id)}`, '_blank', 'noopener,noreferrer')
        return
      case 'export-metrics':
        await downloadSummary(run)
        return
      case 'stop':
        await cancelRun(run.id, false)
        return
      case 'force-abort':
        await cancelRun(run.id, true)
        return
      case 'rerun':
        await rerunRun(run.id)
        return
      case 'remove-from-view':
        // Frontend-only cleanup: drops the clicked badge from
        // the in-memory runs map. The backend still holds the
        // run; a page refresh would re-hydrate it from
        // /api/test-runs. The dashboard focus is re-evaluated
        // via pickActiveRunId so the detail card keeps pointing
        // at a run that is still in the map — or hides if no
        // run is left. The remaining badges re-sort on the next
        // render via the existing sortRunsByCreatedAt call in
        // the grid.
        setRuns(current => {
          const next = removeRun(current, run.id)
          setActiveRunId(pickActiveRunId(next, activeRunId))
          return next
        })
        return
      case 'remove-all-other-failed':
        // Bulk frontend cleanup: keeps the clicked badge but
        // drops every other FAILED run from the in-memory map.
        // STOPPED and ABORTED are intentionally preserved — the
        // user asked for "failed" (the FAILED status), not for
        // every non-success outcome. Focus is re-evaluated so
        // the detail card survives the removal even when the
        // previously-focused run was a different FAILED badge.
        setRuns(current => {
          const next = removeAllOtherFailed(current, run.id)
          setActiveRunId(pickActiveRunId(next, activeRunId))
          return next
        })
        return
    }
  }

  async function safeClipboard(text: string) {
    try {
      await copyTextToClipboard(text)
    } catch (cause) {
      setRunActionError(cause instanceof Error ? cause.message : translate(language, 'error.copyFailed'))
    }
  }

  /**
   * Downloads the k6 summary JSON for a finished/aborted run via
   * the existing /api/test-runs/{id}/script endpoint is not a
   * summary — we re-use the run list since the controller does
   * not yet expose a dedicated summary endpoint. The download
   // is offered only when a summary is actually present so the
   // server is not pinged for nothing.
   */
  async function downloadSummary(run: TestRun) {
    // The menu only enables the export item when a summary is
    // present (see runMenuItems.ts), so we never reach this path
    // without data. Downloading the summary as a file is more
    // useful than opening it in a new tab — the user can drop
    // it into a k6 report or compare runs offline.
    if (!run.summary?.raw) return
    const blob = new Blob([run.summary.raw], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `lasttest-${run.id}-summary.json`
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    URL.revokeObjectURL(url)
  }

  async function cancelRun(runId: string, force: boolean) {
    try {
      const response = await fetch(`/api/test-runs/${encodeURIComponent(runId)}/cancel?force=${force}`, { method: 'POST' })
      if (!response.ok && response.status !== 409) {
        throw new Error(`Cancel fehlgeschlagen (HTTP ${response.status})`)
      }
      // The controller returns the updated run on success so we
      // can update the local map immediately instead of waiting
      // for the next poll tick (which can be up to 1 s later).
      if (response.ok) {
        const updated = (await response.json()) as TestRun
        setRuns(current => ({ ...current, [updated.id]: updated }))
      }
    } catch (cause) {
      setRunActionError(cause instanceof Error ? cause.message : translate(language, 'error.cancelFailedNoStatus'))
    }
  }

  async function rerunRun(runId: string) {
    try {
      const response = await fetch(`/api/test-runs/${encodeURIComponent(runId)}/rerun`, { method: 'POST' })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.message ?? `Rerun fehlgeschlagen (HTTP ${response.status})`)
      }
      const fresh = (await response.json()) as TestRun
      // Add the new run to the dashboard and surface it as the
      // active one — same shape as `startTest()` so the user
      // sees a consistent focus transfer: the rerun badge is
      // selected right away instead of leaving the focus on the
      // run it was started from.
      setRuns(current => {
        const next = { ...current, [fresh.id]: fresh }
        setActiveRunId(pickActiveRunIdAfterStart(next, fresh.id, activeRunId))
        return next
      })
    } catch (cause) {
      setRunActionError(cause instanceof Error ? cause.message : translate(language, 'error.rerunFailedNoStatus'))
    }
  }

  return <>
    <TopToolbar language={language} onOpenSettings={() => setSettingsOpen(true)} onOpenDoc={handleOpenDoc} />
    <main>
    <header>
      <div className="mark">k6</div>
      <div><h1>lasttest</h1><p>{translate(language, 'app.tagline')}</p></div>
    </header>

    <section className="card">
      <div className="step">1</div>
      <h2>{translate(language, 'spec.card.title')}</h2>
      <label className="url-import">
        <span className="url-label">{translate(language, 'spec.url.label')}</span>
        <input
          type="url"
          placeholder={translate(language, 'spec.url.placeholder')}
          aria-label={translate(language, 'spec.url.label')}
          value={specificationUrl}
          onChange={event => setSpecificationUrl(event.target.value)}
          spellCheck={false}
        />
        <small>
          {translate(language, 'spec.url.hint')}
        </small>
      </label>
      <textarea className="specification-textarea" aria-label={translate(language, 'spec.card.title')} value={specification} onChange={event => setSpecification(event.target.value)} spellCheck={false} />
      <div className="actions">
        <label className="upload">{translate(language, 'spec.file.open')}<input type="file" accept=".yaml,.yml,.json" onChange={async event => {
          const file = event.target.files?.[0]
          if (file) setSpecification(await file.text())
        }} /></label>
        <button onClick={importSpecification} disabled={busy}>{translate(language, 'spec.import')}</button>
      </div>
      {lastFetched && (
        <p className="fetched-info" aria-live="polite">
          {translate(language, 'spec.fetched.from', { url: '' }).trim()} <code>{lastFetched.resolvedUrl}</code>
          {lastFetched.source === 'swagger-ui' ? translate(language, 'spec.fetched.swaggerUi') : translate(language, 'spec.fetched.direct')}.
        </p>
      )}
    </section>

    {error && <div className="error" role="alert">{error}</div>}
    {runActionError && <div className="error" role="alert">{runActionError}</div>}

    {imported && <>
      <section className="card">
        <div className="step">2</div>
        <h2>{imported.title} <small>v{imported.version}</small></h2>
        <p>{translate(language, 'ops.opsDetected', { n: imported.operations.length })}</p>
        <div className="operations">
          {imported.operations.map(operation => <OperationEditor
            key={operation.operationId}
            operation={operation}
            selected={selected.has(operation.operationId)}
            settings={operationSettings[operation.operationId]}
            expanded={!collapsed.has(operation.operationId)}
            language={language}
            onToggle={() => toggle(operation.operationId)}
            onToggleExpand={() => toggleExpanded(operation.operationId)}
            onPayloadField={(payloadIndex, field, patch) => updatePayloadField(operation.operationId, payloadIndex, field, patch)}
            onAddPayload={() => addPayload(operation.operationId)}
            onRemovePayload={payloadIndex => removePayload(operation.operationId, payloadIndex)}
          />)}
        </div>
      </section>

      <section className="card">
        <div className="step">3</div>
        <h2>{translate(language, 'profile.card.title')}</h2>
        <div className="lastprofil-row">
          <div className="lastprofil-left">
            {hasMultipleServers(imported.servers) && (
              <div className="server-selector">
                <label htmlFor="base-url-select">{translate(language, 'ops.serverSelector.label')}</label>
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
                <small>{translate(language, 'ops.serverSelector.hint')}</small>
              </div>
            )}
            <label className="base-url-label">{translate(language, 'ops.baseUrl')}<input value={baseUrl} onChange={event => setBaseUrl(event.target.value)} /></label>
          </div>
          <fieldset className="strategy-box">
            <legend className="sr-only">{translate(language, 'ops.payloadStrategy')}</legend>
            <div className="strategy-box-title">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <path d="M2 4h12M2 8h12M2 12h12" strokeLinecap="round" />
                <circle cx="5" cy="4" r="1.3" fill="currentColor" stroke="none" />
                <circle cx="10" cy="8" r="1.3" fill="currentColor" stroke="none" />
                <circle cx="7" cy="12" r="1.3" fill="currentColor" stroke="none" />
              </svg>
              <span>{translate(language, 'ops.payloadStrategy')}</span>
            </div>
            <div className="strategy-options">
              <label>
                <input
                  type="radio"
                  name="payloadStrategy"
                  value="sequential"
                  checked={loadProfile.payloadStrategy !== 'random'}
                  onChange={() => setLoadProfile({ ...loadProfile, payloadStrategy: 'sequential' })}
                />
                <span>
                  <span className="opt-name">{translate(language, 'ops.payloadStrategy.sequential')}</span>
                  <span className="opt-desc">{translate(language, 'ops.payloadStrategy.sequential.desc')}</span>
                </span>
              </label>
              <label>
                <input
                  type="radio"
                  name="payloadStrategy"
                  value="random"
                  checked={loadProfile.payloadStrategy === 'random'}
                  onChange={() => setLoadProfile({ ...loadProfile, payloadStrategy: 'random' })}
                />
                <span>
                  <span className="opt-name">{translate(language, 'ops.payloadStrategy.random')}</span>
                  <span className="opt-desc">{translate(language, 'ops.payloadStrategy.random.desc')}</span>
                </span>
              </label>
            </div>
            <small className="strategy-box-hint">
              {(() => {
                const template = translate(language, 'ops.payloadStrategy.hint', { n: 1 })
                // Spring `1` into a <code>1</code> token so it is
                // visually consistent with the rest of the app's
                // mono-spaced code chips. The helper template just
                // knows the literal character, not the markup.
                const [before, after] = template.split('1')
                return <>{before}<code>1</code>{after}</>
              })()}
            </small>
          </fieldset>
        </div>
        <LoadProfileEditor profile={loadProfile} language={language} onChange={setLoadProfile} disabled={busy} />
        {(() => {
          const selectedOperation = imported.operations.find(operation => selected.has(operation.operationId))
          const selectedValidation = selectedOperation
            ? validateOperationSettings(selectedOperation, operationSettings[selectedOperation.operationId])
            : undefined
          const hasValidationErrors = selectedValidation !== undefined && !isOperationValid(selectedValidation)
          const hint = !selectedOperation
            ? undefined
            : hasValidationErrors
              ? translate(language, 'ops.validation.fixErrors')
              : selectedOperation.hasRequestBody
                ? translate(language, 'ops.validation.hintWithBody')
                : translate(language, 'ops.validation.hintNoBody')
          return <>
            {hasValidationErrors && <div className="error validation-summary" role="alert">{hint}</div>}
            {!hasValidationErrors && hint && <p className="validation-hint">{hint}</p>}
            <button className="start" onClick={startTest} disabled={busy || selected.size === 0 || hasValidationErrors}>k6-Lasttest starten</button>
          </>
        })()}
      </section>
    </>}

    {Object.keys(runs).length > 0 && <section className="card result">
      <header className="result-header">
        <div className="result-header-top">
          <div className="step">4</div>
          <h2>{translate(language, 'run.card.title')}</h2>
        </div>
      </header>

      {/* Multi-run dashboard: a grid of badges — one per run, in its
          own evenly-sized column. The badge is the focus target
          (klick- und tastaturbedienbar), so the user does not need a
          separate tab strip below. */}
      <h3 className="run-grid-heading">{translate(language, 'run.grid.heading')}</h3>
      <div className="run-grid" role="tablist" aria-label="Testläufe">
        {Object.values(runs)
          .sort((a, b) => {
            if (a.createdAt !== b.createdAt) return b.createdAt.localeCompare(a.createdAt)
            return a.id.localeCompare(b.id)
          })
          .map(candidate => {
            const operations = candidate.configuration?.operations ?? []
            // Multi-operation runs are rare (the picker only allows one
            // today) but if a run has several, we show the first method
            // and the joined paths so the badge stays compact.
            const primary = operations[0]
            const method = primary?.method ?? '–'
            const path = operations.map(op => op.path).join(', ') || '–'
            return (
              <button
                key={candidate.id}
                type="button"
                role="tab"
                aria-selected={candidate.id === activeRunId}
                className={`run-badge ${candidate.id === activeRunId ? 'active' : ''} run-badge-${candidate.status.toLowerCase()}`}
                onClick={() => setActiveRunId(candidate.id)}
                onContextMenu={event => openRunMenu(event, candidate.id)}
                title={`${candidate.id} · ${method} ${path} — Rechtsklick für Aktionen`}
              >
                <span className={`run-badge-method method-${method.toLowerCase()}`}>{method}</span>
                <div className="run-badge-info">
                  <span className="run-badge-status">{candidate.status}</span>
                  <span className="run-badge-path">{path}</span>
                </div>
              </button>
            )
          })}
      </div>

      {run && <RunDetail run={run} runNow={runNow} />}
    </section>}

    {runMenu && <RunContextMenu
      menu={runMenu}
      run={runs[runMenu.runId]}
      runs={runs}
      language={language}
      onAction={item => runMenuAction(runs[runMenu.runId]!, item)}
      onClose={() => setRunMenu(null)}
      menuRef={runMenuRef}
    />}
    </main>
    <SettingsDrawer
      open={settingsOpen}
      language={language}
      notificationSettings={notificationSettings}
      notificationPermission={notificationPermission}
      onClose={() => setSettingsOpen(false)}
      onLanguageChange={setLanguage}
      onNotificationSettingsChange={setNotificationSettings}
      onRequestNotificationPermission={handleRequestNotificationPermission}
    />
    <DocPopup
      doc={openDoc === 'userGuide' || openDoc === 'readme' ? openDoc : null}
      language={language}
      onClose={() => setOpenDoc(null)}
      strings={{
        search: translate(language, 'doc.popup.search'),
        counterTemplate: hits => formatters.docPopupCounter[language](hits),
        closeAria: translate(language, 'common.close'),
        noResults: translate(language, 'doc.popup.noResults'),
        prev: translate(language, 'doc.popup.prev'),
        next: translate(language, 'doc.popup.next'),
        dismiss: translate(language, 'doc.popup.close'),
      }}
    />
    <WikiPopup
      open={openDoc === 'wiki'}
      language={language}
      initialQuery={wikiInitialQuery}
      onClose={() => setOpenDoc(null)}
      strings={{
        title: translate(language, 'wiki.popup.title'),
        placeholder: translate(language, 'wiki.popup.placeholder'),
        open: translate(language, 'wiki.popup.open'),
        openHint: translate(language, 'wiki.popup.openHint'),
        dismiss: translate(language, 'wiki.popup.dismiss'),
        noMatch: translate(language, 'wiki.popup.noMatch'),
        allTermsHeading: translate(language, 'wiki.popup.allTermsHeading'),
        suggestionsHeading: translate(language, 'wiki.popup.suggestionsHeading'),
        matchedOnLabel: translate(language, 'wiki.popup.matchedOnLabel'),
      }}
    />
  </>
}

/**
 * Per-run card. Renders the status pill, the report link, the live
 * status view and the optional console / summary blocks. Extracted
 * from the inline JSX so the multi-run dashboard above can stay
 * simple.
 */
function RunDetail({ run, runNow }: { run: TestRun, runNow: number }) {
  const { language } = useLanguage()
  // Der Detail-Block zeigt den live-Status des aktuell gewählten
  // Runs. Der zugehörige Endpunkt steht bereits im Badge-Grid
  // darüber, also hier kein Duplikat — nur Status, Metriken und
  // der Report-Button. Der Report-Button lebt jetzt im
  // ResultHeader (Bestanden / Abgebrochen-Pille), nicht mehr in
  // einer eigenen Header-Zeile darüber. Über `showReportButton`
  // teilen wir RunStatusView mit, dass wir den Link einblenden
  // wollen — der Vollreport in TestRunReport.tsx lässt das Flag
  // weg, weil der Report selbst das Link-Ziel ist.
  return <>
    <TestRunSummary run={run} />
    <RunStatusView run={run} now={runNow} showReportButton />
    {((run.consoleOutput ?? run.error) || run.summary) && <div className="result-extras">
      <div className="result-extras-details">
        {(run.consoleOutput ?? run.error) && <details><summary>{translate(language, 'report.console')}</summary><pre>{run.consoleOutput ?? run.error}</pre></details>}
        {run.summary && <details><summary>{translate(language, 'report.json')}</summary><pre>{run.summary.raw}</pre></details>}
      </div>
    </div>}
  </>
}

type TestRunSummaryProps = {
  run: TestRun
}

function TestRunSummary({ run }: TestRunSummaryProps) {
  const summary = parseK6Summary(run)
  const failure = summarizeFailure(run)
  const metricItems = buildMetricRow(run, summary, failure)
  // As soon as k6 is done, <RunStatusView> takes over the full
  // result presentation (badge + threshold notice + cards + run
  // foot). We then hide the metric row and the failure causes here.
  // As soon as k6 is done, <RunStatusView> takes over the full
  // result presentation (PASSED/FAILED pill + exit code in the
  // `ResultHeader` row, threshold notice, cards, run foot). Here at
  // the top we hide both the status pill and the failure causes so
  // nothing appears twice. For RUNNING/QUEUED the status pill stays
  // visible; we keep hiding the time hint ("running since …")
  // because the three cells below (RUNNING SINCE / REMAINING /
  // STARTED) show the same information more clearly.
  // A terminal run is rendered by `RunStatusView` below — which
  // carries the colour-coded "STOPPED" / "ABORTED" pills and the
  // matching threshold notice. Showing the generic gray ".status"
  // pill on top would duplicate the status and look colourless
  // next to the dedicated terminal-state badges.
  const isFinished = isTerminalRun(run.status)

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
  language: SupportedLanguage
  onToggle: () => void
  onToggleExpand: () => void
  onPayloadField: (payloadIndex: number, field: 'parameterValues' | 'requestBodyJson' | 'bearerToken' | 'basicAuthUsername' | 'basicAuthPassword' | 'apiKey' | 'oauth2Token', patch: Record<string, string> | string) => void
  onAddPayload: () => void
  onRemovePayload: (payloadIndex: number) => void
}

function OperationEditor({
  operation,
  selected,
  language,
  expanded,
  settings,
  onToggle,
  onToggleExpand,
  onPayloadField,
  onAddPayload,
  onRemovePayload,
}: OperationEditorProps) {
  if (!settings) return null

  // Aggregate validation across the whole pool. The first payload with
  // a problem decides which error is shown; this keeps the UX simple
  // without losing information (each error message still names the
  // specific field that failed).
  const poolValidation = settings.payloads.map((payload, index) => {
    const parameterErrors: Record<string, string> = {}
    for (const parameter of operation.parameters) {
      const key = parameterKey(parameter)
      const value = payload.parameterValues[key] ?? ''
      const result = validateParameterValue(value, parameter.schema)
      if (!result.valid) parameterErrors[key] = result.message
    }
    const bodyResult = operation.hasRequestBody
      ? validateRequestBody(payload.requestBodyJson, operation.requestBodySchema, operation.requestBodyRequired)
      : { valid: true as const }
    return {
      index,
      parameterErrors,
      bodyError: bodyResult.valid ? undefined : bodyResult.message,
    }
  })
  const firstProblem = poolValidation.find(v => v.bodyError !== undefined || Object.keys(v.parameterErrors).length > 0)
  const hasPoolError = firstProblem !== undefined

  // The pool editor renders one credential column per auth type
  // declared by the operation. `hasBasicAuth` / `hasBearerAuth` /
  // `hasApiKeyAuth` are derived from `operation.authRequirements`
  // (the new discriminated union from the backend); the legacy
  // `bearerAuth` boolean is used as a fallback so specs without
  // the new field keep showing the optional Bearer input.
  const showBasicAuth = hasBasicAuth(operation)
  const showBearerAuth = hasBearerAuth(operation) || (!showBasicAuth && operation.bearerAuth)
  const showApiKey = hasApiKeyAuth(operation)
  const showOAuth2 = hasOAuth2Auth(operation)

  return <article className={`operation-card ${selected ? 'selected' : ''} ${expanded ? 'expanded' : ''}`}>
    <label className="operation-heading">
      <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Endpunkt ${operation.method} ${operation.path} auswählen`} />
      <span className={`method ${operation.method.toLowerCase()}`}>{operation.method}</span>
      <code>{operation.path}</code>
    </label>
    <div className="operation-meta">
      <span className="operation-id" aria-label={`Operation ${operation.operationId}`}>{operation.operationId}</span>
      <span className="type-hint">{settings.payloads.length} Payload{settings.payloads.length === 1 ? '' : 's'}</span>
      {operation.summary && <p className="operation-summary">{operation.summary}</p>}
    </div>

    <button
      type="button"
      className="expand-toggle"
      onClick={onToggleExpand}
      aria-expanded={expanded}
      aria-label={translate(language, expanded ? 'ops.card.collapse.aria' : 'ops.card.expand.aria')}
      title={translate(language, expanded ? 'ops.card.collapse.title' : 'ops.card.expand.title')}
    >
      <svg className="chevron" viewBox="0 0 12 12" aria-hidden="true">
        {expanded
          ? <path d="M1 2 L6 10 L11 2 L6 6 Z" fill="currentColor" />
          : <path d="M2 1 L10 6 L2 11 L6 6 Z" fill="currentColor" />}
      </svg>
    </button>

    {expanded && <div className="payload-pool">
      <DemoCredentialsBanner
        operationId={operation.operationId}
        language={language}
        onApplyBasic={(username, password) => {
          onPayloadField(0, 'basicAuthUsername', username)
          onPayloadField(0, 'basicAuthPassword', password)
        }}
        onApplyBearer={token => onPayloadField(0, 'bearerToken', token)}
        onApplyApiKey={key => onPayloadField(0, 'apiKey', key)}
        onApplyOAuth2={token => onPayloadField(0, 'oauth2Token', token)}
      />
      <p className="pool-hint">
        {translate(language, 'ops.pool.hint')}
      </p>
      <div className="pool-table-wrap">
        <table className="pool-table" aria-label={translate(language, 'ops.pool.tableAria', { operationId: operation.operationId })}>
          <thead>
            <tr>
              <th className="pool-col-index">#</th>
              {operation.parameters.map(parameter => {
                const typeLabel = formatParameterType(parameter.schema)
                return (
                  <th key={parameterKey(parameter)}>
                    <div className="pool-th-name">{parameter.name}</div>
                    <div className="pool-th-meta">
                      <span className="pool-th-loc">{parameter.location}</span>
                      {typeLabel && <span className="type-hint">{typeLabel}</span>}
                      {parameter.required && <em className="pool-th-req">{translate(language, 'ops.payload.required')}</em>}
                    </div>
                  </th>
                )
              })}
              {operation.hasRequestBody && <th className="col-wide">{translate(language, 'report.payload.jsonSummary')}</th>}
              {showBasicAuth && <th className="col-auth-basic">{translate(language, 'ops.auth.basic.header')}</th>}
              {showApiKey && <th className="col-auth-api-key">{translate(language, 'ops.auth.apiKey.header')}</th>}
              {showOAuth2 && <th className="col-auth-oauth2">{translate(language, 'ops.auth.oauth2.header')}</th>}
              {showBearerAuth && <th>{translate(language, 'ops.auth.bearer.header')}</th>}
              <th className="col-actions" aria-label={translate(language, 'profile.stages.action') as string}></th>
            </tr>
          </thead>
          <tbody>
            {settings.payloads.map((payload, payloadIndex) => {
              const validation = poolValidation[payloadIndex]
              return (
                <tr key={payloadIndex}>
                  <th scope="row" className="pool-col-index">{payloadIndex + 1}</th>
                  {operation.parameters.map(parameter => {
                    const key = parameterKey(parameter)
                    const value = payload.parameterValues[key] ?? ''
                    const errorMessage = validation.parameterErrors[key]
                    const errorId = errorMessage ? `${operation.operationId}-p${payloadIndex}-${parameter.name}-error` : undefined
                    // `parameterInputKind` decides whether the field
                    // is rendered as a plain `<input>` (default) or as
                    // a `<select>` dropdown. OpenAPI `boolean`
                    // parameters and every parameter that declares an
                    // `enum` are surfaced as a dropdown so the user
                    // cannot pick a value that the spec does not
                    // allow. The wire format stays a string — k6 reads
                    // the literal "true" / "false" directly.
                    const inputKind = parameterInputKind(parameter.schema)
                    const cellLabel = `${operation.operationId} · Payload ${payloadIndex + 1}: ${parameter.name}`
                    return (
                      <td key={key}>
                        {inputKind === 'text'
                          ? <input
                              aria-label={cellLabel}
                              aria-invalid={errorMessage ? true : undefined}
                              aria-describedby={errorId}
                              value={value}
                              onChange={event => onPayloadField(payloadIndex, 'parameterValues', { [key]: event.target.value })}
                            />
                          : <select
                              className="parameter-select"
                              aria-label={cellLabel}
                              aria-invalid={errorMessage ? true : undefined}
                              aria-describedby={errorId}
                              value={parameterSelectOptions(parameter, inputKind).includes(value) ? value : ''}
                              onChange={event => onPayloadField(payloadIndex, 'parameterValues', { [key]: event.target.value })}
                            >
                              {/* Empty option lets the user unselect
                                  (or — for required fields — forces
                                  an explicit choice before the row is
                                  considered valid). */}
                              <option value="">{translate(language, parameter.required ? 'ops.param.requiredPlaceholder' : 'ops.param.optionalPlaceholder')}</option>
                              {parameterSelectOptions(parameter, inputKind).map(option => (
                                <option key={option} value={option}>{option}</option>
                              ))}
                            </select>}
                        {errorMessage && <div className="parameter-error" role="alert" id={errorId}>{errorMessage}</div>}
                      </td>
                    )
                  })}
                  {operation.hasRequestBody && (
                    <td>
                      <textarea
                        className="request-body"
                        aria-label={`${operation.operationId} · Payload ${payloadIndex + 1}: JSON Request-Body`}
                        aria-invalid={validation.bodyError ? true : undefined}
                        value={payload.requestBodyJson}
                        onChange={event => onPayloadField(payloadIndex, 'requestBodyJson', event.target.value)}
                        spellCheck={false}
                      />
                      {validation.bodyError && <div className="parameter-error" role="alert">{validation.bodyError}</div>}
                    </td>
                  )}
                  {showBasicAuth && (
                    <td className="col-auth-basic">
                      <div className="auth-stack">
                        <input
                          type="text"
                          autoComplete="off"
                          spellCheck={false}
                          aria-label={translate(language, 'ops.auth.basic.cellAria.username', { operationId: operation.operationId, n: payloadIndex + 1 })}
                          placeholder={translate(language, 'ops.auth.basic.placeholder.username')}
                          value={payload.basicAuthUsername}
                          onChange={event => onPayloadField(payloadIndex, 'basicAuthUsername', event.target.value)}
                        />
                        <input
                          type="password"
                          autoComplete="off"
                          aria-label={translate(language, 'ops.auth.basic.cellAria.password', { operationId: operation.operationId, n: payloadIndex + 1 })}
                          placeholder={translate(language, 'ops.auth.basic.placeholder.password')}
                          value={payload.basicAuthPassword}
                          onChange={event => onPayloadField(payloadIndex, 'basicAuthPassword', event.target.value)}
                        />
                      </div>
                    </td>
                  )}
                  {showApiKey && (
                    <td className="col-auth-api-key">
                      <input
                        type="password"
                        autoComplete="off"
                        aria-label={translate(language, 'ops.auth.apiKey.cellAria', { operationId: operation.operationId, n: payloadIndex + 1 })}
                        placeholder={translate(language, 'ops.auth.apiKey.placeholder')}
                        value={payload.apiKey}
                        onChange={event => onPayloadField(payloadIndex, 'apiKey', event.target.value)}
                      />
                    </td>
                  )}
                  {showOAuth2 && (
                    <td className="col-auth-oauth2">
                      <input
                        type="password"
                        autoComplete="off"
                        aria-label={translate(language, 'ops.auth.oauth2.cellAria', { operationId: operation.operationId, n: payloadIndex + 1 })}
                        placeholder={translate(language, 'ops.auth.oauth2.placeholder')}
                        value={payload.oauth2Token}
                        onChange={event => onPayloadField(payloadIndex, 'oauth2Token', event.target.value)}
                      />
                    </td>
                  )}
                  {showBearerAuth && (
                    <td>
                      <input
                        type="password"
                        autoComplete="off"
                        aria-label={translate(language, 'ops.auth.bearer.cellAria', { operationId: operation.operationId, n: payloadIndex + 1 })}
                        placeholder={translate(language, hasBearerAuth(operation) ? 'ops.auth.bearer.placeholder' : 'ops.auth.bearer.placeholderOptional')}
                        value={payload.bearerToken}
                        onChange={event => onPayloadField(payloadIndex, 'bearerToken', event.target.value)}
                      />
                    </td>
                  )}
                  <td className="col-actions">
                    <button
                      type="button"
                      className="row-remove"
                      aria-label={translate(language, 'ops.pool.removeAria', { n: payloadIndex + 1 })}
                      disabled={settings.payloads.length <= 1}
                      onClick={() => onRemovePayload(payloadIndex)}
                      title={translate(language, settings.payloads.length <= 1 ? 'ops.pool.removeDisabledTitle' : 'ops.pool.removeEnabledTitle')}
                    >×</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <button type="button" className="pool-add" onClick={onAddPayload}>{translate(language, 'ops.pool.add')}</button>
      {hasPoolError && (
        <div className="parameter-error" role="alert" style={{ marginTop: '.6rem' }}>
          {firstProblem!.bodyError ?? translate(language, 'ops.pool.rowErrorFallback', { n: firstProblem!.index + 1 })}
        </div>
      )}
    </div>}
  </article>
}

/**
 * Renders a short, human-readable type label for a parameter so the
 * user can see at a glance what validation the input field will be
 * checked against. Enum values and explicit `format` win over the raw
 * `type` because they tell the user the most about what is accepted.
 */
function formatParameterType(schema: unknown): string | undefined {
  if (schema == null || typeof schema !== 'object') return undefined
  const candidate = schema as { type?: unknown, format?: unknown, enum?: unknown }
  if (Array.isArray(candidate.enum) && candidate.enum.length > 0) {
    return `${typeof candidate.type === 'string' ? candidate.type : 'string'} enum`
  }
  if (typeof candidate.format === 'string' && candidate.format.length > 0) {
    return candidate.format
  }
  if (typeof candidate.type === 'string' && candidate.type.length > 0) {
    return candidate.type
  }
  return undefined
}

/**
 * Floating menu that opens on right-click on a run badge. The
 * visible items come from `buildRunMenuItems(run)` and adapt to the
 * run's current status. The component is intentionally dumb: it
 * does not know what each action does — it just emits the
 * `MenuItem` and lets the parent route to the right handler.
 */
function RunContextMenu({
  menu,
  run,
  runs,
  language,
  onAction,
  onClose,
  menuRef,
}: {
  menu: { runId: string, x: number, y: number }
  run: TestRun | undefined
  runs: Record<string, TestRun>
  language: SupportedLanguage
  onAction: (item: MenuItem) => void
  onClose: () => void
  menuRef: React.RefObject<HTMLDivElement | null>
}) {
  // Defensive: the menu should be closed by the parent when run
  // disappears from the map, but render nothing if it slipped
  // through.
  if (!run) { onClose(); return null }
  // The full runs map is passed so the menu can disable the
  // "remove all other failed" item when no other FAILED run
  // is in the dashboard. Without it the user could click the
  // action with no visible effect. The active language comes
  // from the toolbar so the labels match the rest of the UI.
  const groups = buildRunMenuItems(run, language, runs)
  // Clamp the position so the menu stays inside the viewport.
  // We use 8px padding from the viewport edge so the rounded
  // corners and the focus ring do not get clipped.
  const menuWidth = 240
  const menuHeightEstimate = 48 * groups.flat().length + 24
  const x = Math.max(8, Math.min(menu.x, window.innerWidth - menuWidth - 8))
  const y = Math.max(8, Math.min(menu.y, window.innerHeight - menuHeightEstimate - 8))
  return <div
    ref={menuRef}
    className="run-context-menu"
    role="menu"
    aria-label="Aktionen für diesen Testlauf"
    style={{ left: x, top: y }}
    onContextMenu={event => event.preventDefault()}
  >
    {groups.map((group, groupIndex) => <div key={groupIndex} className="run-context-menu-group">
      {group.map(item => {
        const disabled = Boolean(item.disabledReason)
        return <button
          key={item.id}
          type="button"
          role="menuitem"
          className={`run-context-menu-item ${item.danger ? 'is-danger' : ''} ${disabled ? 'is-disabled' : ''}`}
          disabled={disabled}
          title={item.disabledReason ?? item.label}
          onClick={() => { if (!disabled) onAction(item) }}
        >
          <MenuItemIcon action={item.action} />
          <span>{item.label}</span>
          {item.shortcut && <kbd className="kbd">{item.shortcut}</kbd>}
        </button>
      })}
      {groupIndex < groups.length - 1 && <div className="run-context-menu-separator" />}
    </div>)}
  </div>
}

export default App

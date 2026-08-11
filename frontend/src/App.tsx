import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useAutoSizeTextarea } from './useAutoSizeTextarea.ts'
import {
  cancellableRunIds,
  isCancellable,
  isInFlight,
  isTerminalRun,
  pickActiveRunId,
  pickActiveRunIdAfterStart,
  removeAllOtherFailed,
  clearAllRuns,
  removeRun,
  showsStatusPill,
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
import { DemoTrafficPage } from './DemoTrafficPage.tsx'
import { DemoStatusProvider } from './useDemoStatus.tsx'
import { useDemoStatus } from './useDemoStatusState.ts'
import {
  buildMetricRow,
  copyTextToClipboard,
  k6ScriptDownloadName,
  k6ScriptUrl,
  parseK6Summary,
  runElapsedSeconds,
  summarizeFailure,
  type TestRun,
} from './k6Report.ts'
import type { MenuItem } from './runMenuItems.ts'
import { RunContextMenu } from './RunContextMenu.tsx'
import { dispatchRunMenuAction, type RunActionHandlers } from './runActionHandlers.ts'
import { TopToolbar, type ToolbarDocId } from './TopToolbar.tsx'
import { SettingsDrawer } from './SettingsDrawer.tsx'
import { DocPopup } from './DocPopup.tsx'
import { WikiPopup } from './WikiPopup.tsx'
import { LanguageProvider } from './useLanguage.tsx'
import { usePersistence } from './persistenceStorage.ts'
import { PersistenceProvider } from './usePersistence.tsx'
import { useLanguage } from './languageStorage.ts'
import { translate, formatters, type SupportedLanguage } from './i18n.ts'
import { RunStatusView, LiveBanner, AktionenTab, LiveRampChart } from './runStatusView.tsx'
import { StatusCodeDistributionCard } from './StatusCodeDistributionCard.tsx'
import { vuSamplesToEpochSeconds } from './timeSeries.ts'
import { computeRampChartParams } from './liveRampChartLayout.ts'
import { ConsoleTab, ThresholdsTab, ConfigTab, FailureTab, K6ScriptTab } from './runDetailTabs.tsx'
import { EndpointTimelineTab } from './EndpointTimelineTab.tsx'
import { useRunClock, useLiveClock } from './useRunClock.ts'
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
  hasOpenIdConnectAuth,
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

type ImportResponse = ImportedSpecification & { message?: string }

// Polling cadence for the in-flight ramp chart. The time-series
// endpoint is served from H2 (see [H2TimeSeriesReader] +
// the seedPlannedRampProfile call in [LocalK6TestRunService]),
// so the request itself is cheap — 1 s feels close to "live"
// without doubling backend load across N concurrent runs.
const RAMP_POLL_INTERVAL_MS = 1000

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

// Pure helpers from `lastRunsView.ts` — imported here because
// the run-grid badge renders the same identifiers (status dot,
// method/path display name) as the "Last runs" list view. The
// helpers are intentionally tiny, side-effect-free and
// locale-aware, so the badge can reuse them without duplicating
// the formatting decisions.
import { loadProfileSummaryFor } from './lastRunsView.ts'

// Formats a (possibly undefined) elapsed-seconds value as the
// compact `M:SS` string the badge shows next to the spinner.
// `undefined` (run not started yet) is rendered as `--:--` so
// the badge layout stays stable — the status pill and the
// spinner already convey the "not yet running" state, so the
// stopwatch does not have to. Mirrors the helper in
// `lastRunsView.ts`; inlined here because the badge lives
// outside that file's render tree.
function formatMmSs(totalSeconds: number | undefined): string {
  if (totalSeconds == null) return '--:--'
  const safe = Math.max(0, Math.floor(totalSeconds))
  const minutes = Math.floor(safe / 60)
  const seconds = safe % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function App() {
  const params = new URLSearchParams(window.location.search)
  const reportRunId = params.get('report')
  // The demo-traffic page is mounted either with an optional
  // `?demo-traffic=<runId>` (filtered to a single run) or with
  // `?demo-traffic` (global stream). The flag-presence check is
  // the cheap test; the actual filter value is forwarded as-is.
  const demoTrafficParam = params.has('demo-traffic') ? params.get('demo-traffic') ?? undefined : undefined
  return (
    <LanguageProvider>
      <PersistenceProvider>
        <DemoStatusProvider>
          {reportRunId
            ? <TestRunReportPage runId={reportRunId} />
            : demoTrafficParam !== undefined
              ? <DemoTrafficPage runId={demoTrafficParam} />
              : <LoadTestApp />}
        </DemoStatusProvider>
      </PersistenceProvider>
    </LanguageProvider>
  )
}

function LoadTestApp() {
  // Subscribe to the demo-API status. The hook is the single
  // source of truth for "is the demo on?", and the auto-load
  // effect below uses it to keep the textarea in sync.
  const demoStatus = useDemoStatus()
  // i18n chrome (toolbar + settings drawer). The hook lives here
  // — not in a deeper component — so the toolbar and drawer share
  // the same language state and stay in sync.
  const { language, setLanguage } = useLanguage()
  // Timeline-persistence toggle. Forwarded as the `persist`
  // body field on every `POST /api/test-runs` call so the
  // backend skips the timeline write when the user has
  // disabled the setting. The hook lives at the App root so
  // the Settings drawer (a sibling) and the test-runner
  // button see the same value without prop-drilling.
  const { persistRuns } = usePersistence()
  // One-shot cleanup: when the user has the persistence
  // toggle OFF at the time the App mounts, wipe the
  // persisted timeline so a fresh start lands on an empty
  // dashboard. The intuitive contract is "I disabled
  // saving — there should be no history"; without this
  // effect the dashboard would still show the runs that
  // were saved when the toggle was previously on (or under
  // the default-true build that shipped before this
  // feature). The [useRef] guard makes the cleanup run
  // exactly once per App lifetime so toggling the switch
  // back on and off does not silently re-trigger the wipe.
  const cleanupRef = useRef(false)
  useEffect(() => {
    if (cleanupRef.current) return
    if (persistRuns) return
    cleanupRef.current = true
    void (async () => {
      try {
        const response = await fetch('/api/test-runs', { method: 'DELETE' })
        if (!response.ok) return
        // Match the backend's wipe: drop the in-memory
        // map and clear the active run selection. The
        // dashboard's first poll re-fetches from an empty
        // table and renders accordingly.
        setRuns(clearAllRuns())
        setActiveRunId(undefined)
      } catch {
        // Best-effort: when the backend is unreachable
        // the polling loop will surface the same
        // connectivity error on the next tick; no need
        // to spam the user with a separate toast here.
      }
    })()
    // The effect intentionally fires only on the first
    // mount with `persistRuns === false`; subsequent
    // renders must not re-run the cleanup. We depend on
    // [persistRuns] only so the lint check is happy, the
    // [cleanupRef] guard short-circuits the body on every
    // subsequent call.
  }, [persistRuns])
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
  // Monotonic counter the parent bumps whenever a new run is
  // started or re-run. The per-endpoint timeline tab
  // ([EndpointTimelineTab]) keeps its own local copy of the
  // run list that is fetched once on mount and again whenever
  // this counter changes, so a freshly started run shows up
  // in the Gantt and the list below the chart without waiting
  // for the user to navigate away from the tab and back. The
  // counter is a plain number (not a timestamp) because the
  // tab only needs to know "something changed, please
  // re-fetch" — equality on the number is sufficient.
  const [timelineRefreshTick, setTimelineRefreshTick] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [lastFetched, setLastFetched] = useState<FetchedSpecification | undefined>()
  // Local ticker for the runtime display. It only ticks while the
  // run is QUEUED or RUNNING; the hook forwards the current `now`
  // to <RunStatusView>.
  const runNow = useRunClock(run)
  // The badge grid needs its own ticker so the per-row stopwatch
  // keeps advancing even when the user is inspecting a *finished*
  // run's detail card. The flag flips to true whenever at least
  // one badge is in flight, and back to false when the last one
  // settles — so the grid re-renders at most once per tick
  // interval while there is something to count.
  const hasAnyInFlight = Object.values(runs).some(r => isInFlight(r.status))
  const gridNow = useLiveClock(hasAnyInFlight)
  // Right-click context menu on a run badge. `null` when no menu
  // is open. `position` keeps the menu at the cursor location;
  // `menuRef` lets us detect outside clicks.
  const [runMenu, setRunMenu] = useState<{ runId: string, x: number, y: number } | null>(null)
  const runMenuRef = useRef<HTMLDivElement | null>(null)
  // Surfaces API failures from the cancel / force-cancel / rerun
  // actions in the global error banner, since the menu itself has
  // no place to render a message.
  const [runActionError, setRunActionError] = useState('')
  // Tracks the previous `demoStatus.status.enabled` value so the
  // demo-off effect below can distinguish a real user-initiated
  // disable from the initial `false` mount. The ref is the
  // standard React pattern for "what was the value last time the
  // effect ran?": mutating it inside the effect (instead of
  // adding a state) avoids an extra re-render on every flip.
  const previousDemoEnabledRef = useRef<boolean | undefined>(undefined)
  // Refs that mirror the latest `runs` map. The demo-disable
  // effect below reads the cancellable-run ids and issues
  // cancels — the effect must not re-run every time a run is
  // added or removed, so the effect's dependency array
  // intentionally only watches the demo status. The ref is
  // the standard "read latest value without subscribing"
  // pattern (same idea as the `runIdRef` in
  // `DemoTrafficPage`).
  const runsRef = useRef<Record<string, TestRun>>(runs)
  runsRef.current = runs

  // The demo toggle is the single source of truth for "is the
  // demo spec supposed to be loaded?". When the user flips the
  // switch on in Settings, we (re)load the bundled demo spec so
  // they can hit Start without any extra click. When the user
  // flips the switch off, we drop whatever the textarea holds
  // back to the embedded sample — the spec the user typed or
  // pasted in is preserved in the sense that the Settings
  // switch is the only path that resets it, but the textarea
  // itself no longer claims to point at the demo.
  //
  // Both branches are intentionally unconditional: the user's
  // mental model of "demo is on" includes "the demo spec is in
  // the textarea" and vice versa, so the two stay locked.
  // The effect also handles the initial mount: when
  // `loaded` flips to `true` and `enabled` is `false`, the
  // textarea stays on the embedded sample (the initial state).
  // When `enabled` is `true`, the demo spec is fetched —
  // either from a localStorage-driven start or a fresh user
  // click. The previous "load on every mount" effect was
  // removed because it bypassed the toggle entirely and
  // fetched the demo spec even when the user had the demo
  // turned off.
  useEffect(() => {
    if (!demoStatus.status.loaded) return
    const wasEnabled = previousDemoEnabledRef.current
    previousDemoEnabledRef.current = demoStatus.status.enabled
    // True when the user just toggled the switch (in either
    // direction). The initial mount leaves `wasEnabled`
    // undefined, and a same-value flip (`false → false` after
    // the backend re-syncs the stored choice, for example)
    // must NOT trigger a reset — only an explicit user
    // gesture is allowed to wipe the dashboard. Both
    // directions share the same reset path: enabling the
    // demo loads a fresh spec, but any imported spec, edited
    // payload or running test the user already had on screen
    // belongs to the previous demo-off (or non-demo)
    // session, so we tear it down symmetrically.
    const isUserToggle = wasEnabled !== undefined && wasEnabled !== demoStatus.status.enabled
    if (demoStatus.status.enabled) {
      let cancelled = false
      async function loadDemoOnEnable(): Promise<void> {
        try {
          const response = await fetch('/api/demo-specification')
          if (!response.ok) return
          const content = await response.text()
          if (!cancelled && content.trim() !== '') setSpecification(content)
        } catch {
          // Network failure: leave the textarea as-is. The user
          // can retry by toggling the switch off and on again.
        }
      }
      loadDemoOnEnable()
    } else {
      // Demo is off — clear the spec so the textarea shows the
      // empty sample and a subsequent import is not overridden
      // by a stale demo document.
      setSpecification(sample)
    }
    if (isUserToggle) {
      // Full reset on user-initiated toggle (both directions).
      // The initial mount (wasEnabled === undefined) and the
      // `false → false` no-op path are filtered out by
      // `isUserToggle` above, so the first paint and the
      // backend-re-sync path keep their state intact. Only an
      // explicit user gesture is allowed to wipe the dashboard.
      //
      // Stop every in-flight load test first so the k6
      // processes go away while the rest of the state is
      // wiped. The cancel request is fired through a silent
      // helper that does NOT touch the in-memory `runs` map —
      // the synchronous `setRuns({})` below would otherwise
      // race with the response handler in `cancelRun` and let
      // the cancelled run re-appear on the dashboard a few
      // hundred milliseconds later. The pure helper
      // [cancellableRunIds] is unit-tested so the membership
      // rule is observable in isolation.
      for (const runId of cancellableRunIds(runsRef.current)) {
        void cancelRunSilent(runId)
      }
      setRuns({})
      setActiveRunId(undefined)
      setImported(undefined)
      setSelected(new Set())
      setCollapsed(new Set())
      setOperationSettings({})
      setBaseUrl('')
      setLoadProfile(defaultLoadProfile())
      setSpecificationUrl('')
      setLastFetched(undefined)
      setError('')
      setRunActionError('')
      setRunMenu(null)
    }
  }, [demoStatus.status.enabled, demoStatus.status.loaded])

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
        pendingIds.forEach((id, index) => {
          const run = updated[index]
          if (run !== null) {
            next[run.id] = run
            return
          }
          // The backend no longer knows about this run id
          // (404 from GET /api/test-runs/{id}). Without this
          // branch the run would stay in the dashboard map
          // forever, because the !isTerminalRun() filter on
          // the next tick would still classify it as
          // non-terminal and re-issue the same 404-bound
          // request. The user then sees a permanent
          // "XHR 404" for /rerun and /time-series on the
          // stale badge. The fix mirrors the contract of
          // [handleClearAll]: a row the backend does not
          // know about is no longer part of the user's
          // timeline and must drop out of the map.
          delete next[id]
        })
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
          // The Settings-drawer toggle. When the user has
          // disabled "Ausgeführte Lasttestkonfigurationen
          // speichern", the backend skips the timeline
          // write and the 40-row retention cap, so this
          // run is dropped on the next container restart.
          // The live view (polling, single-run endpoints)
          // keeps working for the duration of the session.
          persist: persistRuns,
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
      // Signal the per-endpoint timeline tab to re-fetch so
      // the new run is visible in the Gantt and the list below
      // the chart without the user having to leave the tab
      // and come back. The tab's own `runs` state is fetched
      // once on mount and only refreshed when this counter
      // changes (or the endpoint changes), so without the
      // bump a freshly started run would stay invisible
      // until the next manual navigation.
      setTimelineRefreshTick(tick => tick + 1)
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
    field: 'parameterValues' | 'requestBodyJson' | 'bearerToken' | 'basicAuthUsername' | 'basicAuthPassword' | 'apiKey' | 'oauth2Token' | 'oidcIdToken',
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
        if (field === 'oidcIdToken' && typeof patch === 'string') {
          return { ...payload, oidcIdToken: patch }
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
        oidcIdToken: primary.oidcIdToken,
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
        oidcIdToken: seed.oidcIdToken,
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
        oidcIdToken: primary.oidcIdToken,
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

  const safeClipboard = useCallback(async (text: string) => {
    try {
      await copyTextToClipboard(text)
    } catch (cause) {
      setRunActionError(cause instanceof Error ? cause.message : translate(language, 'error.copyFailed'))
    }
  }, [language])

  /**
   * Downloads the k6 summary JSON for a finished/aborted run via
   * the existing /api/test-runs/{id}/script endpoint is not a
   * summary — we re-use the run list since the controller does
   * not yet expose a dedicated summary endpoint. The download
   // is offered only when a summary is actually present so the
   // server is not pinged for nothing.
   */
  const downloadSummary = useCallback(async (run: TestRun) => {
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
  }, [])

  /**
   * Variant of [downloadSummary] that takes a run id. Looks the
   * run up in the cached [runsRef] so callers that only have
   * the id (right-click menus, per-run handlers) do not have
   * to thread the full `TestRun` through their props.
   */
  const downloadSummaryById = useCallback(async (runId: string) => {
    const run = runsRef.current[runId]
    if (!run) return
    await downloadSummary(run)
  }, [downloadSummary])

  /**
   * Downloads the generated k6 script for a finished run by
   * delegating to the browser's native download behaviour: a
   * transient anchor with the `download` attribute and the
   * server-side content-disposition filename. The same URL
   * powers the in-report download link, so the two affordances
   * stay in sync and pick up any future server-side filename
   * change automatically.
   */
  const downloadScript = useCallback((run: TestRun) => {
    const anchor = document.createElement('a')
    anchor.href = k6ScriptUrl(run.id)
    anchor.download = k6ScriptDownloadName(run.id)
    anchor.rel = 'noopener'
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
  }, [])

  /**
   * Variant of [downloadScript] that takes a run id. The
   * original only needs `run.id` to build the URL, so this is
   * a one-liner — kept as a separate function so the handler
   * bundle has a uniform `(runId) => void` signature.
   */
  const downloadScriptById = useCallback((runId: string) => {
    downloadScript({ id: runId } as TestRun)
  }, [downloadScript])

  const cancelRun = useCallback(async (runId: string, force: boolean) => {
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
        // Bump the per-endpoint timeline tab's refresh tick so
        // the tab's locally-fetched snapshot also picks up the
        // cancel. Without this bump the tab would still show
        // the pre-cancel status until the user navigates away
        // and back — the user reported this as "after I cancel
        // a run in the timeline, it still shows as running".
        // The tab's own sync effect (see
        // [EndpointTimelineTab]) keeps the displayed status in
        // lockstep with the parent's `runs` map on every render,
        // so the bump is the belt-and-braces fallback for the
        // case where the user re-mounted the tab after a page
        // reload and the parent's `runs` map is still empty.
        setTimelineRefreshTick(tick => tick + 1)
      }
    } catch (cause) {
      setRunActionError(cause instanceof Error ? cause.message : translate(language, 'error.cancelFailedNoStatus'))
    }
  }, [language])

  /**
   * Sends a graceful cancel to the backend for the given run
   * without touching the in-memory `runs` map. Used by the
   * "demo off" reset path: the caller is about to wipe the
   * map with a synchronous `setRuns({})`, and any
   * `setRuns(current => ({ ...current, ... }))` issued by the
   * cancel response would re-add the cancelled run on the
   * next render and undo the reset. The error path is
   * intentionally silent: the dashboard is being torn down
   * anyway, so a "cancel failed" banner would be noise.
   */
  async function cancelRunSilent(runId: string): Promise<void> {
    try {
      await fetch(`/api/test-runs/${encodeURIComponent(runId)}/cancel?force=false`, { method: 'POST' })
    } catch {
      // Best-effort: the k6 process might already be gone, the
      // network might be flaky, or the backend might have
      // already settled the run. None of these block the reset
      // — the in-memory state is wiped synchronously below.
    }
  }

  const rerunRun = useCallback(async (runId: string) => {
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
      // Same rationale as in `startTest` above: the per-endpoint
      // timeline tab keeps its own copy of the run list and
      // needs a nudge to pick up the freshly created rerun.
      setTimelineRefreshTick(tick => tick + 1)
    } catch (cause) {
      setRunActionError(cause instanceof Error ? cause.message : translate(language, 'error.rerunFailedNoStatus'))
    }
  }, [language, activeRunId])

  // Drops a single run from the in-memory dashboard map and
  // re-evaluates which run should keep the focus. Shared by
  // the right-click "Aus Ansicht entfernen" entry and the
  // inline X button on the badge so the two affordances stay
  // in lock-step. Pure: a missing id is a no-op (the runs map
  // comes back referentially equal and React skips the
  // re-render). The backend still holds the run; a page
  // refresh would re-hydrate it from /api/test-runs.
  const handleRemoveRun = useCallback((runId: string) => {
    setRuns(current => {
      if (current[runId] === undefined) return current
      const next = removeRun(current, runId)
      setActiveRunId(pickActiveRunId(next, activeRunId))
      return next
    })
  }, [activeRunId])

  /**
   * Single source of truth for run-targeted actions. Every
   * handler takes the run id explicitly so the same bundle
   * drives the Aktionen tab in [RunDetail] (operates on the
   * focused run) and the per-run right-click menus in the
   * run grid / endpoint timeline (operate on whichever past
   * run was clicked). Memoisd so child components that depend
   * on handler identity (e.g. inside `useEffect`) do not
   * re-fire on every parent render.
   *
   * Lives after every underlying callback because `const`
   * declarations have a temporal-dead-zone; referencing
   * `cancelRun` / `rerunRun` etc. before they are
   * initialised would throw at first render.
   */
  const runHandlers = useMemo<RunActionHandlers>(() => ({
    onFocusRun: (runId) => setActiveRunId(runId),
    onStop: (runId, force) => cancelRun(runId, force),
    onRerun: (runId) => rerunRun(runId),
    onCopyRunId: (runId) => safeClipboard(runId),
    onCopyReportLink: (runId) => safeClipboard(`${window.location.origin}/?report=${encodeURIComponent(runId)}`),
    onOpenReport: (runId) => { window.open(`/?report=${encodeURIComponent(runId)}`, '_blank', 'noopener,noreferrer') },
    onDownloadScript: (runId) => downloadScriptById(runId),
    onExportMetrics: (runId) => downloadSummaryById(runId),
    onRemove: (runId) => handleRemoveRun(runId),
    // Mirror the early-return guard from [handleRemoveRun]: when
    // the clicked run is NOT in the dashboard map (typical for the
    // per-endpoint timeline tab, which renders historical runs that
    // were persisted to H2 by previous sessions), there is nothing
    // the parent should drop from its in-memory map. The timeline
    // tab already hides the other FAILED runs from its own view via
    // [setHiddenRunIds]; removing dashboard runs we should not touch
    // would silently wipe the user's current session — see the
    // regression test in `e2e/context-menu.spec.ts` ("right-click on
    // a failed run in the timeline list offers …").
    onRemoveAllOtherFailed: (runId) => setRuns(current => {
      if (current[runId] === undefined) return current
      const next = removeAllOtherFailed(current, runId)
      setActiveRunId(pickActiveRunId(next, activeRunId))
      return next
    }),
    // Wipe the timeline. The backend handles the
    // in-flight cancellation + bulk delete via
    // `DELETE /api/test-runs` (see
    // [LocalK6TestRunService.deleteAll]); the client just
    // empties its in-memory map and clears the active run
    // selection. We swallow fetch errors and return null
    // so the caller can surface a toast without the
    // promise itself rejecting.
    onClearAll: async () => {
      try {
        const response = await fetch('/api/test-runs', { method: 'DELETE' })
        if (!response.ok) {
          return null
        }
        const body = (await response.json()) as { cancelled: number, deleted: number }
        setRuns(() => clearAllRuns())
        setActiveRunId(undefined)
        return body
      } catch {
        return null
      }
    },
  }), [cancelRun, rerunRun, safeClipboard, downloadScriptById, downloadSummaryById, handleRemoveRun, activeRunId])

  /**
   * Closes the overview-badge menu and dispatches the picked
   * item to the matching handler in [runHandlers]. The actual
   * action routing lives in [dispatchRunMenuAction] so the
   * overview badge menu and the per-endpoint timeline menu
   * share one implementation. We close the menu synchronously
   * here (a UI concern) and let the handler complete async.
   */
  async function runMenuAction(run: TestRun, item: MenuItem) {
    setRunMenu(null)
    await dispatchRunMenuAction(item, runHandlers, run.id)
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
                      options.push(<option key="__custom__" value={baseUrl}>{baseUrl} — {translate(language, 'ops.serverSelector.customUrl')}</option>)
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
            <button className="start" data-testid="start-test-button" onClick={startTest} disabled={busy || selected.size === 0 || hasValidationErrors}>{translate(language, 'run.startButton')}</button>
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
      <div className="run-grid" role="tablist" aria-label={translate(language, 'run.grid.aria')}>
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
            // Stricter than `isInFlight` (used for the grid
            // ticker): a QUEUED run is still on the dashboard
            // (so the live ticker keeps running) but it has
            // no spawned k6 process to cancel, so the inline
            // stop button is hidden until the run transitions
            // to RUNNING.
            const candidateCancellable = isCancellable(candidate.status)
            const candidateTerminal = isTerminalRun(candidate.status)
            return (
              <button
                key={candidate.id}
                type="button"
                role="tab"
                aria-selected={candidate.id === activeRunId}
                className={`run-badge ${candidate.id === activeRunId ? 'active' : ''} run-badge-${candidate.status.toLowerCase()}`}
                onClick={() => setActiveRunId(candidate.id)}
                onContextMenu={event => openRunMenu(event, candidate.id)}
                title={translate(language, 'run.badge.title', { id: candidate.id, method, path })}
              >
                <span className={`run-badge-method method-${method.toLowerCase()}`}>{method}</span>
                <div className="run-badge-info">
                  <span className="run-badge-status">
                    {candidate.status}
                    {/* The spinner + live stopwatch only show on
                        RUNNING. QUEUED keeps the layout minimal
                        (the run has not started yet, so there is
                        nothing to count) and STOPPING uses the
                        spinner in the cancel button instead so the
                        user sees the action is in progress without
                        doubling up. The status text is `aria-hidden`
                        redundant: screen readers announce "running"
                        and the stopwatch's content — the spinner
                        itself is `aria-hidden` for the same reason. */}
                    {candidate.status === 'RUNNING' && (
                      <>
                        <span className="status-spinner" aria-hidden="true" />
                        <span className="status-time" data-testid={`run-badge-time-${candidate.id}`}>
                          {formatMmSs(runElapsedSeconds(candidate, gridNow))}
                        </span>
                      </>
                    )}
                  </span>
                  <span className="run-badge-path">{path}</span>
                  {/* Third line on the badge: the load profile the
                      run was started with (and the values it ran
                      with). The user can now tell at a glance which
                      endpoint was hit and which profile was used
                      without opening the run detail. The line uses
                      a dedicated element so it can be styled
                      independently — smaller font, muted colour —
                      and clipped with an ellipsis when the badge
                      column is narrower than the profile name (a
                      load/stress profile summary easily fits; a
                      long path does not). The full string is
                      available as a `title` tooltip so the truncated
                      tail is still reachable without leaving the
                      dashboard. */}
                  <span
                    className="run-badge-profile"
                    title={loadProfileSummaryFor(candidate.configuration?.loadProfile, language)}
                    data-testid={`run-badge-profile-${candidate.id}`}
                  >
                    {loadProfileSummaryFor(candidate.configuration?.loadProfile, language)}
                  </span>
                </div>
                {/* Inline action buttons on the right edge of the
                    badge — appear on hover/focus so the default
                    grid stays visually quiet. Two affordances
                    share the same anchor: in-flight runs get a
                    stop button (graceful cancel via the existing
                    `cancelRun`), terminal runs get an X to drop
                    the badge from the dashboard. `stopPropagation`
                    keeps the badge-click from firing alongside
                    the action. The Stopping state shows a spinner
                    and ignores clicks — the backend is already
                    tearing the run down. */}
                {candidateCancellable && (
                  <span
                    className="icon-action icon-action--cancel"
                    role="button"
                    tabIndex={0}
                    aria-label={candidate.status === 'STOPPING'
                      ? translate(language, 'runBadge.stopping')
                      : translate(language, 'runBadge.cancel')}
                    title={candidate.status === 'STOPPING'
                      ? translate(language, 'runBadge.stopping')
                      : translate(language, 'runBadge.cancel')}
                    data-testid={`run-badge-cancel-${candidate.id}`}
                    onClick={event => {
                      event.stopPropagation()
                      void cancelRun(candidate.id, false)
                    }}
                    onKeyDown={event => {
                      if (event.key !== 'Enter' && event.key !== ' ') return
                      event.preventDefault()
                      event.stopPropagation()
                      void cancelRun(candidate.id, false)
                    }}
                  >
                    {candidate.status === 'STOPPING'
                      ? <span className="icon-action-spinner" aria-hidden="true" />
                      : <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                          <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
                        </svg>}
                    <span className="sr-only">
                      {candidate.status === 'STOPPING'
                        ? translate(language, 'runBadge.stopping')
                        : translate(language, 'runBadge.cancel')}
                    </span>
                  </span>
                )}
                {candidateTerminal && (
                  <span
                    className="icon-action icon-action--remove"
                    role="button"
                    tabIndex={0}
                    aria-label={translate(language, 'runBadge.remove')}
                    title={translate(language, 'runBadge.remove')}
                    data-testid={`run-badge-remove-${candidate.id}`}
                    onClick={event => {
                      event.stopPropagation()
                      handleRemoveRun(candidate.id)
                    }}
                    onKeyDown={event => {
                      if (event.key !== 'Enter' && event.key !== ' ') return
                      event.preventDefault()
                      event.stopPropagation()
                      handleRemoveRun(candidate.id)
                    }}
                  >
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                      <path d="M4 4l8 8M12 4l-8 8" />
                    </svg>
                    <span className="sr-only">{translate(language, 'runBadge.remove')}</span>
                  </span>
                )}
              </button>
            )
          })}
      </div>

      {run && <RunDetail
        run={run}
        runNow={runNow}
        handlers={runHandlers}
        // Forward the full dashboard runs map so the per-endpoint
        // timeline tab can render the right-click menu and disable
        // the "remove all other failed" entry when no other
        // FAILED badge is in the dashboard.
        runs={runs}
        // Forward the parent-owned refresh counter so the
        // per-endpoint timeline tab inside <RunDetail> can
        // re-fetch its run list whenever a new run is started
        // or re-run. See the declaration of
        // [timelineRefreshTick] in [LoadTestApp] for the
        // full rationale.
        timelineRefreshTick={timelineRefreshTick}
      />}
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
 *
 * Since the "Tab-Navigation + Aktionen-Tab" release, the detail
 * view is split into a horizontal tab strip (Übersicht · Timeline ·
 * Aktionen · k6-Konsole · Schwellen · Konfiguration · Fehler-Diagnose)
 * plus a tab body. The previous "stack everything" layout is
 * preserved in the Übersicht tab so the user still sees the live
 * banner, the RunProgress grid, the metric cards and the
 * console/summary extras in one place when they need them all.
 */
type DetailTabId = 'overview' | 'script' | 'timeline' | 'actions' | 'console' | 'thresholds' | 'config' | 'failure'

function RunDetail({ run, runNow, handlers, timelineRefreshTick, runs }: { run: TestRun, runNow: number, handlers: RunActionHandlers, timelineRefreshTick: number, runs: Record<string, TestRun> }) {
  const { language } = useLanguage()
  const [activeTab, setActiveTab] = useState<DetailTabId>('overview')
  // Wall-clock scroll position the user is reading at, captured
  // right before the tab change. The browser tries to scroll the
  // activated tab button into view as part of its click-event
  // default behaviour — this happens AFTER React's onClick
  // handler returns, AFTER the layout effect runs, and even
  // AFTER the next animation frame. None of the standard
  // React-side recovery hooks catch it. The robust solution is
  // a one-shot scroll listener: as soon as the user agent
  // scrolls away from the snapshotted position, we scroll back.
  // A ref is used (not state) because the value is only read
  // by the listener below and must NOT trigger a re-render on
  // its own.
  const anchorScrollY = useRef<number | null>(null)
  const inFlight = isInFlight(run.status)
  const failed = run.status === 'FAILED' || run.status === 'ABORTED'
  const selectTab = (tab: DetailTabId) => {
    setActiveTab(tab)
  }
  // Snapshot the user's reading position in `mousedown` so it
  // is captured BEFORE the browser's click-event default can
  // scroll the page (e.g. scroll-into-view on the activated
  // tab button). `onMouseDown` is also the right hook to
  // call `preventDefault()` to stop the focus from jumping to
  // the tab button, which would also trigger a focus-driven
  // scroll. The `onPointerEnter` handler is a defensive
  // secondary capture: if a regression ever reintroduces a
  // scroll BEFORE `mousedown` fires (e.g. the browser starts
  // scrolling on hover), we still have a recent anchor.
  const onTabMouseDown = (event: React.MouseEvent) => {
    if (event.button !== 0) return
    event.preventDefault()
    anchorScrollY.current = window.scrollY
  }
  const onPointerEnter = () => {
    if (anchorScrollY.current === null) {
      anchorScrollY.current = window.scrollY
    }
  }
  // Capture the user's reading position before a tab change
  // and restore it immediately after the new tab body commits.
  // Two scroll-affecting events conspire here:
  //   1. The user agent may scroll the activated tab button
  //      into view (a click-event default that fires after
  //      React's onClick). Catching the position in
  //      `mousedown` and re-applying it synchronously in
  //      `useLayoutEffect` is the only way to fight it.
  //   2. The new tab body is a different height than the old
  //      one, so `document.scrollHeight` changes. The browser
  //      clamps `window.scrollY` to the new maximum — if the
  //      user was at the very bottom of the long Timeline tab,
  //      they land at the bottom of the short Schwellen tab.
  //      We can't preserve the exact pixel (the document is
  //      genuinely shorter) but we can pin the position to
  //      the new maximum instead of letting the browser
  //      animate a jump. Without the layout effect the
  //      browser keeps the stale `scrollY` until the next
  //      `scroll` event, which is what produces the visible
  //      "page jumps up" artefact.
  useLayoutEffect(() => {
    if (anchorScrollY.current === null) return
    const target = anchorScrollY.current
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
    window.scrollTo({ top: Math.min(target, maxScroll), left: 0, behavior: 'instant' as ScrollBehavior })
    anchorScrollY.current = null
  }, [activeTab])
  // Re-render the tab strip whenever the selected run changes —
  // when the user clicks a different run the new run's natural
  // landing tab is "overview", not whatever the previous run was
  // showing (e.g. "Aktionen" makes no sense if the user then
  // selected a different run).
  //
  // The Timeline tab is the one exception: when the user is
  // browsing the endpoint timeline and picks a different run
  // from the [LastRunsPanel] list, the chart must stay open and
  // re-centre on the new run's [createdAt]. Forcing the user
  // back to "Übersicht" would throw away the very context
  // (the bar in the Gantt, the heatmap, the focus label) that
  // makes the timeline useful as a navigation surface.
  useEffect(() => {
    setActiveTab(prev => (prev === 'timeline' ? prev : 'overview'))
  }, [run.id])
  return <>
    {inFlight && <LiveBanner run={run} onStop={handlers.onStop} />}
    <div className="run-detail-tabs" role="tablist" aria-label={translate(language, 'detail.tab.aria')}>
      {/* The `onMouseDown` handler on every tab button calls
          `preventDefault()` to suppress the browser's default
          focus-on-mouse-click behaviour. Without it, clicking
          a tab moves keyboard focus to the button, which in
          turn triggers the user agent's "scroll the focused
          element into view" pass — and the page jumps back to
          the tab strip even when the user is reading content
          further down. The click handler still fires (so
          `selectTab` runs), and the button remains focusable
          via the Tab key, so keyboard users and screen readers
          keep full access. The same hook is applied uniformly
          to every tab rather than only to some of them,
          because the user expects the same "stay where I am"
          behaviour from every entry.

          `preventDefault()` on `mousedown` is necessary but
          not sufficient: the user agent ALSO scrolls the
          activated element into view as a click-event
          consequence (not focus-driven), so we additionally
          capture `window.scrollY` in [selectTab] and restore
          it in the `useLayoutEffect` above. Keyboard
          activation (Tab + Enter) is unaffected because the
          user is in fact expected to see the focused tab in
          that case. */}
      <button type="button" role="tab" aria-selected={activeTab === 'overview'}
        className={`run-detail-tab ${activeTab === 'overview' ? 'active' : ''}`}
        onMouseEnter={onPointerEnter}
        onFocus={onPointerEnter}
        onMouseDown={onTabMouseDown}
        onClick={() => selectTab('overview')}>
        {translate(language, 'detail.tab.overview')}
      </button>
      <button type="button" role="tab" aria-selected={activeTab === 'timeline'}
        className={`run-detail-tab ${activeTab === 'timeline' ? 'active' : ''}`}
        onMouseEnter={onPointerEnter}
        onFocus={onPointerEnter}
        onMouseDown={onTabMouseDown}
        onClick={() => selectTab('timeline')}>
        {translate(language, 'detail.tab.timeline')}
      </button>
      <button type="button" role="tab" aria-selected={activeTab === 'actions'}
        className={`run-detail-tab ${activeTab === 'actions' ? 'active' : ''}`}
        onMouseEnter={onPointerEnter}
        onFocus={onPointerEnter}
        onMouseDown={onTabMouseDown}
        onClick={() => selectTab('actions')}>
        {translate(language, 'detail.tab.actions')}
      </button>
      <button type="button" role="tab" aria-selected={activeTab === 'console'}
        className={`run-detail-tab ${activeTab === 'console' ? 'active' : ''}`}
        onMouseEnter={onPointerEnter}
        onFocus={onPointerEnter}
        onMouseDown={onTabMouseDown}
        onClick={() => selectTab('console')}>
        {translate(language, 'detail.tab.console')}
      </button>
      <button type="button" role="tab" aria-selected={activeTab === 'thresholds'}
        className={`run-detail-tab ${activeTab === 'thresholds' ? 'active' : ''}`}
        onMouseEnter={onPointerEnter}
        onFocus={onPointerEnter}
        onMouseDown={onTabMouseDown}
        onClick={() => selectTab('thresholds')}>
        {translate(language, 'detail.tab.thresholds')}
      </button>
      <button type="button" role="tab" aria-selected={activeTab === 'config'}
        className={`run-detail-tab ${activeTab === 'config' ? 'active' : ''}`}
        onMouseEnter={onPointerEnter}
        onFocus={onPointerEnter}
        onMouseDown={onTabMouseDown}
        onClick={() => selectTab('config')}>
        {translate(language, 'detail.tab.config')}
      </button>
      <button type="button" role="tab" aria-selected={activeTab === 'failure'}
        className={`run-detail-tab ${activeTab === 'failure' ? 'active' : ''}`}
        onMouseEnter={onPointerEnter}
        onFocus={onPointerEnter}
        onMouseDown={onTabMouseDown}
        onClick={() => selectTab('failure')}>
        {translate(language, 'detail.tab.failure')} {failed && <span className="badge alert">!</span>}
      </button>
      {/* The k6 Script tab is intentionally placed *directly*
          to the left of the external "K6 Bericht öffnen" link
          (the open-in-new-tab affordance). The two are
          conceptually paired — the script tab is for users
          who want to run the test outside lasttest, the
          external link is for users who want the printable
          web report — so they sit next to each other at the
          end of the tab strip. */}
      <button type="button" role="tab" aria-selected={activeTab === 'script'}
        className={`run-detail-tab ${activeTab === 'script' ? 'active' : ''}`}
        onMouseEnter={onPointerEnter}
        onFocus={onPointerEnter}
        onMouseDown={onTabMouseDown}
        title={translate(language, 'detail.tab.script.title')}
        onClick={() => selectTab('script')}>
        {translate(language, 'detail.tab.script')}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={false}
        className="run-detail-tab run-detail-tab-external"
        title={translate(language, 'detail.tab.external.title')}
        onClick={() => window.open(`/?report=${encodeURIComponent(run.id)}`, '_blank', 'noopener,noreferrer')}
      >
        <span className="external-icon" aria-hidden="true">↗</span>
        {translate(language, 'detail.tab.external')}
      </button>
    </div>
    <div className="run-detail-tab-body">
      {activeTab === 'overview' && <>
        <TestRunSummary run={run} />
        <RunStatusView run={run} now={runNow} />
        {/* Always surface the ramp chart here on the Übersicht
            tab. The chart shows both the planned and the
            measured curve over the whole run lifetime, so it is
            useful before the run starts (planned only), while
            it is running (planned + live measured), and after
            it has finished (planned + frozen measured). The
            dedicated Auslastung tab was removed; this is now
            the only place the live chart renders.
            [OverviewLiveRamp] itself only polls /time-series
            while the run is in flight, so a finished run does
            not keep firing requests in the background. */}
        <OverviewLiveRamp run={run} now={runNow} />
        {/* HTTP-Status-Code-Verteilung (Mini-Balken-Grid) für
            den gesamten Lauf. Die Karte rendert nichts, solange
            kein k6-Summary vorliegt — ein leeres Grid mit
            "Gesamt: 0 Requests" wäre verwirrender als die
            komplette Auslassung. Liegt ein Summary vor, summiert
            die Karte die Counts über alle Endpunkte und
            präsentiert sie nach Status-Code-Familie eingefärbt
            (2xx grün, 4xx gelb, 5xx rot, err braun). Der
            detaillierte Bericht (Aktionen → "K6 Bericht öffnen")
            bleibt die Quelle für die Per-Endpunkt-Aufschlüsselung. */}
        <StatusCodeDistributionCard run={run} />
        {/* The k6 console output and the JSON summary live in
            their own tabs (and in the Aktionen → Roh-Zusammenfassung
            exportieren action). Keeping them out of the Übersicht
            tab keeps the high-level view compact — the user
            explicitly asked to drop the long blocks from here. */}
      </>}
      {activeTab === 'script' && <K6ScriptTab run={run} />}
      {activeTab === 'timeline' && (() => {
        const endpoint = run.configuration?.operations?.[0]
        if (!endpoint) return <EmptyStateTimeline run={run} />
        return <EndpointTimelineTab
          method={endpoint.method}
          path={endpoint.path}
          apiTitle={run.configuration?.apiTitle}
          selectedRunId={run.id}
          // Forward the right-click menu wiring so list items
          // and Gantt bars open the same context menu as the
          // overview badges. [handlers] is memoisd in
          // [LoadTestApp] so a new bundle is only produced when
          // an underlying callback (e.g. `cancelRun`) changes.
          // [runs] is the full dashboard map — needed so the
          // menu can disable "remove all other failed" when
          // there is nothing else to remove.
          handlers={handlers}
          runs={runs}
          // Parent-owned refresh signal: the tab re-fetches its
          // run list whenever the counter changes so a new
          // (or re-run) test shows up immediately in the Gantt
          // and the list below, even while the user is staying
          // on the Timeline tab. Without this, the tab's
          // locally fetched snapshot would stay frozen on the
          // data that was current when the tab was first
          // opened.
          refreshTick={timelineRefreshTick}
          // When the parent swaps in a different run, the
          // timeline re-centres on the new run's `createdAt`
          // (via [EndpointTimelineTab]'s internal effect) so
          // the user lands in the middle of the chart and sees
          // the new bar highlighted immediately. Klicks INNERHALB
          // des Timeline-Tabs (Listeneintrag oder Gantt-Balken)
          // ändern den aktiven Run NICHT — der Nutzer bleibt im
          // Timeline-Tab, die Tab-Leiste verschwindet nicht.
          // Ein Run-Wechsel passiert weiterhin ausschließlich
          // über die [LastRunsPanel] oben.
          focusRunCreatedAt={run.createdAt}
        />
      })()}
      {activeTab === 'actions' && <AktionenTab
        run={run}
        onStop={handlers.onStop}
        onRerun={handlers.onRerun}
        onCopyRunId={handlers.onCopyRunId}
        onCopyReportLink={handlers.onCopyReportLink}
        onOpenReport={handlers.onOpenReport}
        onDownloadScript={handlers.onDownloadScript}
        onExportMetrics={handlers.onExportMetrics}
        onRemove={handlers.onRemove}
        onRemoveAllOtherFailed={handlers.onRemoveAllOtherFailed}
      />}
      {activeTab === 'console' && <ConsoleTab run={run} />}
      {activeTab === 'thresholds' && <ThresholdsTab run={run} />}
      {activeTab === 'config' && <ConfigTab run={run} />}
      {activeTab === 'failure' && <FailureTab run={run} />}
    </div>
  </>
}

/**
 * Bundle of callbacks for actions that target a specific run.
 * Re-exported here so existing imports keep working without
 * pulling a new module into the public surface. The canonical
 * type lives in [runActionHandlers.ts] so child components can
 * import it without a circular dependency on `App.tsx`.
 */
export type { RunActionHandlers } from './runActionHandlers.ts'

// The tabs that do not yet have a dedicated body fall back to a
// small placeholder card explaining where the data lives. The
// placeholder keeps the layout stable while the dedicated tab
// bodies (config, thresholds, failure) are being migrated.
function EmptyStateTimeline({ run }: { run: TestRun }) {
  const { language } = useLanguage()
  return <div className="run-tab-empty">
    <div className="run-tab-empty-title">{translate(language, 'detail.empty.noOperation.title')}</div>
    <div className="run-tab-empty-hint">
      {translate(language, 'detail.empty.noOperation.hint', { id: run.id.slice(0, 8) })}
    </div>
  </div>
}

/**
 * Renders the Soll-vs-Ist live chart inside the Übersicht tab
 * for in-flight runs. Pulls the planned line from the load
 * profile and the actual line from
 * `/api/test-runs/{id}/time-series` (sourced from H2, so the
 * data is stable across container restarts); the polyline
 * auto-updates as the polling loop pulls new samples.
 */
function OverviewLiveRamp({ run, now }: { run: TestRun, now: number }) {
  const [vus, setVus] = useState<{ t: number, value: number }[]>([])
  const profile = run.configuration?.loadProfile ?? null
  // The ramp chart's planned line, y-axis scale and run length
  // all come from a single helper. Before this lived in
  // `runStatusView.tsx` as `plannedRampPoints`, the helper only
  // handled VU-based executors and dropped the planned line
  // entirely for any arrival-rate profile — so the spike,
  // stress, soak and lead-stress presets rendered an empty
  // green line while the report (a different code path) showed
  // the same chart correctly. [computeRampChartParams] is now
  // the single source of truth for both surfaces.
  const chartParams = computeRampChartParams(profile)
  // While the run is still QUEUED the backend has not written a
  // [startedAt] timestamp yet, so we cannot compute a real
  // elapsed duration. Falling back to [Date.now()] here would
  // make `now - startedAt` hover around 0 and [formatDurationSeconds]
  // render "00:00" — which flickers with every 500 ms tick because
  // each render captures a fresh [Date.now()]. Keep the value
  // `undefined` in that window so the chart shows the same "–"
  // dash as every other queued-only surface.
  const startedAtMs = run.startedAt ? Date.parse(run.startedAt) : null
  // Tracks whether the run is still in flight at the moment
  // the effect re-runs. Captured at effect time so the cleanup
  // function (which closes over the previous run's interval)
  // does not see a stale value.
  const inFlight = isInFlight(run.status)

  // Fetch the time-series immediately on mount, then keep
  // polling every [RAMP_POLL_INTERVAL_MS] while the run is
  // in flight. The data is already cached on the backend in
  // H2 (see [H2TimeSeriesReader] + the seedPlannedRampProfile
  // call in [LocalK6TestRunService]), so the dashboard never
  // has to wait for k6 to write a summary to see the planned
  // line.
  //
  // The effect deliberately depends on `run.id` + the in-flight
  // status only — NOT on `now` (which ticks every 500ms). Listing
  // `now` here would tear down the interval on every clock tick
  // and starve the polling loop; the rendered SVG already reads
  // `now` via its prop on each render so the elapsed-time label
  // stays current without the effect re-firing.
  useEffect(() => {
    let cancelled = false
    const tick = () => {
      if (cancelled) return
      fetch(`/api/test-runs/${encodeURIComponent(run.id)}/time-series`)
        .then(r => (r.ok ? r.json() : null))
        .then((data: { vus?: { time: string, value: number }[] } | null) => {
          if (cancelled || !data) return
          // Backend returns ISO-8601 timestamps; convert to
          // epoch seconds here so the ramp chart's x-axis
          // projection (which scales by `t * 1000`) does not
          // blow up on `NaN`. See [vuSamplesToEpochSeconds].
          setVus(vuSamplesToEpochSeconds(data.vus ?? []))
        })
        .catch(() => { /* ignore transient errors */ })
    }
    tick()
    if (!inFlight) return () => { cancelled = true }
    const timer = window.setInterval(tick, RAMP_POLL_INTERVAL_MS)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [run.id, inFlight])

  // The ramp chart needs both a target value (VUs or RPS, to
  // anchor the y-axis) and a planned duration (to anchor the
  // x-axis). A run without a load profile OR a profile whose
  // chart unit is `none` (e.g. shared-iterations) cannot
  // produce a meaningful planned line, so we render an
  // explicit empty state instead. The measured line still
  // shows up as soon as the polling loop delivers its first
  // sample — the empty state is only about the planned
  // reference.
  if (!profile || chartParams.unit === 'none' || chartParams.targetValue <= 0) {
    return <div className="run-tab-empty">
      <div className="run-tab-empty-title">Keine Auslastungs-Daten</div>
      <div className="run-tab-empty-hint">
        Für diesen Lauf ist kein Last-Profil mit Ziel-VUs oder Ziel-Rate konfiguriert. Sobald ein Profil mit einem vorhersagbaren Soll-Verlauf existiert, zeigt dieser Tab die geplante und gemessene Kurve.
      </div>
    </div>
  }
  // The H2 samples carry absolute epoch *seconds* (see
  // [H2TimeSeriesReader] + the seed step in [LocalK6TestRunService]).
  // [LiveRampChart] expects the polyline in [RampPoint] form
  // where `t` is "seconds since run start" — convert the epoch
  // timestamps back into the same offset space the planned line
  // uses, so the two polylines line up on the SVG.
  //
  // The QUEUED path is handled defensively: `startedAtMs` is
  // `null`, `vus` is empty, and the planned line is the only
  // thing on the canvas anyway. Anchoring the actual-line window
  // at the current tick would otherwise push any future sample
  // into negative `t` territory once the run starts.
  const startedAtSeconds = startedAtMs != null ? Math.floor(startedAtMs / 1000) : 0
  const actualInWindow = startedAtMs == null
    ? []
    : vus
      .map(p => ({ t: p.t - startedAtSeconds, planned: NaN, actual: p.value }))
      .filter(p => p.t >= -1 && p.t <= chartParams.totalDuration + 1)
  const windowStart = startedAtMs ?? now
  const windowEnd = windowStart + chartParams.totalDuration * 1000
  return <div style={{ marginTop: 14 }}>
    <LiveRampChart
      planned={chartParams.planned}
      actual={actualInWindow}
      totalDurationSeconds={chartParams.totalDuration}
      elapsedSeconds={startedAtMs == null ? undefined : (now - startedAtMs) / 1000}
      targetValue={chartParams.targetValue}
      unit={chartParams.unit}
      windowStartMs={windowStart}
      windowEndMs={windowEnd}
    />
  </div>
}

type TestRunSummaryProps = {
  run: TestRun
}

function TestRunSummary({ run }: TestRunSummaryProps) {
  const { language } = useLanguage()
  const summary = parseK6Summary(run)
  const failure = summarizeFailure(language, run)
  const metricItems = buildMetricRow(language, run, summary, failure)
  // As soon as k6 is done, <RunStatusView> takes over the full
  // result presentation (badge + threshold notice + cards + run
  // foot). We then hide the metric row and the failure causes here.
  // As soon as k6 is done, <RunStatusView> takes over the full
  // result presentation (PASSED/FAILED pill + exit code in the
  // `ResultHeader` row, threshold notice, cards, run foot). Here at
  // the top we hide both the status pill and the failure causes so
  // nothing appears twice. For RUNNING/QUEUED we suppress the
  // status pill entirely: it would otherwise render in the
  // default gray `.status` colour (no `.status.running` /
  // `.status.queued` modifier exists) and the cells below
  // (RUNNING SINCE / REMAINING / STARTED) already communicate the
  // in-flight state more clearly. STOPPING keeps the pill because
  // it doubles as a "k6 is winding down" hint that no cell carries
  // on its own. A terminal run is rendered by `RunStatusView`
  // below — which carries the colour-coded "STOPPED" / "ABORTED"
  // pills and the matching threshold notice. Showing the generic
  // gray ".status" pill on top would duplicate the status and
  // look colourless next to the dedicated terminal-state badges.
  // The pill-visibility predicate is centralised in
  // `showsStatusPill` so the same rule is exercised by the unit
  // tests in `runDashboard.test.ts` rather than living only as
  // inline JSX.
  const isFinished = isTerminalRun(run.status)
  const showStatusRow = showsStatusPill(run.status)

  return (
    <>
      {showStatusRow && <div className="status-row">
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

// Small wrapper around the JSON Request-Body `<textarea>`. The
// only thing it adds over a plain textarea is the `useAutoSize`
// hook, which resizes the field to fit its current content (see
// `useAutoSizeTextarea.ts` for the why). Kept as a separate
// component so the hook's `useLayoutEffect` is isolated from the
// outer `OperationEditor`'s render path — otherwise every payload
// cell re-renders whenever *any* payload in *any* operation
// changes, which would re-run the effect for all of them.
function RequestBodyTextarea({
  operationId,
  payloadIndex,
  value,
  invalid,
  onChange,
}: {
  operationId: string
  payloadIndex: number
  value: string
  invalid: boolean | undefined
  onChange: (value: string) => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useAutoSizeTextarea(ref, value)
  return <textarea
    ref={ref}
    className="request-body"
    aria-label={`${operationId} · Payload ${payloadIndex + 1}: JSON Request-Body`}
    aria-invalid={invalid}
    value={value}
    onChange={event => onChange(event.target.value)}
    spellCheck={false}
  />
}

type OperationEditorProps = {
  operation: Operation
  selected: boolean
  settings?: OperationSettings
  expanded: boolean
  language: SupportedLanguage
  onToggle: () => void
  onToggleExpand: () => void
  onPayloadField: (payloadIndex: number, field: 'parameterValues' | 'requestBodyJson' | 'bearerToken' | 'basicAuthUsername' | 'basicAuthPassword' | 'apiKey' | 'oauth2Token' | 'oidcIdToken', patch: Record<string, string> | string) => void
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
  const showOidc = hasOpenIdConnectAuth(operation)

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
        onApplyOidc={(idToken: string) => onPayloadField(0, 'oidcIdToken', idToken)}
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
              {showOidc && <th className="col-auth-oidc">{translate(language, 'ops.auth.oidc.header')}</th>}
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
                      <RequestBodyTextarea
                        operationId={operation.operationId}
                        payloadIndex={payloadIndex}
                        value={payload.requestBodyJson}
                        invalid={validation.bodyError ? true : undefined}
                        onChange={value => onPayloadField(payloadIndex, 'requestBodyJson', value)}
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
                  {showOidc && (
                    <td className="col-auth-oidc">
                      <input
                        type="password"
                        autoComplete="off"
                        aria-label={translate(language, 'ops.auth.oidc.cellAria', { operationId: operation.operationId, n: payloadIndex + 1 })}
                        placeholder={translate(language, 'ops.auth.oidc.placeholder')}
                        value={payload.oidcIdToken}
                        onChange={event => onPayloadField(payloadIndex, 'oidcIdToken', event.target.value)}
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

export default App

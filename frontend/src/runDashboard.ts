// Pure helpers for the multi-run dashboard. Extracted from
// `App.tsx` so the multi-run state logic is unit-testable without
// having to render a full React tree.

import type { TestRun } from './k6Report.ts'

/**
 * Returns the runs in the order the dashboard should render them:
 * newest first, ties broken by id (stable across re-renders).
 */
export function sortRunsByCreatedAt(runs: Record<string, TestRun>): TestRun[] {
  return Object.values(runs).sort((a, b) => {
    if (a.createdAt !== b.createdAt) return b.createdAt.localeCompare(a.createdAt)
    return a.id.localeCompare(b.id)
  })
}

/**
 * Returns a new runs map with the given run id removed. Pure —
 * the input map is never mutated. Powers the right-click "remove
 * from view" menu action when the user wants to clear a single
 * (terminal) badge from the dashboard. Removing a non-existent
 * id is a no-op and returns the original reference so the
 * caller can rely on referential equality to skip re-renders.
 */
export function removeRun(
  runs: Record<string, TestRun>,
  runId: string,
): Record<string, TestRun> {
  if (runs[runId] === undefined) return runs
  const next = { ...runs }
  delete next[runId]
  return next
}

/**
 * Returns a new empty runs map. Pure — the input map is
 * never mutated. Powers the "Alle löschen" timeline action:
 * the user clicks the button, the backend wipes the
 * `test_run` table, and the client drops every run from its
 * in-memory state so the dashboard re-renders as an empty
 * grid. Returning `{}` rather than `null` keeps the
 * downstream `Record<string, TestRun>` typing intact and
 * saves every consumer from a null-check.
 */
export function clearAllRuns(): Record<string, TestRun> {
  return {}
}

/**
 * Returns a new runs map with every FAILED run removed except
 * the keepRunId one. Pure — the input map is never mutated.
 * Powers the right-click "remove all other failed" menu action:
 * the user keeps the badge they clicked on but clears every
 * other FAILED badge from the dashboard. STOPPED and ABORTED
 * runs are intentionally kept — the user asked for "failed"
 * (the FAILED status), not for every non-success outcome.
 */
export function removeAllOtherFailed(
  runs: Record<string, TestRun>,
  keepRunId: string,
): Record<string, TestRun> {
  const next: Record<string, TestRun> = {}
  for (const [id, run] of Object.entries(runs)) {
    if (run.status === 'FAILED' && id !== keepRunId) continue
    next[id] = run
  }
  return next
}

/**
 * True when at least one other FAILED run is present in the
 * map. Drives the "remove all other failed" menu item's
 * enabled state — the item is shown disabled with a reason
 * when nothing would actually be removed, so the user is not
 * tempted to click an action that has no effect.
 */
export function hasOtherFailedRun(
  runs: Record<string, TestRun>,
  currentId: string,
): boolean {
  for (const [id, run] of Object.entries(runs)) {
    if (id === currentId) continue
    if (run.status === 'FAILED') return true
  }
  return false
}

/**
 * True while the run is still owned by the k6 process. STOPPING
 * belongs to this set on purpose: the user just clicked Stop and
 * the dashboard focus should stay on the run until the backend
 * reports the terminal state (STOPPED or ABORTED). Treating
 * STOPPING as terminal would silently lose focus mid-transition.
 */
export function isInFlight(status: string): boolean {
  return (
    status === 'QUEUED' ||
    status === 'RUNNING' ||
    status === 'STOPPING'
  )
}

/**
 * True once the run can be cancelled from the UI. This is
 * stricter than `isInFlight`: a QUEUED run is still in the
 * dashboard (so the live ticker keeps running) but the k6
 * process has not been spawned yet, so a stop request would
 * have no effect and the affordance is intentionally hidden
 * on the badge. STOPPING stays in the set so the badge can
 * keep showing the in-progress spinner until the backend
 * reports the terminal state.
 */
export function isCancellable(status: string): boolean {
  return status === 'RUNNING' || status === 'STOPPING'
}

/**
 * Returns the ids of every run that is currently cancellable
 * (RUNNING or STOPPING). Used when the user disables the
 * bundled demo API to stop every in-flight load test in one
 * pass — the same affordance the inline Stop button on each
 * badge provides, but applied to all badges at once.
 *
 * Pure: the input map is never mutated, the output is a fresh
 * array on every call. The function never depends on
 * [isInFlight] because a QUEUED run is still in the dashboard
 * (so the live ticker keeps running) but the k6 process has
 * not been spawned yet — sending a cancel request to the
 * backend would have no effect. [isCancellable] is the right
 * predicate for "a stop request will actually do something".
 *
 * Terminal runs are intentionally excluded: the user cannot
 * stop a run that has already settled, and the dashboard
 * would not need to issue the request anyway.
 */
export function cancellableRunIds(runs: Record<string, TestRun>): string[] {
  const ids: string[] = []
  for (const [id, run] of Object.entries(runs)) {
    if (isCancellable(run.status)) ids.push(id)
  }
  return ids
}

/**
 * True once the run has settled in a terminal state and no more
 * transitions are expected. Polling on the frontend uses the
 * negation of this predicate to stop refreshing runs that have
 * finished. STOPPING is intentionally excluded so the badge can
 * observe the STOPPING → STOPPED transition.
 */
export function isTerminalRun(status: string): boolean {
  return (
    status === 'COMPLETED' ||
    status === 'FAILED' ||
    status === 'STOPPED' ||
    status === 'ABORTED'
  )
}

/**
 * True when the `<TestRunSummary>` block should render the
 * compact status pill above the run's detail area. The pill is
 * suppressed for `RUNNING` and `QUEUED` runs because their CSS
 * modifier (`.status.running` / `.status.queued`) has no specific
 * background colour and would otherwise render in the default
 * gray — visually conflicting with the colour-coded
 * `RunStatusView` pills below. The in-flight state is still
 * communicated by the three progress cells
 * (RUNNING SINCE / REMAINING / STARTED). `STOPPING` keeps the
 * pill because the cells do not surface the "k6 is winding
 * down" hint on their own. Terminal runs are owned by
 * `RunStatusView`; the local pill would just duplicate the
 * state, so it is hidden there as well.
 */
export function showsStatusPill(status: string): boolean {
  return !isTerminalRun(status) && status !== 'RUNNING' && status !== 'QUEUED'
}

/**
 * Picks the id of the run the dashboard should focus on after the
 * run map changes. The rule:
 *   - keep the current focus if it is still present and not yet
 *     in a terminal state (the user might still be watching it);
 *   - otherwise, fall back to the newest run, preferring runs that
 *     are still in flight.
 * Returning `undefined` means the dashboard should hide the detail
 * card (no run to inspect).
 */
export function pickActiveRunId(
  runs: Record<string, TestRun>,
  currentId: string | undefined,
): string | undefined {
  if (currentId !== undefined && runs[currentId] !== undefined) return currentId
  const ordered = sortRunsByCreatedAt(runs)
  if (ordered.length === 0) return undefined
  // Prefer the newest still-running / queued run, so the user
  // immediately sees the live status of their last action.
  // STOPPING is included: the user just asked for a stop and
  // expects to see the transition play out before focus moves on.
  const inFlight = ordered.find(run => isInFlight(run.status))
  if (inFlight) return inFlight.id
  return ordered[0].id
}

/**
 * Picks the focus after the user started a k6 run ("k6-Lasttest
 * starten") or re-ran an existing one. Unlike [pickActiveRunId],
 * the freshly started run *always* wins: the user just triggered
 * it and expects its badge to light up so they can see that
 * something is happening. Keeping the old focus here would leave
 * the detail card on the previous — usually already finished —
 * run while the new badge sits unselected in the grid.
 * Falls back to the regular rule when the started run is not (or
 * no longer) in the map, so the helper never returns a dangling id.
 */
export function pickActiveRunIdAfterStart(
  runs: Record<string, TestRun>,
  startedId: string,
  currentId: string | undefined,
): string | undefined {
  if (runs[startedId] !== undefined) return startedId
  return pickActiveRunId(runs, currentId)
}

/**
 * Merge the dashboard's in-session run map with the runs
 * fetched for the per-endpoint timeline tab into a single map
 * the right-click menu can resolve from.
 *
 * Why this exists: historical runs (e.g. from previous
 * sessions) only live in the timeline fetch and never in the
 * parent's `runs` map — that map is only hydrated for runs
 * the user started in the current browser session, there is
 * no initial `GET /api/test-runs` in `App.tsx`. When the user
 * right-clicks a Gantt bar or a list item in
 * [EndpointTimelineTab], the menu was looked up via
 * `runsMap[runMenu.runId]` and returned `undefined` for any
 * historical run, which made [RunContextMenu]'s defensive
 * `if (!run) { onClose(); return null }` close the menu
 * immediately — hiding every action (focus / rerun / share /
 * cleanup) for exactly the runs the timeline tab is there to
 * surface.
 *
 * Timeline wins on id collisions because the right-click
 * happened on a timeline item and its snapshot is the most
 * recent fetch the tab has seen. Same id on both sides is
 * the same `TestRun` in practice, so this is defensive.
 */
export function mergeTimelineMenuRuns(
  dashboardRuns: Record<string, TestRun>,
  timelineRuns: TestRun[],
): Record<string, TestRun> {
  const merged: Record<string, TestRun> = { ...dashboardRuns }
  for (const run of timelineRuns) merged[run.id] = run
  return merged
}

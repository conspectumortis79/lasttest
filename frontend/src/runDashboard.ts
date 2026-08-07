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

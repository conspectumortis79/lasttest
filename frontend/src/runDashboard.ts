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

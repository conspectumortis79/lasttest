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
  const inFlight = ordered.find(run => run.status === 'QUEUED' || run.status === 'RUNNING')
  if (inFlight) return inFlight.id
  return ordered[0].id
}

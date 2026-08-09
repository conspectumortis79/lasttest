// Pure helpers for the per-endpoint Timeline tab's axis labels.
// Extracted into a `.ts` module so they can be unit-tested
// with `node:test` (which cannot load `.tsx`) and so the
// React component stays focused on rendering. The functions
// here are pure: same `Date` in, same string out, no state.

/**
 * Formats the label of a 24h-window tick. The wall-clock time
 * is anchored to `date` (the centre + the hour offset) and
 * rendered in `de-DE` style (HH:MM) so the user reads an
 * absolute moment instead of a relative offset like "-6h".
 *
 * Uses the *local* time of the supplied `Date` because the
 * timeline is rendered in the user's local timezone, and
 * zero-pads both fields so the labels stay column-aligned
 * under the Gantt axis.
 */
export function formatHourTick(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/**
 * Formats the label of a multi-day tick. The minor ticks show
 * only the date (TT.MM); the major centre tick adds the time
 * (HH:MM) so the user can tell *which* moment of the centred
 * day the axis is anchored to without having to cross-reference
 * the heatmap title above.
 */
export function formatDayTick(date: Date, major: boolean): string {
  const day = `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}`
  if (!major) return day
  return `${day} · ${formatHourTick(date)}`
}

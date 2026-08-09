import { deepEqual, equal } from 'node:assert/strict'
import { test } from 'node:test'
import { formatDayTick, formatHourTick } from './endpointTimelineTicks.ts'

// ---- formatHourTick -----------------------------------------------------
//
// The 24h axis used to show only relative offsets like "-6h" / "+0h".
// The user needs concrete wall-clock labels (HH:MM, German locale) so
// they can read the absolute moment a tick is anchored to without doing
// arithmetic in their head. The helper must use the *local* time of
// the supplied `Date` because the timeline is rendered in the user's
// local timezone, and zero-pad both fields to keep the labels aligned.

test('formatHourTick zero-pads hours and minutes', () => {
  const date = new Date(2026, 7, 8, 5, 7, 0) // 2026-08-08 05:07 local
  equal(formatHourTick(date), '05:07')
})

test('formatHourTick preserves midnight and noon as 00:00 / 12:00', () => {
  equal(formatHourTick(new Date(2026, 0, 1, 0, 0)), '00:00')
  equal(formatHourTick(new Date(2026, 0, 1, 12, 0)), '12:00')
})

test('formatHourTick reads hours and minutes from the local Date', () => {
  // 23:59 local is the boundary case: the helper must not wrap to
  // "00:59" or similar, and it must not leak the UTC hour back.
  const date = new Date(2026, 5, 15, 23, 59, 0)
  equal(formatHourTick(date), '23:59')
})

// ---- formatDayTick ------------------------------------------------------
//
// The day-window axis shows the date (TT.MM) on every tick and adds
// the time (HH:MM) on the major centre tick so the user can pinpoint
// the moment the chart is anchored to. The helper must NOT add the
// time on minor ticks (the label is already cramped, the heatmap
// title above carries the absolute timestamp), and it must keep the
// zero-padding consistent with [formatHourTick].

test('formatDayTick returns only TT.MM on a minor tick', () => {
  // 2026-08-08 05:07 local — minor tick must NOT show the time.
  const date = new Date(2026, 7, 8, 5, 7, 0)
  equal(formatDayTick(date, false), '08.08')
})

test('formatDayTick returns TT.MM and HH:MM on a major tick', () => {
  const date = new Date(2026, 7, 8, 23, 37, 0)
  equal(formatDayTick(date, true), '08.08 · 23:37')
})

test('formatDayTick zero-pads single-digit days and months', () => {
  // 2026-01-05 — both day and month are single-digit, both must pad.
  const date = new Date(2026, 0, 5, 9, 5, 0)
  deepEqual(formatDayTick(date, false), '05.01')
  deepEqual(formatDayTick(date, true), '05.01 · 09:05')
})

test('formatDayTick handles year/month rollovers for December 31', () => {
  // Edge case: a tick that crosses the year boundary must still
  // reflect the local Date (31.12, not 01.01). This guards against
  // an off-by-one if the helper were ever switched to UTC.
  const date = new Date(2026, 11, 31, 0, 0, 0)
  equal(formatDayTick(date, false), '31.12')
})

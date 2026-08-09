// Pure helpers for the "Letzte Läufe" panel — the list view of
// recent k6 runs that replaces the old run-badge grid. Every piece
// of decision logic (which CSS class for a status, which meta line
// to render, which duration to show) lives here so it can be
// unit-tested without rendering React. The component
// `LastRunsPanel.tsx` is the only caller.
//
// The visual contract comes straight from the design in
// `mockups/v7-gg-replica.html`: each row carries a status dot, a
// human-readable identifier, a status badge, a one-line meta, a
// duration display and a relative "when" stamp. Right-click is
// handled at the panel level (it opens the same `RunContextMenu`
// the old grid used); the helpers below stay agnostic of that.

import type { ReportLoadProfile, TestRun } from './k6Report.ts'
import { translate, type SupportedLanguage } from './i18n.ts'

/**
 * Maps a k6 status to the CSS modifier used on the status badge
 * inside the row. The terminal states COMPLETED, FAILED, STOPPED
 * and ABORTED each have their own colour so the user can tell at
 * a glance why the run settled. QUEUED / RUNNING / STOPPING share
 * the "is-running" colour because the run is still in flight.
 */
export function statusBadgeClass(status: string): 'is-pass' | 'is-fail' | 'is-running' | 'is-stopped' | 'is-aborted' | 'is-queued' {
  switch (status) {
    case 'COMPLETED': return 'is-pass'
    case 'FAILED': return 'is-fail'
    case 'STOPPED': return 'is-stopped'
    case 'ABORTED': return 'is-aborted'
    case 'QUEUED': return 'is-queued'
    case 'RUNNING':
    case 'STOPPING':
    default:
      return 'is-running'
  }
}

/**
 * Maps a k6 status to the status-dot CSS modifier. The dot uses
 * the same colour family as the badge so the two stay in sync
 * even when the badge text is too long to read.
 */
export function statusDotClass(status: string): 'is-pass' | 'is-fail' | 'is-running' | 'is-stopped' | 'is-aborted' | 'is-queued' {
  return statusBadgeClass(status)
}

/**
 * Returns the localisable label that goes inside the status badge
 * (e.g. "PASSED" / "BESTANDEN"). Uses the shared i18n dictionary
 * so the badge speaks the user's current language.
 */
export function statusBadgeLabel(status: string, lang: SupportedLanguage): string {
  return translate(lang, `status.${status}`)
}

/**
 * Returns a compact identifier for the run, suitable for the bold
 * "name" segment of the row. The app has no explicit run name in
 * the wire model — runs are identified by UUID. To keep the row
 * readable we surface the first HTTP method and joined paths of
 * the operations that were tested. Falls back to the run-id
 * prefix when no operations are attached (older fixtures).
 */
export function runDisplayName(run: TestRun): string {
  const operations = run.configuration?.operations ?? []
  if (operations.length === 0) return run.id.slice(0, 8)
  // `||` (not `??`) so an empty-string method also surfaces the
  // dash — synthetic fixtures occasionally ship with
  // `method: ''` and we would otherwise render " /path".
  const method = operations[0]?.method || '–'
  const path = operations.map(op => op.path).join(', ')
  return `${method} ${path}`
}

/**
 * Returns the (method, path) tuple that uniquely identifies the
 * primary endpoint a run exercised. Used by [LastRunsPanel] to
 * look up the per-endpoint × N statistics from
 * [useOperationStats]. Returns empty strings when the run has no
 * configuration attached (synthetic / unknown runs); the caller
 * treats those as "untested" rather than "× 0".
 */
export function operationMethodAndPath(run: TestRun): { method: string, path: string } {
  const operations = run.configuration?.operations ?? []
  if (operations.length === 0) return { method: '', path: '' }
  return {
    method: operations[0]?.method ?? '',
    path: operations[0]?.path ?? '',
  }
}

/**
 * Known executor types after normalisation (kebab-case,
 * lower-case). Mirrors the table in `k6Report.ts#profileSummary`
 * so the badge summary stays in lockstep with the report's
 * load-profile rendering.
 */
type NormalisedProfileType =
  | 'constant-vus'
  | 'ramping-vus'
  | 'shared-iterations'
  | 'constant-arrival-rate'
  | 'ramping-arrival-rate'
  | 'unknown'

function normalisedProfileType(profile: ReportLoadProfile): NormalisedProfileType {
  const raw = String(profile.type ?? '').toLowerCase().replace(/_/g, '-')
  switch (raw) {
    case 'constant-vus': return 'constant-vus'
    case 'ramping-vus': return 'ramping-vus'
    case 'shared-iterations': return 'shared-iterations'
    case 'constant-arrival-rate': return 'constant-arrival-rate'
    case 'ramping-arrival-rate': return 'ramping-arrival-rate'
    default: return 'unknown'
  }
}

function shortProfileLabel(type: NormalisedProfileType, lang: SupportedLanguage): string {
  return translate(lang, `profile.badge.short.${type}`)
}

/**
 * Builds the compact "profile · values" string rendered on each
 * run badge so the user can see — without opening the run
 * detail — which load profile (with which configuration values)
 * the run was started with. The shape mirrors the mockup's
 * one-line meta, but is more explicit about the profile type so
 * the user can tell a constant-vus run from a ramping-vus run
 * at a glance.
 *
 * Falls back to a single dash when the run has no configuration
 * attached (legacy fixtures, synthetic test runs) and to a
 * neutral "unknown profile" label when the executor is unknown
 * to this build (forward-compat with future k6 executors). The
 * returned string is intentionally short — the badge has to fit
 * next to the HTTP method pill and the path, so a long sentence
 * would force the badge to expand past the grid cell.
 */
export function loadProfileSummaryFor(
  profile: ReportLoadProfile | null | undefined,
  lang: SupportedLanguage,
): string {
  if (!profile) return translate(lang, 'profile.badge.summary.missing')
  const type = normalisedProfileType(profile)
  const label = shortProfileLabel(type, lang)
  switch (type) {
    case 'constant-vus':
      return translate(lang, 'profile.badge.summary.constant-vus', {
        profile: label,
        vus: profile.virtualUsers ?? '?',
        duration: formatProfileSeconds(profile.durationSeconds, lang),
      })
    case 'shared-iterations':
      return translate(lang, 'profile.badge.summary.shared-iterations', {
        profile: label,
        iterations: formatInteger(profile.iterations) ?? '?',
        vus: profile.virtualUsers ?? '?',
      })
    case 'ramping-vus': {
      const stages = profile.stages ?? []
      const start = profile.startVUs ?? 0
      const peak = stages.reduce((max, stage) => Math.max(max, stage.target), start)
      const duration = profile.durationSeconds ?? stages.reduce((sum, s) => sum + s.durationSeconds, 0)
      // When the profile has no `stages` array the run is
      // conceptually a single-stage ramp from `startVUs` to
      // `virtualUsers` over `durationSeconds`; collapse the
      // arrow notation into a flat "<vus> VUs" label so the
      // badge does not render "0→50 VUs" for what is really a
      // constant-vus-like profile.
      if (stages.length === 0) {
        return translate(lang, 'profile.badge.summary.ramping-vus.flat', {
          profile: label,
          vus: profile.virtualUsers ?? peak,
          duration: formatProfileSeconds(duration, lang),
        })
      }
      return translate(lang, 'profile.badge.summary.ramping-vus', {
        profile: label,
        start,
        peak,
        duration: formatProfileSeconds(duration, lang),
      })
    }
    case 'constant-arrival-rate':
      return translate(lang, 'profile.badge.summary.constant-arrival-rate', {
        profile: label,
        rate: profile.rate ?? '?',
        duration: formatProfileSeconds(profile.durationSeconds, lang),
      })
    case 'ramping-arrival-rate': {
      const stages = profile.stages ?? []
      const startRate = profile.startRate ?? 0
      const peakRate = stages.reduce((max, stage) => Math.max(max, stage.target), startRate)
      const duration = profile.durationSeconds ?? stages.reduce((sum, s) => sum + s.durationSeconds, 0)
      if (stages.length === 0) {
        return translate(lang, 'profile.badge.summary.ramping-arrival-rate.flat', {
          profile: label,
          rate: profile.rate ?? peakRate,
          duration: formatProfileSeconds(duration, lang),
        })
      }
      return translate(lang, 'profile.badge.summary.ramping-arrival-rate', {
        profile: label,
        startRate,
        peakRate,
        duration: formatProfileSeconds(duration, lang),
      })
    }
    case 'unknown':
    default:
      return translate(lang, 'profile.badge.short.unknown')
  }
}

/**
 * Locale-aware duration formatter for the badge. Mirrors the
 * shape used by the meta line so the badge and the list row do
 * not disagree about how a 90-second run is written — the badge
 * uses the same `{seconds} s` / `{minutes} min` tokens so the
 * string lands in roughly the same column width on both views.
 */
function formatProfileSeconds(seconds: number | undefined, lang: SupportedLanguage): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return '–'
  if (seconds < 60) return translate(lang, 'lastRuns.meta.seconds', { seconds: Math.round(seconds) })
  if (seconds < 3600) {
    const minutes = Math.round(seconds / 60)
    return translate(lang, 'lastRuns.meta.minutes', { minutes })
  }
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.round((seconds - hours * 3600) / 60)
  if (minutes === 0) return translate(lang, 'lastRuns.meta.hours', { hours })
  return translate(lang, 'lastRuns.meta.hoursMinutes', { hours, minutes })
}

/** Formats a number with a thin-space thousands separator so
 *  shared-iterations counts stay scannable on the badge. */
function formatInteger(value: number | undefined): string | undefined {
  if (value == null || !Number.isFinite(value)) return undefined
  return Math.round(value).toLocaleString('en-US')
}

/**
 * Builds the single-line meta string shown under the run name.
 * Mirrors the shape from the mockup: VUs · duration · extra
 * (Ramp-up duration, phase counter, failure reason, …). Empty
 * segments are dropped so the bullet separators never produce
 * dangling whitespace.
 */
export function metaLineFor(run: TestRun, lang: SupportedLanguage): string {
  const profile = run.configuration?.loadProfile
  if (!profile) return '–'
  const parts: string[] = []
  const vus = profile.virtualUsers
  if (vus != null) parts.push(translate(lang, 'lastRuns.meta.vus', { vus }))
  const duration = profile.durationSeconds
  if (duration != null) {
    parts.push(translate(lang, 'lastRuns.meta.duration', { seconds: formatSecondsCompact(duration, lang) }))
  } else {
    const stages = profile.stages ?? []
    if (stages.length > 0) {
      const total = stages.reduce((sum, s) => sum + s.durationSeconds, 0)
      parts.push(translate(lang, 'lastRuns.meta.duration', { seconds: formatSecondsCompact(total, lang) }))
    }
  }
  if (run.status === 'RUNNING') {
    parts.push(translate(lang, 'lastRuns.meta.running'))
  } else if (run.status === 'STOPPING') {
    parts.push(translate(lang, 'lastRuns.meta.stopping'))
  } else if (run.status === 'FAILED' && run.error) {
    parts.push(translate(lang, 'lastRuns.meta.failed'))
  } else if (run.status === 'QUEUED') {
    parts.push(translate(lang, 'lastRuns.meta.queued'))
  }
  return parts.length === 0 ? '–' : parts.join(' · ')
}

/**
 * Formats a duration in seconds as a short human-readable string
 * (e.g. `5 min`, `2:30`, `45 s`). Used inside the meta line — the
 * duration column on the right uses a different formatter
 * (mm:ss) so the two do not visually compete.
 */
function formatSecondsCompact(seconds: number, lang: SupportedLanguage): string {
  if (seconds < 60) return translate(lang, 'lastRuns.meta.seconds', { seconds })
  if (seconds < 3600) {
    const minutes = Math.round(seconds / 60)
    return translate(lang, 'lastRuns.meta.minutes', { minutes })
  }
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.round((seconds - hours * 3600) / 60)
  if (minutes === 0) return translate(lang, 'lastRuns.meta.hours', { hours })
  return translate(lang, 'lastRuns.meta.hoursMinutes', { hours, minutes })
}

/**
 * Returns the "elapsed" / "total" string shown in the right-hand
 * duration column. In-flight runs show `<elapsed> / ~<planned>`
 * (planned omitted if the profile has no predictable total).
 * Terminal runs show the final elapsed wall-clock time.
 */
export function durationFor(
  run: TestRun,
  elapsedSeconds: number | undefined,
  lang: SupportedLanguage,
): string {
  if (run.status === 'QUEUED' || run.status === 'STOPPING' && elapsedSeconds == null) {
    return '—'
  }
  if (elapsedSeconds == null) return '—'
  if (run.status === 'RUNNING' || run.status === 'STOPPING') {
    const planned = plannedDurationSeconds(run)
    const elapsed = formatMmSs(elapsedSeconds)
    if (planned == null || planned <= 0) return elapsed
    return translate(lang, 'lastRuns.duration.elapsedOf', {
      elapsed,
      planned: formatMmSs(planned),
    })
  }
  return formatMmSs(elapsedSeconds)
}

/**
 * Returns the right-hand relative timestamp (e.g. `vor 2 Std.`,
 * `läuft seit 2:41`, `wartet`). Localised; the raw math is
 * identical between languages — only the suffix changes.
 */
export function relativeWhenFor(
  run: TestRun,
  now: number,
  lang: SupportedLanguage,
): string {
  if (run.status === 'QUEUED') return translate(lang, 'lastRuns.when.queued')
  if (run.status === 'RUNNING' || run.status === 'STOPPING') {
    const elapsed = elapsedSecondsFrom(run, now)
    if (elapsed == null) return '—'
    return translate(lang, 'lastRuns.when.runningFor', { duration: formatMmSs(elapsed) })
  }
  const finishedMs = run.finishedAt ? Date.parse(run.finishedAt) : Number.NaN
  if (!Number.isFinite(finishedMs)) return '—'
  const deltaMs = Math.max(0, now - finishedMs)
  return translate(lang, 'lastRuns.when.ago', { value: humaniseDelta(deltaMs, lang) })
}

/**
 * Returns the total planned duration of the load profile in
 * seconds, or `undefined` if the profile is open-ended (e.g.
 * shared-iterations without an explicit cap). Used to format
 * `<elapsed> / ~<planned>` for in-flight runs.
 */
function plannedDurationSeconds(run: TestRun): number | undefined {
  const profile = run.configuration?.loadProfile
  if (!profile) return undefined
  if (profile.durationSeconds != null) return profile.durationSeconds
  if (profile.stages != null && profile.stages.length > 0) {
    return profile.stages.reduce((sum, s) => sum + s.durationSeconds, 0)
  }
  return undefined
}

function elapsedSecondsFrom(run: TestRun, now: number): number | undefined {
  if (run.startedAt == null) return undefined
  const started = Date.parse(run.startedAt)
  if (!Number.isFinite(started)) return undefined
  const finished = run.finishedAt ? Date.parse(run.finishedAt) : now
  if (!Number.isFinite(finished)) return undefined
  return Math.max(0, (finished - started) / 1000)
}

function formatMmSs(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds))
  const minutes = Math.floor(safe / 60)
  const seconds = safe % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

/**
 * Picks a localised human string for a millisecond delta, with
 * the same buckets the demo uses (`vor 2 Std.`, `vor 5 Min`,
 * `gerade eben`). Buckets: < 60 s → seconds, < 60 m → minutes,
 * < 24 h → hours, otherwise days.
 */
// Exported so the test file can pin each branch directly; the
// helper is otherwise internal to `relativeWhenFor`.
export function humaniseDelta(deltaMs: number, lang: SupportedLanguage): string {
  const seconds = Math.floor(deltaMs / 1000)
  if (seconds < 45) return translate(lang, 'lastRuns.delta.justNow')
  if (seconds < 90) return translate(lang, 'lastRuns.delta.minutes', { minutes: 1 })
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return translate(lang, 'lastRuns.delta.minutes', { minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return translate(lang, 'lastRuns.delta.hours', { hours })
  const days = Math.floor(hours / 24)
  return translate(lang, 'lastRuns.delta.days', { days })
}

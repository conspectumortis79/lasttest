// Time-series loader for the ramp chart in the report. Fetches the
// real measured values (VUs, RPS) from InfluxDB through the backend.
// Returns empty arrays on network or server errors so the UI can
// transparently fall back to "target only".

export type TimeSeriesPoint = {
  /** ISO-8601 timestamp. */
  time: string
  /** Measured value (VUs as integer, RPS as float). */
  value: number
}

export type TimeSeriesResponse = {
  runId: string
  resolutionSeconds: number
  vus: TimeSeriesPoint[]
  requestsPerSecond: TimeSeriesPoint[]
}

export const EMPTY_TIME_SERIES: TimeSeriesResponse = {
  runId: '',
  resolutionSeconds: 1,
  vus: [],
  requestsPerSecond: [],
}

export async function fetchTimeSeries(runId: string): Promise<TimeSeriesResponse> {
  try {
    const response = await fetch(`/api/test-runs/${encodeURIComponent(runId)}/time-series`)
    if (response.status === 404) return EMPTY_TIME_SERIES
    if (!response.ok) return EMPTY_TIME_SERIES
    const data = await response.json() as TimeSeriesResponse
    return data
  } catch {
    return EMPTY_TIME_SERIES
  }
}

/**
 * Point in the chart-friendly epoch-seconds shape. The ramp chart
 * expects `t` to be a plain numeric seconds value; converting the
 * ISO-8601 string with `Number(...)` would silently produce `NaN`
 * and leave the polyline empty (see [LiveRampChart] in
 * `runStatusView.tsx`, which renders the points through an
 * `xFor(t * 1000)` projection).
 */
export type EpochSecondPoint = {
  /** Seconds since the Unix epoch. */
  t: number
  value: number
}

/**
 * Converts time-series points (the shape returned by
 * `/api/test-runs/{id}/time-series`, where `time` is an ISO-8601
 * string) into the `t`-as-epoch-seconds shape the ramp chart needs.
 *
 * Points whose timestamp cannot be parsed, or whose value is not a
 * finite number, are dropped. A `NaN` coordinate would silently
 * hide the polyline; filtering at this boundary keeps the chart
 * resilient against partial or malformed server responses.
 */
export function vuSamplesToEpochSeconds(
  vus: readonly TimeSeriesPoint[],
): EpochSecondPoint[] {
  const result: EpochSecondPoint[] = []
  for (const p of vus) {
    const seconds = Date.parse(p.time) / 1000
    if (!Number.isFinite(seconds) || !Number.isFinite(p.value)) continue
    result.push({ t: seconds, value: p.value })
  }
  return result
}

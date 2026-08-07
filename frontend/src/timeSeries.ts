// Time-series loader for the ramp chart in the report. Fetches the
// real measured values (VUs, RPS) from InfluxDB through the backend.
// Returns empty arrays on network or server errors so the UI can
// transparently fall back to "target only".

type TimeSeriesPoint = {
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

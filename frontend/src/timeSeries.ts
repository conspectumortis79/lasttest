// Time-Series-Loader für die Ramp-Grafik im Report. Holt die echten
// Ist-Werte (VUs, RPS) aus InfluxDB über das Backend. Liefert bei
// Netzwerk- oder Server-Fehlern leere Arrays zurück, damit die UI
// transparent auf Soll-only zurückfällt.

export type TimeSeriesPoint = {
  /** ISO-8601-Zeitstempel. */
  time: string
  /** Messwert (VUs als Ganzzahl, RPS als Fließkomma). */
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

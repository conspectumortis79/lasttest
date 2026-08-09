import { deepEqual, equal, ok } from 'node:assert/strict'
import { test } from 'node:test'
import { EMPTY_TIME_SERIES, fetchTimeSeries, vuSamplesToEpochSeconds } from './timeSeries.ts'

type FetchCall = { url: string; init: RequestInit | undefined }

function makeFakeFetch(
  outcomes: Array<
    | { ok: true; status: number; body: unknown }
    | { ok: false; status: number; throwsOnJson?: unknown; body?: string }
  >,
): { fetch: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = []
  let index = 0
  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    calls.push({ url, init })
    const next = outcomes[index++]
    if (!next) throw new Error('No more fake responses configured')
    const headers = new Headers({ 'content-type': 'application/json' })
    if (next.ok) {
      return new Response(JSON.stringify(next.body), { status: next.status, headers })
    }
    return new Response(next.body ?? '', { status: next.status, headers })
  }) as typeof fetch
  // patch `.json()` for the non-ok path to optionally throw
  const originalFetch = fakeFetch
  const wrappedFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await originalFetch(input, init)
    const outcome = outcomes[calls.length - 1]
    if (outcome && !outcome.ok && outcome.throwsOnJson !== undefined) {
      return new Proxy(response, {
        get(target, prop, receiver) {
          if (prop === 'json') return () => Promise.reject(outcome.throwsOnJson)
          return Reflect.get(target, prop, receiver)
        },
      })
    }
    return response
  }) as typeof fetch
  return { fetch: wrappedFetch, calls }
}

test('EMPTY_TIME_SERIES is a well-formed empty payload', () => {
  equal(EMPTY_TIME_SERIES.runId, '')
  equal(EMPTY_TIME_SERIES.resolutionSeconds, 1)
  deepEqual(EMPTY_TIME_SERIES.vus, [])
  deepEqual(EMPTY_TIME_SERIES.requestsPerSecond, [])
})

test('fetchTimeSeries returns parsed data for a successful response', async () => {
  const { fetch, calls } = makeFakeFetch([
    {
      ok: true,
      status: 200,
      body: {
        runId: 'run-42',
        resolutionSeconds: 2,
        vus: [{ time: 't0', value: 1 }],
        requestsPerSecond: [{ time: 't0', value: 5.5 }],
      },
    },
  ])
  const original = globalThis.fetch
  globalThis.fetch = fetch
  try {
    const result = await fetchTimeSeries('run-42')
    equal(result.runId, 'run-42')
    equal(result.resolutionSeconds, 2)
    equal(result.vus.length, 1)
    equal(result.requestsPerSecond.length, 1)
    equal(calls.length, 1)
    ok(calls[0].url.includes('/api/test-runs/run-42/time-series'))
  } finally {
    globalThis.fetch = original
  }
})

test('fetchTimeSeries URL-encodes the runId in the path', async () => {
  const { fetch, calls } = makeFakeFetch([
    { ok: true, status: 200, body: { ...EMPTY_TIME_SERIES, runId: 'a/b c' } },
  ])
  const original = globalThis.fetch
  globalThis.fetch = fetch
  try {
    await fetchTimeSeries('a/b c')
    ok(calls[0].url.includes('/api/test-runs/a%2Fb%20c/time-series'))
  } finally {
    globalThis.fetch = original
  }
})

test('fetchTimeSeries returns EMPTY_TIME_SERIES for a 404 response', async () => {
  const { fetch } = makeFakeFetch([{ ok: false, status: 404 }])
  const original = globalThis.fetch
  globalThis.fetch = fetch
  try {
    const result = await fetchTimeSeries('missing')
    deepEqual(result, EMPTY_TIME_SERIES)
  } finally {
    globalThis.fetch = original
  }
})

test('fetchTimeSeries returns EMPTY_TIME_SERIES for any non-2xx response', async () => {
  const { fetch } = makeFakeFetch([{ ok: false, status: 500, body: 'boom' }])
  const original = globalThis.fetch
  globalThis.fetch = fetch
  try {
    const result = await fetchTimeSeries('server-down')
    deepEqual(result, EMPTY_TIME_SERIES)
  } finally {
    globalThis.fetch = original
  }
})

test('fetchTimeSeries returns EMPTY_TIME_SERIES when the response body is not valid JSON', async () => {
  const { fetch } = makeFakeFetch([
    { ok: false, status: 200, body: 'not json', throwsOnJson: new SyntaxError('bad json') },
  ])
  const original = globalThis.fetch
  globalThis.fetch = fetch
  try {
    const result = await fetchTimeSeries('whatever')
    deepEqual(result, EMPTY_TIME_SERIES)
  } finally {
    globalThis.fetch = original
  }
})

test('fetchTimeSeries returns EMPTY_TIME_SERIES when fetch itself throws', async () => {
  const original = globalThis.fetch
  globalThis.fetch = (async () => {
    throw new TypeError('network down')
  }) as typeof fetch
  try {
    const result = await fetchTimeSeries('network')
    deepEqual(result, EMPTY_TIME_SERIES)
  } finally {
    globalThis.fetch = original
  }
})

test('fetchTimeSeries rejects nothing and always resolves to a TimeSeriesResponse', async () => {
  const { fetch } = makeFakeFetch([
    { ok: false, status: 503, body: '', throwsOnJson: new TypeError('cannot parse') },
  ])
  const original = globalThis.fetch
  globalThis.fetch = fetch
  try {
    let resolved: unknown
    await fetchTimeSeries('x').then(value => {
      resolved = value
    })
    ok(resolved)
    deepEqual(resolved, EMPTY_TIME_SERIES)
    // ensure no throw propagated
    await fetchTimeSeries('y').catch(() => {
      throw new Error('fetchTimeSeries must not reject')
    })
  } finally {
    globalThis.fetch = original
  }
})

// ---- vuSamplesToEpochSeconds --------------------------------------------
//
// The backend returns ISO-8601 timestamps in [TimeSeriesPoint.time];
// the ramp chart needs `t` as a plain number of epoch *seconds*. A
// previous version of `OverviewLiveRamp` used `Number(p.time)` inline,
// which silently turned every timestamp into `NaN` and left the
// polyline empty while the run was still in flight. The helper below
// is the single place that handles the conversion and is exercised
// here so that regression cannot slip back in.

test('vuSamplesToEpochSeconds returns an empty array for an empty input', () => {
  deepEqual(vuSamplesToEpochSeconds([]), [])
})

test('vuSamplesToEpochSeconds converts ISO-8601 timestamps to epoch seconds', () => {
  const points = [
    { time: '2026-08-08T21:44:26Z', value: 5 },
    { time: '2026-08-08T21:44:27Z', value: 7 },
    { time: '2026-08-08T21:44:28Z', value: 9 },
  ]
  const converted = vuSamplesToEpochSeconds(points)
  equal(converted.length, 3)
  // Seconds must be strictly monotonic and match the ISO timestamps
  // to the nearest whole second (no fractional drift).
  equal(converted[1].t - converted[0].t, 1)
  equal(converted[2].t - converted[1].t, 1)
  equal(converted[0].value, 5)
  equal(converted[1].value, 7)
  equal(converted[2].value, 9)
  // The conversion must produce finite numbers — the bug we are
  // guarding against was that `Number(p.time)` returned `NaN` for
  // ISO strings, which made the ramp chart render zero samples.
  for (const p of converted) {
    ok(Number.isFinite(p.t), `t must be finite, got ${p.t}`)
    ok(Number.isFinite(p.value), `value must be finite, got ${p.value}`)
  }
})

test('vuSamplesToEpochSeconds drops points with an unparseable timestamp', () => {
  const points = [
    { time: 'not-a-timestamp', value: 5 },
    { time: '2026-08-08T21:44:27Z', value: 7 },
  ]
  const converted = vuSamplesToEpochSeconds(points)
  // Only the well-formed entry survives; the malformed one would
  // otherwise yield a `NaN` x-coordinate that hides the polyline.
  equal(converted.length, 1)
  equal(converted[0].value, 7)
  ok(Number.isFinite(converted[0].t))
})

test('vuSamplesToEpochSeconds drops points whose value is not finite', () => {
  const points = [
    { time: '2026-08-08T21:44:26Z', value: Number.NaN },
    { time: '2026-08-08T21:44:27Z', value: Number.POSITIVE_INFINITY },
    { time: '2026-08-08T21:44:28Z', value: 4 },
  ]
  const converted = vuSamplesToEpochSeconds(points)
  equal(converted.length, 1)
  equal(converted[0].value, 4)
})

test('vuSamplesToEpochSeconds preserves order and does not mutate the input', () => {
  const points = [
    { time: '2026-08-08T21:44:26Z', value: 1 },
    { time: '2026-08-08T21:44:27Z', value: 2 },
  ]
  const snapshot = JSON.parse(JSON.stringify(points))
  const converted = vuSamplesToEpochSeconds(points)
  // Input must be untouched — the helper must be referentially
  // transparent so React state setters can rely on it.
  deepEqual(points, snapshot)
  equal(converted[0].value, 1)
  equal(converted[1].value, 2)
})

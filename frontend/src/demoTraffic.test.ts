// Unit tests for the demo-traffic loader and helpers. The network
// surface is mocked via `globalThis.fetch` so the tests can pin
// every branch — happy path, server error, malformed JSON, empty
// runId, etc. — without spinning up a real backend. The pattern
// is "stash the real `fetch`, install a stub, restore in
// `finally`". The `no-unused-vars` lint rule is happy because the
// stashed value is used in the restore line.

import { deepEqual, equal, ok } from 'node:assert/strict'
import { test } from 'node:test'
import {
  EMPTY_DEMO_TRAFFIC,
  fetchDemoTraffic,
  formatTrafficTimestamp,
  statusBucket,
  type DemoTrafficResponse,
} from './demoTraffic.ts'

type FetchCall = {
  url: string
  init?: RequestInit
}

function installFetchMock(handler: (call: FetchCall) => Response | Promise<Response>): { calls: FetchCall[], restore: () => void } {
  const calls: FetchCall[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    calls.push({ url, init })
    return await handler({ url, init })
  }) as typeof fetch
  return { calls, restore: () => { globalThis.fetch = original } }
}

test('fetchDemoTraffic returns the parsed response on a 200', async () => {
  const payload: DemoTrafficResponse = {
    runId: 'r',
    limit: 500,
    count: 2,
    entries: [
      { timestamp: '2026-01-01T00:00:00Z', method: 'GET', path: '/demo-api/products', queryString: null, status: 200, userAgent: 'k6/test', runId: 'r' },
      { timestamp: '2026-01-01T00:00:01Z', method: 'POST', path: '/demo-api/products/search', queryString: 'q=1', status: 401, userAgent: null, runId: 'r' },
    ],
  }
  const { calls, restore } = installFetchMock(() => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } }))
  try {
    const result = await fetchDemoTraffic('r')
    deepEqual(result, payload)
    equal(calls.length, 1)
    equal(calls[0]?.url, '/api/demo-traffic/requests?runId=r')
  } finally {
    restore()
  }
})

test('fetchDemoTraffic omits the runId query parameter when the caller passes none', async () => {
  const { calls, restore } = installFetchMock(() => new Response(JSON.stringify(EMPTY_DEMO_TRAFFIC), { status: 200 }))
  try {
    await fetchDemoTraffic()
    equal(calls[0]?.url, '/api/demo-traffic/requests')
  } finally {
    restore()
  }
})

test('fetchDemoTraffic treats a blank runId the same as no runId', async () => {
  // The dashboard might pass a stale runId from a previous run;
  // we don't want that to accidentally filter the global stream
  // (the server would return an empty list).
  const { calls, restore } = installFetchMock(() => new Response(JSON.stringify(EMPTY_DEMO_TRAFFIC), { status: 200 }))
  try {
    await fetchDemoTraffic('   ')
    equal(calls[0]?.url, '/api/demo-traffic/requests')
  } finally {
    restore()
  }
})

test('fetchDemoTraffic returns the empty envelope on a 5xx response', async () => {
  const { restore } = installFetchMock(() => new Response('boom', { status: 500 }))
  try {
    const result = await fetchDemoTraffic('r')
    deepEqual(result, EMPTY_DEMO_TRAFFIC)
  } finally {
    restore()
  }
})

test('fetchDemoTraffic returns the empty envelope on a 404', async () => {
  // 404 would mean the controller is not mounted; the dashboard
  // should still render an empty table instead of an error toast.
  const { restore } = installFetchMock(() => new Response('', { status: 404 }))
  try {
    const result = await fetchDemoTraffic('r')
    deepEqual(result, EMPTY_DEMO_TRAFFIC)
  } finally {
    restore()
  }
})

test('fetchDemoTraffic returns the empty envelope when the response is not JSON', async () => {
  const { restore } = installFetchMock(() => new Response('<html>oops</html>', { status: 200, headers: { 'content-type': 'text/html' } }))
  try {
    const result = await fetchDemoTraffic('r')
    deepEqual(result, EMPTY_DEMO_TRAFFIC)
  } finally {
    restore()
  }
})

test('fetchDemoTraffic returns the empty envelope when fetch itself throws', async () => {
  const { restore } = installFetchMock(() => {
    throw new Error('network down')
  })
  try {
    const result = await fetchDemoTraffic('r')
    deepEqual(result, EMPTY_DEMO_TRAFFIC)
  } finally {
    restore()
  }
})

test('formatTrafficTimestamp renders milliseconds with the expected precision', () => {
  // Pinned to UTC so the test is locale-independent.
  const formatted = formatTrafficTimestamp('2026-01-01T12:34:56.789Z')
  equal(formatted, '12:34:56.789')
})

test('formatTrafficTimestamp pads single-digit fields to keep columns aligned', () => {
  equal(formatTrafficTimestamp('2026-01-01T01:02:03.004Z'), '01:02:03.004')
})

test('formatTrafficTimestamp returns the input verbatim when the timestamp is unparseable', () => {
  // Defensive: a malformed timestamp from the server should not
  // crash the table; the raw string is the least surprising
  // fallback.
  equal(formatTrafficTimestamp('not-a-timestamp'), 'not-a-timestamp')
})

test('statusBucket maps every tracked range to the right CSS bucket', () => {
  equal(statusBucket(200), 'success')
  equal(statusBucket(204), 'success')
  equal(statusBucket(299), 'success')
  equal(statusBucket(301), 'redirect')
  equal(statusBucket(304), 'redirect')
  equal(statusBucket(400), 'client-error')
  equal(statusBucket(401), 'client-error')
  equal(statusBucket(404), 'client-error')
  equal(statusBucket(429), 'client-error')
  equal(statusBucket(500), 'server-error')
  equal(statusBucket(502), 'server-error')
  equal(statusBucket(504), 'server-error')
  equal(statusBucket(0), 'other')
  equal(statusBucket(600), 'other')
})

test('EMPTY_DEMO_TRAFFIC carries the expected sentinel values', () => {
  // The sentinel is referenced from React state initialisation;
  // a typo here would silently break the "no requests yet" branch.
  equal(EMPTY_DEMO_TRAFFIC.runId, null)
  equal(EMPTY_DEMO_TRAFFIC.limit, 500)
  equal(EMPTY_DEMO_TRAFFIC.count, 0)
  ok(Array.isArray(EMPTY_DEMO_TRAFFIC.entries))
  equal(EMPTY_DEMO_TRAFFIC.entries.length, 0)
})

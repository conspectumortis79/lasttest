// Unit tests for the demo-status loader. The tests follow the
// pattern from `demoTraffic.test.ts`: each test installs a stub
// `globalThis.fetch`, runs the loader, and restores the original
// `fetch` in a `finally` block. The stub does not need to track
// every call — the contract is just "the loader makes a request
// and returns the parsed body".

import { deepEqual, equal, ok } from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEMO_DISABLED,
  DEMO_ENABLED,
  fetchDemoStatus,
  setDemoEnabled,
  type DemoStatus,
} from './demoStatus.ts'

function installFetchMock(handler: (request: { url: string, init?: RequestInit }) => Response | Promise<Response>): { restore: () => void } {
  const original = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    return await handler({ url, init })
  }) as typeof fetch
  return { restore: () => { globalThis.fetch = original } }
}

test('fetchDemoStatus returns the parsed payload on 200', async () => {
  const payload: DemoStatus = { enabled: true, loaded: true }
  const { restore } = installFetchMock(() => new Response(JSON.stringify(payload), { status: 200 }))
  try {
    const result = await fetchDemoStatus()
    deepEqual(result, payload)
  } finally {
    restore()
  }
})

test('fetchDemoStatus falls back to DISABLED on a 5xx response', async () => {
  const { restore } = installFetchMock(() => new Response('boom', { status: 500 }))
  try {
    const result = await fetchDemoStatus()
    equal(result.enabled, false)
  } finally {
    restore()
  }
})

test('fetchDemoStatus falls back to DISABLED on a 404', async () => {
  const { restore } = installFetchMock(() => new Response('', { status: 404 }))
  try {
    const result = await fetchDemoStatus()
    deepEqual(result, DEMO_DISABLED)
  } finally {
    restore()
  }
})

test('fetchDemoStatus falls back to DISABLED on a network error', async () => {
  const { restore } = installFetchMock(() => { throw new Error('network down') })
  try {
    const result = await fetchDemoStatus()
    deepEqual(result, DEMO_DISABLED)
  } finally {
    restore()
  }
})

test('setDemoEnabled POSTs to /api/demo-traffic/enabled with a JSON body', async () => {
  const seen: { url: string, init?: RequestInit }[] = []
  const { restore } = installFetchMock((request) => {
    seen.push(request)
    return new Response(JSON.stringify({ enabled: true }), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  try {
    const result = await setDemoEnabled(true)
    equal(seen.length, 1)
    equal(seen[0]?.url, '/api/demo-traffic/enabled')
    equal(seen[0]?.init?.method, 'POST')
    const headers = seen[0]?.init?.headers as Record<string, string> | undefined
    equal(headers?.['content-type'], 'application/json')
    equal(seen[0]?.init?.body, JSON.stringify({ enabled: true }))
    equal(result.enabled, true)
  } finally {
    restore()
  }
})

test('setDemoEnabled returns the backend-reported state on success', async () => {
  const { restore } = installFetchMock(() => new Response(JSON.stringify({ enabled: false }), { status: 200 }))
  try {
    const result = await setDemoEnabled(false)
    // The wire helper returns the raw server payload; the
    // `loaded` flag is owned by the provider, not by the
    // HTTP helper. Assert the wire contract only.
    equal(result.enabled, false)
  } finally {
    restore()
  }
})

test('setDemoEnabled optimistically reflects the requested state on error', async () => {
  // The backend might be temporarily unavailable, but the UI
  // should not flash a wrong state — returning the requested
  // state on error keeps the toggle in sync with the user's last
  // action. The next read will reconcile with the server.
  const { restore } = installFetchMock(() => { throw new Error('network down') })
  try {
    const result = await setDemoEnabled(true)
    deepEqual(result, DEMO_ENABLED)
  } finally {
    restore()
  }
})

test('setDemoEnabled returns the requested state on a 5xx response', async () => {
  const { restore } = installFetchMock(() => new Response('boom', { status: 500 }))
  try {
    const result = await setDemoEnabled(false)
    deepEqual(result, DEMO_DISABLED)
  } finally {
    restore()
  }
})

test('setDemoEnabled falls back to the requested state when the response body is not JSON', async () => {
  // A 200 with a non-JSON body still resolves the `fetch`
  // promise, but the `response.json()` call inside `try` throws
  // a SyntaxError. The catch branch then has to return the
  // requested state so the UI does not get stuck in a half-
  // applied value.
  const { restore } = installFetchMock(() => new Response('<html>not json</html>', { status: 200, headers: { 'content-type': 'text/html' } }))
  try {
    const result = await setDemoEnabled(true)
    deepEqual(result, DEMO_ENABLED)
  } finally {
    restore()
  }
})

test('fetchDemoStatus returns DISABLED when the response body is not JSON', async () => {
  const { restore } = installFetchMock(() => new Response('<html>nope</html>', { status: 200, headers: { 'content-type': 'text/html' } }))
  try {
    const result = await fetchDemoStatus()
    deepEqual(result, DEMO_DISABLED)
  } finally {
    restore()
  }
})

test('setDemoEnabled returns the parsed body on a 200 response with enabled=false', async () => {
  const { restore } = installFetchMock(() => new Response(JSON.stringify({ enabled: false }), { status: 200 }))
  try {
    const result = await setDemoEnabled(false)
    equal(result.enabled, false)
  } finally {
    restore()
  }
})

test('DEMO_DISABLED and DEMO_ENABLED sentinels are easy to recognise in tests', () => {
  ok(DEMO_DISABLED.enabled === false)
  ok(DEMO_ENABLED.enabled === true)
})

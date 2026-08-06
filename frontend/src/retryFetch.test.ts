import { deepEqual, ok, rejects } from 'node:assert/strict'
import { test } from 'node:test'
import { fetchWithRetry } from './retryFetch.ts'

type FetchCall = { url: string; init: RequestInit | undefined; attempt: number }
type FetchOutcome = Response | { throws: unknown }

function makeFakeFetch(
  responses: FetchOutcome[],
): { fetch: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = []
  let index = 0
  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    calls.push({ url, init, attempt: index + 1 })
    const next = responses[index++]
    if (!next) throw new Error('No more fake responses configured')
    if ('throws' in next) throw next.throws
    return next
  }) as typeof fetch
  return { fetch: fakeFetch, calls }
}

function jsonResponse(status: number): Response {
  return new Response('{}', { status, headers: { 'content-type': 'application/json' } })
}

test('fetchWithRetry returns the first successful response without retrying', async () => {
  const { fetch, calls } = makeFakeFetch([jsonResponse(200)])
  const original = globalThis.fetch
  globalThis.fetch = fetch
  try {
    const response = await fetchWithRetry('/api/x')
    deepEqual(calls.map(call => call.attempt), [1])
    ok(response.ok)
  } finally {
    globalThis.fetch = original
  }
})

test('fetchWithRetry retries on network errors and returns the eventual response', async () => {
  const { fetch, calls } = makeFakeFetch([
    { throws: new TypeError('Failed to fetch') },
    { throws: new TypeError('Failed to fetch') },
    jsonResponse(200),
  ])
  const original = globalThis.fetch
  globalThis.fetch = fetch
  try {
    const response = await fetchWithRetry('/api/x', undefined, { delayMs: 0 })
    deepEqual(calls.map(call => call.attempt), [1, 2, 3])
    ok(response.ok)
  } finally {
    globalThis.fetch = original
  }
})

test('fetchWithRetry stops after maxAttempts and throws the last network error', async () => {
  const { fetch, calls } = makeFakeFetch([
    { throws: new TypeError('boom-1') },
    { throws: new TypeError('boom-2') },
    { throws: new TypeError('boom-3') },
  ])
  const original = globalThis.fetch
  globalThis.fetch = fetch
  try {
    await rejects(
      fetchWithRetry('/api/x', undefined, { maxAttempts: 3, delayMs: 0 }),
      (error: unknown) => error instanceof Error && error.message === 'boom-3',
    )
    deepEqual(calls.map(call => call.attempt), [1, 2, 3])
  } finally {
    globalThis.fetch = original
  }
})

test('fetchWithRetry returns the last failed response when shouldRetry always returns true', async () => {
  const { fetch, calls } = makeFakeFetch([jsonResponse(500), jsonResponse(503), jsonResponse(504)])
  const original = globalThis.fetch
  globalThis.fetch = fetch
  try {
    const response = await fetchWithRetry('/api/x', undefined, { maxAttempts: 3, delayMs: 0 })
    deepEqual(calls.map(call => call.attempt), [1, 2, 3])
    deepEqual([response.status], [504])
  } finally {
    globalThis.fetch = original
  }
})

test('fetchWithRetry does not retry when shouldRetry returns false on a non-2xx response', async () => {
  const { fetch, calls } = makeFakeFetch([jsonResponse(400)])
  const original = globalThis.fetch
  globalThis.fetch = fetch
  try {
    const response = await fetchWithRetry(
      '/api/x',
      undefined,
      { maxAttempts: 5, delayMs: 0, shouldRetry: () => false },
    )
    deepEqual(calls.map(call => call.attempt), [1])
    deepEqual([response.status], [400])
  } finally {
    globalThis.fetch = original
  }
})

test('fetchWithRetry wraps a non-Error throw in a generic Error after maxAttempts', async () => {
  // last thrown value is a string, not an Error instance, so the
  // `lastError instanceof Error` branch must take the `new Error(...)` fallback.
  const { fetch, calls } = makeFakeFetch([{ throws: 'plain-string-failure' }])
  const original = globalThis.fetch
  globalThis.fetch = fetch
  try {
    await rejects(
      fetchWithRetry('/api/x', undefined, { maxAttempts: 1, delayMs: 0 }),
      (error: unknown) =>
        error instanceof Error &&
        error.message === 'fetchWithRetry failed without a response',
    )
    deepEqual(calls.map(call => call.attempt), [1])
  } finally {
    globalThis.fetch = original
  }
})

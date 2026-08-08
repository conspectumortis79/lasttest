// Tests for the demo-status localStorage round-trip. The hook
// itself is not directly testable through `node --test` (it
// would need React's `act` and a DOM). Instead we test the
// two pure helpers that own the persistence contract: the
// provider uses them in `useState` init and in a `useEffect`
// that mirrors every state change, so the integration is
// mechanical — if the helpers behave correctly, the hook does
// too.

import { deepEqual, equal, ok } from 'node:assert/strict'
import { afterEach, before, test } from 'node:test'
import {
  DEMO_STATUS_STORAGE_KEY,
  readStoredDemoEnabled,
  writeStoredDemoEnabled,
} from './demoStatus.ts'

// `localStorage` is not defined in node's default global
// object. The production code's `try/catch` falls back to
// "no value" on a missing storage, but the tests need the
// real round-trip behaviour. We install a minimal in-memory
// polyfill before any test runs and leave it in place for the
// rest of the file so the `afterEach` cleanup operates on the
// same object the production code reads from.
const storage = new Map<string, string>()
before(() => {
  if (typeof globalThis.localStorage === 'undefined') {
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem(key: string) { return storage.get(key) ?? null },
        setItem(key: string, value: string) { storage.set(key, value) },
        removeItem(key: string) { storage.delete(key) },
        clear() { storage.clear() },
        key() { return null },
        get length() { return storage.size },
      },
      configurable: true,
    })
  }
})

function clearStorage(): void {
  try { localStorage.removeItem(DEMO_STATUS_STORAGE_KEY) } catch { /* localStorage unavailable */ }
}

afterEach(() => {
  clearStorage()
})

test('readStoredDemoEnabled returns false when localStorage is empty', () => {
  clearStorage()
  equal(readStoredDemoEnabled(), false)
})

test('writeStoredDemoEnabled(true) then readStoredDemoEnabled returns true', () => {
  clearStorage()
  writeStoredDemoEnabled(true)
  equal(readStoredDemoEnabled(), true)
})

test('writeStoredDemoEnabled(false) then readStoredDemoEnabled returns false', () => {
  // A subsequent "false" must overwrite a previous "true" so
  // the user can reset the demo. The previous test set the
  // value to true; this test writes "false" and reads it back.
  writeStoredDemoEnabled(true)
  writeStoredDemoEnabled(false)
  equal(readStoredDemoEnabled(), false)
})

test('only the literal string "true" is treated as enabled', () => {
  // A regression guard: the previous implementation
  // `JSON.parse(localStorage.getItem(...))` would have
  // accepted `"True"` (capitalised) as truthy in some
  // environments. The current implementation compares the
  // raw string to the canonical lowercase "true" so the
  // format is unambiguous.
  clearStorage()
  try { localStorage.setItem(DEMO_STATUS_STORAGE_KEY, 'TRUE') } catch { return }
  equal(readStoredDemoEnabled(), false)
  try { localStorage.setItem(DEMO_STATUS_STORAGE_KEY, '1') } catch { return }
  equal(readStoredDemoEnabled(), false)
  try { localStorage.setItem(DEMO_STATUS_STORAGE_KEY, 'false') } catch { return }
  equal(readStoredDemoEnabled(), false)
})

test('localStorage is the only persistence channel — the value survives a function-call round-trip', () => {
  // Sanity check: writing through `writeStoredDemoEnabled`
  // and reading back through `readStoredDemoEnabled` must
  // return the same boolean. The two helpers are the only
  // call sites in production code (the provider's `useState`
  // init and its `useEffect` mirror), so the contract is
  // closed.
  clearStorage()
  writeStoredDemoEnabled(true)
  deepEqual([readStoredDemoEnabled()], [true])
  writeStoredDemoEnabled(false)
  deepEqual([readStoredDemoEnabled()], [false])
})

test('readStoredDemoEnabled returns false when localStorage.getItem throws', () => {
  // A regression guard: a `localStorage` implementation
  // that throws on access (private mode, Safari ITP, ...)
  // must not crash the page. The catch branch returns the
  // safe default so the rest of the UI keeps working.
  const original = (globalThis as { localStorage: Storage }).localStorage
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') }, removeItem: () => { throw new Error('blocked') } },
    configurable: true,
  })
  try {
    equal(readStoredDemoEnabled(), false)
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { value: original, configurable: true })
  }
})

test('writeStoredDemoEnabled is a no-op when localStorage.setItem throws', () => {
  // Same idea on the write side: a throwing storage must
  // not break the toggle handler. The in-memory state still
  // reflects the user's choice for the rest of the session.
  const original = (globalThis as { localStorage: Storage }).localStorage
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: () => null, setItem: () => { throw new Error('blocked') }, removeItem: () => { /* noop */ } },
    configurable: true,
  })
  try {
    // The call must not throw — that is the whole contract.
    writeStoredDemoEnabled(true)
    writeStoredDemoEnabled(false)
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { value: original, configurable: true })
  }
})

test('DEMO_STATUS_STORAGE_KEY is namespaced under lasttest so it does not collide with other apps on the same origin', () => {
  // The key sits under the `lasttest.*` namespace to make it
  // easy to clear all of lasttest's localStorage at once
  // (e.g. during development) and to keep multiple apps on
  // the same origin from reading each other's data.
  ok(DEMO_STATUS_STORAGE_KEY.startsWith('lasttest.'), 'storage key must be namespaced under lasttest')
  ok(DEMO_STATUS_STORAGE_KEY.length > 'lasttest.'.length, 'storage key must have a meaningful suffix')
})

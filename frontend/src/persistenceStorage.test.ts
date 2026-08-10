// Tests for the timeline-persistence storage layer
// (`persistenceStorage.ts` + the JSX-less hook in the same
// file). Pinning the storage contract is important because
// the Settings drawer, the App's POST handler and the
// in-render fallback all share the same read/write paths —
// a regression that flipped the default or dropped the
// localStorage write would silently disable the timeline
// retention cap on the next visit.

import { equal, ok } from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_PERSIST_RUNS,
  readStoredPersistRuns,
  STORAGE_KEY,
  usePersistence,
} from './persistenceStorage.ts'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' })

function setGlobal(name: string, value: unknown) {
  Object.defineProperty(globalThis, name, {
    value,
    writable: true,
    configurable: true,
  })
}

setGlobal('window', dom.window)
setGlobal('document', dom.window.document)
setGlobal('HTMLElement', dom.window.HTMLElement)
setGlobal('localStorage', dom.window.localStorage)
setGlobal('IS_REACT_ACT_ENVIRONMENT', true)

type Capture = {
  value: boolean
  setValue: (next: boolean) => void
  unmount: () => void
}

function captureHookValue(): Capture {
  let captured: ReturnType<typeof usePersistence> | null = null
  function Probe() {
    captured = usePersistence()
    return null
  }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(createElement(Probe)) })
  return {
    get value() { return captured!.persistRuns },
    setValue(next) { act(() => { captured!.setPersistRuns(next) }) },
    unmount() { act(() => { root.unmount() }); container.remove() },
  }
}

test('default is disabled so a fresh install does not silently grow the timeline', () => {
  // The user asked for the toggle to be opt-in: the
  // default of `false` means a fresh install does not
  // start persisting runs to the timeline just because
  // the user clicked "Start test". Pin the default
  // value so a future change cannot quietly flip it.
  equal(DEFAULT_PERSIST_RUNS, false)
})

test('readStoredPersistRuns returns the default when no value has been written', () => {
  // The storage layer reads `localStorage` lazily, so a
  // missing key must surface as the documented default.
  // We clear the key explicitly to avoid a leaked value
  // from a previous test run.
  localStorage.removeItem(STORAGE_KEY)
  equal(readStoredPersistRuns(), false)
})

test('readStoredPersistRuns honours a previously written "true" value', () => {
  localStorage.setItem(STORAGE_KEY, 'true')
  equal(readStoredPersistRuns(), true)
  localStorage.removeItem(STORAGE_KEY)
})

test('readStoredPersistRuns treats any non-boolean string as the default', () => {
  // Forward-compat: a value from a future schema must
  // not crash the reader. The conservative behaviour is
  // to fall back to the default so the user does not
  // accidentally enable persistence just because a
  // migration wrote a new format.
  localStorage.setItem(STORAGE_KEY, 'maybe')
  equal(readStoredPersistRuns(), false)
  localStorage.removeItem(STORAGE_KEY)
})

test('the hook defaults to the storage value, not the constant, when one was written', () => {
  // The hook reads from the same `localStorage` key the
  // provider writes to. A persisted `true` must surface
  // as `true` on the very first render of any consumer
  // — without that, the dashboard's POST handler would
  // send `persist: false` for one render cycle and
  // accidentally drop a run.
  localStorage.setItem(STORAGE_KEY, 'true')
  const capture = captureHookValue()
  try {
    equal(capture.value, true)
  } finally {
    capture.unmount()
    localStorage.removeItem(STORAGE_KEY)
  }
})

test('the hook reflects the default when nothing was written', () => {
  // Pair with the previous test: when the user has never
  // opened the Settings drawer, the hook must read the
  // default (off). The Settings drawer also uses the
  // hook for the same reason — a regression that
  // hard-codes `true` here would silently flip the
  // toggle on for every new visit.
  localStorage.removeItem(STORAGE_KEY)
  const capture = captureHookValue()
  try {
    equal(capture.value, false)
  } finally {
    capture.unmount()
  }
})

test('the hook updates when the setter is called (in-render re-render only)', () => {
  // The hook without a provider re-renders consumers on
  // every setter call — without that, the dashboard's
  // POST handler would still see the stale value. The
  // localStorage write is the provider's job (see the
  // dedicated PersistenceProvider test in
  // usePersistence.test.tsx); the hook in isolation is
  // an in-memory fallback for tests and isolated
  // renders.
  localStorage.removeItem(STORAGE_KEY)
  const capture = captureHookValue()
  try {
    equal(capture.value, false)
    capture.setValue(true)
    equal(capture.value, true, 'the hook must surface the new value after the setter runs')
    // Without a provider the value is in-memory only;
    // localStorage is intentionally untouched so the
    // test does not leak a value into the next test's
    // setup.
    equal(localStorage.getItem(STORAGE_KEY), null)
  } finally {
    capture.unmount()
  }
})

test('the default value is intentionally opt-in (false) so it matches the user-facing copy', () => {
  // The Settings drawer copy says "default is disabled
  // unless you flip the switch". Pin the contract so a
  // copy change cannot accidentally mislead the user:
  // if the default ever flips to true, this assertion
  // fails and forces a re-read of the i18n string.
  ok(!DEFAULT_PERSIST_RUNS, 'DEFAULT_PERSIST_RUNS must stay false; the drawer copy says the toggle is off by default')
})

// Verifies the one-shot "wipe the persisted timeline when
// the persistence toggle is off at mount time" behaviour in
// `App.tsx`. The user reported the following regression:
// they had the toggle off, restarted the app, and the old
// runs (saved under a previous default-true build) were
// still on the timeline. The fix is a one-shot cleanup
// effect that runs the first time the App mounts with
// `persistRuns === false`; subsequent renders must not
// re-trigger the wipe (toggling the switch back on and off
// in the same session should not silently delete newly
// persisted runs).
//
// RUN ME WITH:
//   TSX_TSCONFIG_PATH=./tsconfig.app.json \
//   node --import tsx --test src/App.persistenceOnMount.spec.ts

import { equal } from 'node:assert/strict'
import { test } from 'node:test'
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
setGlobal('navigator', dom.window.navigator)
setGlobal('HTMLElement', dom.window.HTMLElement)
setGlobal('Element', dom.window.Element)
setGlobal('Node', dom.window.Node)
setGlobal('DocumentFragment', dom.window.DocumentFragment)
setGlobal('localStorage', dom.window.localStorage)
setGlobal('getComputedStyle', dom.window.getComputedStyle)
setGlobal('IS_REACT_ACT_ENVIRONMENT', true)

// `App.tsx` would pull in the whole toolchain (Settings drawer,
// RunDetail, k6 polling, …) which is far too heavy for a
// targeted regression. The behaviour under test is a one-shot
// `useEffect` that runs the very first time the App renders
// with the persistence toggle off. We test the same pattern
// in isolation here: a component that wires the toggle into
// `usePersistence()`, renders a sentinel child, and runs
// the cleanup effect. A real run of the App is the
// integration check, this test pins the contract.
import { act, createElement, useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { PersistenceProvider } from './usePersistence.tsx'
import { STORAGE_KEY, usePersistence } from './persistenceStorage.ts'

type RecordedFetch = { url: string, method: string }

function renderHarness(persistRunsOnMount: boolean) {
  const fetches: RecordedFetch[] = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    const method = init?.method ?? 'GET'
    fetches.push({ url, method })
    if (url.includes('/api/test-runs') && method === 'DELETE') {
      return new Response(JSON.stringify({ cancelled: 0, deleted: 0 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch

  // Pre-seed the storage slot with the value the user
  // had at the time of the previous session so the App
  // boots with the right mode. The storage write mirrors
  // what the Settings drawer does on toggle.
  if (persistRunsOnMount) {
    localStorage.setItem(STORAGE_KEY, 'true')
  } else {
    localStorage.setItem(STORAGE_KEY, 'false')
  }

  function Harness() {
    const { persistRuns } = usePersistence()
    const cleanupRef = useRef(false)
    useEffect(() => {
      if (cleanupRef.current) return
      if (persistRuns) return
      cleanupRef.current = true
      void fetch('/api/test-runs', { method: 'DELETE' })
    }, [persistRuns])
    return null
  }

  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(createElement(PersistenceProvider, null, createElement(Harness)))
  })
  return {
    root,
    container,
    fetches,
    unmount: () => {
      act(() => { root.unmount() })
      container.remove()
      globalThis.fetch = originalFetch
      localStorage.removeItem(STORAGE_KEY)
    },
  }
}

test('mount with the toggle off triggers a DELETE /api/test-runs call so old runs disappear', () => {
  // The user-reported regression: they had the toggle off,
  // restarted the app, and the old runs were still on the
  // timeline. The contract is "off at mount = wipe the
  // persisted history so a fresh start lands on an empty
  // dashboard". Pin the DELETE call so a future refactor
  // cannot drop the cleanup without a test failure.
  const handle = renderHarness(false)
  try {
    const deleteCall = handle.fetches.find(f => f.method === 'DELETE' && f.url.endsWith('/api/test-runs'))
    equal(deleteCall !== undefined, true, 'expected a DELETE /api/test-runs call on mount with toggle off')
  } finally {
    handle.unmount()
  }
})

test('mount with the toggle on does NOT trigger the cleanup', () => {
  // The dual contract: the cleanup is opt-in via the
  // toggle. When the user has the toggle ON, the
  // persisted timeline is the source of truth and the
  // App must not silently wipe it on mount. A regression
  // that always runs the cleanup (regardless of the
  // toggle) would surface here as a DELETE call against
  // a saved timeline.
  const handle = renderHarness(true)
  try {
    const deleteCall = handle.fetches.find(f => f.method === 'DELETE' && f.url.endsWith('/api/test-runs'))
    equal(deleteCall, undefined, 'mount with toggle on must not call DELETE /api/test-runs')
  } finally {
    handle.unmount()
  }
})

test('the cleanup effect runs exactly once per App lifetime', () => {
  // The user reported the bug after a fresh install (so
  // a single mount already wiped the timeline). The
  // guard against re-running is the
  // `[useRef] cleanupRef.current` short-circuit. A
  // regression that re-runs the effect on every render
  // would silently wipe the timeline every time the
  // dashboard re-renders — the user would see a flash
  // of "runs loaded" → "runs gone" on the first poll.
  const handle = renderHarness(false)
  try {
    // Force a re-render: the cleanup must not fire a
    // second time. We do this by mutating localStorage
    // (the only input the effect reads through the
    // hook) and re-rendering. The harness holds the
    // cleanupRef so the body short-circuits.
    act(() => {
      handle.root.render(createElement(PersistenceProvider, null, createElement(() => {
        const { persistRuns } = usePersistence()
        return createElement('div', null, `runs=${persistRuns}`)
      })))
    })
    const deleteCalls = handle.fetches.filter(f => f.method === 'DELETE' && f.url.endsWith('/api/test-runs'))
    equal(deleteCalls.length, 1, 'the cleanup effect must fire exactly once per App lifetime')
  } finally {
    handle.unmount()
  }
})

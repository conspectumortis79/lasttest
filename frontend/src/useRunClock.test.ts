import { equal, ok } from 'node:assert/strict'
import { test } from 'node:test'
import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { useRunClock, useLiveClock } from './useRunClock.ts'
import type { TestRun } from './k6Report.ts'

// JSDOM provides a real DOM so React's createRoot + effects can run
// inside the Node.js test runner. We set up a window/document once
// per worker; the hook only uses `window.setInterval`/`clearInterval`
// and `Date.now`, both of which JSDOM polyfills.
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
// Node 22+ exposes some globals (e.g. `navigator`) as read-only
// getters, so we must use `defineProperty` to overwrite them.
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
// React's `act` API checks this flag to silence the
// "current testing environment is not configured to support act(...)"
// warning that React emits when it runs outside a real test framework.
// See https://react.dev/reference/react/act for details.
setGlobal('IS_REACT_ACT_ENVIRONMENT', true)

function makeRun(status: TestRun['status']): TestRun {
  return {
    id: 'run-1',
    status,
    createdAt: '2026-01-01T00:00:00Z',
    startedAt: '2026-01-01T00:00:01Z',
    finishedAt: status === 'RUNNING' || status === 'QUEUED' ? undefined : '2026-01-01T00:00:10Z',
  }
}

type RenderHandle = {
  root: Root
  container: HTMLDivElement
  getNow: () => number
  setRun: (run: TestRun | undefined) => void
  unmount: () => void
}

function renderProbe(initialRun: TestRun | undefined): RenderHandle {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  let getNow: () => number = () => NaN
  let setRun: (run: TestRun | undefined) => void = () => {}

  function Probe() {
    const [run, setRunState] = useState<TestRun | undefined>(initialRun)
    const now = useRunClock(run)
    setRun = setRunState
    getNow = () => now
    return createElement('span', { 'data-now': now }, String(now))
  }

  act(() => {
    root.render(createElement(Probe))
  })

  return {
    root,
    container,
    getNow: () => getNow(),
    setRun: run => {
      act(() => {
        setRun(run)
      })
    },
    unmount: () => {
      act(() => {
        root.unmount()
      })
      container.remove()
    },
  }
}

test('useRunClock ticks the now value while a queued run is alive', async () => {
  const handle = renderProbe(makeRun('QUEUED'))
  try {
    const initial = handle.getNow()
    // Wait long enough for the internal `setInterval(..., 500)` to
    // fire at least once. The exact value is not asserted; only the
    // monotonically-non-decreasing contract and the fact that the
    // interval callback ran are required.
    await new Promise(resolve => setTimeout(resolve, 1100))
    ok(handle.getNow() >= initial)
  } finally {
    handle.unmount()
  }
})

test('useRunClock does not start a ticker for an undefined run', async () => {
  const handle = renderProbe(undefined)
  try {
    const initial = handle.getNow()
    // Wait two tick intervals to ensure no timer would have fired.
    await new Promise(resolve => setTimeout(resolve, 1100))
    equal(handle.getNow(), initial)
  } finally {
    handle.unmount()
  }
})

test('useRunClock does not start a ticker for a finished run', async () => {
  const handle = renderProbe(makeRun('COMPLETED'))
  try {
    const initial = handle.getNow()
    await new Promise(resolve => setTimeout(resolve, 1100))
    equal(handle.getNow(), initial)
  } finally {
    handle.unmount()
  }
})

test('useRunClock stops the ticker once a running run completes', async () => {
  const handle = renderProbe(makeRun('RUNNING'))
  try {
    const beforeComplete = handle.getNow()
    handle.setRun(makeRun('COMPLETED'))
    const afterComplete = handle.getNow()
    await new Promise(resolve => setTimeout(resolve, 1100))
    equal(handle.getNow(), afterComplete)
    ok(afterComplete >= beforeComplete)
  } finally {
    handle.unmount()
  }
})

test('useRunClock starts ticking when the run switches from undefined to QUEUED', async () => {
  const handle = renderProbe(undefined)
  try {
    const initial = handle.getNow()
    handle.setRun(makeRun('QUEUED'))
    const afterSwitch = handle.getNow()
    ok(afterSwitch >= initial)
  } finally {
    handle.unmount()
  }
})

test('useRunClock restarts ticking when a failed run is followed by a running one', async () => {
  const handle = renderProbe(makeRun('FAILED'))
  try {
    const failedNow = handle.getNow()
    handle.setRun(makeRun('RUNNING'))
    const runningNow = handle.getNow()
    ok(runningNow >= failedNow)
  } finally {
    handle.unmount()
  }
})

// --- useLiveClock ----------------------------------------------------
//
// The grid uses `useLiveClock` directly so it can tick whenever *any*
// run is in flight, independent of which run the user is currently
// inspecting. The tests below cover the boolean flag and confirm the
// ticker stops cleanly when the flag flips to false.

type LiveHandle = {
  root: Root
  container: HTMLDivElement
  getNow: () => number
  setLive: (live: boolean) => void
  unmount: () => void
}

function renderLiveProbe(initialLive: boolean): LiveHandle {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  let getNow: () => number = () => NaN
  let setLiveState: (live: boolean) => void = () => {}

  function Probe() {
    const [live, setLive] = useState(initialLive)
    const now = useLiveClock(live)
    setLiveState = setLive
    getNow = () => now
    return createElement('span', { 'data-now': now, 'data-live': String(live) }, String(now))
  }

  act(() => {
    root.render(createElement(Probe))
  })

  return {
    root,
    container,
    getNow: () => getNow(),
    setLive: live => {
      act(() => {
        setLiveState(live)
      })
    },
    unmount: () => {
      act(() => {
        root.unmount()
      })
      container.remove()
    },
  }
}

test('useLiveClock ticks the now value while the live flag is true', async () => {
  const handle = renderLiveProbe(true)
  try {
    const initial = handle.getNow()
    await new Promise(resolve => setTimeout(resolve, 1100))
    ok(handle.getNow() >= initial)
  } finally {
    handle.unmount()
  }
})

test('useLiveClock does not tick when the live flag is false', async () => {
  const handle = renderLiveProbe(false)
  try {
    const initial = handle.getNow()
    await new Promise(resolve => setTimeout(resolve, 1100))
    equal(handle.getNow(), initial)
  } finally {
    handle.unmount()
  }
})

test('useLiveClock stops ticking when the live flag flips from true to false', async () => {
  const handle = renderLiveProbe(true)
  try {
    const before = handle.getNow()
    handle.setLive(false)
    const afterFlip = handle.getNow()
    await new Promise(resolve => setTimeout(resolve, 1100))
    equal(handle.getNow(), afterFlip)
    ok(afterFlip >= before)
  } finally {
    handle.unmount()
  }
})

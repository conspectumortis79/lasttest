// Regression tests for the live ramp chart's "läuft seit" label.
//
// The chart used to render "läuft seit 00:00" while the run was
// still QUEUED — the parent component fell back to `Date.now()`
// when the run had no `startedAt` yet, so each 500 ms tick
// produced a near-zero elapsed duration that
// [formatDurationSeconds] formatted as "00:00". The user saw
// the text pop in and out as React re-rendered the ticker.
//
// The fix routes `elapsedSeconds: undefined` through to the
// chart when no real `startedAt` exists. The chart already
// rendered the value via [formatDurationSeconds], which returns
// "–" for undefined. These tests pin both halves of the new
// contract:
//
//   1. formatDurationSeconds(undefined) === "–"
//      — covered in k6Report.test.ts; restated here so the
//        regression search lands here.
//   2. LiveRampChart renders the "–" placeholder into the DOM
//      when elapsedSeconds is undefined, and never emits the
//      "00:00" string in that case.
//
// RUN ME WITH:
//   TSX_TSCONFIG_PATH=./tsconfig.app.json \
//   node --import tsx --test src/liveRampChartRender.spec.ts
//
// This file is named `.spec.ts` (not `.test.ts`) on purpose:
// the project's normal test command uses
// `node --experimental-strip-types --test src/*.test.ts`, which
// can only handle plain `.ts` imports. This file renders the
// `LiveRampChart` `.tsx` component, so it needs the `tsx`
// loader and the `app` tsconfig (which carries
// `jsx: "react-jsx"`). Mirrors the setup in
// `EndpointTimelineTab.selection.spec.ts`.

import { equal, ok } from 'node:assert/strict'
import { test } from 'node:test'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { LiveRampChart } from './runStatusView.tsx'
import { formatDurationSeconds } from './k6Report.ts'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')

// Node 22+ exposes some globals as read-only getters, so the
// helper has to use `defineProperty` to overwrite them. Mirrors
// the setup in `useRunClock.test.ts`.
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
setGlobal('HTMLElement', dom.window.HTMElement)
setGlobal('Element', dom.window.Element)
setGlobal('Node', dom.window.Node)
setGlobal('DocumentFragment', dom.window.DocumentFragment)
// React's `act` checks this flag and silences the "current
// testing environment is not configured to support act(...)"
// warning when run outside a real test framework.
setGlobal('IS_REACT_ACT_ENVIRONMENT', true)

type RenderHandle = { root: Root, container: HTMLDivElement, unmount: () => void }

function renderChart(props: { elapsedSeconds: number | undefined }): RenderHandle {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  // `useLanguage` has a defensive fallback for renders without
  // a `<LanguageProvider>` (see `languageStorage.ts`), so the
  // chart can mount in this isolated JSDOM harness without any
  // extra wrapping. The render is wrapped in `act()` so React's
  // state updates commit before we read the rendered HTML.
  act(() => {
    root.render(createElement(LiveRampChart, {
      planned: [{ t: 0, planned: 1, actual: NaN }],
      actual: [],
      totalDurationSeconds: 30,
      elapsedSeconds: props.elapsedSeconds,
      targetValue: 1,
      unit: 'vus',
    }))
  })
  return {
    root,
    container,
    unmount: () => {
      act(() => {
        root.unmount()
      })
      container.remove()
    },
  }
}

test('formatDurationSeconds renders the dash placeholder for undefined', () => {
  // Re-stated from `k6Report.test.ts` so a regression search
  // for "läuft seit 00:00" lands in this file too. The chart
  // relies on this exact behaviour: passing `undefined` down
  // must yield "–", not "00:00".
  equal(formatDurationSeconds(undefined), '–')
  equal(formatDurationSeconds(0), '00:00')
})

test('LiveRampChart shows the dash placeholder while elapsedSeconds is undefined', () => {
  // The pre-fix bug: when the parent falls back to `Date.now()`
  // for a QUEUED run, the chart receives an elapsed duration of
  // ~0 and renders "läuft seit 00:00". The fix is to forward
  // `undefined` instead. Assert both halves here:
  //   • the rendered DOM contains the "–" placeholder, and
  //   • the rendered DOM does NOT contain the old "00:00" text.
  const handle = renderChart({ elapsedSeconds: undefined })
  try {
    const html = handle.container.innerHTML
    ok(html.includes('–'), `expected the dash placeholder in the rendered chart, got: ${html}`)
    ok(!/00:00/.test(html), `did not expect "00:00" in the rendered chart, got: ${html}`)
  } finally {
    handle.unmount()
  }
})

test('LiveRampChart renders the formatted duration once the run has started', () => {
  // After [run.startedAt] is populated, the parent forwards a
  // real number. The chart keeps the same shape so callers do
  // not have to special-case the transition. Five seconds is
  // "00:05"; we assert both the formatted value and the
  // absence of the dash so a regression that reverts to "–"
  // surfaces here as well.
  const handle = renderChart({ elapsedSeconds: 5 })
  try {
    const html = handle.container.innerHTML
    ok(html.includes('00:05'), `expected "00:05" in the rendered chart, got: ${html}`)
  } finally {
    handle.unmount()
  }
})

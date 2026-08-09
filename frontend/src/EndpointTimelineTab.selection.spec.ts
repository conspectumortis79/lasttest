// Behavioural tests for the run-list highlight in
// [EndpointTimelineTab].
//
// RUN ME WITH:
//   TSX_TSCONFIG_PATH=./tsconfig.app.json \
//   node --import tsx --test src/EndpointTimelineTab.selection.spec.ts
//
// The test file is named `.spec.ts` (not `.test.ts`) on
// purpose: the project's normal test command uses
// `node --experimental-strip-types --test src/*.test.ts`,
// which can only handle `.ts` imports. This test renders the
// `EndpointTimelineTab` `.tsx` component, so it needs the
// `tsx` loader and the `app` tsconfig (which carries
// `jsx: "react-jsx"`). Keeping it out of the default glob
// avoids breaking the standard `npm test` run.
//
// The three tests below pin the bug the user reported: with
// four historical runs visible in the timeline, clicking a
// different list item must move the highlight (and ONLY the
// highlight) to the clicked item — the previously-active run
// must drop its highlight.
//
// The user reported: "bei 4 testläufe unter timeline, verhätl
// sich das klicken eines vergangenen badges unvorhersehbar,
// manchmal bleibt eins dauerhaft ausgewählt und wenn ich einen
// anderen lasttest badge dort auswählen will von vielen dann
// sind der bereits markierte und mein markierter ausgewählt".
//
// Root cause (see the two `className` expressions inside
// [EndpointTimelineTab.tsx] for the Gantt bar and the list
// item, plus the `pin` `<span>` inside the list item): the
// `is-selected` class was added when EITHER the run matched
// the parent-owned `selectedRunId` (the "active" run) OR its
// `createdAt` matched the in-tab `centerTs` (the "focused"
// run). When the user clicks a *different* list item in the
// timeline, only `centerTs` changes — `selectedRunId` stays
// on the previously-active run — so both conditions are true
// at once on two different runs. The timeline then highlights
// BOTH the active run and the clicked one, which is exactly
// what the user describes.
//
// The fix is to make the highlight a function of the *focus*
// only: the timeline is a navigation surface, not a
// selection surface. The active run is already painted in
// the run-grid above. The tests below pin both halves of
// that contract — initial state (focus == active) and
// post-click state (focus moves, only the new focus is
// highlighted).

import { deepEqual, equal, ok } from 'node:assert/strict'
import { test } from 'node:test'
import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { EndpointTimelineTab, type EndpointTimelineProps } from './EndpointTimelineTab.tsx'
import { LanguageContext } from './languageStorage.ts'
import type { TestRun } from './k6Report.ts'
import type { RunActionHandlers } from './runActionHandlers.ts'

// JSDOM gives us a real DOM so React's createRoot + effects
// (the timeline's own `fetch` + the parent-driven `focusRun`
// effect) can run inside the Node test runner.
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
})

// Node 22+ exposes some globals (e.g. `navigator`) as
// read-only getters, so we must use `defineProperty` to
// overwrite them.
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
setGlobal('Element', dom.window.Element)
setGlobal('Node', dom.window.Node)
setGlobal('localStorage', dom.window.localStorage)
setGlobal('getComputedStyle', dom.window.getComputedStyle)
// Tell React this is a test environment so `act` does not
// warn. See https://react.dev/reference/react/act.
setGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const HANDLERS: RunActionHandlers = {
  onFocusRun: () => {},
  onStop: () => {},
  onRerun: () => {},
  onCopyRunId: () => {},
  onCopyReportLink: () => {},
  onOpenReport: () => {},
  onDownloadScript: () => {},
  onExportMetrics: () => {},
  onRemove: () => {},
  onRemoveAllOtherFailed: () => {},
}

// Four historical runs at well-separated timestamps so the
// `± 1000 ms` "focused run" match in [EndpointTimelineTab]
// never accidentally hits two runs at once (the timestamps
// are minutes apart). The shape is the minimum
// [EndpointTimelineTab] needs to render the list and the
// Gantt: `id`, `status`, `createdAt` and a configuration
// (otherwise the configuration-backed helpers bail out).
function makeRuns(statuses: Partial<Record<string, TestRun['status']>> = {}): TestRun[] {
  return [
    { id: 'run-A', status: statuses['run-A'] ?? 'COMPLETED', createdAt: '2026-01-01T10:00:00Z', configuration: { apiTitle: 't', apiVersion: '1', baseUrl: 'http://x', loadProfile: { type: 'constant-vus', virtualUsers: 1, durationSeconds: 1 }, operations: [] } },
    { id: 'run-B', status: statuses['run-B'] ?? 'COMPLETED', createdAt: '2026-01-01T11:00:00Z', configuration: { apiTitle: 't', apiVersion: '1', baseUrl: 'http://x', loadProfile: { type: 'constant-vus', virtualUsers: 1, durationSeconds: 1 }, operations: [] } },
    { id: 'run-C', status: statuses['run-C'] ?? 'COMPLETED', createdAt: '2026-01-01T12:00:00Z', configuration: { apiTitle: 't', apiVersion: '1', baseUrl: 'http://x', loadProfile: { type: 'constant-vus', virtualUsers: 1, durationSeconds: 1 }, operations: [] } },
    { id: 'run-D', status: statuses['run-D'] ?? 'COMPLETED', createdAt: '2026-01-01T13:00:00Z', configuration: { apiTitle: 't', apiVersion: '1', baseUrl: 'http://x', loadProfile: { type: 'constant-vus', virtualUsers: 1, durationSeconds: 1 }, operations: [] } },
  ]
}

type RenderHandle = {
  root: Root
  container: HTMLDivElement
  queryListItems: () => Element[]
  waitForRuns: () => Promise<void>
  clickListItem: (runId: string) => void
  rightClickListItem: (runId: string) => void
  clickMenuItem: (label: string) => void
  listIds: () => string[]
  selectedIds: () => string[]
  relativeTimesByItem: () => Map<string, string>
  unmount: () => void
}

function renderTimeline(
  activeRunId: string,
  focusRunCreatedAt: string | null,
  handlers: RunActionHandlers = HANDLERS,
  timelineRuns: TestRun[] = makeRuns(),
): RenderHandle {
  const runs = timelineRuns
  const runsMap: Record<string, TestRun> = {}
  for (const run of runs) runsMap[run.id] = run

  // The component fetches `/api/operations/runs?...` on
  // mount. We return the same runs the parent owns so the
  // Gantt + list have something to render. Reset the
  // spy between tests so call counts do not leak.
  const originalFetch = globalThis.fetch
  let fetchCalls = 0
  globalThis.fetch = (async (_input: RequestInfo | URL) => {
    fetchCalls += 1
    return new Response(JSON.stringify(runs), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch

  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  // The component re-renders when the parent changes
  // `focusRunCreatedAt`. We keep the latest value in a ref
  // and re-render the whole tree on demand so the test can
  // simulate "parent swapped the active run" without having
  // to rebuild the React tree by hand.
  let setFocus: (next: string | null) => void = () => {}
  let currentFocus = focusRunCreatedAt
  function Wrapper() {
    const [focus, setFocusState] = useState<string | null>(focusRunCreatedAt)
    setFocus = setFocusState
    currentFocus = focus
    const props: EndpointTimelineProps = {
      method: 'GET',
      path: '/things',
      selectedRunId: activeRunId,
      focusRunCreatedAt: focus,
      handlers: handlers,
      runs: runsMap,
    }
    return createElement(LanguageContext.Provider, { value: { language: 'en', setLanguage: () => {} } }, createElement(EndpointTimelineTab, props))
  }

  act(() => {
    root.render(createElement(Wrapper))
  })

  function queryListItems(): Element[] {
    return Array.from(container.querySelectorAll('.timeline-tab-list-item'))
  }

  function listIds(): string[] {
    return queryListItems()
      .map(el => el.getAttribute('data-run-id'))
      .filter((value): value is string => value !== null)
  }

  function selectedIds(): string[] {
    return queryListItems()
      .filter(el => el.classList.contains('is-selected'))
      .map(el => el.getAttribute('data-run-id'))
      .filter((value): value is string => value !== null)
  }

  function relativeTimesByItem(): Map<string, string> {
    // Read the relative-time stamp (.rel) and the absolute
    // timestamp (.abs) for every list item so the regression
    // tests below can pin the exact contract: the relative
    // stamp must always be computed against `Date.now()`,
    // never against the in-tab focus, and the absolute stamp
    // must always reflect the run's `createdAt` regardless
    // of any state. Returning the data-run-id alongside the
    // text keeps the failure messages actionable when a
    // future change regresses either invariant.
    const result = new Map<string, string>()
    for (const el of queryListItems()) {
      const id = el.getAttribute('data-run-id')
      if (id == null) continue
      const rel = el.querySelector('.rel')?.textContent ?? ''
      const abs = el.querySelector('.abs')?.textContent ?? ''
      result.set(id, `${rel}|${abs}`)
    }
    return result
  }

  return {
    root,
    container,
    queryListItems,
    // Wait for the timeline's own `fetch` to complete and
    // for React to commit the resulting state. The component
    // fetches `/api/operations/runs?...` on mount; without
    // this flush the list is empty and the assertions below
    // fire before the Gantt + list have anything to render.
    async waitForRuns(): Promise<void> {
      for (let attempt = 0; attempt < 50; attempt++) {
        await act(async () => {
          await new Promise(resolve => setTimeout(resolve, 20))
        })
        if (queryListItems().length > 0) return
      }
    },
    clickListItem(runId: string) {
      const target = queryListItems().find(el => el.getAttribute('data-run-id') === runId)
      ok(target, `expected to find a list item for ${runId}`)
      act(() => {
        target!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
      })
    },
    rightClickListItem(runId: string) {
      const target = queryListItems().find(el => el.getAttribute('data-run-id') === runId)
      ok(target, `expected to find a list item for ${runId}`)
      act(() => {
        target!.dispatchEvent(new dom.window.MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: 100,
          clientY: 100,
        }))
      })
      ok(container.querySelector('.run-context-menu'), 'expected the run context menu to open')
    },
    clickMenuItem(label: string) {
      const target = Array.from(container.querySelectorAll<HTMLButtonElement>('.run-context-menu-item'))
        .find(item => item.textContent?.includes(label))
      ok(target, `expected to find the context-menu item "${label}"`)
      equal(target!.disabled, false, `expected the context-menu item "${label}" to be enabled`)
      act(() => {
        target!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
      })
    },
    listIds,
    selectedIds,
    relativeTimesByItem,
    unmount() {
      act(() => {
        root.unmount()
      })
      container.remove()
      globalThis.fetch = originalFetch
      // Keep `fetchCalls` in scope so the test can assert on
      // it without a `globalThis` lookup. It is a deliberate
      // no-op otherwise.
      void fetchCalls
    },
    // Expose the focus setter so tests can simulate the
    // parent swapping the active run.
    __setFocus: setFocus,
    __getFocus: () => currentFocus,
  } as RenderHandle & { __setFocus: (next: string | null) => void, __getFocus: () => string | null }
}

test('initial state: only the active run is highlighted in the timeline list', async () => {
  const handle = renderTimeline('run-A', '2026-01-01T10:00:00Z')
  try {
    await handle.waitForRuns()
    const items = handle.queryListItems()
    equal(items.length, 4, 'expected four list items for the four runs')
    deepEqual(handle.selectedIds(), ['run-A'])
  } finally {
    handle.unmount()
  }
})

test('clicking a different list item moves the highlight and clears the old one', async () => {
  // The regression the user reported. `run-A` is the active
  // run; the user clicks `run-C` in the timeline list. The
  // highlight must move from `run-A` to `run-C` — it must
  // NOT stay on `run-A` as well.
  const handle = renderTimeline('run-A', '2026-01-01T10:00:00Z')
  try {
    await handle.waitForRuns()
    // Sanity check the initial state.
    deepEqual(handle.selectedIds(), ['run-A'])
    handle.clickListItem('run-C')
    deepEqual(handle.selectedIds(), ['run-C'], 'expected the highlight to follow the focus')
    // Click yet another one to make sure the move is
    // repeatable — the user said "letzter badge" stays
    // selected sometimes, which sounds like a one-way
    // transition that gets stuck.
    handle.clickListItem('run-D')
    deepEqual(handle.selectedIds(), ['run-D'])
    handle.clickListItem('run-B')
    deepEqual(handle.selectedIds(), ['run-B'])
  } finally {
    handle.unmount()
  }
})

test('switching the active run from the parent re-highlights the new active run', async () => {
  // The parent owns `selectedRunId` AND `focusRunCreatedAt`.
  // When the parent swaps both at once (e.g. the user picks
  // a different badge in the run-grid), the highlight must
  // follow the new active run. This is the case the OR
  // originally tried to cover — we keep the contract, but
  // pin it to a single run.
  const handle = renderTimeline('run-A', '2026-01-01T10:00:00Z')
  try {
    await handle.waitForRuns()
    deepEqual(handle.selectedIds(), ['run-A'])
    // The user clicks `run-C` first, then picks `run-B` from
    // the run-grid. The highlight must follow the run-grid
    // pick (because the parent pushes B's `createdAt` into
    // `focusRunCreatedAt`), and the previously-clicked
    // `run-C` must lose the highlight.
    handle.clickListItem('run-C')
    deepEqual(handle.selectedIds(), ['run-C'])
    act(() => {
      ;(handle as RenderHandle & { __setFocus: (n: string | null) => void }).__setFocus('2026-01-01T11:00:00Z')
    })
    deepEqual(handle.selectedIds(), ['run-B'])
  } finally {
    handle.unmount()
  }
})

test('clicking a past run never turns another past run into "just now"', async () => {
  // Regression test for the bug the user reported in
  // `aa.png`: clicking a past run made the relative-time
  // stamp on OTHER past runs change to "just now" because
  // the list item computed the relative diff against the
  // *focused* run's `centerTs` instead of the actual
  // `Date.now()`. The relative time must always reflect the
  // wall-clock distance from `now`, never from a clicked
  // ancestor — otherwise the dashboard looks like every run
  // happened seconds ago the moment the user picks one.
  //
  // The fixture timestamps are from 2026-01-01 (months/years
  // before the test runs in 2026+), so every run is
  // guaranteed to be far enough in the past that the only
  // way an item can read "just now" is if the formatter is
  // mis-using the focus anchor as its "now" input. We centre
  // the window on `run-C`'s timestamp so all four runs fall
  // inside the default 7-day slice.
  const handle = renderTimeline('run-A', '2026-01-01T12:00:00Z')
  try {
    await handle.waitForRuns()
    // Sanity check: before any click, no item should read
    // "just now" because every run is at least hours old.
    const before = handle.relativeTimesByItem()
    for (const [id, payload] of before) {
      const rel = payload.split('|')[0] ?? ''
      ok(!/just now/i.test(rel), `pre-click: ${id} should not say "just now", got "${rel}"`)
    }
    // Click a past run — this is the action that triggered
    // the original bug. With the buggy code, `relativeWhen`
    // received `centerTs` (= 12:00) as its "now" and so
    // surfaced "just now" for the focused run itself (diff=0)
    // and for any run inside the same 45-second bucket as
    // the focused timestamp.
    handle.clickListItem('run-C')
    const after = handle.relativeTimesByItem()
    for (const [id, payload] of after) {
      const rel = payload.split('|')[0] ?? ''
      ok(!/just now/i.test(rel), `post-click on run-C: ${id} should not say "just now", got "${rel}"`)
    }
    // The absolute stamp on every item must still match the
    // run's own `createdAt`, untouched by the focus shift.
    // This guards against a regression where someone tries
    // to "fix" the relative stamp by swapping to the
    // absolute stamp — both must stay correct.
    for (const run of makeRuns()) {
      const payload = after.get(run.id)
      ok(payload != null, `expected to find a list item for ${run.id}`)
      const abs = payload!.split('|')[1] ?? ''
      ok(abs.includes(run.id.slice(0, 8)), `${run.id}: expected absolute stamp to include the id, got "${abs}"`)
    }
  } finally {
    handle.unmount()
  }
})

test('remove from view hides the targeted run from the timeline and forwards the action', async () => {
  const removeCalls: string[] = []
  const handlers: RunActionHandlers = {
    ...HANDLERS,
    onRemove: runId => { removeCalls.push(runId) },
  }
  const handle = renderTimeline('run-C', '2026-01-01T12:00:00Z', handlers)
  try {
    await handle.waitForRuns()
    deepEqual(handle.listIds(), ['run-D', 'run-C', 'run-B', 'run-A'])

    handle.rightClickListItem('run-B')
    handle.clickMenuItem('Remove from view')

    deepEqual(removeCalls, ['run-B'])
    deepEqual(handle.listIds(), ['run-D', 'run-C', 'run-A'])
    equal(handle.container.querySelector('[data-run-id="run-B"]'), null)
  } finally {
    handle.unmount()
  }
})

test('remove all other failed hides failed timeline runs except the targeted run', async () => {
  const bulkRemoveCalls: string[] = []
  const handlers: RunActionHandlers = {
    ...HANDLERS,
    onRemoveAllOtherFailed: runId => { bulkRemoveCalls.push(runId) },
  }
  const runs = makeRuns({
    'run-A': 'FAILED',
    'run-B': 'FAILED',
    'run-C': 'COMPLETED',
    'run-D': 'STOPPED',
  })
  const handle = renderTimeline('run-C', '2026-01-01T12:00:00Z', handlers, runs)
  try {
    await handle.waitForRuns()

    handle.rightClickListItem('run-A')
    handle.clickMenuItem('Remove all other failed runs')

    deepEqual(bulkRemoveCalls, ['run-A'])
    deepEqual(handle.listIds(), ['run-D', 'run-C', 'run-A'])
    equal(handle.container.querySelector('[data-run-id="run-B"]'), null)
  } finally {
    handle.unmount()
  }
})

test('clicking a past run badge in the timeline list does NOT call onFocusRun', async () => {
  // Pin the design contract the user re-confirmed: a click
  // inside the timeline tab re-centres the chart (`setFocusedTs`)
  // but MUST NOT route the run id through `onFocusRun`.
  //
  // Why this matters: the timeline list is fed by an
  // independent fetch against `/api/operations/runs`, so the
  // runs it shows are not guaranteed to live in the parent's
  // `runs` map. Forwarding every click to `onFocusRun` would
  // hand the parent a run id it cannot resolve — `run` would
  // become `undefined` and the entire `RunDetail` would
  // disappear from the page, which is exactly the "Seite
  // springt weg" regression the user reported after the first
  // attempt wired `onFocusRun` into the click handler.
  //
  // The "configuration loads the correct id" requirement
  // still holds: it lives on the run-grid badges in the
  // Übersicht tab, which call `setActiveRunId(candidate.id)`
  // directly. The timeline tab is a navigation surface,
  // not a selection surface.
  const focusCalls: string[] = []
  const handlers: RunActionHandlers = {
    ...HANDLERS,
    onFocusRun: (runId: string) => { focusCalls.push(runId) },
  }
  const handle = renderTimeline('run-A', '2026-01-01T12:00:00Z', handlers)
  try {
    await handle.waitForRuns()
    deepEqual(focusCalls, [], 'no focus call before any click')
    handle.clickListItem('run-C')
    deepEqual(focusCalls, [], 'clicking run-C must NOT call onFocusRun — the timeline list is a navigation surface')
    handle.clickListItem('run-B')
    deepEqual(focusCalls, [], 'clicking run-B must NOT call onFocusRun either')
    handle.clickListItem('run-B')
    deepEqual(focusCalls, [], 're-clicking run-B must also stay silent onFocusRun')
  } finally {
    handle.unmount()
  }
})

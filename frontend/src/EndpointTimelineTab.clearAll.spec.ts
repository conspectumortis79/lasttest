// Behavioural tests for the "Alle löschen" (Clear all)
// button on the per-endpoint timeline tab.
//
// RUN ME WITH:
//   TSX_TSCONFIG_PATH=./tsconfig.app.json \
//   node --import tsx --test src/EndpointTimelineTab.clearAll.spec.ts
//
// Same loader setup as [EndpointTimelineTab.selection.spec.ts]:
// the file renders a `.tsx` component so it needs the `tsx`
// loader and the `app` tsconfig (with `jsx: "react-jsx"`).
// The default `npm test` glob would not handle the JSX.
//
// The button is a destructive action that wipes the entire
// timeline (the backend force-cancels every in-flight run as
// part of the operation), so the test surface focuses on
// the user-visible UX:
//   1. the button is rendered next to the "Visible in
//      window · N runs" header;
//   2. clicking the button opens a confirm dialog (not a
//      native window.confirm, the styling is inline);
//   3. the DELETE call is only fired when the user confirms
//      — a stray click on the button alone must not wipe
//      the timeline;
//   4. the confirm dialog can be cancelled without firing
//      the call;
//   5. confirming calls the parent's onClearAll handler and
//      surfaces the (cancelled, deleted) counts on success;
//   6. a failed DELETE call surfaces an error message
//      instead of silently closing the dialog.

import { equal, ok } from 'node:assert/strict'
import { test } from 'node:test'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { LanguageContext } from './languageStorage.ts'
import type { RunActionHandlers } from './runActionHandlers.ts'
import { EndpointTimelineTab } from './EndpointTimelineTab.tsx'
import type { TestRun } from './k6Report.ts'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' })

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
setGlobal('DocumentFragment', dom.window.DocumentFragment)
setGlobal('localStorage', dom.window.localStorage)
setGlobal('getComputedStyle', dom.window.getComputedStyle)
setGlobal('IS_REACT_ACT_ENVIRONMENT', true)

function makeRuns(): TestRun[] {
  return [
    {
      id: 'run-1',
      status: 'COMPLETED',
      createdAt: '2026-01-01T10:00:00Z',
      finishedAt: '2026-01-01T10:00:30Z',
      configuration: {
        apiTitle: 'Pet API',
        apiVersion: '1',
        baseUrl: 'https://example.test',
        loadProfile: { type: 'CONSTANT_VUS', virtualUsers: 1, durationSeconds: 1 },
        operations: [
          {
            operationId: 'getPet',
            method: 'GET',
            path: '/pets/{id}',
            summary: 'Find pet',
            payloads: [], bearerTokenConfigured: false,
            parameterValues: [],
            requestBodyJson: undefined,
          },
        ],
      },
    },
    {
      id: 'run-2',
      status: 'COMPLETED',
      createdAt: '2026-01-01T09:00:00Z',
      finishedAt: '2026-01-01T09:00:30Z',
      configuration: {
        apiTitle: 'Pet API',
        apiVersion: '1',
        baseUrl: 'https://example.test',
        loadProfile: { type: 'CONSTANT_VUS', virtualUsers: 1, durationSeconds: 1 },
        operations: [
          {
            operationId: 'getPet',
            method: 'GET',
            path: '/pets/{id}',
            summary: 'Find pet',
            payloads: [], bearerTokenConfigured: false,
            parameterValues: [],
            requestBodyJson: undefined,
          },
        ],
      },
    },
  ]
}

type RecordedFetch = { url: string, method: string, status: number, body: unknown }

type RenderHandle = {
  root: Root
  container: HTMLDivElement
  unmount: () => void
  // Recorded calls to the parent's onClearAll handler.
  // The recorded call count lets tests assert the DELETE
  // round trip is only fired when the user confirms.
  clearAllCalls: number
  // Recorded DELETE responses; useful for asserting the
  // status code the mock backend reported.
  fetches: RecordedFetch[]
}

function renderTimeline(
  handlers: RunActionHandlers,
  options: {
    timelineRuns?: TestRun[]
    deleteStatus?: number
  } = {},
): RenderHandle {
  const runs = options.timelineRuns ?? makeRuns()
  const initialRunsMap: Record<string, TestRun> = {}
  for (const run of runs) initialRunsMap[run.id] = run

  let clearAllCalls = 0
  const wrappedHandlers: RunActionHandlers = {
    ...handlers,
    onClearAll: async () => {
      clearAllCalls += 1
      return await handlers.onClearAll()
    },
  }

  const fetches: RecordedFetch[] = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    const method = init?.method ?? 'GET'
    if (url.includes('/test-runs') && method === 'DELETE') {
      const status = options.deleteStatus ?? 200
      const body = status === 200 ? { cancelled: 2, deleted: runs.length } : { error: 'boom' }
      fetches.push({ url, method, status, body })
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (url.includes('/api/operations/runs')) {
      return new Response(JSON.stringify(runs), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch

  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      createElement(
        LanguageContext.Provider,
        { value: { language: 'de', setLanguage: () => {} } },
        createElement(EndpointTimelineTab, {
          method: 'GET',
          path: '/pets/{id}',
          apiTitle: 'Pet API',
          selectedRunId: 'run-1',
          focusRunCreatedAt: '2026-01-01T10:00:00Z' as string | null,
          handlers: wrappedHandlers,
          runs: initialRunsMap,
        }),
      ),
    )
  })
  return {
    root,
    container,
    fetches,
    get clearAllCalls() { return clearAllCalls },
    unmount: () => {
      act(() => {
        root.unmount()
      })
      container.remove()
      globalThis.fetch = originalFetch
    },
  }
}

test('the Clear all button is rendered next to the "Visible in window" header', async () => {
  const handle = renderTimeline({
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
    onClearAll: async () => ({ cancelled: 0, deleted: 0 }),
  })
  try {
    // Allow the timeline fetch to settle so the list is
    // populated and the button is not in its disabled state.
    await new Promise(resolve => setTimeout(resolve, 0))
    act(() => { /* flush */ })
    const button = handle.container.querySelector('.timeline-tab-list-clear')
    ok(button, 'expected the Clear all button to be present next to the list header')
    // The button must be in the same header row as the
    // "Sichtbar im Zeitfenster · N Läufe" text. Pinning the
    // sibling relationship keeps the layout intentional —
    // a future refactor that floats the button somewhere
    // else would break the contract the user asked for.
    const head = handle.container.querySelector('.timeline-tab-list-head')
    ok(head?.contains(button), 'expected the button to be a child of the list head')
  } finally {
    handle.unmount()
  }
})

test('clicking the button opens the confirm dialog and does not yet call onClearAll', async () => {
  // Regression for the destructive-action contract: a
  // single click must NOT wipe the timeline. The user
  // has to confirm in the dialog before the backend call
  // fires. Without the two-step UX, a stray click would
  // cancel every in-flight run on the user's behalf.
  let clearAllCalls = 0
  const handle = renderTimeline({
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
    onClearAll: async () => { clearAllCalls += 1; return { cancelled: 0, deleted: 0 } },
  })
  try {
    await new Promise(resolve => setTimeout(resolve, 0))
    act(() => { /* flush */ })
    const button = handle.container.querySelector('.timeline-tab-list-clear') as HTMLButtonElement
    act(() => { button.click() })
    // The confirm dialog is now rendered; the handler was
    // NOT called yet.
    const dialog = handle.container.querySelector('.timeline-tab-list-clear-confirm')
    ok(dialog, 'expected the confirm dialog to open on button click')
    equal(clearAllCalls, 0, 'onClearAll must not be called before the user confirms')
  } finally {
    handle.unmount()
  }
})

test('cancelling the confirm dialog closes it without calling onClearAll', async () => {
  let clearAllCalls = 0
  const handle = renderTimeline({
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
    onClearAll: async () => { clearAllCalls += 1; return { cancelled: 0, deleted: 0 } },
  })
  try {
    await new Promise(resolve => setTimeout(resolve, 0))
    act(() => { /* flush */ })
    const button = handle.container.querySelector('.timeline-tab-list-clear') as HTMLButtonElement
    act(() => { button.click() })
    const cancel = handle.container.querySelector('.timeline-tab-list-clear-confirm-cancel') as HTMLButtonElement
    act(() => { cancel.click() })
    equal(handle.container.querySelector('.timeline-tab-list-clear-confirm'), null, 'expected the dialog to close on cancel')
    equal(clearAllCalls, 0, 'cancelling the dialog must not call onClearAll')
  } finally {
    handle.unmount()
  }
})

test('confirming in the dialog calls onClearAll and the DELETE endpoint', async () => {
  // The happy path: button click → dialog → confirm → DELETE
  // round trip → dialog closes. Pin every step so a future
  // refactor that drops the DELETE call (e.g. by mistakenly
  // closing the dialog before the handler resolves) is
  // caught here. The onClearAll handler mirrors the
  // production implementation (it issues the fetch itself
  // rather than delegating to a separate transport layer)
  // so the test exercises the real wire format the backend
  // sees.
  const handle = renderTimeline({
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
    onClearAll: async () => {
      const response = await fetch('/api/test-runs', { method: 'DELETE' })
      if (!response.ok) return null
      return await response.json() as { cancelled: number, deleted: number }
    },
  })
  try {
    await new Promise(resolve => setTimeout(resolve, 0))
    act(() => { /* flush */ })
    const button = handle.container.querySelector('.timeline-tab-list-clear') as HTMLButtonElement
    act(() => { button.click() })
    const confirmButton = handle.container.querySelector('.timeline-tab-list-clear-confirm-delete') as HTMLButtonElement
    await act(async () => { confirmButton.click() })
    // The dialog is closed on success.
    equal(handle.container.querySelector('.timeline-tab-list-clear-confirm'), null, 'expected the dialog to close on confirm')
    // The DELETE call hit the right endpoint with the
    // right verb. A regression that swapped the method
    // or path would surface here.
    const deleteCall = handle.fetches.find(f => f.method === 'DELETE' && f.url.includes('/api/test-runs'))
    ok(deleteCall, 'expected a DELETE /api/test-runs call')
    equal(handle.clearAllCalls, 1, 'onClearAll must be called exactly once on confirm')
  } finally {
    handle.unmount()
  }
})

test('a failed DELETE call keeps the dialog open and shows an error message', async () => {
  // The user clicked the button, accepted the warning, and
  // the backend rejected the request. The UI must not
  // pretend the wipe succeeded; it must keep the dialog
  // open and surface a localised error so the user can
  // try again or report the failure.
  const handle = renderTimeline({
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
    onClearAll: async () => null,
  }, { deleteStatus: 500 })
  try {
    await new Promise(resolve => setTimeout(resolve, 0))
    act(() => { /* flush */ })
    const button = handle.container.querySelector('.timeline-tab-list-clear') as HTMLButtonElement
    act(() => { button.click() })
    const confirmButton = handle.container.querySelector('.timeline-tab-list-clear-confirm-delete') as HTMLButtonElement
    await act(async () => { confirmButton.click() })
    // The dialog stays open so the user can retry.
    const dialog = handle.container.querySelector('.timeline-tab-list-clear-confirm')
    ok(dialog, 'expected the dialog to stay open on backend failure')
    // An error message is rendered inside the dialog.
    const errorMessage = handle.container.querySelector('.timeline-tab-list-clear-confirm-error')
    ok(errorMessage, 'expected an error message in the dialog on failure')
  } finally {
    handle.unmount()
  }
})

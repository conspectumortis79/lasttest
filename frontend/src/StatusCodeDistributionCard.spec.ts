// Renders the [StatusCodeDistributionCard] in JSDOM and
// asserts the DOM shape against the HTML mockup
// (`demo/lastruns-statuscode-mockups/variant-3-mini-bar-grid.html`).
// The file is named `.spec.ts` (not `.test.ts`) because it
// renders a `.tsx` component and therefore needs the `tsx`
// loader plus the `app` tsconfig (with `jsx: "react-jsx"`).
// The project's default `npm run test:unit` only handles plain
// `.ts` files. Run this file directly with:
//
//   TSX_TSCONFIG_PATH=./tsconfig.app.json \
//   node --import tsx --test src/StatusCodeDistributionCard.spec.ts

import { deepEqual, equal, ok } from 'node:assert/strict'
import { test } from 'node:test'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { StatusCodeDistributionCard } from './StatusCodeDistributionCard.tsx'
import type { K6Summary, TestRun } from './k6Report.ts'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')

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
setGlobal('IS_REACT_ACT_ENVIRONMENT', true)

type RenderHandle = {
  root: Root
  container: HTMLDivElement
  unmount: () => void
}

function renderCard(run: TestRun): RenderHandle {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(createElement(StatusCodeDistributionCard, { run }))
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

function makeRun(summary: K6Summary, operationIds: string[]): TestRun {
  return {
    id: 'run-1',
    status: 'COMPLETED',
    createdAt: '2026-01-01T00:00:00Z',
    finishedAt: '2026-01-01T00:00:30Z',
    summary: { raw: JSON.stringify({ metrics: summary.metrics }) },
    configuration: {
      apiTitle: 'Pet API',
      apiVersion: '1',
      baseUrl: 'https://example.test',
      loadProfile: { type: 'CONSTANT_VUS', virtualUsers: 1, durationSeconds: 1 },
      operations: operationIds.map(operationId => ({
        operationId,
        method: 'GET',
        path: `/things/${operationId}`,
        summary: '',
        payloads: [],
        parameterValues: [],
        bearerTokenConfigured: false,
      })),
    },
  }
}

test('renders the mini bar grid with one cell per active status code', () => {
  // Regression for the mockup contract: 200, 304, 401, 429
  // and 503 each get their own cell; the header carries the
  // grand total; the legend is below the grid. `err` and
  // `other` are NOT shown because they did not fire — the
  // Übersicht only surfaces codes that actually happened.
  const summary = {
    metrics: {
      lt_status_200_getThing: { count: 12450 },
      lt_status_304_getThing: { count: 8 },
      lt_status_401_getThing: { count: 41 },
      lt_status_429_getThing: { count: 10 },
      lt_status_503_getThing: { count: 3 },
    } as Record<string, { count: number }>,
  }
  const run = makeRun(summary, ['getThing'])
  const handle = renderCard(run)
  try {
    const cells = handle.container.querySelectorAll('.status-cell')
    // 5 tracked codes that fired. `err` and `other` are
    // absent because they did not fire and the Übersicht
    // does not render empty fallback cells.
    equal(cells.length, 5)
    // First cell is the 200 with the highest count.
    const firstCode = cells[0].querySelector('.status-cell-code')?.textContent
    equal(firstCode, '200')
    // Total in the header sums the actual counts.
    const totalText = handle.container.querySelector('.status-dist-total')?.textContent ?? ''
    ok(/12\.512|12,512/.test(totalText), `expected grand total in header, got: ${totalText}`)
  } finally {
    handle.unmount()
  }
})

test('omits err and other cells when only 200 responses fired', () => {
  // The user explicitly asked for this: a clean 200-only
  // run must not render empty `err` / `other` cells on the
  // Übersicht. The detailed report still shows them (via
  // [activeStatusCodes] directly), the mini grid does not.
  const summary = {
    metrics: { lt_status_200_op: { count: 100 } } as Record<string, { count: number }>,
  }
  const run = makeRun(summary, ['op'])
  const handle = renderCard(run)
  try {
    const cells = Array.from(handle.container.querySelectorAll('.status-cell'))
    const codes = cells.map(cell => cell.querySelector('.status-cell-code')?.textContent ?? '')
    deepEqual(codes, ['200'])
  } finally {
    handle.unmount()
  }
})

test('cell carries the family-specific CSS class so the accent stripe is coloured correctly', () => {
  // The mockup pins a left accent stripe per family:
  // 2xx green, 3xx blue, 4xx yellow, 5xx red. The class
  // lookup is the single source of truth for that mapping,
  // so we assert it on each rendered cell.
  const summary = {
    metrics: {
      lt_status_200_op: { count: 5 },
      lt_status_304_op: { count: 1 },
      lt_status_401_op: { count: 2 },
      lt_status_500_op: { count: 3 },
      lt_status_err_op: { count: 1 },
    } as Record<string, { count: number }>,
  }
  const run = makeRun(summary, ['op'])
  const handle = renderCard(run)
  try {
    const cells = Array.from(handle.container.querySelectorAll('.status-cell'))
    const classByCode: Record<string, string> = {}
    for (const cell of cells) {
      const code = cell.querySelector('.status-cell-code')?.textContent ?? ''
      classByCode[code] = cell.className
    }
    ok(classByCode['200'].includes('cell-2xx'), `expected cell-2xx on 200 cell, got: ${classByCode['200']}`)
    ok(classByCode['304'].includes('cell-3xx'), `expected cell-3xx on 304 cell, got: ${classByCode['304']}`)
    ok(classByCode['401'].includes('cell-4xx'), `expected cell-4xx on 401 cell, got: ${classByCode['401']}`)
    ok(classByCode['500'].includes('cell-5xx'), `expected cell-5xx on 500 cell, got: ${classByCode['500']}`)
    ok(classByCode['err'].includes('cell-err'), `expected cell-err on err cell, got: ${classByCode['err']}`)
  } finally {
    handle.unmount()
  }
})

test('cell title encodes code, count and percentage for hover tooltips', () => {
  // The mockup shows a tooltip on each cell ("200 OK · 12.450
  // Requests (99,50 %)"). The component renders the same
  // shape via the `title` attribute. Pin both the code and
  // the count so a future refactor that drops the title
  // surfaces here.
  const summary = {
    metrics: { lt_status_200_op: { count: 100 } } as Record<string, { count: number }>,
  }
  const run = makeRun(summary, ['op'])
  const handle = renderCard(run)
  try {
    const cell = handle.container.querySelector('.status-cell')
    const title = cell?.getAttribute('title') ?? ''
    ok(title.includes('200'), `expected code in title, got: ${title}`)
    ok(title.includes('100'), `expected count in title, got: ${title}`)
    ok(title.includes('100,00 %') || title.includes('100.00 %'), `expected pct in title, got: ${title}`)
  } finally {
    handle.unmount()
  }
})

test('cell bar fill width is set so the dominant code is wider than the others', () => {
  // The bar uses a log scale so a single 12 450 doesn't
  // visually swallow every smaller count, but the dominant
  // cell must still be strictly wider than the smallest one.
  // Pinning the relative ordering is enough — exact pixel
  // widths would be brittle to CSS tweaks.
  const summary = {
    metrics: {
      lt_status_200_op: { count: 1000 },
      lt_status_503_op: { count: 5 },
    } as Record<string, { count: number }>,
  }
  const run = makeRun(summary, ['op'])
  const handle = renderCard(run)
  try {
    const fills = Array.from(handle.container.querySelectorAll('.status-cell-bar-fill'))
    const widths = fills.map(f => parseFloat((f as HTMLElement).style.width || '0'))
    const dominant = Math.max(...widths)
    const smallest = Math.min(...widths)
    ok(dominant > smallest, `expected dominant bar wider than smallest, got dominant=${dominant}, smallest=${smallest}`)
  } finally {
    handle.unmount()
  }
})

test('legend contains all five entries (2xx, 3xx, 4xx, 5xx, err)', () => {
  // The legend mirrors the cell classes one-to-one. Adding
  // a new family without updating the legend would leave the
  // user guessing what the colour means; this test pins the
  // 1:1 mapping. The legend is always rendered so the user
  // can decode any cell that might appear later (a 503 that
  // only fires in run N+1, for example), even on a run
  // whose mini grid only shows 200s right now.
  const summary = {
    metrics: { lt_status_200_op: { count: 1 } } as Record<string, { count: number }>,
  }
  const run = makeRun(summary, ['op'])
  const handle = renderCard(run)
  try {
    const items = Array.from(handle.container.querySelectorAll('.status-legend .lg-item'))
    const labels = items.map(item => (item.textContent ?? '').trim())
    deepEqual(labels, [
      '2xx — success',
      '3xx — redirect',
      '4xx — client error',
      '5xx — server error',
      'err — network / TLS failure',
    ])
  } finally {
    handle.unmount()
  }
})

test('returns null when the run has no k6 summary', () => {
  // A queued or running run has no summary yet. The card
  // renders nothing in that case so the Übersicht stays
  // compact instead of showing an empty grid with
  // "Gesamt: 0 Requests".
  const run: TestRun = {
    id: 'run-no-summary',
    status: 'RUNNING',
    createdAt: '2026-01-01T00:00:00Z',
    // summary is omitted on purpose.
  }
  const handle = renderCard(run)
  try {
    equal(handle.container.querySelector('.status-dist'), null)
  } finally {
    handle.unmount()
  }
})

test('returns null when the run has no operations configured', () => {
  // A synthetic fixture or a degenerate run configuration
  // could leave `run.configuration.operations` empty. The
  // card must not render an empty grid in that case.
  const summary = {
    metrics: { lt_status_200_op: { count: 1 } } as Record<string, { count: number }>,
  }
  const run: TestRun = {
    id: 'run-no-ops',
    status: 'COMPLETED',
    createdAt: '2026-01-01T00:00:00Z',
    finishedAt: '2026-01-01T00:00:30Z',
    summary: { raw: JSON.stringify({ metrics: summary.metrics }) },
    configuration: {
      apiTitle: 'Empty',
      apiVersion: '1',
      baseUrl: 'https://example.test',
      loadProfile: { type: 'CONSTANT_VUS', virtualUsers: 1, durationSeconds: 1 },
      operations: [],
    },
  }
  const handle = renderCard(run)
  try {
    equal(handle.container.querySelector('.status-dist'), null)
  } finally {
    handle.unmount()
  }
})

test('returns null when the summary has no requests at all', () => {
  // A run that produced a parseable summary with zero
  // iterations (every check failed before the executor
  // started) is hidden by the card so the user is not
  // shown a "Gesamt: 0 Requests" header that looks like
  // a render bug.
  const summary = {
    metrics: { lt_status_200_op: { count: 0 } } as Record<string, { count: number }>,
  }
  const run = makeRun(summary, ['op'])
  const handle = renderCard(run)
  try {
    equal(handle.container.querySelector('.status-dist'), null)
  } finally {
    handle.unmount()
  }
})

test('aggregates counts across multiple operations in the same run', () => {
  // Multi-endpoint contract: the bar grid is run-wide, not
  // per-endpoint. Two operations that each produced 200s must
  // show a single 200 cell with the summed count. Without
  // this, a multi-endpoint run would render one grid per
  // operation and the Übersicht would overflow.
  const summary = {
    metrics: {
      lt_status_200_getUsers: { count: 100 },
      lt_status_200_listUsers: { count: 50 },
      lt_status_401_listUsers: { count: 3 },
    } as Record<string, { count: number }>,
  }
  const run = makeRun(summary, ['getUsers', 'listUsers'])
  const handle = renderCard(run)
  try {
    const cells = Array.from(handle.container.querySelectorAll('.status-cell'))
    const cell200 = cells.find(cell => cell.querySelector('.status-cell-code')?.textContent === '200')
    const count200 = cell200?.querySelector('.status-cell-count strong')?.textContent ?? ''
    equal(count200, '150', `expected 200 cell to show 150 requests, got: ${count200}`)
  } finally {
    handle.unmount()
  }
})

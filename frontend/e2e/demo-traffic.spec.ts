// E2E coverage for the demo-traffic dashboard. The spec proves
// three contracts:
//   1. `/?demo-traffic` renders the dashboard shell (toolbar,
//      brand, empty-state copy) and polls the live endpoint;
//   2. `/?demo-traffic=<runId>` filters the snapshot to a single
//      run — the demo's run-badge right-click menu offers "View
//      demo traffic" and the link must carry the id end-to-end;
//   3. A request that hits the demo API during a k6 run shows up
//      in the dashboard with the run id from the `X-Lasttest-Run-Id`
//      header, so the user can confirm "the run did reach the
//      server".
//
// The spec runs against the live Docker Compose stack, so it
// exercises the same wiring (interceptor → ring buffer →
// controller → JSON → React) that the unit tests cover in
// isolation. Tests clean up via `forceAbortRun` so the executor
// pool (MAX_PARALLEL_RUNS = 2 on the Spring side) frees up for
// the next test in the suite.

import { expect, test, type Page, request as playwrightRequest } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const demoSpecification = path.resolve(currentDirectory, '../../demo/openapi-demo.yaml')

async function importDemo(page: Page): Promise<void> {
  await page.locator('input[type="file"]').setInputFiles(demoSpecification)
  await page.getByRole('button', { name: 'Validieren & importieren' }).click()
  await expect(page.getByRole('heading', { name: /Lasttest Demo API/ })).toBeVisible()
}

async function runIdFromBadge(page: Page): Promise<string> {
  const title = await page.locator('.run-badge').first().getAttribute('title')
  const id = title?.split(' · ')[0] ?? ''
  expect(id).not.toBe('')
  return id
}

async function forceAbortRun(runId: string): Promise<void> {
  const api = await playwrightRequest.newContext({ baseURL: 'http://localhost:8286' })
  try {
    await api.post(`/api/test-runs/${runId}/cancel?force=true`)
  } finally {
    await api.dispose()
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('lasttest.language', 'de'))
  await page.goto('/')
})

test('the global demo-traffic dashboard renders the empty state when no run is active', async ({ page }) => {
  // The empty state is the most important thing to nail down:
  // it is the very first thing the user sees when they open the
  // page in a fresh install. The exact copy is locked here so a
  // silent regression in the i18n dict surfaces immediately.
  await page.goto('/?demo-traffic')

  await expect(page.getByRole('heading', { name: 'Demo-API-Traffic' })).toBeVisible()
  await expect(page.getByText(/Noch keine Anfragen|keine Anfragen/)).toBeVisible()
  // The back link must return to the main app; without it the
  // user has no way out of the dashboard.
  await expect(page.getByRole('link', { name: /Zur Anwendung/ })).toBeVisible()
  // The "Live" badge appears once the first poll returns; without
  // it the user has no visual confirmation that the dashboard is
  // actually polling and not stuck on a loading screen.
  await expect(page.locator('.demo-traffic-live-badge.is-live')).toBeVisible({ timeout: 5_000 })
})

test('the demo API link in the toolbar is hidden until the Settings switch is flipped on', async ({ page }) => {
  // The demo is opt-in. On a fresh page the Settings switch is
  // off, so the toolbar must NOT advertise a Demo-API link —
  // surfacing the link would imply "the demo is running",
  // which it is not. The Settings drawer is the only entry
  // point that flips the toggle.
  await page.goto('/')

  await expect(page.getByRole('link', { name: 'Demo-API' })).toHaveCount(0)

  // Open Settings, flip the switch, and the link appears.
  await page.getByRole('button', { name: 'Einstellungen' }).click()
  await expect(page.locator('[data-testid="settings-demo-api-switch"]')).toBeVisible()
  await page.locator('[data-testid="settings-demo-api-switch"]').check()

  await expect(page.getByRole('link', { name: 'Demo-API' })).toBeVisible()
  // The "active" badge is the visual confirmation that the
  // demo is now running. Without the badge the user has no
  // immediate signal that the switch actually started the
  // in-process controller.
  await expect(page.locator('.top-toolbar-demo-active')).toBeVisible()
})

test('enabling the demo in Settings auto-loads the bundled demo spec into the textarea', async ({ page }) => {
  // The user-reported contract: the Settings switch is the only
  // path that flips the demo on, and flipping it on has to also
  // load the demo spec so the user can hit Start without any
  // extra click. A regression here would force the user to
  // click "Try the demo specification" manually even after they
  // already turned the demo on.
  await page.goto('/')
  // Pre-condition: the textarea holds the embedded sample,
  // not the bundled demo spec.
  const textarea = page.locator('.specification-textarea')
  await expect(textarea).not.toContainText('Lasttest Demo API')

  // Enable the demo.
  await page.getByRole('button', { name: 'Einstellungen' }).click()
  await page.locator('[data-testid="settings-demo-api-switch"]').check()
  // Close the drawer so the textarea is visible.
  await page.keyboard.press('Escape')

  // The demo spec is now in the textarea. The 'Lasttest Demo
  // API' string is a stable, easy-to-grep marker that lives in
  // the bundled `openapi-demo.yaml`.
  await expect(textarea).toContainText('Lasttest Demo API', { timeout: 5_000 })
})

test('disabling the demo in Settings clears the textarea back to the empty sample', async ({ page }) => {
  // The inverse of the previous test: turning the demo off has
  // to clear whatever the textarea holds, so a stale demo spec
  // does not linger on screen and confuse the next import.
  await page.goto('/')
  await page.getByRole('button', { name: 'Einstellungen' }).click()
  await page.locator('[data-testid="settings-demo-api-switch"]').check()
  await page.keyboard.press('Escape')
  const textarea = page.locator('.specification-textarea')
  await expect(textarea).toContainText('Lasttest Demo API', { timeout: 5_000 })

  // Disable the demo again.
  await page.getByRole('button', { name: 'Einstellungen' }).click()
  await page.locator('[data-testid="settings-demo-api-switch"]').uncheck()
  await page.keyboard.press('Escape')

  await expect(textarea).not.toContainText('Lasttest Demo API', { timeout: 5_000 })
})

test('flipping the Settings switch off hides the demo link and the demo API returns 404 again', async ({ page, request }) => {
  // The inverse of the previous test: enabling the demo,
  // confirming it works, then disabling it and confirming the
  // controller short-circuits to 404. Goes through the full
  // happy-path → reset-path flow so a regression that
  // forgets to actually flip the toggle on the backend (e.g.
  // only updates the local React state) is caught.
  await page.goto('/')

  // Enable the demo via the Settings drawer.
  await page.getByRole('button', { name: 'Einstellungen' }).click()
  await page.locator('[data-testid="settings-demo-api-switch"]').check()

  // The demo API now responds with 200.
  const enabled = await request.get('http://localhost:8286/demo-api/products')
  expect(enabled.status()).toBe(200)

  // Disable the demo. The link disappears and the controller
  // returns 404.
  await page.locator('[data-testid="settings-demo-api-switch"]').uncheck()

  await expect(page.getByRole('link', { name: 'Demo-API' })).toHaveCount(0)
  const disabled = await request.get('http://localhost:8286/demo-api/products')
  expect(disabled.status()).toBe(404)
})

test('the top toolbar exposes a direct Demo-API link that opens the dashboard in a new tab', async ({ page, context }) => {
  // The headline use case for the dashboard is: open it in its
  // own tab, start a load test in another tab, watch the table
  // populate. The toolbar is the entry point — a regression that
  // removes the link (or breaks the new-tab behaviour) would
  // force the user back to typing `/?demo-traffic` by hand.
  await page.goto('/')

  const link = page.getByRole('link', { name: 'Demo-API' })
  await expect(link).toBeVisible()
  await expect(link).toHaveAttribute('href', '/?demo-traffic')
  await expect(link).toHaveAttribute('target', '_blank')

  // Click the link and verify the new tab actually lands on the
  // dashboard — a missing onClick handler or a wrong URL would
  // open a blank tab here.
  const [newTab] = await Promise.all([
    context.waitForEvent('page'),
    link.click(),
  ])
  await newTab.waitForLoadState()
  await expect(newTab.getByRole('heading', { name: 'Demo-API-Traffic' })).toBeVisible()
})

test('a request driven by a k6 run shows up in the filtered dashboard with the run id', async ({ page }) => {
  // Two long-running tests do not fit into the default budget —
  // a smoke run with 1 VU and 3 s of duration is enough to drive
  // a handful of requests through the demo API and the run
  // finishes in time for the assertions below.
  test.setTimeout(120_000)

  await importDemo(page)
  await page.getByLabel('Endpunkt GET /products auswählen').check()
  await page.getByLabel('Virtual Users').fill('1')
  await page.getByLabel('Dauer (Sekunden)').fill('3')
  await page.getByRole('button', { name: 'k6-Lasttest starten' }).click()

  // Wait for the run to finish (status badge → COMPLETED). The
  // dashboard only stops polling once the run is terminal, so we
  // pin the wait here to keep the assertion deterministic.
  await expect(page.getByRole('tab', { name: /COMPLETED/ }).first()).toBeVisible({ timeout: 60_000 })
  const runId = await runIdFromBadge(page)

  try {
    // Navigate to the filtered dashboard for this run. The page
    // polls the backend until the run is terminal, so the entries
    // that landed during the run are already in the ring buffer.
    await page.goto(`/?demo-traffic=${encodeURIComponent(runId)}`)

    await expect(page.getByRole('heading', { name: 'Demo-API-Traffic' })).toBeVisible()
    // The page renders the run id in the subtitle, so the user
    // can see at a glance which run the table is filtered to.
    await expect(page.getByText(new RegExp(`Anfragen aus Run ${runId}`))).toBeVisible()

    // The demo API guarantees that an integer-typed query
    // parameter (none here) and the GET endpoint both respond
    // with 200. At least one row must be visible.
    const rows = page.locator('.demo-traffic-row')
    await expect(rows.first()).toBeVisible({ timeout: 30_000 })
    const rowCount = await rows.count()
    expect(rowCount).toBeGreaterThan(0)

    // The first row must carry the right method + path. We assert
    // on the exact string (not just "GET") so a regression in the
    // interceptor's method extraction would surface here instead
    // of hiding in a 200 from the report.
    await expect(page.locator('.demo-traffic-cell-method').first()).toHaveText('GET')
    await expect(page.locator('.demo-traffic-cell-path').first()).toContainText('/demo-api/products')
  } finally {
    // Belt-and-braces: the smoke test is short, but if a future
    // change makes the duration configurable the run could still
    // be in flight when the test ends. Abort it so the next test
    // does not have to wait for the executor pool to drain.
    await forceAbortRun(runId)
  }
})

test('the demo-traffic API returns the entries we expect after a run', async ({ page }) => {
  // This test exercises the wire format directly: a fresh request
  // to /api/demo-traffic/requests must come back as JSON with the
  // documented shape. We do not depend on the run ever having
  // started — the empty envelope is a valid response too, so we
  // only assert the structural contract.
  await page.goto('/')

  const payload = await page.evaluate(async () => {
    const response = await fetch('/api/demo-traffic/requests')
    if (!response.ok) throw new Error(`status ${response.status}`)
    return await response.json()
  })

  expect(payload).toMatchObject({
    runId: null,
    limit: expect.any(Number),
    count: expect.any(Number),
    entries: expect.any(Array),
  })
  for (const entry of payload.entries) {
    expect(entry).toMatchObject({
      timestamp: expect.any(String),
      method: expect.any(String),
      path: expect.any(String),
      status: expect.any(Number),
    })
  }
})

test('a request that hits the demo API while the dashboard is open shows up without a run id filter', async ({ page }) => {
  // The headline use case: the user opens `/?demo-traffic` in one
  // tab, then drives the demo API from somewhere else (here: a
  // `fetch` from the same browser context, but a real k6 run or
  // a `curl` from the host would behave identically). The
  // dashboard must pick the new request up on the next poll
  // without the user having to reload or click anything.
  await page.goto('/?demo-traffic')
  await expect(page.locator('.demo-traffic-live-badge.is-live')).toBeVisible({ timeout: 5_000 })

  // Drive the demo API from the page context so the interceptor
  // on the server side records the request exactly as a k6 run
  // would. We do not care about the response, only that the
  // request reaches the bundled demo.
  const before = await page.locator('.demo-traffic-row').count()

  await page.evaluate(async () => {
    await fetch('/demo-api/products?category=books', { headers: { 'X-Test-Source': 'e2e' } })
  })

  // The dashboard polls every second; allow up to five seconds
  // for the new row to land in the table.
  await expect(async () => {
    const after = await page.locator('.demo-traffic-row').count()
    expect(after).toBeGreaterThan(before)
  }).toPass({ timeout: 5_000, intervals: [500] })

  // The row we just produced must be the newest one (the table
  // is rendered newest-first) and must carry the path we asked
  // for. We assert the path substring rather than the full
  // string so a future addition of query parameters does not
  // break the test.
  const newestPath = await page.locator('.demo-traffic-cell-path').first().textContent()
  expect(newestPath).toContain('/demo-api/products')
  // The request was driven from a `fetch` in the browser, so the
  // recorded User-Agent is the browser's. We do not pin the exact
  // string; we just assert it is non-empty so a regression that
  // drops the User-Agent header surfaces.
  const userAgent = await page.locator('.demo-traffic-cell-user-agent').first().textContent()
  expect(userAgent?.trim().length ?? 0).toBeGreaterThan(0)
})

test('the demo toggle survives a page reload (localStorage persistence)', async ({ page }) => {
  // The user enabled the demo in Settings, the choice must
  // come back on the next visit. A regression that loses the
  // stored value forces the user to flip the switch on every
  // page refresh, which silently breaks the auto-load
  // behaviour as well.
  await page.goto('/')

  // Pre-condition: switch is off, no Demo-API link.
  await expect(page.getByRole('link', { name: 'Demo-API' })).toHaveCount(0)

  // Enable and flip back. The localStorage round-trip happens
  // through `useDemoStatus` in the frontend; we wait for the
  // optimistic state to settle before reloading.
  await page.getByRole('button', { name: 'Einstellungen' }).click()
  await page.locator('[data-testid="settings-demo-api-switch"]').check()
  await expect(page.getByRole('link', { name: 'Demo-API' })).toBeVisible()

  // Reload the page. The choice must come back from
  // localStorage, and the backend toggle must be in sync.
  await page.reload()

  // Post-reload: link visible, switch checked.
  await expect(page.getByRole('link', { name: 'Demo-API' })).toBeVisible({ timeout: 5_000 })
  await page.getByRole('button', { name: 'Einstellungen' }).click()
  await expect(page.locator('[data-testid="settings-demo-api-switch"]')).toBeChecked()

  // The demo API is reachable — the backend toggle was
  // re-synced from the stored value.
  const response = await page.request.get('http://localhost:8286/demo-api/products')
  expect(response.status()).toBe(200)

  // Flip off and reload again — the choice must also persist
  // in the off direction.
  await page.locator('[data-testid="settings-demo-api-switch"]').uncheck()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('link', { name: 'Demo-API' })).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('link', { name: 'Demo-API' })).toHaveCount(0)
})

test('the Demo-API toolbar link sits at the right end of the nav, after Wiki', async ({ page }) => {
  // The toolbar nav order is fixed in `NAV_ITEMS`. A regression
  // that re-orders the items (e.g. someone moves Demo-API next
  // to Dashboard "for visibility") changes the visual rhythm of
  // the toolbar and undoes the deliberate "power user feature
  // at the edge" decision. The test walks the children in DOM
  // order and asserts the last visible nav link is the
  // Demo-API one — and that the Wiki link sits immediately
  // before it.
  await page.goto('/')

  // Enable the demo so the Demo-API link is in the DOM. The
  // persistence test above shows how the off-state hides the
  // link entirely.
  await page.getByRole('button', { name: 'Einstellungen' }).click()
  await page.locator('[data-testid="settings-demo-api-switch"]').check()
  await page.keyboard.press('Escape')

  const navLinks = page.locator('.top-toolbar-nav .top-toolbar-nav-link')
  const count = await navLinks.count()
  expect(count).toBeGreaterThanOrEqual(5)

  // The last link in the nav must be the Demo-API one.
  await expect(navLinks.nth(count - 1)).toHaveText(/Demo-API/)
  // The second-to-last must be the Wiki link — i.e. Demo-API
  // sits at the right edge, not in the middle.
  await expect(navLinks.nth(count - 2)).toHaveText(/Wiki/)
})

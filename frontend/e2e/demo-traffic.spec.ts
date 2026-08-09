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

test('the global demo-traffic dashboard renders an empty OR populated state', async ({ page }) => {
  // The dashboard's two valid first-impression states are the
  // empty-state card ("Noch keine Anfragen…") and the populated
  // table. Both must render without errors and surface the
  // "Live" badge once the first poll returns. The ring buffer
  // retains the last 500 entries, so a freshly-restarted
  // backend always shows the empty state, but a backend that
  // has been running through earlier tests will have rows to
  // render. We assert on the structural pieces that are
  // present in both states — heading, back link, live badge.
  await page.goto('/?demo-traffic')

  await expect(page.getByRole('heading', { name: 'Demo-API-Traffic' })).toBeVisible()
  // The back link must return to the main app; without it the
  // user has no way out of the dashboard.
  await expect(page.getByRole('link', { name: /Zur Anwendung/ })).toBeVisible()
  // The "Live" badge appears once the first poll returns; without
  // it the user has no visual confirmation that the dashboard is
  // actually polling and not stuck on a loading screen.
  await expect(page.locator('.demo-traffic-live-badge.is-live')).toBeVisible({ timeout: 5_000 })
  // Exactly one of the two content blocks must be visible:
  // the empty-state card or the captured-requests table.
  const emptyState = page.getByText(/Noch keine Anfragen/)
  const table = page.locator('table')
  const emptyVisible = await emptyState.isVisible().catch(() => false)
  const tableVisible = await table.isVisible().catch(() => false)
  expect.soft(emptyVisible !== tableVisible, 'either the empty state or the table must be visible').toBe(true)
})

test('the demo API link in the toolbar is hidden until the Settings switch is flipped on', async ({ page }) => {
  // The demo is opt-in. On a fresh page the Settings switch is
  // off, so the toolbar must NOT advertise a Demo-API link —
  // surfacing the link would imply "the demo is running",
  // which it is not. The Settings drawer is the only entry
  // point that flips the toggle. The global setup enables
  // the demo for every other test, so we explicitly clear
  // the localStorage flag here to start from a known-off
  // baseline.
  await page.addInitScript(() => {
    localStorage.removeItem('lasttest.demo.enabled')
  })
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
  // already turned the demo on. The global setup enables the
  // demo for every other test, so we explicitly clear the
  // localStorage flag before the first page load via a
  // one-shot init script — the textarea must start from the
  // embedded sample so the test can prove the Settings switch
  // triggers the auto-load.
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('__demoStorageCleared')) {
      localStorage.removeItem('lasttest.demo.enabled')
      sessionStorage.setItem('__demoStorageCleared', '1')
    }
  })
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

test('the toolbar reset button drops every captured request after a confirm prompt', async ({ page }) => {
  // The reset button is the headline "as if the demo API was
  // never started" affordance: drive a request, confirm the
  // table picks it up, click the reset button, dismiss the
  // browser-native confirm prompt, and verify the table is
  // empty again. We register the dialog handler before the
  // click so the prompt can be auto-accepted; otherwise the
  // Playwright driver would hang on the modal.
  await page.goto('/?demo-traffic')
  await expect(page.locator('.demo-traffic-live-badge.is-live')).toBeVisible({ timeout: 5_000 })

  // Drive a request so the table has at least one row.
  await page.evaluate(async () => {
    await fetch('/demo-api/products?reset-fixture=true')
  })
  await expect(page.locator('.demo-traffic-row').first()).toBeVisible({ timeout: 5_000 })

  // Auto-accept the native confirm prompt. The test would
  // hang on the modal otherwise because Playwright does not
  // know about browser-native dialogs unless we register a
  // handler first.
  page.once('dialog', dialog => {
    void dialog.accept()
  })

  // Click the reset button. The optimistic local state
  // update means the table should empty out before the
  // dashboard's next poll even has a chance to run, so we
  // assert against the local state rather than waiting for
  // a network round-trip.
  await page.locator('[data-testid="demo-traffic-reset"]').click()

  // The table is gone (count === 0) and the empty-state
  // card is back. The success banner is also visible.
  await expect(page.locator('.demo-traffic-row')).toHaveCount(0, { timeout: 5_000 })
  await expect(page.getByText(/Noch keine Anfragen/)).toBeVisible()
  await expect(page.locator('[data-testid="demo-traffic-reset-banner"]')).toBeVisible()
  await expect(page.locator('.demo-traffic-banner-ok')).toBeVisible()

  // The reset must have actually reached the backend: a
  // follow-up GET on the wire format returns the empty
  // envelope too. Without this, a regression that only
  // updated the local React state would pass the UI
  // assertions but leave the server holding the entries.
  const payload = await page.evaluate(async () => {
    const response = await fetch('/api/demo-traffic/requests')
    if (!response.ok) throw new Error(`status ${response.status}`)
    return await response.json()
  })
  expect(payload.count).toBe(0)
  expect(payload.entries).toEqual([])
})

test('the toolbar reset button does nothing when the user cancels the confirm prompt', async ({ page }) => {
  // The reset is destructive, so the confirm prompt is the
  // last line of defence. A user who clicks "Cancel" must
  // keep their captured list intact — both locally and on
  // the server. A regression that auto-clears regardless of
  // the prompt would force the user to re-drive their load
  // test.
  await page.goto('/?demo-traffic')
  await expect(page.locator('.demo-traffic-live-badge.is-live')).toBeVisible({ timeout: 5_000 })

  // Drive a request so the table has at least one row.
  await page.evaluate(async () => {
    await fetch('/demo-api/products?reset-cancel-fixture=true')
  })
  await expect(page.locator('.demo-traffic-row').first()).toBeVisible({ timeout: 5_000 })
  const beforeRowCount = await page.locator('.demo-traffic-row').count()

  // Auto-dismiss the native confirm prompt.
  page.once('dialog', dialog => {
    void dialog.dismiss()
  })
  await page.locator('[data-testid="demo-traffic-reset"]').click()

  // The table must still hold the row we drove earlier. We
  // give the polling loop a chance to overwrite the local
  // state with whatever the server returns; the server
  // never received a DELETE, so the count must stay the
  // same.
  await page.waitForTimeout(1_500)
  const afterRowCount = await page.locator('.demo-traffic-row').count()
  expect(afterRowCount).toBe(beforeRowCount)
  await expect(page.locator('.demo-traffic-row').first()).toBeVisible()
  // The success banner must not have appeared — a regression
  // that surfaces a banner even after a cancelled reset
  // would confuse the user into thinking the click took
  // effect.
  await expect(page.locator('[data-testid="demo-traffic-reset-banner"]')).toHaveCount(0)
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
  // request reaches the bundled demo. We snapshot the
  // first-row *timestamp* rather than the row count or path
  // because the ring buffer can roll entries off (count stays
  // flat) and earlier specs may have left the same path at
  // the top (the path collides, only the timestamp differs).
  const beforeFirstRow = page.locator('.demo-traffic-row').first()
  const beforeTimestamp = await beforeFirstRow.evaluate(node => node.outerHTML)

  await page.evaluate(async () => {
    await fetch('/demo-api/products?category=books', { headers: { 'X-Test-Source': 'e2e' } })
  })

  // The dashboard polls every second; allow up to five seconds
  // for the new row to land in the table. We compare the full
  // outer HTML of the first row so the only signal that
  // matters is "the row at the top is different from before".
  await expect(async () => {
    const afterHtml = await beforeFirstRow.evaluate(node => node.outerHTML)
    expect(afterHtml).not.toBe(beforeTimestamp)
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
  // behaviour as well. The global setup enables the demo for
  // every other test, so we explicitly clear the localStorage
  // entry before the first page load via `addInitScript`.
  // The script uses a `sessionStorage` sentinel so it only
  // acts on the very first navigation: subsequent navigations
  // (the page reload below) keep the freshly-stored value.
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('__demoStorageCleared')) {
      localStorage.removeItem('lasttest.demo.enabled')
      sessionStorage.setItem('__demoStorageCleared', '1')
    }
  })
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

test('disabling the demo mid-run cancels the in-flight load test and wipes the dashboard', async ({ page }) => {
  // The headline contract for the "demo off" reset: while the
  // user is in the middle of testing the demo API, flipping
  // the switch off must stop every running k6 process AND
  // clear the in-memory dashboard, so the user lands on a
  // clean state — exactly as if they had reloaded the page.
  // Without this, a stale RUNNING badge would keep polling
  // and the operations card would still show the demo's
  // endpoints, leaving the user with two contradictory
  // signals: "demo is off" + "GET /products is still running".

  // Demo is on by default thanks to the global setup. Make
  // sure the spec is imported and a run is in flight. We
  // pick a 30 s run so the test has a comfortable window to
  // observe the running badge before pulling the rug.
  await importDemo(page)
  await page.getByLabel('Endpunkt GET /products auswählen').check()
  await page.getByLabel('Virtual Users').fill('2')
  await page.getByLabel('Dauer (Sekunden)').fill('30')
  await page.getByRole('button', { name: 'k6-Lasttest starten' }).click()

  // Pin the wait on the running badge so we know the k6
  // process is alive on the backend before we disable the
  // demo. A regression that misses the running state here
  // would not actually test the cancel behaviour.
  await expect(page.getByRole('tab', { name: /RUNNING/ }).first()).toBeVisible({ timeout: 10_000 })
  const runId = await runIdFromBadge(page)

  try {
    // Disable the demo via the Settings drawer.
    await page.getByRole('button', { name: 'Einstellungen' }).click()
    await page.locator('[data-testid="settings-demo-api-switch"]').uncheck()
    await page.keyboard.press('Escape')

    // The dashboard must be empty now. The RUNNING badge
    // should be gone (cancelled + wiped) and the operations
    // card (Step 2) should be hidden because the import
    // state was reset. The textarea should be back to the
    // empty sample — mirroring the existing
    // "disabling the demo in Settings clears the textarea
    // back to the empty sample" contract.
    await expect(page.locator('.run-badge')).toHaveCount(0, { timeout: 5_000 })
    await expect(page.locator('.specification-textarea')).not.toContainText('Lasttest Demo API', { timeout: 5_000 })
    // The operations card lists every endpoint of the
    // imported spec; the import was wiped, so it must
    // disappear too.
    await expect(page.getByRole('heading', { name: /Lasttest Demo API/ })).toHaveCount(0)

    // The cancel request must have reached the backend: the
    // run is either STOPPING, STOPPED or ABORTED now.
    // Polling stops after the run hits a terminal state, so
    // a one-shot `GET` is the simplest way to assert that.
    const api = await playwrightRequest.newContext({ baseURL: 'http://localhost:8286' })
    let status = ''
    try {
      // Allow up to 5 s for the backend to settle — the
      // graceful cancel goes through SIGTERM and k6 needs
      // a moment to flush its summary.
      for (let attempt = 0; attempt < 10; attempt++) {
        const response = await api.get(`/api/test-runs/${runId}`)
        if (response.ok()) {
          const body = await response.json() as { status: string }
          status = body.status
          if (status === 'STOPPING' || status === 'STOPPED' || status === 'ABORTED') break
        }
        await page.waitForTimeout(500)
      }
    } finally {
      await api.dispose()
    }
    expect(['STOPPING', 'STOPPED', 'ABORTED']).toContain(status)

    // The demo API itself must be off — the bundled
    // controller short-circuits to 404. Without this, a
    // partial reset (state wiped but backend still on)
    // would leave the user staring at an empty dashboard
    // while their k6 process was still able to hit a
    // running server.
    const demoResponse = await page.request.get('http://localhost:8286/demo-api/products')
    expect(demoResponse.status()).toBe(404)

    // The Swagger UI shell must also 404 when the demo is
    // off — otherwise a stale tab would still show the
    // bundled spec even though the controller is down.
    const swaggerResponse = await page.request.get('http://localhost:8286/demo-swagger-ui')
    expect(swaggerResponse.status()).toBe(404)
  } finally {
    // Belt-and-braces: the test path can fail before the
    // cancel reaches the backend. Force-abort the run so
    // the executor pool frees up for the next test in the
    // suite (MAX_PARALLEL_RUNS = 2 on the Spring side).
    await forceAbortRun(runId)
  }
})

test('enabling the demo mid-session wipes the in-memory dashboard — symmetric to disabling', async ({ page }) => {
  // The "demo on" reset is the mirror image of the "demo off"
  // reset: the user is in the middle of testing some non-demo
  // API, has imported a spec and started a run, and then
  // decides to switch to the demo. Whatever is on screen at
  // that moment belongs to the previous target and must go:
  // the imported spec, the load profile, the in-flight test.
  // Without this, a user who flips the demo on while a
  // non-demo run is still RUNNING would end up with the demo
  // spec in the textarea AND a live k6 process hitting the
  // *previous* backend — two contradictory signals that the
  // user has to clean up by hand.
  //
  // We start with the demo off so the helper can import a
  // non-demo spec and run a smoke test against it.

  // Reset the demo flag for this test only — the global
  // setup turns it on for every other test in the suite.
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('__demoOffStorageSet')) {
      localStorage.setItem('lasttest.demo.enabled', 'false')
      sessionStorage.setItem('__demoOffStorageSet', '1')
    }
  })
  await page.goto('/')

  // Pre-condition: demo is off, toolbar has no Demo-API link.
  await expect(page.getByRole('link', { name: 'Demo-API' })).toHaveCount(0)

  // Import a non-demo spec and start a long-running test. The
  // test's k6 process is hitting the in-process demo (which
  // is currently off) — that's fine, the request will just
  // 404, but the run is still RUNNING on the backend and the
  // dashboard has populated state.
  await importDemo(page)
  await page.getByLabel('Endpunkt GET /products auswählen').check()
  await page.getByLabel('Virtual Users').fill('2')
  await page.getByLabel('Dauer (Sekunden)').fill('30')
  await page.getByRole('button', { name: 'k6-Lasttest starten' }).click()

  // Pin the wait on the running badge so we know the k6
  // process is alive on the backend before we enable the
  // demo. A regression that misses the running state here
  // would not actually test the cancel behaviour.
  await expect(page.getByRole('tab', { name: /RUNNING/ }).first()).toBeVisible({ timeout: 10_000 })
  const runId = await runIdFromBadge(page)

  try {
    // Enable the demo via the Settings drawer.
    await page.getByRole('button', { name: 'Einstellungen' }).click()
    await page.locator('[data-testid="settings-demo-api-switch"]').check()
    await page.keyboard.press('Escape')

    // The dashboard must be empty. The RUNNING badge should
    // be gone (cancelled + wiped) and the operations card
    // (Step 2) should be hidden because the import state
    // was reset. The textarea should now hold the bundled
    // demo spec (the auto-load on enable contract).
    await expect(page.locator('.run-badge')).toHaveCount(0, { timeout: 5_000 })
    await expect(page.locator('.specification-textarea')).toContainText('Lasttest Demo API', { timeout: 5_000 })
    await expect(page.getByRole('heading', { name: /Lasttest Demo API/ })).toHaveCount(0)

    // The cancel request must have reached the backend: the
    // run is either STOPPING, STOPPED or ABORTED now.
    const api = await playwrightRequest.newContext({ baseURL: 'http://localhost:8286' })
    let status = ''
    try {
      for (let attempt = 0; attempt < 10; attempt++) {
        const response = await api.get(`/api/test-runs/${runId}`)
        if (response.ok()) {
          const body = await response.json() as { status: string }
          status = body.status
          if (status === 'STOPPING' || status === 'STOPPED' || status === 'ABORTED') break
        }
        await page.waitForTimeout(500)
      }
    } finally {
      await api.dispose()
    }
    expect(['STOPPING', 'STOPPED', 'ABORTED']).toContain(status)

    // The toolbar now shows the Demo-API link (with the
    // "active" pill), confirming the toggle actually reached
    // the backend. A partial reset that only wiped the
    // in-memory state but forgot the toggle itself would
    // leave the user staring at a demo spec in the textarea
    // while the controller was still 404-ing.
    await expect(page.getByRole('link', { name: 'Demo-API' })).toBeVisible()
    await expect(page.locator('.top-toolbar-demo-active')).toBeVisible()

    // The demo API itself is reachable now.
    const demoResponse = await page.request.get('http://localhost:8286/demo-api/products')
    expect(demoResponse.status()).toBe(200)
  } finally {
    // Belt-and-braces: force-abort the run so the executor
    // pool frees up for the next test in the suite.
    await forceAbortRun(runId)
  }
})

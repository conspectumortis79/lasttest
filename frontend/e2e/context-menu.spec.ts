import { expect, test, type Page, request as playwrightRequest } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Standalone smoke tests for the right-click run-badge context
// menu. The tests clean up between runs so they don't starve the
// Spring backend's executor pool (`MAX_PARALLEL_RUNS = 2`).
// Each test force-cancels any run it creates in afterEach so
// the executor thread frees up before the next test starts.

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const demoSpecification = path.resolve(currentDirectory, '../../demo/openapi-demo.yaml')

async function importDemo(page: Page) {
  await page.locator('input[type="file"]').setInputFiles(demoSpecification)
  await page.getByRole('button', { name: 'Validieren & importieren' }).click()
  await expect(page.getByRole('heading', { name: /Lasttest Demo API/ })).toBeVisible()
}

// Read the run id from the badge title (`<uuid> · GET /...`).
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
  // Pin the language to German via localStorage so the
  // button labels, menu items and status texts match the
  // assertions below. Without this the default English
  // chrome breaks every selector that names a translated
  // string. `addInitScript` runs before any page script,
  // so the React LanguageProvider reads the stored value
  // on its first read.
  await page.addInitScript(() => {
    localStorage.setItem('lasttest.language', 'de')
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'lasttest' })).toBeVisible()
})

test('context menu opens on right-click and closes on Escape', async ({ page }) => {
  await importDemo(page)
  await page.getByLabel('Virtual Users').fill('1')
  await page.getByLabel('Dauer (Sekunden)').fill('5')
  await page.getByRole('button', { name: 'k6-Lasttest starten' }).click()

  try {
    const badge = page.locator('.run-badge').first()
    await expect(badge).toBeVisible({ timeout: 10_000 })

    await badge.click({ button: 'right' })

    const menu = page.locator('.run-context-menu')
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Live-Details anzeigen' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Stop (graceful)' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Force abort' })).toBeVisible()
    // The "open k6 web report" item is present in both in-flight
    // and terminal menus — it is an *additional* access point,
    // not a replacement for the existing detail-report button.
    await expect(menu.getByRole('menuitem', { name: 'k6-Webreport öffnen' })).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
  } finally {
    const id = await runIdFromBadge(page).catch(() => '')
    if (id) await forceAbortRun(id)
  }
})

test('graceful stop transitions the badge from RUNNING to STOPPED (freeze regression)', async ({ page }) => {
  // Regression test for the bug where the polling stopped at
  // STOPPING and the badge froze there forever. We start a
  // short run, wait for RUNNING, click Stop (graceful), and
  // require the badge to reach STOPPED within a small window.
  await importDemo(page)
  await page.getByLabel('Virtual Users').fill('1')
  await page.getByLabel('Dauer (Sekunden)').fill('30')
  await page.getByRole('button', { name: 'k6-Lasttest starten' }).click()

  try {
    const badge = page.locator('.run-badge').first()
    await expect(badge).toBeVisible({ timeout: 15_000 })
    await expect(badge).toHaveClass(/run-badge-running|run-badge-stopping/, { timeout: 30_000 })

    await badge.click({ button: 'right' })
    const menu = page.locator('.run-context-menu')
    await expect(menu).toBeVisible()
    await menu.getByRole('menuitem', { name: 'Stop (graceful)' }).click()

    // The badge must transition all the way from RUNNING through
    // STOPPING to a terminal STOPPED state. Without the polling
    // fix the badge would freeze on STOPPING.
    await expect(badge).toContainText('STOPPING', { timeout: 5_000 })
    await expect(badge).toContainText('STOPPED', { timeout: 15_000 })
  } finally {
    const id = await runIdFromBadge(page).catch(() => '')
    if (id) await forceAbortRun(id)
  }
})

test('cancel endpoint refuses an unknown id with a 404', async () => {
  // Pure API check: drive the cancel endpoint against an id
  // that does not exist. The frontend surfaces a 404 with a
  // banner; this just confirms the wire contract.
  const api = await playwrightRequest.newContext({ baseURL: 'http://localhost:8286' })
  try {
    const response = await api.post('/api/test-runs/never-exists/cancel?force=false')
    expect(response.status()).toBe(404)
  } finally {
    await api.dispose()
  }
})

test('right-click on a completed badge removes it from the dashboard', async ({ page }) => {
  // End-to-end check for the "Aus Ansicht entfernen" menu
  // entry: starts a short run, waits for it to settle in a
  // terminal state, right-clicks the badge, picks the entry,
  // and asserts the badge disappears from the grid. The
  // backend keeps the run, but the in-memory dashboard map
  // drops it so the UI updates immediately.
  await importDemo(page)
  await page.getByLabel('Virtual Users').fill('1')
  await page.getByLabel('Dauer (Sekunden)').fill('3')
  await page.getByRole('button', { name: 'k6-Lasttest starten' }).click()

  try {
    const badge = page.locator('.run-badge').first()
    await expect(badge).toBeVisible({ timeout: 10_000 })
    // Wait for the run to reach a terminal state. The demo API
    // answers 200, so the badge ends up as COMPLETED.
    await expect(badge).toContainText('COMPLETED', { timeout: 30_000 })

    const id = await runIdFromBadge(page)
    await badge.click({ button: 'right' })
    const menu = page.locator('.run-context-menu')
    await expect(menu).toBeVisible()
    await menu.getByRole('menuitem', { name: 'Aus Ansicht entfernen' }).click()

    // The badge must disappear from the grid. We match the
    // specific id so we don't accidentally match a sibling
    // badge that might appear later.
    await expect(page.locator(`.run-badge[title^="${id}"]`)).toHaveCount(0)
  } finally {
    // The run may already be terminal; a force-cancel is a
    // safe no-op then, but it keeps the cleanup contract
    // consistent with the other tests in this file.
    const id = await page.locator('.run-badge').first().getAttribute('title').catch(() => '')
    if (id) await forceAbortRun(id.split(' · ')[0] ?? '')
  }
})

test('right-click on a failed badge offers "Alle anderen fehlgeschlagenen entfernen" which clears the other FAILED badges', async ({ page }) => {
  // Bulk cleanup check: right-click on a FAILED badge and
  // confirm the bulk-remove entry drops every other FAILED
  // badge from the dashboard. We use the cancel endpoint to
  // turn two runs into STOPPED-equivalent terminal states
  // before the test reaches the menu — the FAILED status is
  // harder to provoke from the happy-path demo API, so this
  // test directly seeds two FAILED runs via the API.
  const api = await playwrightRequest.newContext({ baseURL: 'http://localhost:8286' })
  let firstRunId = ''
  let secondRunId = ''
  try {
    await importDemo(page)
    // Start the first run normally so the frontend owns its
    // in-memory record (the dashboard then polls it and
    // surfaces it as a badge).
    await page.getByLabel('Virtual Users').fill('1')
    await page.getByLabel('Dauer (Sekunden)').fill('3')
    await page.getByRole('button', { name: 'k6-Lasttest starten' }).click()
    const firstBadge = page.locator('.run-badge').first()
    await expect(firstBadge).toBeVisible({ timeout: 10_000 })
    firstRunId = await runIdFromBadge(page)

    // Drive the run into a FAILED state by cancelling it
    // forcefully: SIGKILL on a still-running k6 process
    // is reported by the backend as FAILED with a
    // partial / no-summary payload. The dashboard picks
    // that up on the next poll tick.
    await api.post(`/api/test-runs/${firstRunId}/cancel?force=true`)
    await expect(firstBadge).toContainText('FAILED', { timeout: 10_000 })

    // Seed a second FAILED run via the API so the bulk
    // action has another badge to remove. We do not need
    // the frontend to ever display it — we just need a
    // second FAILED record that the bulk removal will
    // clean up after a page reload. Reload the page so
    // the frontend re-hydrates its in-memory map from
    // /api/test-runs.
    secondRunId = await (async () => {
      const startResponse = await api.post('/api/test-runs', {
        data: {
          specification: await (await api.get('/api/demo-specification')).text(),
          baseUrl: 'http://localhost:8286',
          operationIds: ['homepage'],
          operationConfigurations: {},
          loadProfile: {
            executor: 'constant-vus',
            vus: 1,
            duration: '1s',
            payloadStrategy: 'sequential',
          },
        },
      })
      const body = await startResponse.json()
      const id = body.id as string
      await api.post(`/api/test-runs/${id}/cancel?force=true`)
      return id
    })()

    await page.reload()
    const badges = page.locator('.run-badge')
    // At least the two FAILED badges must be visible after
    // the re-hydration. Other runs may linger from prior
    // tests; the bulk action targets only FAILED entries.
    await expect(badges.first()).toBeVisible({ timeout: 15_000 })
    const failedBadges = page.locator('.run-badge-failed')
    expect(await failedBadges.count()).toBeGreaterThanOrEqual(2)

    // Right-click the first FAILED badge, then click the
    // bulk entry. The clicked badge stays, every other
    // FAILED badge disappears.
    await failedBadges.first().click({ button: 'right' })
    const menu = page.locator('.run-context-menu')
    await expect(menu).toBeVisible()
    await menu.getByRole('menuitem', { name: 'Alle anderen fehlgeschlagenen Läufe entfernen' }).click()

    // Exactly one FAILED badge (the clicked one) must remain.
    await expect(failedBadges).toHaveCount(1)
  } finally {
    await api.dispose()
    if (firstRunId) await forceAbortRun(firstRunId)
    if (secondRunId) await forceAbortRun(secondRunId)
  }
})

test('bulk "remove all other failed" is disabled when no other FAILED run is present', async ({ page }) => {
  // UX check: when the clicked terminal badge is the only
  // FAILED one in the dashboard, the bulk entry must be
  // visible but disabled with an explanatory reason so the
  // user is not tempted to click an action with no effect.
  const api = await playwrightRequest.newContext({ baseURL: 'http://localhost:8286' })
  let runId = ''
  try {
    await importDemo(page)
    await page.getByLabel('Virtual Users').fill('1')
    await page.getByLabel('Dauer (Sekunden)').fill('3')
    await page.getByRole('button', { name: 'k6-Lasttest starten' }).click()
    const badge = page.locator('.run-badge').first()
    await expect(badge).toBeVisible({ timeout: 10_000 })
    runId = await runIdFromBadge(page)
    await api.post(`/api/test-runs/${runId}/cancel?force=true`)
    await expect(badge).toContainText('FAILED', { timeout: 10_000 })

    // Wait for any stale COMPLETED siblings from previous
    // tests to drop from the polling map by reloading; this
    // also guarantees the dashboard sees only the freshly
    // started FAILED run on a clean page.
    await page.reload()
    const failedBadges = page.locator('.run-badge-failed')
    await expect(failedBadges.first()).toBeVisible({ timeout: 15_000 })

    await failedBadges.first().click({ button: 'right' })
    const menu = page.locator('.run-context-menu')
    await expect(menu).toBeVisible()
    const bulkItem = menu.getByRole('menuitem', { name: 'Alle anderen fehlgeschlagenen Läufe entfernen' })
    await expect(bulkItem).toBeVisible()
    await expect(bulkItem).toBeDisabled()
  } finally {
    await api.dispose()
    if (runId) await forceAbortRun(runId)
  }
})

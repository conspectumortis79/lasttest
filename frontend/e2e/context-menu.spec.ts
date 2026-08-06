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

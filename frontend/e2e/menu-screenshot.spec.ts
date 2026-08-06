import { expect, test, type Page, request as playwrightRequest } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Visual snapshot of the run-badge context menu in its four
// observed states. The PNGs land in `test-results/`:
//   - menu-in-flight.png        : Stop / Force abort visible
//   - menu-stopped.png          : STOPPED summary row visible
//   - menu-aborted.png          : ABORTED summary row visible
//
// The aborted/stopped snapshots are taken after a real cancel so
// the backend transitions are exercised end-to-end.

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const demoSpecification = path.resolve(currentDirectory, '../../demo/openapi-demo.yaml')

async function importDemo(page: Page) {
  await page.locator('input[type="file"]').setInputFiles(demoSpecification)
  await page.getByRole('button', { name: 'Validieren & importieren' }).click()
  await expect(page.getByRole('heading', { name: /Lasttest Demo API/ })).toBeVisible()
}

async function runIdFromBadge(page: Page): Promise<string> {
  const title = await page.locator('.run-badge').first().getAttribute('title')
  return title?.split(' · ')[0] ?? ''
}

async function forceAbortRun(runId: string): Promise<void> {
  const api = await playwrightRequest.newContext({ baseURL: 'http://localhost:8286' })
  try {
    await api.post(`/api/test-runs/${runId}/cancel?force=true`)
  } finally {
    await api.dispose()
  }
}

async function gracefulStopRun(runId: string): Promise<void> {
  const api = await playwrightRequest.newContext({ baseURL: 'http://localhost:8286' })
  try {
    await api.post(`/api/test-runs/${runId}/cancel?force=false`)
  } finally {
    await api.dispose()
  }
}

test('in-flight menu', async ({ page }) => {
  await page.goto('/')
  await importDemo(page)
  await page.getByLabel('Virtual Users').fill('1')
  await page.getByLabel('Dauer (Sekunden)').fill('30')
  await page.getByRole('button', { name: 'k6-Lasttest starten' }).click()

  const badge = page.locator('.run-badge').first()
  await expect(badge).toBeVisible({ timeout: 15_000 })

  // Snapshot the in-flight menu while k6 is still running. We
  // do not wait for RUNNING because the executor pool can be
  // saturated on a cold start; the menu items are identical
  // from QUEUED onward.
  await badge.click({ button: 'right' })
  await expect(page.locator('.run-context-menu')).toBeVisible()
  await page.screenshot({ path: 'test-results/menu-in-flight.png', fullPage: true })

  // Clean up before the next test so the executor thread frees.
  const id = await runIdFromBadge(page).catch(() => '')
  if (id) await forceAbortRun(id)
})

test('graceful-stopped summary', async ({ page }) => {
  await page.goto('/')
  await importDemo(page)
  await page.getByLabel('Virtual Users').fill('1')
  await page.getByLabel('Dauer (Sekunden)').fill('30')
  await page.getByRole('button', { name: 'k6-Lasttest starten' }).click()

  try {
    const badge = page.locator('.run-badge').first()
    await expect(badge).toBeVisible({ timeout: 15_000 })
    // Wait until the backend actually picked the run up before
    // cancelling — otherwise cancel returns 409 because no k6
    // process has been spawned yet.
    await expect(badge).toHaveClass(/run-badge-running|run-badge-stopping/, { timeout: 30_000 })
    await gracefulStopRun(await runIdFromBadge(page))
    // The badge must transition through STOPPING to STOPPED; if
    // it freezes on STOPPING the polling fix did not work.
    await expect(badge).toContainText('STOPPED', { timeout: 15_000 })
    await page.screenshot({ path: 'test-results/menu-stopped.png', fullPage: true })
  } finally {
    const id = await runIdFromBadge(page).catch(() => '')
    if (id) await forceAbortRun(id)
  }
})

test('aborted summary', async ({ page }) => {
  await page.goto('/')
  await importDemo(page)
  await page.getByLabel('Virtual Users').fill('1')
  await page.getByLabel('Dauer (Sekunden)').fill('30')
  await page.getByRole('button', { name: 'k6-Lasttest starten' }).click()

  try {
    const badge = page.locator('.run-badge').first()
    await expect(badge).toBeVisible({ timeout: 15_000 })
    await forceAbortRun(await runIdFromBadge(page))
    await expect(badge).toContainText('ABORTED', { timeout: 15_000 })
    await page.screenshot({ path: 'test-results/menu-aborted.png', fullPage: true })
  } finally {
    const id = await runIdFromBadge(page).catch(() => '')
    if (id) await forceAbortRun(id)
  }
})

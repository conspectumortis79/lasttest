import { test, expect, type Page } from '@playwright/test'
import { importDemo, startDemoRunAndAwaitTerminal } from './helpers.ts'

test.describe.configure({ mode: 'serial' })

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

async function newestRunId(page: Page): Promise<string> {
  const runs = await page.evaluate(async () => {
    const response = await fetch('/api/test-runs')
    return (await response.json()) as Array<{ id: string, createdAt: string }>
  })
  if (runs.length === 0) throw new Error('no runs on the server')

  const sorted = [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return sorted[0]?.id ?? ''
}

test('Rerun issues POST /api/test-runs/{id}/rerun and the fresh run lands in the grid', async ({ page }) => {
  test.setTimeout(120_000)
  await startDemoRunAndAwaitTerminal(page, { operation: 'listProducts', vus: '1', duration: '1' })
  const originalId = await newestRunId(page)
  expect(originalId).toBeTruthy()

  await page.locator('.run-grid .run-badge').first().click({ button: 'right' })
  const menu = page.locator('.run-context-menu')
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: /Rerun/i })).toBeVisible()
  await menu.getByRole('menuitem', { name: /Rerun/i }).click()
  await expect(page.locator('.run-grid .run-badge')).toHaveCount(2, { timeout: 30_000 })
  const ids = await page.evaluate(async () => {
    const response = await fetch('/api/test-runs')
    return ((await response.json()) as Array<{ id: string }>).map(r => r.id)
  })
  expect(ids).toContain(originalId)
  expect(ids.find(id => id === originalId)).toBe(originalId)
  const freshId = ids.find(id => id !== originalId)
  expect(freshId, 'a new run id must appear after Rerun').toBeTruthy()
})

test('Stop (graceful) cancels an in-flight run via the right-click menu', async ({ page }) => {
  test.setTimeout(90_000)
  await importDemo(page)
  await page.getByLabel('Virtual Users').fill('1')
  await page.getByLabel('Duration (seconds)').fill('60')
  await page.getByRole('button', { name: 'Start k6 load test' }).click()
  await expect(page.locator('.run-grid .run-badge-running').first()).toBeVisible({ timeout: 30_000 })
  await page.locator('.run-grid .run-badge').first().click({ button: 'right' })
  const menu = page.locator('.run-context-menu')
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: /^Stop/i })).toBeVisible()
  await menu.getByRole('menuitem', { name: /^Stop/i }).click()

  await expect(page.locator('.run-grid .run-badge-running')).toHaveCount(0, { timeout: 30_000 })
  const terminalBadge = page.locator('.run-grid .run-badge-stopped, .run-grid .run-badge-completed').first()
  await expect(terminalBadge).toBeVisible({ timeout: 30_000 })
})

test('Open k6 web report from the menu opens the report page in a new tab', async ({ page, context }) => {
  test.setTimeout(90_000)
  await startDemoRunAndAwaitTerminal(page, { operation: 'listProducts', vus: '1', duration: '1' })
  const id = await newestRunId(page)
  expect(id).toBeTruthy()

  await page.locator('.run-grid .run-badge').first().click({ button: 'right' })
  const menu = page.locator('.run-context-menu')
  await expect(menu).toBeVisible()
  const [newTab] = await Promise.all([
    context.waitForEvent('page'),
    menu.getByRole('menuitem', { name: /Open k6 web report/i }).click(),
  ])
  await newTab.waitForLoadState('domcontentloaded')
  const url = new URL(newTab.url())
  expect(url.pathname).toBe('/')
  expect(url.searchParams.get('report')).toBe(id)
  await newTab.close()
})

test('Download k6 script from the menu triggers a file download', async ({ page }) => {
  test.setTimeout(90_000)
  await startDemoRunAndAwaitTerminal(page, { operation: 'listProducts', vus: '1', duration: '1' })
  await page.locator('.run-grid .run-badge').first().click({ button: 'right' })
  const menu = page.locator('.run-context-menu')
  await expect(menu).toBeVisible()
  const downloadPromise = page.waitForEvent('download', { timeout: 15_000 })
  await menu.getByRole('menuitem', { name: /Download k6 script/i }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/\.js$/)
})

test('Export k6 JSON from the menu triggers a JSON file download', async ({ page }) => {
  test.setTimeout(90_000)
  await startDemoRunAndAwaitTerminal(page, { operation: 'listProducts', vus: '1', duration: '1' })
  await page.locator('.run-grid .run-badge').first().click({ button: 'right' })
  const menu = page.locator('.run-context-menu')
  await expect(menu).toBeVisible()
  const downloadPromise = page.waitForEvent('download', { timeout: 15_000 })
  await menu.getByRole('menuitem', { name: /Export k6 JSON/i }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/\.json$/)
})

test('Copy report link writes the deep-link URL to the clipboard', async ({ page, context, browserName }) => {
  test.setTimeout(90_000)
  if (browserName === 'chromium') {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  }
  await startDemoRunAndAwaitTerminal(page, { operation: 'listProducts', vus: '1', duration: '1' })
  const id = await newestRunId(page)
  expect(id).toBeTruthy()

  await page.locator('.run-grid .run-badge').first().click({ button: 'right' })
  const menu = page.locator('.run-context-menu')
  await expect(menu).toBeVisible()
  await menu.getByRole('menuitem', { name: /Copy report link/i }).click()

  await page.waitForTimeout(200)
  const clipboard = await page.evaluate(() => navigator.clipboard.readText())
  expect(clipboard).toContain(`report=${id}`)
  expect(clipboard).toMatch(/^https?:\/\//)
})

test('In-flight menu offers Stop + Force abort and hides Rerun + Remove', async ({ page }) => {
  test.setTimeout(90_000)
  await importDemo(page)
  await page.getByLabel('Virtual Users').fill('1')
  await page.getByLabel('Duration (seconds)').fill('60')
  await page.getByRole('button', { name: 'Start k6 load test' }).click()
  await expect(page.locator('.run-grid .run-badge-running').first()).toBeVisible({ timeout: 30_000 })

  await page.locator('.run-grid .run-badge').first().click({ button: 'right' })
  const menu = page.locator('.run-context-menu')
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: /Copy run id/i })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: /Open k6 web report/i })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: /^Stop/i })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: /Force abort/i })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: /^Rerun/i })).toHaveCount(0)
  await expect(menu.getByRole('menuitem', { name: /Remove from view/i })).toHaveCount(0)
  // Cancel the in-flight run so the next test starts clean.
  await menu.getByRole('menuitem', { name: /Force abort/i }).click()
  await expect(page.locator('.run-grid .run-badge-running')).toHaveCount(0, { timeout: 30_000 })
})

test('Remove all other failed wipes every other FAILED badge from the dashboard', async ({ page }) => {
  test.setTimeout(240_000)
  await importDemo(page)
  for (let i = 0; i < 2; i++) {
    await page.getByLabel(endpointCheckboxLabelLocal('GET', '/products')).uncheck().catch(() => undefined)
    await page.getByLabel(endpointCheckboxLabelLocal('POST', '/products/search')).check()
    await expandOperationLocal(page, 'searchProducts')
    await page.getByLabel('searchProducts · Payload 1: JSON Request-Body').fill('{"category":"hardware","maxPrice":100}')
    await page.getByLabel('searchProducts · Payload 1: Bearer token').fill('definitely-wrong-token')
    await page.getByLabel('Virtual Users').fill('1')
    await page.getByLabel('Duration (seconds)').fill('1')
    await page.getByRole('button', { name: 'Start k6 load test' }).click()
    await expect(page.locator('.run-grid .run-badge-failed').first()).toBeVisible({ timeout: 60_000 })
  }
  await expect(page.locator('.run-grid .run-badge-failed')).toHaveCount(2)

  await page.locator('.run-grid .run-badge-failed').first().click({ button: 'right' })
  const menu = page.locator('.run-context-menu')
  await expect(menu).toBeVisible()
  const removeAll = menu.getByRole('menuitem', { name: /Remove all other failed/i })
  await expect(removeAll).toBeVisible()
  await expect(removeAll).toBeEnabled()
  await removeAll.click()
  await expect(page.locator('.run-grid .run-badge-failed')).toHaveCount(1, { timeout: 10_000 })
})

function endpointCheckboxLabelLocal(method: string, path: string): string {
  return `Endpunkt ${method} ${path} auswählen`
}

async function expandOperationLocal(page: Page, operationId: string): Promise<void> {
  const card = page.locator('.operation-card', {
    has: page.getByLabel(`Operation ${operationId}`),
  })
  const toggle = card.locator('button.expand-toggle')
  if ((await toggle.getAttribute('aria-expanded')) === 'false') {
    await toggle.click()
  }
}

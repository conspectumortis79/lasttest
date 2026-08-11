import { test, expect } from './demoToggleFixture.ts'
import { importDemo, startDemoRunAndAwaitTerminal, endpointCheckboxLabel } from './helpers.ts'

test.describe.configure({ mode: 'serial' })

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('lists a single run in the run grid after one smoke test', async ({ page }) => {
  test.setTimeout(180_000)
  await startDemoRunAndAwaitTerminal(page, { operation: 'listProducts', vus: '1', duration: '1' })
  await expect(page.locator('.run-grid .run-badge')).toHaveCount(1)
  await expect(page.locator('.run-grid .run-badge-completed')).toBeVisible()
})

test('accumulates runs in the run grid', async ({ page }) => {
  test.setTimeout(240_000)
  await importDemo(page)
  await page.getByLabel(endpointCheckboxLabel('GET', '/products')).check()
  await page.getByLabel('Virtual Users').fill('1')
  await page.getByLabel('Duration (seconds)').fill('1')

  await page.getByRole('button', { name: 'Start k6 load test' }).click()
  await page.locator('.run-grid .run-badge-completed').first().waitFor({ timeout: 60_000 })

  await page.getByLabel(endpointCheckboxLabel('GET', '/products')).check()
  await page.getByRole('button', { name: 'Start k6 load test' }).click()
  await expect(page.locator('.run-grid .run-badge-completed')).toHaveCount(2, { timeout: 60_000 })
})

test('opens the right-click context menu with the expected entries', async ({ page }) => {
  test.setTimeout(90_000)
  await startDemoRunAndAwaitTerminal(page, { operation: 'listProducts', vus: '1', duration: '1' })
  const row = page.locator('.run-grid .run-badge').first()
  await row.click({ button: 'right' })
  const menu = page.locator('.run-context-menu')
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: /Copy report link/i })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: /Open k6 web report/i })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: /Download k6 script/i })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: /Export k6 JSON/i })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: /Rerun/i })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: /Remove from view/i })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: /Stop/i })).toHaveCount(0)
  await expect(menu.getByRole('menuitem', { name: /Force abort/i })).toHaveCount(0)
})

test('clicking outside the menu closes it', async ({ page }) => {
  test.setTimeout(90_000)
  await startDemoRunAndAwaitTerminal(page, { operation: 'listProducts', vus: '1', duration: '1' })
  const row = page.locator('.run-grid .run-badge').first()
  await row.click({ button: 'right' })
  await expect(page.locator('.run-context-menu')).toBeVisible()
  await page.locator('h2', { hasText: 'Test Runs' }).click()
  await expect(page.locator('.run-context-menu')).toHaveCount(0)
})

test('Remove from view drops the row from the dashboard', async ({ page }) => {
  test.setTimeout(90_000)
  await startDemoRunAndAwaitTerminal(page, { operation: 'listProducts', vus: '1', duration: '1' })
  await expect(page.locator('.run-grid .run-badge')).toHaveCount(1)
  await page.locator('.run-grid .run-badge').first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: /Remove from view/i }).click()
  await expect(page.locator('.run-grid .run-badge')).toHaveCount(0)
})

test('left-clicking a badge focuses it as the active tab', async ({ page }) => {
  test.setTimeout(90_000)
  await startDemoRunAndAwaitTerminal(page, { operation: 'listProducts', vus: '1', duration: '1' })
  const row = page.locator('.run-grid .run-badge').first()
  await row.click()
  await expect(row).toHaveAttribute('aria-selected', 'true')
})

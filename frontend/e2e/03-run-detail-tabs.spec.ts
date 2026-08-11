import { test, expect } from './demoToggleFixture.ts'
import { startDemoRunAndAwaitTerminal } from './helpers.ts'

test.describe.configure({ mode: 'serial' })

async function bootRunDetailTabs(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/')
  await startDemoRunAndAwaitTerminal(page, { operation: 'listProducts', vus: '1', duration: '1' })
  await expect(page.locator('.run-detail-tabs')).toBeVisible({ timeout: 30_000 })
}

test('shows every tab in the strip', async ({ page }) => {
  test.setTimeout(90_000)
  await bootRunDetailTabs(page)
  for (const label of ['Overview', 'Timeline', 'Actions', 'k6 console', 'Thresholds', 'Configuration', 'Failure diagnosis', 'k6 script']) {
    await expect(page.getByRole('tab', { name: label })).toBeVisible()
  }
})

test('the Overview tab is selected by default', async ({ page }) => {
  test.setTimeout(90_000)
  await bootRunDetailTabs(page)
  await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
})

test('switching tabs preserves the active tab indicator', async ({ page }) => {
  test.setTimeout(90_000)
  await bootRunDetailTabs(page)
  await page.getByRole('tab', { name: 'Configuration' }).click()
  await expect(page.getByRole('tab', { name: 'Configuration' })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('tab', { name: 'Overview' }).click()
  await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
})

test('the Configuration tab echoes the API title and base URL', async ({ page }) => {
  test.setTimeout(90_000)
  await bootRunDetailTabs(page)
  await page.getByRole('tab', { name: 'Configuration' }).click()
  await expect(page.getByText('Lasttest Demo API').first()).toBeVisible()
  await expect(page.getByText('GET').first()).toBeVisible()
  await expect(page.getByText('/products').first()).toBeVisible()
})

test('the Thresholds tab shows pass / fail rows for the smoke run', async ({ page }) => {
  test.setTimeout(90_000)
  await bootRunDetailTabs(page)
  await page.getByRole('tab', { name: 'Thresholds' }).click()
  await expect(page.locator('.thresholds-table')).toBeVisible()
  await expect(page.getByText('http_req_failed').first()).toBeVisible()
  await expect(page.getByText('http_req_duration').first()).toBeVisible()
})

test('the k6 console tab shows the captured stdout / stderr', async ({ page }) => {
  test.setTimeout(90_000)
  await bootRunDetailTabs(page)
  await page.getByRole('tab', { name: 'k6 console' }).click()
  await expect(page.locator('.console-tab')).toBeVisible()
})

test('the k6 script tab shows the generated script and the manual command', async ({ page }) => {
  test.setTimeout(90_000)
  await bootRunDetailTabs(page)
  await page.getByRole('tab', { name: 'k6 script' }).click()
  await expect(page.getByTestId('k6-script-source')).toBeVisible()
  await expect(page.getByTestId('k6-script-source')).toContainText('import http')
  await expect(page.getByTestId('k6-script-command')).toBeVisible()
  await expect(page.getByTestId('k6-script-command')).toContainText('k6 run')
})

test('the Actions tab offers Rerun / Remove controls for terminal runs', async ({ page }) => {
  test.setTimeout(90_000)
  await bootRunDetailTabs(page)
  await page.getByRole('tab', { name: 'Actions' }).click()
  await expect(page.getByRole('button', { name: /Rerun/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /Remove from view/i })).toBeVisible()
})

test('the "Open k6 report" external button opens the report URL', async ({ page }) => {
  test.setTimeout(90_000)
  await bootRunDetailTabs(page)
  const button = page.locator('.run-detail-tab-external')
  await expect(button).toBeVisible()
  const popupPromise = page.waitForEvent('popup')
  await button.click()
  const popup = await popupPromise
  await popup.waitForLoadState('domcontentloaded')
  expect(popup.url()).toContain('?report=')
  await popup.close()
})

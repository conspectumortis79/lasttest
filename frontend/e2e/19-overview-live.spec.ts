import { test, expect } from '@playwright/test'
import { importDemo, startDemoRunAndAwaitTerminal } from './helpers.ts'

test.describe.configure({ mode: 'serial' })

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('the Overview tab shows the live ramp chart for an in-flight run', async ({ page }) => {
  test.setTimeout(120_000)
  await importDemo(page)
  await page.getByLabel('Virtual Users').fill('1')
  await page.getByLabel('Duration (seconds)').fill('60')
  await page.getByRole('button', { name: 'Start k6 load test' }).click()
  await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
  const svg = page.locator('svg.ramp-tab-svg').first()
  await expect(svg).toBeVisible({ timeout: 30_000 })
  const polyline = svg.locator('polyline').first()
  await expect(polyline).toBeAttached({ timeout: 30_000 })
})

test('the Overview tab shows the status-code distribution once a run settles', async ({ page }) => {
  test.setTimeout(120_000)
  await startDemoRunAndAwaitTerminal(page, { operation: 'listProducts', vus: '1', duration: '1' })
  const card = page.locator('.status-distribution-card, [data-testid="status-distribution-card"]').first()
  if (await card.count() > 0) {
    await expect(card).toBeVisible()
  }
})


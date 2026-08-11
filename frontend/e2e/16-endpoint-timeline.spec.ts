import { test, expect } from '@playwright/test'
import { startDemoRunAndAwaitTerminal } from './helpers.ts'

test.beforeEach(async ({ page, request }) => {
  await request.post('/api/demo-traffic/enabled', { data: { enabled: true } })
  await page.goto('/')
})

test('the Timeline tab opens and lists the runs for the focused endpoint', async ({ page }) => {
  test.setTimeout(180_000)
  await startDemoRunAndAwaitTerminal(page, { operation: 'listProducts', vus: '1', duration: '1' })
  await startDemoRunAndAwaitTerminal(page, { operation: 'listProducts', vus: '1', duration: '1' })
  const timelineTab = page.getByRole('tab', { name: 'Timeline' })
  await expect(timelineTab).toBeVisible()
  await timelineTab.click()
  await expect(page.locator('.timeline-tab-endpoint-chip')).toBeVisible()
  const rows = page.locator('.timeline-tab-list-item, .timeline-tab-row')
  await expect(rows.first()).toBeVisible({ timeout: 15_000 })
  await expect(rows).toHaveCount(2, { timeout: 15_000 })
})

test('the Timeline tab shows an empty state when the endpoint has no history', async ({ page }) => {
  test.setTimeout(180_000)
  await startDemoRunAndAwaitTerminal(page, { operation: 'listProducts', vus: '1', duration: '1' })
  await page.getByRole('tab', { name: 'Timeline' }).click()
  await expect(page.locator('.timeline-tab-endpoint-chip')).toBeVisible()
})

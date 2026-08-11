import { test, expect } from '@playwright/test'
import { importDemo, expandOperation } from './helpers.ts'

test.describe.configure({ mode: 'serial' })

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.request.post('/api/demo-traffic/enabled', { data: { enabled: true } })
})

test('the Failure tab renders a diagnosis for a run that failed with bad credentials', async ({ page }) => {
  test.setTimeout(120_000)
  await importDemo(page)
  await page.getByLabel('Endpunkt GET /products auswählen').uncheck()
  await page.getByLabel('Endpunkt POST /products/search auswählen').check()
  await expandOperation(page, 'searchProducts')
  await page.getByLabel('searchProducts · Payload 1: JSON Request-Body').fill('{"category":"hardware","maxPrice":100}')
  await page.getByLabel('searchProducts · Payload 1: Bearer token').fill('definitely-wrong-token')

  await page.getByLabel('Virtual Users').fill('1')
  await page.getByLabel('Duration (seconds)').fill('2')
  await page.getByRole('button', { name: 'Start k6 load test' }).click()
  await expect(page.locator('.run-grid .run-badge-failed').first()).toBeVisible({ timeout: 60_000 })

  await page.getByRole('tab', { name: /Failure diagnosis/i }).click()
  await expect(page.locator('.failure-tab')).toBeVisible()
  await expect(page.locator('.failure-tab-card')).toBeVisible()
  const summary = page.locator('.failure-tab-summary').first()
  await expect(summary).toBeVisible()
  const text = await summary.textContent()
  expect(text?.trim().length ?? 0).toBeGreaterThan(0)
})

test('the Failure tab shows an empty state for a run that completed successfully', async ({ page }) => {
  test.setTimeout(90_000)
  await importDemo(page)
  await page.getByLabel('Virtual Users').fill('1')
  await page.getByLabel('Duration (seconds)').fill('1')
  await page.getByRole('button', { name: 'Start k6 load test' }).click()
  await expect(page.locator('.run-grid .run-badge-completed').first()).toBeVisible({ timeout: 60_000 })

  await page.getByRole('tab', { name: /Failure diagnosis/i }).click()
  await expect(page.locator('.run-tab-empty')).toBeVisible()
  await expect(page.locator('.run-tab-empty-title')).toBeVisible()
})

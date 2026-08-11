import { test, expect } from '@playwright/test'
import { expandOperation } from './helpers.ts'

test('an auth-failing run lands the FAILED pill', async ({ page, request }) => {
  test.setTimeout(120_000)
  await page.goto('/')
  await request.post('/api/demo-traffic/enabled', { data: { enabled: true } })

  await page.locator('input[type="file"]').setInputFiles(
    await import('./helpers.ts').then(m => m.demoSpecificationPath),
  )
  await page.getByRole('button', { name: 'Validate & import' }).click()
  await expect(page.getByRole('heading', { name: /Lasttest Demo API/ })).toBeVisible()

  await page.getByLabel('Endpunkt GET /products auswählen').uncheck()
  await page.getByLabel('Endpunkt POST /products/search auswählen').check()
  await expandOperation(page, 'searchProducts')
  await page.getByLabel('searchProducts · Payload 1: JSON Request-Body').fill('{"category":"hardware","maxPrice":100}')
  await page.getByLabel('searchProducts · Payload 1: Bearer token').fill('definitely-wrong-token')

  await page.getByLabel('Virtual Users').fill('1')
  await page.getByLabel('Duration (seconds)').fill('2')
  await page.getByRole('button', { name: 'Start k6 load test' }).click()

  await expect(page.locator('.status-badge.is-fail').first()).toBeVisible({ timeout: 60_000 })
})

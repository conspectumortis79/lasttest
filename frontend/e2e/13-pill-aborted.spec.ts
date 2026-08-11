import { test, expect } from '@playwright/test'
import { importInlineSpec } from './helpers.ts'

test('force-aborting an in-flight run lands the ABORTED pill', async ({ page, request }) => {
  test.setTimeout(180_000)
  await page.goto('/')
  await request.post('/api/demo-traffic/enabled', { data: { enabled: true } })

  await importInlineSpec(page, `openapi: 3.0.3
info:
  title: Abort Spec
  version: "1"
paths:
  /products:
    get:
      operationId: listProducts
      responses:
        '200':
          description: OK
`, 'Abort Spec')

  await page.locator('label', { hasText: 'Base URL' }).locator('input').fill('http://localhost:8286/demo-api')
  await page.getByLabel('Virtual Users').fill('1')
  await page.getByLabel('Duration (seconds)').fill('120')
  await page.getByRole('button', { name: 'Start k6 load test' }).click()

  await expect(page.locator('.run-grid .run-badge-running').first()).toBeVisible({ timeout: 30_000 })

  const { id } = await page.evaluate(async () => {
    const response = await fetch('/api/test-runs')
    const runs = await response.json() as Array<{ id: string }>
    return { id: runs[0]?.id ?? '' }
  })
  expect(id).toBeTruthy()
  await request.post(`/api/test-runs/${id}/cancel?force=true`)

  await expect(page.locator('.run-grid .run-badge-aborted').first()).toBeVisible({ timeout: 30_000 })
})

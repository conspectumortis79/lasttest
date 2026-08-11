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

test('the Actions tab renders every action group as a wide card', async ({ page }) => {
  test.setTimeout(90_000)
  await startDemoRunAndAwaitTerminal(page, { operation: 'listProducts', vus: '1', duration: '1' })
  await page.getByRole('tab', { name: 'Actions' }).click()
  await expect(page.locator('.aktionen')).toBeVisible()
  await expect(page.locator('.aktion-card').first()).toBeVisible()
  await expect(page.getByText(/^Controls$/i)).toBeVisible()
  await expect(page.getByText(/Share & export/i)).toBeVisible()
  await expect(page.getByText(/^Cleanup$/i)).toBeVisible()
})

test('Rerun card on a terminal run creates a new run on the server', async ({ page }) => {
  test.setTimeout(90_000)
  await startDemoRunAndAwaitTerminal(page, { operation: 'listProducts', vus: '1', duration: '1' })
  const originalId = await newestRunId(page)
  expect(originalId).toBeTruthy()

  await page.getByRole('tab', { name: 'Actions' }).click()
  const rerunCard = page.locator('.aktion-card', { hasText: /Rerun|Erneut starten/i }).first()
  await expect(rerunCard).toBeEnabled()
  await rerunCard.click()

  await expect(page.locator('.run-grid .run-badge')).toHaveCount(2, { timeout: 30_000 })
  const ids = await page.evaluate(async () => {
    const response = await fetch('/api/test-runs')
    return ((await response.json()) as Array<{ id: string }>).map(r => r.id)
  })
  expect(ids).toContain(originalId)
  const freshId = ids.find(id => id !== originalId)
  expect(freshId, 'a new run id must appear after Rerun').toBeTruthy()
})

test('Stop / Abort cards on an in-flight run are enabled and trigger the cancel API', async ({ page }) => {
  test.setTimeout(90_000)
  await importDemo(page)
  await page.getByLabel('Virtual Users').fill('1')
  await page.getByLabel('Duration (seconds)').fill('60')
  await page.getByRole('button', { name: 'Start k6 load test' }).click()
  await expect(page.locator('.run-grid .run-badge-running').first()).toBeVisible({ timeout: 30_000 })
  await page.getByRole('tab', { name: 'Actions' }).click()
  const stopCard = page.locator('.aktion-card', { hasText: /\bStop\b|\bStoppen\b/ }).first()
  const abortCard = page.locator('.aktion-card', { hasText: /\bAbort\b/ }).first()
  const rerunCard = page.locator('.aktion-card', { hasText: /Rerun|Erneut starten/i }).first()
  await expect(stopCard).toBeEnabled()
  await expect(abortCard).toBeEnabled()
  await expect(rerunCard).toBeDisabled()

  const cancelPromise = page.waitForResponse(response =>
    response.url().includes('/api/test-runs/') && response.url().endsWith('/cancel?force=true')
  , { timeout: 15_000 })
  await abortCard.click()
  const cancelResponse = await cancelPromise
  expect(cancelResponse.status()).toBeLessThan(300)
  await expect(page.locator('.run-grid .run-badge-running')).toHaveCount(0, { timeout: 30_000 })
  await expect(page.locator('.run-grid .run-badge-aborted').first()).toBeVisible({ timeout: 30_000 })
})

test('Download k6 script card triggers a file download', async ({ page }) => {
  test.setTimeout(90_000)
  await startDemoRunAndAwaitTerminal(page, { operation: 'listProducts', vus: '1', duration: '1' })
  await page.getByRole('tab', { name: 'Actions' }).click()
  const downloadCard = page.locator('.aktion-card', { hasText: /Download k6 script/i }).first()
  await expect(downloadCard).toBeEnabled()
  const downloadPromise = page.waitForEvent('download', { timeout: 15_000 })
  await downloadCard.click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/\.js$/)
})

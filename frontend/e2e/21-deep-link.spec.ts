import { test, expect, type Page } from '@playwright/test'
import { startDemoRunAndAwaitTerminal } from './helpers.ts'

test.describe.configure({ mode: 'serial' })

test.beforeEach(async ({ page }) => {
  await page.request.post('/api/demo-traffic/enabled', { data: { enabled: true } })
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

test('?report=<id> for a known run renders the printable report', async ({ page }) => {
  test.setTimeout(90_000)
  // Drive a run so the report has real data.
  await page.goto('/')
  await startDemoRunAndAwaitTerminal(page, { operation: 'listProducts', vus: '1', duration: '1' })
  const id = await newestRunId(page)
  expect(id).toBeTruthy()
  await page.goto(`/?report=${id}`)
  await expect(page.getByText(id.slice(0, 8)).first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('link', { name: /Back to app/i })).toBeVisible()
})

test('?report=<unknown> renders the "run not found" error', async ({ page }) => {
  await page.goto('/?report=this-run-does-not-exist')
  await expect(page.getByText(/not found|unknown/i).first()).toBeVisible({ timeout: 15_000 })
})

test('?demo-traffic=<runId> filters the dashboard to a single run', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/')
  await startDemoRunAndAwaitTerminal(page, { operation: 'listProducts', vus: '1', duration: '1' })
  const id = await newestRunId(page)
  expect(id).toBeTruthy()
  await page.goto(`/?demo-traffic=${id}`)
  await expect(page.locator('.demo-traffic-live-badge.is-live')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(id.slice(0, 8)).first()).toBeVisible()
})

test('?demo-traffic (without runId) opens the global stream', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/?demo-traffic')
  await expect(page.locator('.demo-traffic-live-badge.is-live')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(/All requests, across all runs/i).first()).toBeVisible()
})

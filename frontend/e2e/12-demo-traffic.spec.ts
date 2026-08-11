import { test, expect } from '@playwright/test'
import { importDemo } from './helpers.ts'

test.beforeEach(async ({ page, request }) => {
  await page.goto('/')
  await request.post('/api/demo-traffic/enabled', { data: { enabled: true } })
  await request.delete('/api/demo-traffic/requests')
})

test('captures requests against the bundled demo API', async ({ page, request: _request }) => {
  test.setTimeout(90_000)
  await importDemo(page)
  await page.getByLabel('Virtual Users').fill('1')
  await page.getByLabel('Duration (seconds)').fill('2')
  await page.getByRole('button', { name: 'Start k6 load test' }).click()
  await expect(page.locator('.status-badge.is-pass').first()).toBeVisible({ timeout: 60_000 })

  await page.goto('/?demo-traffic')
  await page.locator('.demo-traffic-row').first().waitFor({ timeout: 15_000 })
  const count = await page.locator('.demo-traffic-row').count()
  expect(count).toBeGreaterThan(0)
})

test('the "Reset" button clears the captured traffic', async ({ page, request }) => {
  test.setTimeout(90_000)
  for (let i = 0; i < 3; i++) {
    await request.get('/demo-api/products')
  }
  await page.goto('/?demo-traffic')
  await expect(page.locator('.demo-traffic-row').first()).toBeVisible()

  const dialogHandler = (dialog: import('@playwright/test').Dialog) => dialog.accept()
  page.on('dialog', dialogHandler)
  try {
    await page.getByTestId('demo-traffic-reset').click()
  } finally {
    page.off('dialog', dialogHandler)
  }
  await expect(page.locator('.demo-traffic-empty, .demo-traffic-row').first()).toBeVisible()
  await expect(page.getByTestId('demo-traffic-reset-banner')).toBeVisible()
})

test('renders the "demo is off" empty state when the toggle is off', async ({ page, request }) => {
  await page.addInitScript(() => {
    localStorage.setItem('lasttest.demo.enabled', 'false')
  })
  await request.post('/api/demo-traffic/enabled', { data: { enabled: false } })
  await page.goto('/?demo-traffic')
  await expect(page.getByText(/Demo API is currently disabled/i).first()).toBeVisible()
})

test('filters traffic by run id when ?demo-traffic=<runId> is set', async ({ page, request: _request }) => {
  test.setTimeout(90_000)
  await importDemo(page)
  await page.getByLabel('Virtual Users').fill('1')
  await page.getByLabel('Duration (seconds)').fill('1')
  await page.getByRole('button', { name: 'Start k6 load test' }).click()
  await expect(page.locator('.status-badge.is-pass').first()).toBeVisible({ timeout: 60_000 })

  const runs = await page.evaluate(async () => {
    const response = await fetch('/api/test-runs')
    return (await response.json()) as Array<{ id: string }>
  })
  const runId = runs[0]?.id ?? ''
  await page.goto(`/?demo-traffic=${runId}`)
  const filtered = await page.evaluate(async (id) => {
    const response = await fetch(`/api/demo-traffic/requests?runId=${encodeURIComponent(id)}`)
    return await response.json() as { entries: Array<{ runId: string | null }> }
  }, runId)
  expect(filtered.entries.length).toBeGreaterThan(0)
  for (const entry of filtered.entries) {
    expect(entry.runId).toBe(runId)
  }
})

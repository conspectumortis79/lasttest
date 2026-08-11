import { test, expect } from './demoToggleFixture.ts'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('before any import, the operations card is hidden', async ({ page }) => {
  await expect(page.locator('.operation-card')).toHaveCount(0)
  await expect(page.locator('.run-grid-heading, h2:has-text("Test Runs"), h3:has-text("Test Runs")')).toHaveCount(0)
})

test('before any run, the run grid is empty', async ({ page }) => {
  await expect(page.locator('.run-grid .run-badge')).toHaveCount(0)
})

test('the demo-traffic dashboard with an empty buffer shows its empty-state card', async ({ page, request }) => {
  await request.post('/api/demo-traffic/enabled', { data: { enabled: true } })
  await request.delete('/api/demo-traffic/requests')
  await page.goto('/?demo-traffic')
  const dialogHandler = (dialog: import('@playwright/test').Dialog) => dialog.accept()
  page.on('dialog', dialogHandler)
  try {
    await page.getByTestId('demo-traffic-reset').click()
  } finally {
    page.off('dialog', dialogHandler)
  }
  await expect(page.locator('.demo-traffic-empty').first()).toBeVisible({ timeout: 10_000 })
})

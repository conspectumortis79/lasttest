import { test, expect } from './demoToggleFixture.ts'
import { DEMO_BASE_URL, importDemo } from './helpers.ts'

test.describe.configure({ mode: 'serial' })

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('imports the bundled demo specification from the textarea', async ({ page }) => {
  const textarea = page.getByLabel('Swagger / OpenAPI Specification')
  await expect(textarea).toContainText('Lasttest Demo API')
  await importDemo(page)
  await expect(page.locator('.operation-card')).toHaveCount(10)
  await expect(page.getByLabel('Endpunkt GET /products auswählen')).toBeChecked()
})

test('imports the demo spec from a file upload', async ({ page }) => {
  const fileInput = page.locator('input[type="file"]')
  const { demoSpecificationPath } = await import('./helpers.ts')
  await fileInput.setInputFiles(demoSpecificationPath)
  await page.getByRole('button', { name: 'Validate & import' }).click()
  await expect(page.getByRole('heading', { name: /Lasttest Demo API/ })).toBeVisible()
})

test('imports the demo spec via the Swagger UI URL field', async ({ page, request }) => {
  const swaggerResponse = await request.get('/demo-swagger-ui')
  expect(swaggerResponse.ok()).toBeTruthy()

  const urlInput = page.getByLabel('URL to the Swagger UI or OpenAPI specification')
  await urlInput.fill('http://localhost:8286/demo-swagger-ui')
  await page.getByRole('button', { name: 'Validate & import' }).click()
  await expect(page.getByRole('heading', { name: /Lasttest Demo API/ })).toBeVisible()
  await expect(page.getByText(/loaded from/i)).toBeVisible()
})

test('runs a smoke test and shows the COMPLETED badge', async ({ page }) => {
  test.setTimeout(180_000)
  await importDemo(page)

  await expect(page.getByLabel('Virtual Users')).toBeVisible()
  await page.getByLabel('Virtual Users').fill('1')
  await page.getByLabel('Duration (seconds)').fill('1')
  const startButton = page.getByRole('button', { name: 'Start k6 load test' })
  await expect(startButton).toBeEnabled({ timeout: 30_000 })
  await startButton.click()

  await expect(page.locator('.run-grid .run-badge')).toHaveCount(1, { timeout: 15_000 })
  await expect(page.locator('.run-grid .run-badge-completed')).toBeVisible({ timeout: 90_000 })
  await expect(page.locator('.status-badge.is-pass').first()).toBeVisible({ timeout: 10_000 })
})

test('shows the inline Demo-Credentials banner on the auth endpoints', async ({ page }) => {
  await importDemo(page)
  const card = page.locator('.operation-card', { has: page.getByText('searchProducts') })
  await card.locator('button.expand-toggle').click()
  await expect(card.locator('.demo-banner')).toBeVisible()
})

test('uses the server selector to drive the demo API URL', async ({ page }) => {
  await importDemo(page)
  const baseUrl = page.locator('label', { hasText: 'Base URL' }).locator('input')
  await expect(baseUrl).toHaveValue(DEMO_BASE_URL)

  const select = page.locator('label', { hasText: 'Select server' }).locator('select')
  if (await select.isVisible()) {
    await select.selectOption({ index: 1 })
    await expect(baseUrl).not.toHaveValue(DEMO_BASE_URL)
  }
})

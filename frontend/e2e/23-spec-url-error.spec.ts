import { test, expect } from './demoToggleFixture.ts'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('an unreachable URL surfaces a backend error without clobbering the textarea', async ({ page }) => {
  const textarea = page.getByLabel('Swagger / OpenAPI Specification')
  await expect(textarea).toContainText('Lasttest Demo API', { timeout: 30_000 })
  const customSpec = 'openapi: 3.0.3\ninfo:\n  title: Custom probe spec\n  version: "1"\npaths:\n  /:\n    get:\n      operationId: root\n      responses:\n        "200": {description: OK}\n'
  await textarea.fill(customSpec)
  const before = await textarea.inputValue()

  await page.getByLabel('URL to the Swagger UI or OpenAPI specification').fill('http://198.51.100.1/spec.yaml')
  await page.getByRole('button', { name: 'Validate & import' }).click()
  await expect(page.locator('[role="alert"]').first()).toBeVisible({ timeout: 15_000 })
  await expect(textarea).toHaveValue(before)
})

test('an HTML page (not OpenAPI) surfaces a backend parse error', async ({ page }) => {
  await page.getByLabel('URL to the Swagger UI or OpenAPI specification').fill('/')
  await page.getByRole('button', { name: 'Validate & import' }).click()
  await expect(page.locator('[role="alert"]').first()).toBeVisible({ timeout: 15_000 })
})

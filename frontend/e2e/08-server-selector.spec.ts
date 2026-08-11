import { test, expect } from './demoToggleFixture.ts'
import { importInlineSpec } from './helpers.ts'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByLabel('Swagger / OpenAPI Specification'))
    .toContainText('Lasttest Demo API', { timeout: 10_000 })
  await page.getByLabel('URL to the Swagger UI or OpenAPI specification').fill('')
})

test('shows a server dropdown for specs with multiple servers', async ({ page }) => {
  const spec = `openapi: 3.0.3
info:
  title: Multi Server
  version: "1"
servers:
  - url: http://localhost:8286/demo-api
    description: Local demo
  - url: http://localhost:8286/alt
    description: Alt
paths:
  /ping:
    get:
      operationId: ping
      responses:
        '200': {description: OK}
`
  await importInlineSpec(page, spec, 'Multi Server')
  const select = page.locator('select#base-url-select')
  await expect(select).toBeVisible()
  const options = await select.locator('option').allTextContents()
  expect(options.some(option => option.includes('Local demo'))).toBe(true)
  expect(options.some(option => option.includes('Alt'))).toBe(true)
  const baseUrl = page.locator('label', { hasText: 'Base URL' }).locator('input')
  await expect(baseUrl).toHaveValue('http://localhost:8286/demo-api')
  await select.selectOption('http://localhost:8286/alt')
  await expect(baseUrl).toHaveValue('http://localhost:8286/alt')
})

test('hides the server dropdown for specs with a single server', async ({ page }) => {
  const spec = `openapi: 3.0.3
info:
  title: Single Server
  version: "1"
servers:
  - url: http://localhost:8286/api
paths:
  /ping:
    get:
      operationId: ping
      responses:
        '200': {description: OK}
`
  await importInlineSpec(page, spec, 'Single Server')
  await expect(page.locator('select#base-url-select')).toHaveCount(0)
  const baseUrl = page.locator('label', { hasText: 'Base URL' }).locator('input')
  await expect(baseUrl).toHaveValue('http://localhost:8286/api')
})

test('typing a custom URL adds a custom option and selects it', async ({ page }) => {
  const spec = `openapi: 3.0.3
info:
  title: Custom URL
  version: "1"
servers:
  - url: http://localhost:8286/api
    description: Staging
  - url: http://localhost:8286/api-2
    description: Dev
paths:
  /ping:
    get:
      operationId: ping
      responses:
        '200': {description: OK}
`
  await importInlineSpec(page, spec, 'Custom URL')
  const select = page.locator('select#base-url-select')
  const baseUrl = page.locator('label', { hasText: 'Base URL' }).locator('input')
  await baseUrl.fill('http://custom.example.test/api')
  await expect(select).toHaveValue('http://custom.example.test/api')
})

test('hides the server dropdown when the spec declares no servers', async ({ page }) => {
  const spec = `openapi: 3.0.3
info:
  title: No Servers
  version: "1"
paths:
  /ping:
    get:
      operationId: ping
      responses:
        '200': {description: OK}
`
  await importInlineSpec(page, spec, 'No Servers')
  await expect(page.locator('select#base-url-select')).toHaveCount(0)
  const baseUrl = page.locator('label', { hasText: 'Base URL' }).locator('input')
  await expect(baseUrl).toHaveValue('/')
})

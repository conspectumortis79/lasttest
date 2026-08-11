import { test, expect } from './demoToggleFixture.ts'
import { expandOperation } from './helpers.ts'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  // The App auto-loads the bundled demo spec into the textarea when
  // `lasttest.demo.enabled` is set in localStorage (see
  // `e2e/global-setup.ts`). This spec-validation suite wants a clean
  // slate, so we explicitly clear the textarea before each test.
  const textarea = page.getByLabel('Swagger / OpenAPI Specification')
  await expect(textarea).toBeVisible()
  await textarea.fill('')
  await page.getByLabel('URL to the Swagger UI or OpenAPI specification').fill('')
  const lang = await page.evaluate(() => localStorage.getItem('lasttest.language'))
  expect(lang).toBe('en')
})

test('rejects an empty specification', async ({ page }) => {
  const textarea = page.getByLabel('Swagger / OpenAPI Specification')
  await textarea.fill(' ')
  await page.getByRole('button', { name: 'Validate & import' }).click()
  await expect(page.getByRole('alert').first()).toContainText(/leer/i)
})

test('rejects an OpenAPI document with no operations', async ({ page }) => {
  const textarea = page.getByLabel('Swagger / OpenAPI Specification')
  await textarea.fill('openapi: 3.0.3\ninfo:\n  title: Empty\n  version: "1"\npaths: {}')
  await page.getByRole('button', { name: 'Validate & import' }).click()
  await expect(page.getByRole('alert').first()).toContainText(/REST-Operationen/i)
})

test('rejects an invalid specification URL before hitting the backend', async ({ page }) => {
  const urlInput = page.getByLabel('URL to the Swagger UI or OpenAPI specification')
  await urlInput.fill('not-a-url')
  await page.getByRole('button', { name: 'Validate & import' }).click()
  await expect(page.getByRole('alert').first()).toContainText(/ungültig/i)
})

test('rejects a non-HTTP base URL on start', async ({ page }) => {
  const textarea = page.getByLabel('Swagger / OpenAPI Specification')
  await textarea.fill(' ')
  const spec = `openapi: 3.0.3
info:
  title: Validation Spec
  version: "1"
paths:
  /ping:
    get:
      operationId: ping
      responses:
        '200': {description: OK}
`
  await textarea.fill(spec)
  await page.getByRole('button', { name: 'Validate & import' }).click()
  await expect(page.getByRole('heading', { name: 'Validation Spec' })).toBeVisible()

  const baseUrl = page.locator('label', { hasText: 'Base URL' }).locator('input')
  await baseUrl.fill('file:///etc/passwd')
  await page.getByRole('button', { name: 'Start k6 load test' }).click()
  await expect(page.getByRole('alert').first()).toContainText(/http/i)
})

test('clamps Virtual Users above the configured maximum', async ({ page }) => {
  const spec = `openapi: 3.0.3
info:
  title: VU Cap Spec
  version: "1"
paths:
  /ping:
    get:
      operationId: ping
      responses:
        '200': {description: OK}
`
  await page.getByLabel('Swagger / OpenAPI Specification').fill(spec)
  await page.getByRole('button', { name: 'Validate & import' }).click()
  await expect(page.getByRole('heading', { name: /VU Cap Spec/ })).toBeVisible()

  const virtualUsers = page.getByLabel('Virtual Users')
  await expect(virtualUsers).toHaveAttribute('max', '30000')
  await virtualUsers.fill('30001')
  await page.getByRole('button', { name: 'Start k6 load test' }).click()
  await expect(page.getByRole('alert').first()).toContainText(/1 und 30000/)
})

test('disables the start button when the request body is invalid JSON', async ({ page }) => {
  const spec = `openapi: 3.0.3
info:
  title: Body Validation Spec
  version: "1"
paths:
  /items:
    post:
      operationId: createItem
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [name]
              properties:
                name: {type: string}
      responses:
        '201': {description: Created}
`
  await page.getByLabel('Swagger / OpenAPI Specification').fill(spec)
  await page.getByRole('button', { name: 'Validate & import' }).click()
  await expect(page.getByRole('heading', { name: /Body Validation Spec/ })).toBeVisible()

  await expandOperation(page, 'createItem')
  const body = page.getByLabel('createItem · Payload 1: JSON Request-Body')
  await body.fill('{not-json}')
  const startButton = page.getByRole('button', { name: 'Start k6 load test' })
  await expect(startButton).toBeDisabled()
  await expect(page.locator('.parameter-error', { hasText: /kein gültiges JSON/i }).first()).toBeVisible()
})

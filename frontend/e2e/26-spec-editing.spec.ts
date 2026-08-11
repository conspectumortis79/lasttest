import { test, expect } from './demoToggleFixture.ts'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

const SINGLE_OP_SPEC = `openapi: 3.0.3
info:
  title: Single Op
  version: "1"
servers:
  - url: http://localhost:8286/demo-api
paths:
  /products:
    get:
      operationId: listProducts
      responses:
        '200':
          description: OK
`

const TWO_OP_SPEC = `openapi: 3.0.3
info:
  title: Two Ops
  version: "1"
servers:
  - url: http://localhost:8286/demo-api
paths:
  /products:
    get:
      operationId: listProducts
      responses:
        '200':
          description: OK
  /products/search:
    post:
      operationId: searchProducts
      responses:
        '200':
          description: OK
`

test('editing the textarea and re-importing updates the operations card', async ({ page }) => {
  const textarea = page.getByLabel('Swagger / OpenAPI Specification')
  // The App auto-loads the bundled demo spec into the textarea when
  // `lasttest.demo.enabled` is set in localStorage (see
  // `e2e/global-setup.ts`). This test wants to start from a clean
  // slate, so we explicitly clear the textarea before filling the
  // first spec.
  await expect(textarea).toBeVisible()
  await textarea.fill('')

  await textarea.fill(SINGLE_OP_SPEC)
  await page.getByRole('button', { name: 'Validate & import' }).click()
  await page.getByRole('heading', { name: 'Single Op' }).waitFor()
  await expect(page.locator('.operation-card')).toHaveCount(1)

  await textarea.fill(TWO_OP_SPEC)
  await page.getByRole('button', { name: 'Validate & import' }).click()
  await page.getByRole('heading', { name: 'Two Ops' }).waitFor()
  await expect(page.locator('.operation-card')).toHaveCount(2)
  await expect(page.getByLabel('Endpunkt POST /products/search auswählen')).toBeVisible()
})

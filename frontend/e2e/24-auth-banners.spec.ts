import { test, expect } from './demoToggleFixture.ts'
import { importDemo, expandOperation } from './helpers.ts'

test.describe.configure({ mode: 'serial' })

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('the Bearer banner offers the demo token and applies it to the payload', async ({ page }) => {
  await importDemo(page)
  await page.getByLabel('Endpunkt POST /products/search auswählen').check()
  await expandOperation(page, 'searchProducts')
  await expect(page.getByText(/Bearer/i).first()).toBeVisible()
  const applyButton = page.getByRole('button', { name: /(Apply|Übernehmen)/i }).first()
  await applyButton.click()
  const bearer = page.getByLabel('searchProducts · Payload 1: Bearer token')
  await expect(bearer).not.toHaveValue('')
})

test('the HTTP Basic banner offers the demo username and password', async ({ page }) => {
  await importDemo(page)
  await page.getByLabel('Endpunkt GET /products/admin/stats auswählen').check()
  await expandOperation(page, 'getAdminStats')
  await expect(page.getByText(/Basic/i).first()).toBeVisible()
})

test('the API-Key banner offers the demo header value', async ({ page }) => {
  await importDemo(page)
  await page.getByLabel('Endpunkt GET /products/lookup-by-id auswählen').check()
  await expandOperation(page, 'lookupProduct')
  await expect(page.getByText(/API[ -]?[Kk]ey/i).first()).toBeVisible()
})

test('the OAuth 2.0 banner offers the demo access token', async ({ page }) => {
  await importDemo(page)
  await page.getByLabel('Endpunkt GET /products/me auswählen').check()
  await expandOperation(page, 'getMe')
  await expect(page.getByText(/OAuth/i).first()).toBeVisible()
})

test('the OIDC banner offers the demo ID token', async ({ page }) => {
  await importDemo(page)
  await page.getByLabel('Endpunkt GET /products/my-profile auswählen').check()
  await expandOperation(page, 'getMyProfile')
  await expect(page.getByText(/OpenID|OIDC/i).first()).toBeVisible()
})

import { test, expect } from './demoToggleFixture.ts'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('switches the whole UI to German and back to English', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Swagger / OpenAPI Specification' })).toBeVisible()

  await page.getByRole('button', { name: 'Open settings' }).click()
  await page.locator('input[type="radio"][value="de"]').check()
  await page.keyboard.press('Escape')

  await expect(page.getByRole('heading', { name: 'Swagger / OpenAPI-Dokumentation' })).toBeVisible()
  await expect(page.locator('.lang-pill-code')).toHaveText('DE')
  await expect(page.getByRole('button', { name: 'Validieren & importieren' })).toBeVisible()
})

test('persists the language choice across reloads', async ({ page }) => {
  await page.getByRole('button', { name: 'Open settings' }).click()
  await page.locator('input[type="radio"][value="de"]').check()
  await page.keyboard.press('Escape')

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Swagger / OpenAPI-Dokumentation' })).toBeVisible()
  await expect(page.locator('.lang-pill-code')).toHaveText('DE')
})

test('the toolbar language pill carries the active language code', async ({ page }) => {
  await expect(page.locator('.lang-pill-code')).toHaveText('EN')
  await page.getByRole('button', { name: 'Open settings' }).click()
  await page.locator('input[type="radio"][value="de"]').check()
  await page.keyboard.press('Escape')
  await expect(page.locator('.lang-pill-code')).toHaveText('DE')
})

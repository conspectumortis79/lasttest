import { test, expect } from './demoToggleFixture.ts'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Open settings' }).click()
  await expect(page.locator('.drawer.is-open')).toBeVisible()
})

test('shows every settings section', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Language' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Archiving' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Demo API' })).toBeVisible()
})

test('the language picker shows English and German options', async ({ page }) => {
  await expect(page.locator('input[type="radio"][value="en"]')).toBeChecked()
  await expect(page.locator('input[type="radio"][value="de"]')).not.toBeChecked()
  await page.locator('input[type="radio"][value="de"]').check()
  await expect(page.locator('input[type="radio"][value="de"]')).toBeChecked()
  await expect(page.locator('.lang-pill-code')).toHaveText('DE')
})

test('the notification master toggle starts disabled when the browser blocks notifications', async ({ page }) => {
  const toggle = page.locator('.drawer-checkbox').filter({ hasText: /Browser notifications/i }).locator('input')
  await expect(toggle).toBeDisabled()
})

test('the "Save executions" toggle round-trips through localStorage', async ({ page }) => {
  const toggle = page.getByTestId('settings-save-executions-switch')
  await expect(toggle).not.toBeChecked()
  await toggle.check()
  await expect(toggle).toBeChecked()
  const stored = await page.evaluate(() => localStorage.getItem('lasttest.persistRuns'))
  expect(stored).toBe('true')

  await page.reload()
  await page.getByRole('button', { name: 'Open settings' }).click()
  await expect(page.getByTestId('settings-save-executions-switch')).toBeChecked()
})

test('the Demo API toggle is on by default in this project', async ({ page }) => {
  const demoToggle = page.getByTestId('settings-demo-api-switch')
  await expect(demoToggle).toBeChecked()
})

test('Escape closes the drawer', async ({ page }) => {
  await page.keyboard.press('Escape')
  await expect(page.locator('.drawer.is-open')).toHaveCount(0)
})

test('clicking the backdrop closes the drawer', async ({ page }) => {
  await page.locator('.drawer-backdrop').click({ position: { x: 10, y: 10 } })
  await expect(page.locator('.drawer.is-open')).toHaveCount(0)
})

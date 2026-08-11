import { test, expect } from './demoToggleFixture.ts'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('the Wiki popup filters the glossary as the user types', async ({ page }) => {
  await page.getByRole('button', { name: 'Wiki' }).click()
  const dialog = page.locator('div[role="dialog"]', { has: page.getByRole('heading', { name: /Wiki/i }) })
  await expect(dialog).toBeVisible()
  const searchbox = dialog.locator('input[type="search"]')
  await expect(searchbox).toBeVisible()
  await searchbox.fill('test')
  const testItems = dialog.getByRole('listitem')
  const testCount = await testItems.count()
  expect(testCount).toBeGreaterThan(0)
  await searchbox.fill('smoke')
  const smokeCount = await testItems.count()
  expect(smokeCount).toBeLessThan(testCount)
  await expect(dialog.getByText(/Smoke Test/i).first()).toBeVisible()
})

test('the Wiki popup shows a no-match pulse for an unknown query', async ({ page }) => {
  await page.getByRole('button', { name: 'Wiki' }).click()
  const dialog = page.locator('div[role="dialog"]', { has: page.getByRole('heading', { name: /Wiki/i }) })
  await expect(dialog).toBeVisible()
  const searchbox = dialog.locator('input[type="search"]')
  await searchbox.fill('zzzzznomatchterm')
  await searchbox.press('Enter')
  await expect(searchbox).toHaveClass(/wiki-popup-no-match/, { timeout: 2_000 })
  await expect(dialog.locator('.wiki-popup-empty')).toBeVisible()
})

test('the User Guide popup filters the document content via its search field', async ({ page }) => {
  await page.getByRole('button', { name: 'User Guide' }).click()
  const dialog = page.locator('div[role="dialog"]', { has: page.getByRole('heading', { name: /User Guide/i }) })
  await expect(dialog).toBeVisible()
  const searchbox = dialog.locator('input[type="search"]')
  await expect(searchbox).toBeVisible()
  await searchbox.fill('k6')
  await expect(dialog.getByText(/[1-9]\d* match/i).first()).toBeVisible({ timeout: 5_000 })
})

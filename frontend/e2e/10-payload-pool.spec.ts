import { test, expect } from './demoToggleFixture.ts'
import { importDemo } from './helpers.ts'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('renders boolean and enum parameters as dropdowns', async ({ page }) => {
  await importDemo(page)
  const card = page.locator('.operation-card', { has: page.getByText('listProducts') })
  await card.locator('button.expand-toggle').click()
  const firstRow = card.locator('.pool-table tbody tr').first()

  const categorySelect = firstRow.locator('select').filter({
    has: page.locator('option', { hasText: 'books' }),
  })
  await expect(categorySelect).toHaveCount(1)
  const categoryOptions = await categorySelect.locator('option').allInnerTexts()
  expect(categoryOptions).toContain('books')
  expect(categoryOptions).toContain('hardware')
  expect(categoryOptions).toContain('software')

  const availableSelect = firstRow.locator('select').filter({
    has: page.locator('option', { hasText: 'true' }),
  })
  await expect(availableSelect).toHaveCount(1)
  const availableOptions = await availableSelect.locator('option').allInnerTexts()
  expect(availableOptions).toContain('true')
  expect(availableOptions).toContain('false')

  const maxPriceInput = firstRow.getByLabel(/maxPrice/i)
  await expect(maxPriceInput).toBeVisible()
  await expect(maxPriceInput.locator('xpath=ancestor::td[1]//select')).toHaveCount(0)
})

test('only one endpoint can be selected at a time', async ({ page }) => {
  await importDemo(page)
  const listCheckbox = page.getByLabel('Endpunkt GET /products auswählen')
  const searchCheckbox = page.getByLabel('Endpunkt POST /products/search auswählen')
  const getCheckbox = page.getByLabel('Endpunkt GET /products/{id} auswählen')

  await expect(listCheckbox).toBeChecked()
  await expect(searchCheckbox).not.toBeChecked()
  await expect(getCheckbox).not.toBeChecked()

  await searchCheckbox.check()
  await expect(searchCheckbox).toBeChecked()
  await expect(listCheckbox).not.toBeChecked()

  await getCheckbox.check()
  await expect(getCheckbox).toBeChecked()
  await expect(searchCheckbox).not.toBeChecked()
})

test('"Add payload" grows the pool and "Remove payload" shrinks it', async ({ page }) => {
  await importDemo(page)
  const card = page.locator('.operation-card', { has: page.getByText('listProducts') })
  await card.locator('button.expand-toggle').click()

  await expect(card.locator('.pool-table tbody tr')).toHaveCount(1)

  await card.getByRole('button', { name: /Add payload/i }).click()
  await card.getByRole('button', { name: /Add payload/i }).click()
  await expect(card.locator('.pool-table tbody tr')).toHaveCount(3)

  const removeButtons = card.locator('.pool-table tbody tr button[aria-label*="Remove"]')
  await removeButtons.nth(1).click()
  await expect(card.locator('.pool-table tbody tr')).toHaveCount(2)
})

test('the single-row payload cannot be removed', async ({ page }) => {
  await importDemo(page)
  const card = page.locator('.operation-card', { has: page.getByText('listProducts') })
  await card.locator('button.expand-toggle').click()
  await expect(card.locator('.pool-table tbody tr')).toHaveCount(1)
  const removeButtons = card.locator('.pool-table tbody tr button[aria-label*="Remove"]')
  await expect(removeButtons).toHaveCount(1)
  await expect(removeButtons.first()).toBeDisabled()
})

test('the payload-strategy radio defaults to sequential', async ({ page }) => {
  await importDemo(page)
  const sequential = page.locator('input[type="radio"][name="payloadStrategy"][value="sequential"]')
  const random = page.locator('input[type="radio"][name="payloadStrategy"][value="random"]')
  await expect(sequential).toBeChecked()
  await expect(random).not.toBeChecked()

  await random.check()
  await expect(random).toBeChecked()
  await expect(sequential).not.toBeChecked()
})

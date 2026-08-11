import { test, expect } from './demoToggleFixture.ts'
import { importDemo } from './helpers.ts'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await importDemo(page)
})

test('renders every preset button', async ({ page }) => {
  const editor = page.getByTestId('load-profile-editor')
  await expect(editor).toBeVisible()
  for (const preset of ['Smoke', 'Load', 'Stress', 'Spike', 'Soak', 'Burst', 'Arrival-rate']) {
    await expect(editor.getByRole('button', { name: preset })).toBeVisible()
  }
})

test('clicking the Smoke preset sets a constant-vus profile', async ({ page }) => {
  const editor = page.getByTestId('load-profile-editor')
  await editor.getByRole('button', { name: 'Smoke' }).click()
  await expect(editor.locator('select.profile-type-select')).toHaveValue('constant-vus')
  await expect(page.getByLabel('Virtual Users')).toBeVisible()
  await expect(page.getByLabel('Duration (seconds)')).toBeVisible()
})

test('switching the executor reveals the right fields', async ({ page }) => {
  const editor = page.getByTestId('load-profile-editor')
  await editor.locator('select.profile-type-select').selectOption('constant-arrival-rate')
  await expect(page.getByLabel(/Rate \(requests\)/i)).toBeVisible()
  await expect(page.getByLabel(/per seconds/i)).toBeVisible()
  await expect(
    page.getByTestId('load-profile-editor').getByLabel(/^preAllocatedVUs$/),
  ).toBeVisible()

  await editor.locator('select.profile-type-select').selectOption('ramping-vus')
  await expect(page.locator('.stages-table')).toBeVisible()
})

test('the ramping-VUs profile grows / shrinks the stages table', async ({ page }) => {
  const editor = page.getByTestId('load-profile-editor')
  await editor.getByRole('button', { name: 'Load' }).click()
  const stagesTable = page.locator('.stages-table')
  await expect(stagesTable).toBeVisible()
  const initialRows = await stagesTable.locator('tbody tr').count()
  expect(initialRows).toBeGreaterThan(0)

  await page.getByRole('button', { name: /Add stage/i }).click()
  await expect(stagesTable.locator('tbody tr')).toHaveCount(initialRows + 1)

  const removeButtons = stagesTable.locator('tbody tr button[aria-label*="Remove"]')
  await removeButtons.last().click()
  await expect(stagesTable.locator('tbody tr')).toHaveCount(initialRows)
})

test('the Virtual Users field enforces max via the HTML5 attribute', async ({ page }) => {
  const vus = page.getByLabel('Virtual Users')
  await expect(vus).toHaveAttribute('max', '30000')
  const duration = page.getByLabel('Duration (seconds)')
  await expect(duration).toHaveAttribute('max', '3600')
})

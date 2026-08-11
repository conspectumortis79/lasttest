import { test, expect } from './demoToggleFixture.ts'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('User Guide opens a markdown popup with search affordances', async ({ page }) => {
  await page.getByRole('button', { name: 'User Guide' }).click()
  const popup = page.locator('.doc-popup.is-open')
  await expect(popup).toBeVisible()
  await expect(popup.locator('.doc-popup-body')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(popup).toHaveCount(0)
})

test('README opens a markdown popup', async ({ page }) => {
  await page.getByRole('button', { name: 'README' }).click()
  const popup = page.locator('.doc-popup.is-open')
  await expect(popup).toBeVisible()
  await expect(popup.locator('.doc-popup-body')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(popup).toHaveCount(0)
})

test('Wiki opens the glossary popup with an input', async ({ page }) => {
  await page.getByRole('button', { name: 'Wiki' }).click()
  const popup = page.locator('.wiki-popup.is-open')
  await expect(popup).toBeVisible()
  await expect(popup.locator('input[type="search"], input[type="text"]').first()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(popup).toHaveCount(0)
})

test('the Demo-API link is hidden when the demo is off', async ({ page, context, request }) => {
  await context.close()
  const isolatedContext = await page.context().browser()!.newContext({
    baseURL: 'http://localhost:8286',
    storageState: {
      cookies: [],
      origins: [
        {
          origin: 'http://localhost:8286',
          localStorage: [
            { name: 'lasttest.language', value: 'en' },
            { name: 'lasttest.demo.enabled', value: 'false' },
          ],
        },
      ],
    },
  })
  const isolated = await isolatedContext.newPage()
  await isolated.goto('/')
  await expect(isolated.getByRole('link', { name: /Demo[-\s]?API/i })).toHaveCount(0)
  await isolatedContext.close()
  await request.post('/api/demo-traffic/enabled', { data: { enabled: true } })
})

test('clicking the popup backdrop closes it', async ({ page }) => {
  await page.getByRole('button', { name: 'User Guide' }).click()
  const popup = page.locator('.doc-popup.is-open')
  await expect(popup).toBeVisible()
  await page.locator('.doc-popup-backdrop.is-open').click({ position: { x: 5, y: 5 } })
  await expect(popup).toHaveCount(0)
})

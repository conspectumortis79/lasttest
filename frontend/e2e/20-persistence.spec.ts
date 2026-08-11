import { test, expect, type Page } from '@playwright/test'
import { startDemoRunAndAwaitTerminal } from './helpers.ts'

test.describe.configure({ mode: 'serial' })

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.setItem('lasttest.persistRuns', 'false'))
})

async function openSettingsAndTogglePersistence(page: Page, on: boolean): Promise<void> {
  await page.getByRole('button', { name: 'Open settings' }).click()
  const toggle = page.getByTestId('settings-save-executions-switch')
  if (on) await toggle.check()
  else await toggle.uncheck()
  await page.keyboard.press('Escape')
}

test('with persistence ON, the next /api/test-runs POST carries persist: true', async ({ page }) => {
  test.setTimeout(120_000)
  await openSettingsAndTogglePersistence(page, true)
  const stored = await page.evaluate(() => localStorage.getItem('lasttest.persistRuns'))
  expect(stored).toBe('true')

  const requestPromise = page.waitForRequest(request =>
    request.url().endsWith('/api/test-runs') && request.method() === 'POST'
  , { timeout: 30_000 })
  await startDemoRunAndAwaitTerminal(page, { operation: 'listProducts', vus: '1', duration: '1' })
  const request = await requestPromise
  const body = request.postDataJSON() as { persist?: boolean }
  expect(body.persist, 'persist flag must be true on the request body when the toggle is on').toBe(true)
})

test('with persistence OFF, the next /api/test-runs POST carries persist: false', async ({ page }) => {
  test.setTimeout(120_000)
  const requestPromise = page.waitForRequest(request =>
    request.url().endsWith('/api/test-runs') && request.method() === 'POST'
  , { timeout: 30_000 })
  await startDemoRunAndAwaitTerminal(page, { operation: 'listProducts', vus: '1', duration: '1' })
  const request = await requestPromise
  const body = request.postDataJSON() as { persist?: boolean }
  expect(body.persist, 'persist flag must be false on the request body when the toggle is off').toBe(false)
})

test('with persistence OFF at mount, the App issues DELETE /api/test-runs to wipe the timeline', async ({ page }) => {
  test.setTimeout(60_000)
  const deletePromise = page.waitForRequest(request =>
    request.url().endsWith('/api/test-runs') && request.method() === 'DELETE'
  , { timeout: 15_000 })

  await page.reload()
  await deletePromise
})

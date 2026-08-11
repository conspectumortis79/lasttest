import { test, expect } from './demoToggleFixture.ts'
import { startDemoRunAndAwaitTerminal } from './helpers.ts'

let runId: string

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto('/')
  await startDemoRunAndAwaitTerminal(page, {
    operation: 'searchProducts',
    vus: '1',
    duration: '1',
  })
  const runs = await page.evaluate(async () => {
    const response = await fetch('/api/test-runs')
    return (await response.json()) as Array<{ id: string }>
  })
  runId = runs[0]?.id ?? ''
  await context.close()
})

test('renders the printable report for a known run id', async ({ page }) => {
  await page.goto(`/?report=${runId}`)
  await expect(page.getByRole('heading', { name: 'Lasttest Demo API', exact: true })).toBeVisible()
  await expect(page.getByText('Checks successful', { exact: true })).toBeVisible()
  await expect(page.getByText('HTTP failure rate', { exact: true })).toBeVisible()
})

test('shows the "run not found" error for an unknown report id', async ({ page }) => {
  await page.goto('/?report=does-not-exist')
  await expect(page.getByText(/Test run was not found/i)).toBeVisible()
  await expect(page.getByRole('link', { name: 'Back to app' })).toBeVisible()
})

test('the JSON Request-Body disclosure reveals the payload', async ({ page }) => {
  await page.goto(`/?report=${runId}`)
  await page.getByText('JSON Request Body').click()
  await expect(page.getByText('"category"', { exact: false })).toBeVisible()
})

test('the generated k6 script is downloadable from the API', async ({ request }) => {
  const response = await request.get(`/api/test-runs/${runId}/script`)
  expect(response.ok()).toBeTruthy()
  expect(response.headers()['content-type']).toContain('application/javascript')
  const body = await response.text()
  expect(body).toContain("import http from 'k6/http'")
  expect(body).toContain('export const options')
  const disposition = response.headers()['content-disposition'] ?? ''
  expect(disposition).toMatch(/^attachment; filename=(?:")?lasttest-.+\.js(?:")?$/)
})

test('the "Print" button calls window.print', async ({ page }) => {
  await page.goto(`/?report=${runId}`)
  await page.evaluate(() => {
    window.print = () => { document.body.dataset.printCalled = 'true' }
  })
  await page.getByRole('button', { name: /Print/i }).click()
  await expect(page.locator('body')).toHaveAttribute('data-print-called', 'true')
})

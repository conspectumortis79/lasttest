import { expect, test } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const demoSpecification = path.resolve(currentDirectory, '../../demo/openapi-demo.yaml')

async function importDemo(page: import('@playwright/test').Page) {
  await page.locator('input[type="file"]').setInputFiles(demoSpecification)
  await page.getByRole('button', { name: 'Validieren & importieren' }).click()
  await expect(page.getByRole('heading', { name: /Lasttest Demo API/ })).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('validates imports, load profiles, parameters, bodies, and target URLs', async ({ page }) => {
  const specification = page.getByLabel('Swagger / OpenAPI-Dokumentation')

  await specification.fill(' ')
  await page.getByRole('button', { name: 'Validieren & importieren' }).click()
  await expect(page.getByRole('alert')).toContainText('Dokumentation ist leer')

  await specification.fill('openapi: 3.0.3\ninfo: {title: Empty, version: "1"}\npaths: {}')
  await page.getByRole('button', { name: 'Validieren & importieren' }).click()
  await expect(page.getByRole('alert')).toContainText('keine REST-Operationen')

  await importDemo(page)
  await expect(page.locator('.operation-card')).toHaveCount(6)
  await expect(page.getByLabel('listProducts: category')).toHaveValue('books')
  await page.getByLabel('listProducts: category').fill('hardware')
  await page.getByLabel('getProduct: id').fill('2')
  await page.getByLabel('getProduct: Bearer-Token').fill('optional-token')

  const virtualUsers = page.getByLabel('Virtual Users')
  await expect(virtualUsers).toHaveAttribute('max', '1000')
  await virtualUsers.fill('1001')
  await page.getByRole('button', { name: 'k6-Lasttest starten' }).click()
  await expect(page.getByRole('alert')).toHaveText('Virtual Users müssen zwischen 1 und 1000 liegen.')

  await virtualUsers.fill('1')
  await page.getByLabel('Dauer (Sekunden)').fill('0')
  await page.getByRole('button', { name: 'k6-Lasttest starten' }).click()
  await expect(page.getByRole('alert')).toHaveText('Die Dauer muss zwischen 1 und 3600 Sekunden liegen.')

  await page.getByLabel('Dauer (Sekunden)').fill('1')
  await page.getByLabel('updateProduct: JSON Request-Body').fill('{invalid}')
  const updateCard = page.getByLabel('updateProduct: JSON Request-Body').locator('xpath=ancestor::article')
  await updateCard.locator('input[type="checkbox"]').check()
  await page.getByRole('button', { name: 'k6-Lasttest starten' }).click()
  await expect(page.getByRole('alert')).toContainText('kein gültiges JSON')

  await updateCard.locator('input[type="checkbox"]').uncheck()
  await page.getByLabel('Base URL').fill('file:///etc/passwd')
  await page.getByRole('button', { name: 'k6-Lasttest starten' }).click()
  await expect(page.getByRole('alert')).toContainText('Base-URL muss mit http:// oder https:// beginnen')
})

test('runs configured endpoints and opens the complete report in a new tab', async ({ page }) => {
  await importDemo(page)

  const getProductCard = page.getByLabel('getProduct: id').locator('xpath=ancestor::article')
  await getProductCard.locator('input[type="checkbox"]').uncheck()
  await page.getByLabel('listProducts: category').fill('hardware')
  await page.getByLabel('listProducts: maxPrice').fill('100')

  const searchBody = page.getByLabel('searchProducts: JSON Request-Body')
  const searchCard = searchBody.locator('xpath=ancestor::article')
  await searchCard.locator('input[type="checkbox"]').check()
  await searchBody.fill('{"category":"hardware","maxPrice":100}')
  await page.getByLabel('searchProducts: Bearer-Token').fill('e2e-secret-token')

  await page.getByLabel('Virtual Users').fill('1')
  await page.getByLabel('Dauer (Sekunden)').fill('1')
  await page.getByRole('button', { name: 'k6-Lasttest starten' }).click()

  await expect(page.locator('.status.completed')).toBeVisible({ timeout: 30_000 })
  const reportLink = page.getByRole('link', { name: /Ausführlichen k6-Testbericht/ })
  await expect(reportLink).toHaveAttribute('target', '_blank')

  const popupPromise = page.waitForEvent('popup')
  await reportLink.click()
  const report = await popupPromise
  await report.waitForLoadState('networkidle')

  await expect(report.getByRole('heading', { name: 'Lasttest Demo API', exact: true })).toBeVisible()
  await expect(report.getByText('Checks erfolgreich', { exact: true })).toBeVisible()
  await expect(report.getByText('HTTP-Fehlerrate', { exact: true })).toBeVisible()
  await expect(report.getByRole('heading', { name: 'Testkonfiguration' })).toBeVisible()
  await expect(report.getByText('hardware', { exact: true }).first()).toBeVisible()
  await expect(report.getByText('konfiguriert (aus Sicherheitsgründen ausgeblendet)')).toBeVisible()
  await expect(report.getByText('e2e-secret-token')).toBeHidden()
  await expect(report.getByRole('heading', { name: 'Detaillierte k6-Metriken' })).toBeVisible()

  await report.getByText('JSON Request-Body').click()
  await expect(report.getByText('{"category":"hardware","maxPrice":100}', { exact: true })).toBeVisible()
  const jsonDetails = report.locator('details').filter({ has: report.getByText('Vollständiger k6-JSON-Export', { exact: true }) })
  await jsonDetails.getByText('Vollständiger k6-JSON-Export').click()
  await expect(jsonDetails.locator('pre')).toContainText('http_req_duration')

  await report.getByText('Generiertes k6-Testskript').click()
  const generatedScript = report.getByTestId('generated-k6-script')
  await expect(generatedScript).toContainText("import http from 'k6/http'")
  await expect(generatedScript).toContainText('export const options')
  await expect(generatedScript).toContainText('BASE_URL')
  await expect(generatedScript).toContainText('Bearer e2e-secret-token')
  await expect(report.locator('.script-command')).toContainText('k6 run -e BASE_URL=')

  const downloadPromise = report.waitForEvent('download')
  await report.getByRole('link', { name: 'k6-Testskript herunterladen' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/^lasttest-.+\.js$/)
  const stream = await download.createReadStream()
  let downloadedScript = ''
  for await (const chunk of stream) downloadedScript += chunk.toString()
  expect(downloadedScript).toBe(await generatedScript.textContent())

  const printButton = report.getByRole('button', { name: 'Drucken / als PDF speichern' })
  await expect(printButton).toBeVisible()
  await report.evaluate(() => {
    window.print = () => { document.body.dataset.printCalled = 'true' }
  })
  await printButton.click()
  await expect(report.locator('body')).toHaveAttribute('data-print-called', 'true')
  await expect(report.getByRole('link', { name: 'Zur Anwendung' })).toHaveAttribute('href', '/')
})

test('shows a useful error for an unknown report', async ({ page }) => {
  await page.goto('/?report=does-not-exist')

  await expect(page.getByText('Der Testlauf wurde nicht gefunden.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Zur Anwendung' })).toBeVisible()
})

import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const demoSpecification = path.resolve(currentDirectory, '../../demo/openapi-demo.yaml')

async function importDemo(page: Page) {
  await page.locator('input[type="file"]').setInputFiles(demoSpecification)
  await page.getByRole('button', { name: 'Validieren & importieren' }).click()
  await expect(page.getByRole('heading', { name: /Lasttest Demo API/ })).toBeVisible()
}

async function expandOperation(page: Page, opId: string) {
  const card = page.locator('.operation-card', { has: page.getByLabel(`Operation ${opId}`) })
  const toggle = card.locator('button.expand-toggle')
  if ((await toggle.getAttribute('aria-expanded')) === 'false') {
    await toggle.click()
  }
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('validates imports, load profiles, parameters, bodies, and target URLs', async ({ page }) => {
  const specification = page.getByLabel('Swagger / OpenAPI-Dokumentation')

  await expect(specification).toContainText('Lasttest Demo API')
  await specification.fill(' ')
  await page.getByRole('button', { name: 'Validieren & importieren' }).click()
  await expect(page.getByRole('alert')).toContainText('Dokumentation ist leer')

  await specification.fill('openapi: 3.0.3\ninfo: {title: Empty, version: "1"}\npaths: {}')
  await page.getByRole('button', { name: 'Validieren & importieren' }).click()
  await expect(page.getByRole('alert')).toContainText('keine REST-Operationen')

  await importDemo(page)
  await expect(page.locator('.operation-card')).toHaveCount(6)
  await expect(page.getByLabel('Endpunkt GET /products auswählen')).toBeChecked()

  // Initial sind alle Endpunkte eingeklappt. Erst aufklappen, dann füllen.
  await expandOperation(page, 'listProducts')
  await expandOperation(page, 'getProduct')
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

  // URL-Validierung zuerst (listProducts ist weiterhin ausgewählt).
  await page.getByLabel('Dauer (Sekunden)').fill('1')
  await page.getByLabel('Base URL').fill('file:///etc/passwd')
  await page.getByRole('button', { name: 'k6-Lasttest starten' }).click()
  await expect(page.getByRole('alert')).toContainText('Base-URL muss mit http:// oder https:// beginnen')

  // Jetzt den JSON-Validierungsfehler: updateProduct auswählen (ersetzt listProducts).
  await page.getByLabel('Base URL').fill('http://localhost:8286/demo-api')
  await expandOperation(page, 'updateProduct')
  await page.getByLabel('updateProduct: JSON Request-Body').fill('{invalid}')
  await page.getByLabel('Endpunkt PUT /products/{id} auswählen').check()
  await page.getByRole('button', { name: 'k6-Lasttest starten' }).click()
  await expect(page.getByRole('alert')).toContainText('kein gültiges JSON')
})

test('runs the selected endpoint and opens the complete report in a new tab', async ({ page }) => {
  const specification = page.getByLabel('Swagger / OpenAPI-Dokumentation')
  await expect(specification).toContainText('Lasttest Demo API')
  await importDemo(page)

  // Single-Selection: listProducts (Default) abwählen, dann searchProducts auswählen.
  await page.getByLabel('Endpunkt GET /products auswählen').uncheck()
  await expandOperation(page, 'searchProducts')
  await page.getByLabel('Endpunkt POST /products/search auswählen').check()
  await page.getByLabel('searchProducts: JSON Request-Body').fill('{"category":"hardware","maxPrice":100}')
  await page.getByLabel('searchProducts: Bearer-Token').fill('e2e-secret-token')

  await page.getByLabel('Virtual Users').fill('1')
  await page.getByLabel('Dauer (Sekunden)').fill('1')
  await page.getByRole('button', { name: 'k6-Lasttest starten' }).click()

  await expect(page.locator('.status.completed')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('searchProducts', { exact: true })).toBeVisible()
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
  await expect(report.getByText('searchProducts', { exact: true }).first()).toBeVisible()
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

test('preloads the bundled demo specification into the editor on startup', async ({ page }) => {
  const specification = page.getByLabel('Swagger / OpenAPI-Dokumentation')
  await expect(specification).toContainText('Lasttest Demo API')

  await page.getByRole('button', { name: 'Validieren & importieren' }).click()
  await expect(page.getByRole('heading', { name: /Lasttest Demo API/ })).toBeVisible()
  await expect(page.locator('.operation-card')).toHaveCount(6)
})

test('exposes multiple OpenAPI servers as a Base-URL dropdown and allows custom overrides', async ({ page }) => {
  const multiServerSpec = `openapi: 3.0.3
info:
  title: Multi Server
  version: "1"
servers:
  - url: http://localhost:8286/demo-api
    description: Local demo
  - url: http://localhost:8286/alt
    description: Alt
paths:
  /products:
    get:
      operationId: listProducts
      responses:
        '200': {description: OK}
`

  await page.locator('input[type="file"]').setInputFiles({
    name: 'multi.yaml',
    mimeType: 'application/yaml',
    buffer: Buffer.from(multiServerSpec),
  })
  await page.getByRole('button', { name: 'Validieren & importieren' }).click()
  await expect(page.getByRole('heading', { name: 'Multi Server' })).toBeVisible()

  const selector = page.getByLabel('Server auswählen')
  await expect(selector).toBeVisible()
  const options = await selector.locator('option').allTextContents()
  expect(options.some(option => option.includes('Local demo'))).toBe(true)
  expect(options.some(option => option.includes('Alt'))).toBe(true)

  await selector.selectOption('http://localhost:8286/alt')
  await expect(page.getByLabel('Base URL')).toHaveValue('http://localhost:8286/alt')

  await page.getByLabel('Base URL').fill('http://custom.example.test/api')
  await expect(selector).toHaveValue('http://custom.example.test/api')
})

test('hides the server dropdown when the OpenAPI document declares at most one server', async ({ page }) => {
  const singleServerSpec = `openapi: 3.0.3
info:
  title: Single Server
  version: "1"
servers:
  - url: http://localhost:8286/api
paths:
  /ping:
    get:
      operationId: ping
      responses:
        '200': {description: OK}
`

  await page.locator('input[type="file"]').setInputFiles({
    name: 'single.yaml',
    mimeType: 'application/yaml',
    buffer: Buffer.from(singleServerSpec),
  })
  await page.getByRole('button', { name: 'Validieren & importieren' }).click()
  await expect(page.getByRole('heading', { name: 'Single Server' })).toBeVisible()

  await expect(page.getByLabel('Server auswählen')).toHaveCount(0)
  await expect(page.getByLabel('Base URL')).toHaveValue('http://localhost:8286/api')
})

test('allows only one endpoint to be selected at a time', async ({ page }) => {
  const specification = page.getByLabel('Swagger / OpenAPI-Dokumentation')
  await expect(specification).toContainText('Lasttest Demo API')
  await page.getByRole('button', { name: 'Validieren & importieren' }).click()
  await expect(page.getByRole('heading', { name: /Lasttest Demo API/ })).toBeVisible()

  // Initial: nur der erste nonDestructive Endpunkt (listProducts) ist ausgewählt.
  const listCheckbox = page.getByLabel('Endpunkt GET /products auswählen')
  const searchCheckbox = page.getByLabel('Endpunkt POST /products/search auswählen')
  const getCheckbox = page.getByLabel('Endpunkt GET /products/{id} auswählen')

  await expect(listCheckbox).toBeChecked()
  await expect(searchCheckbox).not.toBeChecked()
  await expect(getCheckbox).not.toBeChecked()

  // Klick auf searchProducts: listProducts wird abgewählt.
  await searchCheckbox.check()
  await expect(searchCheckbox).toBeChecked()
  await expect(listCheckbox).not.toBeChecked()

  // Klick auf getProduct: searchProducts wird abgewählt.
  await getCheckbox.check()
  await expect(getCheckbox).toBeChecked()
  await expect(searchCheckbox).not.toBeChecked()

  // Erneuter Klick auf listProducts: getProduct wird abgewählt.
  await listCheckbox.check()
  await expect(listCheckbox).toBeChecked()
  await expect(getCheckbox).not.toBeChecked()

  // Erneuter Klick auf die bereits ausgewählte Checkbox wählt ab.
  await listCheckbox.uncheck()
  await expect(listCheckbox).not.toBeChecked()
  await expect(page.getByRole('button', { name: 'k6-Lasttest starten' })).toBeDisabled()
})

test('collapses all endpoints on import and toggles a single card via the expand button', async ({ page }) => {
  const specification = page.getByLabel('Swagger / OpenAPI-Dokumentation')
  await expect(specification).toContainText('Lasttest Demo API')
  await page.getByRole('button', { name: 'Validieren & importieren' }).click()
  await expect(page.getByRole('heading', { name: /Lasttest Demo API/ })).toBeVisible()

  // Direkt nach dem Import ist jede Karte eingeklappt: aria-expanded="false".
  const toggles = page.locator('.operation-card button.expand-toggle')
  await expect(toggles).toHaveCount(6)
  for (let index = 0; index < 6; index += 1) {
    await expect(toggles.nth(index)).toHaveAttribute('aria-expanded', 'false')
  }
  await expect(page.getByLabel('listProducts: category')).toHaveCount(0)

  // Klick auf den Ausklapp-Button von listProducts: nur diese Karte ist sichtbar.
  await expandOperation(page, 'listProducts')
  await expect(toggles.nth(0)).toHaveAttribute('aria-expanded', 'true')
  await expect(toggles.nth(1)).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByLabel('listProducts: category')).toBeVisible()

  // Erneuter Klick klappt wieder ein.
  await toggles.nth(0).click()
  await expect(toggles.nth(0)).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByLabel('listProducts: category')).toHaveCount(0)
})

test('replaces the selected endpoint when importing a different specification', async ({ page }) => {
  await page.goto('/')
  const textarea = page.getByLabel('Swagger / OpenAPI-Dokumentation')
  await expect(textarea).toContainText('Lasttest Demo API')
  await page.getByRole('button', { name: 'Validieren & importieren' }).click()
  await expect(page.getByRole('heading', { name: /Lasttest Demo API/ })).toBeVisible()
  await expect(page.getByLabel('Endpunkt GET /products auswählen')).toBeChecked()

  const altSpec = `openapi: 3.0.3
info:
  title: Other API
  version: "1"
servers:
  - url: http://localhost:8286/other
paths:
  /widgets:
    get:
      operationId: listWidgets
      responses:
        '200': {description: OK}
`
  await page.locator('input[type="file"]').setInputFiles({
    name: 'other.yaml',
    mimeType: 'application/yaml',
    buffer: Buffer.from(altSpec),
  })
  await page.getByRole('button', { name: 'Validieren & importieren' }).click()
  await expect(page.getByRole('heading', { name: 'Other API' })).toBeVisible()
  await expect(page.locator('.operation-card')).toHaveCount(1)
  await expect(page.getByLabel('Endpunkt GET /widgets auswählen')).toBeChecked()
  // Alle Demo-Karten sind nach dem Neuimport verschwunden.
  await expect(page.getByLabel('Operation listProducts')).toHaveCount(0)
})

test('allows custom Base-URL entry even when the document has only one server', async ({ page }) => {
  const singleServerSpec = `openapi: 3.0.3
info:
  title: Single
  version: "1"
servers:
  - url: http://localhost:8286/api
paths:
  /ping:
    get:
      operationId: ping
      responses:
        '200': {description: OK}
`
  await page.locator('input[type="file"]').setInputFiles({
    name: 'single.yaml',
    mimeType: 'application/yaml',
    buffer: Buffer.from(singleServerSpec),
  })
  await page.getByRole('button', { name: 'Validieren & importieren' }).click()
  await expect(page.getByLabel('Base URL')).toHaveValue('http://localhost:8286/api')

  await page.getByLabel('Base URL').fill('http://custom.example.test/api')
  await expect(page.getByLabel('Base URL')).toHaveValue('http://custom.example.test/api')
  await expect(page.getByLabel('Server auswählen')).toHaveCount(0)
})

test('surfaces a failed run with its k6 error output and raw JSON', async ({ page }) => {
  const unreachableSpec = `openapi: 3.0.3
info:
  title: Unreachable
  version: "1"
servers:
  - url: http://127.0.0.1:1
paths:
  /ping:
    get:
      operationId: ping
      responses:
        '200': {description: OK}
`
  await page.locator('input[type="file"]').setInputFiles({
    name: 'unreachable.yaml',
    mimeType: 'application/yaml',
    buffer: Buffer.from(unreachableSpec),
  })
  await page.getByRole('button', { name: 'Validieren & importieren' }).click()
  await expect(page.getByRole('heading', { name: 'Unreachable' })).toBeVisible()

  await page.getByLabel('Virtual Users').fill('1')
  await page.getByLabel('Dauer (Sekunden)').fill('2')
  await page.getByRole('button', { name: 'k6-Lasttest starten' }).click()

  await expect(page.locator('.status.failed')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('k6-Konsolenausgabe')).toBeVisible()
  await expect(page.getByText('k6-JSON-Rohdaten')).toBeVisible()
})

test('runs the selected destructive endpoint with bearer token and downloads the k6 script', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  const specification = page.getByLabel('Swagger / OpenAPI-Dokumentation')
  await expect(specification).toContainText('Lasttest Demo API')
  await page.getByRole('button', { name: 'Validieren & importieren' }).click()
  await expect(page.getByRole('heading', { name: /Lasttest Demo API/ })).toBeVisible()
  await expect(page.locator('.operation-card')).toHaveCount(6)

  // Single-Selection: nur eine Operation zur Zeit – wir wählen searchProducts für den Bearer-Test.
  await expandOperation(page, 'searchProducts')
  await page.getByLabel('Endpunkt POST /products/search auswählen').check()
  await page.getByLabel('searchProducts: Bearer-Token').fill('demo-secret')

  await page.getByLabel('Virtual Users').fill('1')
  await page.getByLabel('Dauer (Sekunden)').fill('1')
  await page.getByRole('button', { name: 'k6-Lasttest starten' }).click()

  await expect(page.locator('.status.completed')).toBeVisible({ timeout: 30_000 })
  const reportLink = page.getByRole('link', { name: /Ausführlichen k6-Testbericht/ })
  const popupPromise = page.waitForEvent('popup')
  await reportLink.click()
  const report = await popupPromise
  await report.waitForLoadState('networkidle')
  await expect(report.getByText('Checks erfolgreich', { exact: true })).toBeVisible()

  const copyButton = report.getByRole('button', { name: /k6-Testskript in die Zwischenablage kopieren/ })
  await expect(copyButton).toBeVisible()
  await copyButton.click()
  await expect(report.getByRole('button', { name: /Skript in die Zwischenablage kopiert/ })).toBeVisible()
  const clipboardContents = await page.evaluate(() => navigator.clipboard.readText())
  expect(clipboardContents).toContain('import http from \'k6/http\'')
  expect(clipboardContents).toBe(await report.getByTestId('generated-k6-script').textContent())
})

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

test('rejects empty specifications and OpenAPI documents without operations', async ({ page }) => {
  const specification = page.getByLabel('Swagger / OpenAPI-Dokumentation')

  await expect(specification).toContainText('Lasttest Demo API')
  await specification.fill(' ')
  await page.getByRole('button', { name: 'Validieren & importieren' }).click()
  await expect(page.getByRole('alert')).toContainText('Dokumentation ist leer')

  await specification.fill('openapi: 3.0.3\ninfo: {title: Empty, version: "1"}\npaths: {}')
  await page.getByRole('button', { name: 'Validieren & importieren' }).click()
  await expect(page.getByRole('alert')).toContainText('keine REST-Operationen')
})

test('imports a specification from a Swagger UI URL via the URL field', async ({ page, request }) => {
  // Sanity check: the demo Swagger UI and spec endpoint are reachable.
  const swaggerResponse = await request.get('/demo-swagger-ui')
  expect(swaggerResponse.ok()).toBeTruthy()
  expect(await swaggerResponse.text()).toContain('SwaggerUIBundle')

  // The fetcher on the backend only accepts absolute URLs, so the field must contain
  // the full origin (request fixture resolves the path against the Playwright baseURL).
  const specUrl = page.getByLabel('URL zur Swagger-UI oder OpenAPI-Spezifikation')
  await specUrl.fill('http://localhost:8286/demo-swagger-ui')
  await page.getByRole('button', { name: 'Validieren & importieren' }).click()

  await expect(page.getByRole('heading', { name: /Lasttest Demo API/ })).toBeVisible()
  await expect(page.locator('.operation-card')).toHaveCount(6)
  await expect(page.getByText('Geladen aus')).toBeVisible()
  await expect(page.getByText('(über Swagger-UI)')).toBeVisible()
})

test('rejects an invalid URL before sending a request', async ({ page }) => {
  const specUrl = page.getByLabel('URL zur Swagger-UI oder OpenAPI-Spezifikation')
  await specUrl.fill('not-a-url')
  await page.getByRole('button', { name: 'Validieren & importieren' }).click()
  await expect(page.getByRole('alert')).toContainText('Die URL ist ungültig.')
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
  await expect(virtualUsers).toHaveAttribute('max', '30000')
  await virtualUsers.fill('30001')
  await page.getByRole('button', { name: 'k6-Lasttest starten' }).click()
  await expect(page.getByRole('alert')).toHaveText('Virtual Users müssen zwischen 1 und 30000 liegen.')

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
  // The new failure-summary UI must classify the run as unreachable and
  // surface the diagnosis, detail, metric row and failure-reasons list.
  await expect(page.locator('.status-diagnosis')).toHaveText('Ziel nicht erreichbar')
  await expect(page.locator('.status-detail')).toContainText('Connection refused auf http://127.0.0.1:1')
  await expect(page.locator('.metric-row .metric-item').first()).toBeVisible()
  await expect(page.locator('.failure-reasons li').first()).toContainText('lehnt TCP-Verbindungen ab')
  await expect(page.getByText('k6-Konsolenausgabe')).toBeVisible()
  await expect(page.getByText('k6-JSON-Rohdaten')).toBeVisible()
})

test('runs the selected destructive endpoint with bearer token and downloads the k6 script', async ({ page }) => {
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

  await report.getByText('Generiertes k6-Testskript', { exact: true }).click()
  const downloadLink = report.getByRole('link', { name: /k6-Testskript herunterladen/ })
  await expect(downloadLink).toBeVisible()
  const [download] = await Promise.all([
    report.waitForEvent('download'),
    downloadLink.click(),
  ])
  expect(download.suggestedFilename()).toMatch(/^lasttest-.*\.js$/)
})

test('validates parameter values against the OpenAPI schema while the user types', async ({ page }) => {
  const typedSpec = `openapi: 3.0.3
info:
  title: Typed API
  version: "1"
servers:
  - url: http://localhost:8286/typed
paths:
  /items:
    get:
      operationId: listItems
      parameters:
        - name: id
          in: query
          required: false
          schema:
            type: integer
            format: int64
        - name: count
          in: query
          required: false
          schema:
            type: integer
            format: int32
            minimum: 1
            maximum: 100
        - name: price
          in: query
          required: false
          schema:
            type: number
            format: double
            minimum: 0.01
        - name: category
          in: query
          required: false
          schema:
            type: string
            enum: [books, hardware, software]
        - name: email
          in: query
          required: false
          schema:
            type: string
            format: email
        - name: enabled
          in: query
          required: false
          schema:
            type: boolean
      responses:
        '200': {description: OK}
`

  await page.locator('input[type="file"]').setInputFiles({
    name: 'typed.yaml',
    mimeType: 'application/yaml',
    buffer: Buffer.from(typedSpec),
  })
  await page.getByRole('button', { name: 'Validieren & importieren' }).click()
  await expect(page.getByRole('heading', { name: /Typed API/ })).toBeVisible()
  const card = page.locator('.operation-card').first()
  await expect(card).toBeVisible()
  const toggle = card.locator('button.expand-toggle')
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')

  const idInput = page.getByLabel('listItems: id')
  const countInput = page.getByLabel('listItems: count')
  const priceInput = page.getByLabel('listItems: price')
  const categoryInput = page.getByLabel('listItems: category')
  const emailInput = page.getByLabel('listItems: email')
  const enabledInput = page.getByLabel('listItems: enabled')

  // Schema-Typen werden als kleiner Hinweis angezeigt.
  await expect(page.locator('.parameter-box', { has: idInput }).locator('.type-hint')).toHaveText('int64')
  await expect(page.locator('.parameter-box', { has: countInput }).locator('.type-hint')).toHaveText('int32')
  await expect(page.locator('.parameter-box', { has: priceInput }).locator('.type-hint')).toHaveText('double')
  await expect(page.locator('.parameter-box', { has: categoryInput }).locator('.type-hint')).toHaveText('string enum')
  await expect(page.locator('.parameter-box', { has: emailInput }).locator('.type-hint')).toHaveText('email')
  await expect(page.locator('.parameter-box', { has: enabledInput }).locator('.type-hint')).toHaveText('boolean')

  // Die importierten Beispielwerte (id=1, count=1, price=0.01, category=books, email=test@example.com, enabled=true)
// sind alle schema-konform und lösen keinen Hinweis aus.
  await expect(card.locator('.parameter-error')).toHaveCount(0)

  // int64: Buchstaben → rote Fehlermeldung.
  await idInput.fill('abc')
  const idBox = page.locator('.parameter-box', { has: idInput })
  await expect(idBox.locator('.parameter-error')).toHaveText('Ungültig: erwartet eine Ganzzahl (long).')
  await expect(idInput).toHaveAttribute('aria-invalid', 'true')

  // int64: gültiger Wert → Fehlermeldung verschwindet.
  await idInput.fill('42')
  await expect(idBox.locator('.parameter-error')).toHaveCount(0)

  // int32: out-of-range → Fehlermeldung über Bereich.
  await countInput.fill('2147483648')
  await expect(page.locator('.parameter-box', { has: countInput }).locator('.parameter-error')).toHaveText('Ungültig: erwartet eine Ganzzahl (int32).')

  // int32: unter minimum → eigene minimum-Meldung.
  await countInput.fill('0')
  await expect(page.locator('.parameter-box', { has: countInput }).locator('.parameter-error')).toHaveText('Ungültig: Wert muss ≥ 1 sein.')

  // int32: gültig → Fehlermeldung verschwindet.
  await countInput.fill('50')
  await expect(page.locator('.parameter-box', { has: countInput }).locator('.parameter-error')).toHaveCount(0)

  // double: Buchstaben → Fehlermeldung.
  await priceInput.fill('not-a-number')
  await expect(page.locator('.parameter-box', { has: priceInput }).locator('.parameter-error')).toHaveText('Ungültig: erwartet eine Zahl (double).')

  // double: gültige Dezimalzahl → ok.
  await priceInput.fill('19.95')
  await expect(page.locator('.parameter-box', { has: priceInput }).locator('.parameter-error')).toHaveCount(0)

  // enum: ungültiger Wert → Meldung listet erlaubte Werte.
  await categoryInput.fill('toys')
  await expect(page.locator('.parameter-box', { has: categoryInput }).locator('.parameter-error')).toHaveText('Ungültig: erwartet einen Wert aus „books“, „hardware“ oder „software“.')

  // enum: gültig → ok.
  await categoryInput.fill('books')
  await expect(page.locator('.parameter-box', { has: categoryInput }).locator('.parameter-error')).toHaveCount(0)

  // email: ungültig → Meldung.
  await emailInput.fill('not-an-email')
  await expect(page.locator('.parameter-box', { has: emailInput }).locator('.parameter-error')).toHaveText('Ungültig: erwartet eine E-Mail-Adresse.')

  // email: gültig → ok.
  await emailInput.fill('user@example.com')
  await expect(page.locator('.parameter-box', { has: emailInput }).locator('.parameter-error')).toHaveCount(0)

  // boolean: „yes“ ist nicht erlaubt.
  await enabledInput.fill('yes')
  await expect(page.locator('.parameter-box', { has: enabledInput }).locator('.parameter-error')).toHaveText('Ungültig: erwartet true oder false.')

  // boolean: „true“ ist erlaubt.
  await enabledInput.fill('true')
  await expect(page.locator('.parameter-box', { has: enabledInput }).locator('.parameter-error')).toHaveCount(0)
})

test('disables the start button when a parameter value is invalid and re-enables it on correction', async ({ page }) => {
  const typedSpec = `openapi: 3.0.3
info:
  title: Typed API
  version: "1"
servers:
  - url: http://localhost:8286/typed
paths:
  /items:
    get:
      operationId: listItems
      parameters:
        - name: id
          in: query
          required: false
          schema:
            type: integer
            format: int64
      responses:
        '200': {description: OK}
`

  await page.locator('input[type="file"]').setInputFiles({
    name: 'typed.yaml',
    mimeType: 'application/yaml',
    buffer: Buffer.from(typedSpec),
  })
  await page.getByRole('button', { name: 'Validieren & importieren' }).click()
  await expect(page.getByRole('heading', { name: /Typed API/ })).toBeVisible()
  await expect(page.locator('.operation-card')).toHaveCount(1)

  // Karten aufklappen, damit das id-Feld sichtbar wird.
  const card = page.locator('.operation-card').first()
  const toggle = card.locator('button.expand-toggle')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')

  const idInput = page.getByLabel('listItems: id')
  const startButton = page.getByRole('button', { name: 'k6-Lasttest starten' })

  // Mit leerem Wert ist alles gültig → Button aktiv.
  await expect(startButton).toBeEnabled()

  // Buchstaben in das int64-Feld → Fehlermeldung + Button deaktiviert.
  await idInput.fill('abc')
  await expect(card.locator('.parameter-error')).toHaveText('Ungültig: erwartet eine Ganzzahl (long).')
  await expect(page.getByRole('alert').filter({ hasText: 'Bitte korrigiere die rot markierten Eingaben' })).toBeVisible()
  await expect(startButton).toBeDisabled()

  // Endpunkt abwählen → nichts zum Starten ausgewählt → Button bleibt deaktiviert.
  await page.getByLabel('Endpunkt GET /items auswählen').uncheck()
  await expect(startButton).toBeDisabled()

  // Endpunkt erneut auswählen → Validierung greift wieder.
  await page.getByLabel('Endpunkt GET /items auswählen').check()
  await expect(startButton).toBeDisabled()

  // Korrekten Wert eingeben → Fehler verschwindet, Button wird wieder aktiv.
  await idInput.fill('42')
  await expect(card.locator('.parameter-error')).toHaveCount(0)
  await expect(startButton).toBeEnabled()
})

test('disables the start button when the JSON body does not match the OpenAPI schema', async ({ page }) => {
  const typedSpec = `openapi: 3.0.3
info:
  title: Body API
  version: "1"
servers:
  - url: http://localhost:8286/body
paths:
  /items:
    post:
      operationId: createItem
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [name, price]
              properties:
                name:
                  type: string
                  minLength: 1
                price:
                  type: number
                  minimum: 0.01
      responses:
        '201': {description: Created}
`

  await page.locator('input[type="file"]').setInputFiles({
    name: 'body.yaml',
    mimeType: 'application/yaml',
    buffer: Buffer.from(typedSpec),
  })
  await page.getByRole('button', { name: 'Validieren & importieren' }).click()
  await expect(page.getByRole('heading', { name: /Body API/ })).toBeVisible()
  await expect(page.locator('.operation-card')).toHaveCount(1)

  // POST ist destruktiv → wird nicht auto-selektiert. Manuell auswählen.
  await page.getByLabel('Endpunkt POST /items auswählen').check()

  const card = page.locator('.operation-card').first()
  const toggle = card.locator('button.expand-toggle')
  await toggle.click()

  const bodyInput = page.getByLabel('createItem: JSON Request-Body')
  const startButton = page.getByRole('button', { name: 'k6-Lasttest starten' })

  // Beispiel wird vom Backend gesetzt: ein gültiges Objekt. Button ist aktiv.
  await expect(bodyInput).toHaveValue(/.+/)
  await expect(startButton).toBeEnabled()

  // JSON-Body entfernen → Pflicht-Body fehlt → Button deaktiviert.
  await bodyInput.fill('')
  await expect(card.locator('.parameter-error')).toHaveText('Ungültig: Pflicht-Request-Body ist leer.')
  await expect(startButton).toBeDisabled()

  // Ungültiges JSON.
  await bodyInput.fill('{invalid}')
  await expect(card.locator('.parameter-error')).toHaveText('Ungültig: kein gültiges JSON.')
  await expect(startButton).toBeDisabled()

  // JSON ok, aber Pflichtfeld fehlt.
  await bodyInput.fill('{"price":1.5}')
  await expect(card.locator('.parameter-error')).toHaveText('Ungültig: Pflichtfeld „name“ fehlt.')
  await expect(startButton).toBeDisabled()

  // JSON ok, aber falscher Typ.
  await bodyInput.fill('{"name":"Luna","price":"viel"}')
  await expect(card.locator('.parameter-error')).toContainText('erwartet eine Zahl (double)')
  await expect(startButton).toBeDisabled()

  // Unter minimum.
  await bodyInput.fill('{"name":"Luna","price":0}')
  await expect(card.locator('.parameter-error')).toContainText('Wert muss ≥ 0.01 sein')
  await expect(startButton).toBeDisabled()

  // Gültiger Body.
  await bodyInput.fill('{"name":"Luna","price":1.5}')
  await expect(card.locator('.parameter-error')).toHaveCount(0)
  await expect(startButton).toBeEnabled()
})

test('revalidates when the user switches the selected endpoint', async ({ page }) => {
  const twoEndpointsSpec = `openapi: 3.0.3
info:
  title: Two Endpoints
  version: "1"
servers:
  - url: http://localhost:8286/two
paths:
  /alpha:
    get:
      operationId: getAlpha
      parameters:
        - name: id
          in: query
          required: false
          schema:
            type: integer
            format: int64
      responses:
        '200': {description: OK}
  /beta:
    get:
      operationId: getBeta
      parameters:
        - name: flag
          in: query
          required: false
          schema:
            type: string
            enum: [a, b, c]
      responses:
        '200': {description: OK}
`

  await page.locator('input[type="file"]').setInputFiles({
    name: 'two.yaml',
    mimeType: 'application/yaml',
    buffer: Buffer.from(twoEndpointsSpec),
  })
  await page.getByRole('button', { name: 'Validieren & importieren' }).click()
  await expect(page.getByRole('heading', { name: /Two Endpoints/ })).toBeVisible()
  await expect(page.locator('.operation-card')).toHaveCount(2)

  // getAlpha ist initial ausgewählt. Wir machen es ungültig.
  const alphaCard = page.locator('.operation-card', { has: page.locator('.operation-id', { hasText: 'getAlpha' }) })
  const betaCard = page.locator('.operation-card', { has: page.locator('.operation-id', { hasText: 'getBeta' }) })
  await alphaCard.locator('button.expand-toggle').click()
  await page.getByLabel('getAlpha: id').fill('abc')
  const startButton = page.getByRole('button', { name: 'k6-Lasttest starten' })
  await expect(startButton).toBeDisabled()

  // Wechsel zu getBeta: alpha-Wert bleibt ungültig, aber die ausgewählte Operation ist neu.
  // Beta hat einen gültigen Beispielwert (erster enum-Wert "a") → Button wird wieder aktiv.
  await page.getByLabel('Endpunkt GET /alpha auswählen').uncheck()
  await page.getByLabel('Endpunkt GET /beta auswählen').check()
  await expect(startButton).toBeEnabled()

  // Beta ungültig machen → Button wird deaktiviert.
  await betaCard.locator('button.expand-toggle').click()
  await page.getByLabel('getBeta: flag').fill('toys')
  await expect(startButton).toBeDisabled()

  // Zurück zu Alpha: alpha hat immer noch den ungültigen Wert → Button bleibt deaktiviert.
  await page.getByLabel('Endpunkt GET /beta auswählen').uncheck()
  await page.getByLabel('Endpunkt GET /alpha auswählen').check()
  await expect(startButton).toBeDisabled()

  // Alpha wieder gültig machen → Button wird wieder aktiv.
  await page.getByLabel('getAlpha: id').fill('5')
  await expect(startButton).toBeEnabled()
})

test('renders the new load profile editor with presets and validates stages', async ({ page }) => {
  await importDemo(page)

  // Lastprofil-Sektion ist sichtbar; Default ist constant-vus mit 10 VUs / 30 s.
  const profileSelect = page.locator('.profile-type-select')
  await expect(profileSelect).toBeVisible()
  await expect(profileSelect).toHaveValue('constant-vus')

  // Profil auf Ramping-VUs umschalten.
  await profileSelect.selectOption('ramping-vus')
  const editor = page.locator('[data-testid="load-profile-editor"]')
  await expect(editor).toBeVisible()

  // Stages-Tabelle mit den 4 Spike-Preset-Stages.
  const stageRows = editor.locator('.stages-table tbody tr')
  await expect(stageRows).toHaveCount(4)
  // Targets des Spike-Presets: 0, 800, 800, 0.
  const firstStageTarget = stageRows.nth(0).locator('input[type="number"]').first()
  await expect(firstStageTarget).toHaveValue('0')

  // Spitze-Preset klicken, um Stages auf 0, 800, 800, 0 zu setzen.
  await editor.getByRole('button', { name: 'Spike', exact: true }).click()
  await expect(stageRows).toHaveCount(4)

  // "Plateau erlaubt": zwei Stages mit demselben Target (800, 800) sollen
  // keinen Validierungsfehler werfen.
  const errorBox = editor.locator('.parameter-error')
  await expect(errorBox).toHaveCount(0)

  // Eine Stage hinzufügen.
  await editor.getByRole('button', { name: 'Stage hinzufügen' }).click()
  await expect(stageRows).toHaveCount(5)

  // Erste Stage entfernen → 4 verbleibend.
  await stageRows.nth(0).locator('button.stage-remove').click()
  await expect(stageRows).toHaveCount(4)

  // Auf Constant-Arrival-Rate wechseln → 5 spezifische Felder.
  await profileSelect.selectOption('constant-arrival-rate')
  await expect(editor.getByLabel('Rate (Anfragen)')).toBeVisible()
  await expect(editor.getByLabel('pro Sekunden')).toBeVisible()
  await expect(editor.getByLabel('Dauer (Sekunden)')).toBeVisible()
  await expect(editor.getByLabel('preAllocatedVUs')).toBeVisible()
  await expect(editor.getByLabel('maxVUs')).toBeVisible()
})

test('report page renders the ramp-grafik for a completed ramping-vus run', async ({ page }) => {
  // Diese Suite setzt voraus, dass ein k6-fähiger Container läuft und
  // ein Ramping-VUs-Lauf in der jüngeren Vergangenheit abgeschlossen
  // wurde. Wir erzeugen den Lauf, warten auf COMPLETED, öffnen den
  // Report und prüfen, dass die Ramp-Grafik gerendert wird.
  await importDemo(page)

  // Ramping-VUs-Profil auswählen.
  const profileSelect = page.locator('.profile-type-select')
  await profileSelect.selectOption('ramping-vus')
  await page.locator('[data-testid="load-profile-editor"]').getByRole('button', { name: 'Spike', exact: true }).click()

  // 200 ms reichen, damit der Demo-Endpunkt unter lasttest/demo-api
  // antwortet; Stages sind 0/2s, 800/10s, 800/30s, 0/2s ≈ 44 s.
  // Wir verkürzen die Stages für den E2E-Test, indem wir die
  // Editor-Werte direkt ändern.
  const stageRows = page.locator('.stages-table tbody tr')
  await expect(stageRows).toHaveCount(4)
  // Setze alle Durations auf 1 s → Lauf dauert ~4 s.
  for (let i = 0; i < 4; i++) {
    const durationInput = stageRows.nth(i).locator('input[type="number"]').nth(1)
    await durationInput.fill('1')
  }

  await page.getByRole('button', { name: 'k6-Lasttest starten' }).click()
  // Warten bis der Run-Status COMPLETED ist.
  await expect(page.getByText('COMPLETED', { exact: false })).toBeVisible({ timeout: 60_000 })

  // Report-Link öffnen.
  const reportLink = page.getByRole('link', { name: /Ausführlichen k6-Testbericht/ })
  const [reportPage] = await Promise.all([page.context().waitForEvent('page'), reportLink.click()])

  // Lastprofil-Sektion und Ramp-Grafik sind sichtbar.
  await expect(reportPage.getByRole('heading', { name: /Lastprofil.*Lastverlauf/ })).toBeVisible()
  // SVG mit Soll-Linie (lila) ist im Ramp-Card.
  const rampSvg = reportPage.locator('.ramp-svg').first()
  await expect(rampSvg).toBeVisible()
  // Legende zeigt beide Linien.
  await expect(reportPage.getByText('Geplant (Soll)')).toBeVisible()
  await expect(reportPage.getByText('Tatsächlich (Ist)')).toBeVisible()
  // Stages-Tabelle ist ebenfalls da.
  const stagesTable = reportPage.locator('table[aria-label="Stages des Lastprofils"]')
  await expect(stagesTable).toBeVisible()
  await expect(stagesTable.locator('tbody tr')).toHaveCount(4)
})

// ---- Run-Status-View: RunProgress / RunSummary / RunFailure ----------------
//
// Diese Tests decken die drei neuen Live-Sichten ab, die nach dem
// Klick auf „k6-Lasttest starten“ im Haupt-Editor erscheinen.

test('shows the live progress card while a k6 run is QUEUED or RUNNING', async ({ page }) => {
  // Wählt einen etwas längeren Lauf, damit die Polling-Animation
  // mit Sicherheit mindestens einen RUNNING-Frame einfängt.
  await importDemo(page)
  await page.getByLabel('Virtual Users').fill('1')
  await page.getByLabel('Dauer (Sekunden)').fill('5')
  await page.getByRole('button', { name: 'k6-Lasttest starten' }).click()

  // Status-Badge ist sichtbar. Da der Test asynchron auf den Lauf
  // wartet, kann die Karte sowohl RUNNING als auch schon COMPLETED
  // sein — wir prüfen daher nur die Zeitanzeige-Komponente.
  await expect(page.locator('.status.running, .status.queued, .status.completed').first()).toBeVisible({ timeout: 30_000 })

  // .run-progress ist da, solange der Test läuft, ODER .run-summary-cards
  // ist da, wenn er schon fertig ist. Mindestens eines davon.
  const progress = page.locator('.run-progress')
  const summary = page.locator('.run-summary-cards')
  await expect(progress.or(summary)).toBeVisible()
})

test('renders a compact summary card grid after a successful smoke test completes', async ({ page }) => {
  await importDemo(page)
  await page.getByLabel('Virtual Users').fill('1')
  await page.getByLabel('Dauer (Sekunden)').fill('1')
  await page.getByRole('button', { name: 'k6-Lasttest starten' }).click()

  // Warten auf COMPLETED.
  await expect(page.locator('.status.completed')).toBeVisible({ timeout: 30_000 })

  // Sechs Metrik-Karten sind sichtbar (Checks, Fehlerrate, p95, Requests, Iterationen, Laufzeit).
  const cards = page.locator('.run-summary-card')
  await expect(cards).toHaveCount(6)
  await expect(page.getByText('Checks erfolgreich', { exact: true })).toBeVisible()
  await expect(page.getByText('HTTP-Fehlerrate', { exact: true })).toBeVisible()
  await expect(page.getByText('p(95) Antwortzeit', { exact: true })).toBeVisible()
  await expect(page.getByText('HTTP Requests', { exact: true })).toBeVisible()
  await expect(page.getByText('Iterationen', { exact: true })).toBeVisible()
  await expect(page.getByText('Laufzeit', { exact: true })).toBeVisible()
})

test('renders a typed failure card with DNS error when the target host cannot be resolved', async ({ page }) => {
  // Spezifikation, die auf einen nicht auflösbaren Host zeigt.
  const unreachableSpec = `openapi: 3.0.3
info:
  title: DNS Failure
  version: "1"
servers:
  - url: http://this-host-does-not-resolve-anywhere.invalid
paths:
  /ping:
    get:
      operationId: ping
      responses:
        '200': {description: OK}
`
  await page.locator('input[type="file"]').setInputFiles({
    name: 'dns-failure.yaml',
    mimeType: 'application/yaml',
    buffer: Buffer.from(unreachableSpec),
  })
  await page.getByRole('button', { name: 'Validieren & importieren' }).click()
  await expect(page.getByRole('heading', { name: 'DNS Failure' })).toBeVisible()

  await page.getByLabel('Virtual Users').fill('1')
  await page.getByLabel('Dauer (Sekunden)').fill('2')
  await page.getByRole('button', { name: 'k6-Lasttest starten' }).click()

  // Status FAILED.
  await expect(page.locator('.status.failed')).toBeVisible({ timeout: 60_000 })

  // Typed-Failure-Card: Label „DNS-Auflösung“ und die Host-Domain.
  const failureCard = page.locator('.run-failure')
  await expect(failureCard).toBeVisible()
  await expect(failureCard).toHaveClass(/kind-dns/)
  await expect(failureCard.getByText('DNS-Auflösung', { exact: true })).toBeVisible()
  await expect(failureCard).toContainText('this-host-does-not-resolve-anywhere.invalid')
  // Action-Hint ist sichtbar.
  await expect(failureCard.getByText(/Prüfe, ob der Hostname/)).toBeVisible()
})

test('renders a typed failure card with connection-refused when the port is not open', async ({ page }) => {
  // 127.0.0.1:1 ist der Standard-„Verbindung abgelehnt“-Endpunkt auf jedem System.
  const unreachableSpec = `openapi: 3.0.3
info:
  title: Connection Refused
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
    name: 'refused.yaml',
    mimeType: 'application/yaml',
    buffer: Buffer.from(unreachableSpec),
  })
  await page.getByRole('button', { name: 'Validieren & importieren' }).click()
  await expect(page.getByRole('heading', { name: 'Connection Refused' })).toBeVisible()

  await page.getByLabel('Virtual Users').fill('1')
  await page.getByLabel('Dauer (Sekunden)').fill('1')
  await page.getByRole('button', { name: 'k6-Lasttest starten' }).click()

  await expect(page.locator('.status.failed')).toBeVisible({ timeout: 60_000 })

  const failureCard = page.locator('.run-failure')
  await expect(failureCard).toBeVisible()
  await expect(failureCard).toHaveClass(/kind-connection-refused/)
  await expect(failureCard.getByText('Verbindung abgelehnt', { exact: true })).toBeVisible()
  await expect(failureCard).toContainText('127.0.0.1')
})

test('the completed summary card grid is also visible in the report popup', async ({ page }) => {
  await importDemo(page)
  await page.getByLabel('Virtual Users').fill('1')
  await page.getByLabel('Dauer (Sekunden)').fill('1')
  await page.getByRole('button', { name: 'k6-Lasttest starten' }).click()
  await expect(page.locator('.status.completed')).toBeVisible({ timeout: 30_000 })

  // Report-Popup öffnen und prüfen, dass die ausführliche
  // Zusammenfassung (Cards + Thresholds) sichtbar ist.
  const popupPromise = page.context().waitForEvent('page')
  await page.getByRole('link', { name: /Ausführlichen k6-Testbericht/ }).click()
  const report = await popupPromise
  await report.waitForLoadState('networkidle')

  await expect(report.getByText('Checks erfolgreich', { exact: true })).toBeVisible()
  await expect(report.getByText('p(95) Antwortzeit', { exact: true })).toBeVisible()
  await expect(report.getByRole('heading', { name: 'Thresholds' })).toBeVisible()
})

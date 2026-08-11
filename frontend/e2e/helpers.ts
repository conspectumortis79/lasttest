import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { expect, type Page } from '@playwright/test'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))

export const demoSpecificationPath: string = path.resolve(
  currentDirectory,
  '../../demo/openapi-demo.yaml',
)

export const DEMO_BASE_URL = 'http://localhost:8286/demo-api'

export async function importDemo(page: Page): Promise<void> {
  await page.getByLabel('Swagger / OpenAPI Specification').waitFor({ timeout: 30_000 })
  await expect(page.getByLabel('Swagger / OpenAPI Specification'))
    .toContainText('Lasttest Demo API', { timeout: 30_000 })
  const demoText = await readFile(demoSpecificationPath, 'utf8')
  await page.getByLabel('Swagger / OpenAPI Specification').fill(demoText)
  await page.getByRole('button', { name: 'Validate & import' }).click()
  await page.getByRole('heading', { name: /Lasttest Demo API/ }).waitFor()
}

export async function importInlineSpec(page: Page, spec: string, expectedTitle: string): Promise<void> {
  const textarea = page.getByLabel('Swagger / OpenAPI Specification')
  await expect(textarea).toContainText('Lasttest Demo API', { timeout: 30_000 })
  await textarea.fill(spec)
  await page.getByRole('button', { name: 'Validate & import' }).click()
  await page.getByRole('heading', { name: new RegExp(expectedTitle) }).waitFor()
}

export async function expandOperation(
  page: Page,
  operationId: string,
  options: { expand?: boolean } = {},
): Promise<void> {
  const { expand = true } = options
  const card = page.locator('.operation-card', {
    has: page.getByLabel(`Operation ${operationId}`),
  })
  if (expand) {
    const toggle = card.locator('button.expand-toggle')
    if ((await toggle.getAttribute('aria-expanded')) === 'false') {
      await toggle.click()
    }
  }
}

export type StartRunOptions = {
  operation: string
  vus: string
  duration: string
  timeout?: number
}

export function endpointCheckboxLabel(method: string, path: string): string {
  return `Endpunkt ${method} ${path} auswählen`
}

export async function startDemoRunAndAwaitTerminal(
  page: Page,
  options: StartRunOptions,
): Promise<void> {
  const { operation, vus, duration, timeout = 120_000 } = options

  await importDemo(page)

  const endpoint = resolveDemoEndpoint(operation)
  const target = page.getByLabel(endpointCheckboxLabel(endpoint.method, endpoint.path))
  const defaultSelected = page.getByLabel(endpointCheckboxLabel('GET', '/products'))
  if (await defaultSelected.isChecked().catch(() => false)) {
    await defaultSelected.uncheck()
  }
  await target.check()

  await page.getByLabel('Virtual Users').fill(vus)
  await page.getByLabel('Duration (seconds)').fill(duration)
  await page.getByRole('button', { name: 'Start k6 load test' }).click()

  await page.locator('.status-badge.is-pass, .status-badge.is-fail, .status-badge.is-aborted')
    .first()
    .waitFor({ timeout })
  await page.locator('.run-grid .run-badge-completed, .run-grid .run-badge-failed, .run-grid .run-badge-aborted')
    .first()
    .waitFor({ timeout })
}

export function resolveDemoEndpoint(operationId: string): { method: string, path: string } {
  const map: Record<string, { method: string, path: string }> = {
    listProducts: { method: 'GET', path: '/products' },
    getProduct: { method: 'GET', path: '/products/{id}' },
    searchProducts: { method: 'POST', path: '/products/search' },
    createProduct: { method: 'POST', path: '/products' },
    updateProduct: { method: 'PUT', path: '/products/{id}' },
    deleteProduct: { method: 'DELETE', path: '/products/{id}' },
    getAdminStats: { method: 'GET', path: '/products/admin/stats' },
    lookupProduct: { method: 'GET', path: '/products/lookup-by-id' },
    getMe: { method: 'GET', path: '/products/me' },
    getMyProfile: { method: 'GET', path: '/products/my-profile' },
  }
  const entry = map[operationId]
  if (!entry) throw new Error(`Unknown demo operationId: ${operationId}`)
  return entry
}

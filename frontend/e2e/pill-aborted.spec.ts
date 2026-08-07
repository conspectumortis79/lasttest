import { expect, test } from '@playwright/test'

// Visual snapshot of the ABORTED result-header pill so it can be
// compared with the FAILED pill — they should share the same
// tonal palette now.

test('ABORTED pill — visual snapshot for design parity', async ({ page }) => {
  // Start the run from the UI so the dashboard knows about it
  // (cross-session runs are not loaded from the server).
  const unreachableSpec = `openapi: 3.0.3
info:
  title: Demo
  version: "1"
servers:
  - url: http://localhost:8286/demo-api
paths:
  /:
    get:
      operationId: root
      responses:
        '200': {description: OK}
`
  await page.goto('/')
  await page.locator('input[type="file"]').setInputFiles({
    name: 'demo.yaml',
    mimeType: 'application/yaml',
    buffer: Buffer.from(unreachableSpec),
  })
  await page.getByRole('button', { name: 'Validieren & importieren' }).click()
  await page.getByLabel('Virtual Users').fill('1')
  await page.getByLabel('Dauer (Sekunden)').fill('60')
  await page.getByRole('button', { name: 'k6-Lasttest starten' }).click()

  const badge = page.locator('.run-badge').first()
  await expect(badge).toBeVisible({ timeout: 10_000 })
  await expect(badge).toHaveClass(/run-badge-running|run-badge-stopping/, { timeout: 30_000 })

  // Force-abort via the context menu — this is exactly the user
  // path the design fix targets.
  await badge.click({ button: 'right' })
  await expect(page.locator('.run-context-menu')).toBeVisible()
  await page.locator('.run-context-menu').getByRole('menuitem', { name: 'Force abort' }).click()

  await expect(badge).toContainText('ABORTED', { timeout: 15_000 })
  await expect(page.locator('.status-badge.is-aborted')).toBeVisible({ timeout: 5_000 })
  await page.locator('.run-result-head').first().screenshot({ path: 'test-results/pill-aborted.png' })
})

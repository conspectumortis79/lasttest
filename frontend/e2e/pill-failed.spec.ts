import { expect, test } from '@playwright/test'

// Visual snapshot of the FAILED result-header pill, used to
// verify the tonal-palette fix matches the ABORTED pill. We do
// not import the demo spec — instead we set the base URL to a
// port nothing listens on, which makes k6 fail fast with
// connection-refused. The existing test
// "renders a typed failure card with connection-refused when the
// port is not open" exercises the same flow end-to-end; this
// spec is just the screenshot counterpart.

test('FAILED pill uses the tonal palette as ABORTED', async ({ page }) => {
  // Use a canned spec with one unreachable server. Matches the
  // pattern lasttest.spec.ts uses for the same flow.
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

  await page.goto('/')
  await page.locator('input[type="file"]').setInputFiles({
    name: 'refused.yaml',
    mimeType: 'application/yaml',
    buffer: Buffer.from(unreachableSpec),
  })
  await page.getByRole('button', { name: 'Validieren & importieren' }).click()
  await expect(page.getByRole('heading', { name: 'Connection Refused' })).toBeVisible()

  await page.getByLabel('Virtual Users').fill('1')
  await page.getByLabel('Dauer (Sekunden)').fill('3')
  await page.getByRole('button', { name: 'k6-Lasttest starten' }).click()

  // Wait until the run reached a terminal state. 3 s duration
  // is the configured ceiling; k6 against an unreachable target
  // typically finishes in well under 30 s.
  const badge = page.locator('.run-badge').first()
  await expect(badge).toBeVisible({ timeout: 10_000 })
  await expect(badge).toContainText(/FAILED|ABORTED|STOPPED|COMPLETED/, { timeout: 60_000 })
  await expect(page.locator('.status-badge.is-fail')).toBeVisible({ timeout: 30_000 })

  // Crop the run-result-head row so the screenshot is just the
  // pill, the exit code and the optional caption — not the
  // full page. This is the visual asset to inspect against
  // the existing falsch.png / richtig.png mock-ups.
  await page.locator('.run-result-head').first().screenshot({ path: 'test-results/pill-failed.png' })
})

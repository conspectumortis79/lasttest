import { expect, test } from '@playwright/test'

// Visual snapshot of the FAILED result-header pill, used to
// verify the tonal-palette fix matches the ABORTED pill. We do
// not import the demo spec — instead we set the base URL to a
// port nothing listens on, which makes k6 fail fast with
// connection-refused. The existing test
// "renders a typed failure card with connection-refused when the
// port is not open" exercises the same flow end-to-end; this
// spec is just the screenshot counterpart.

test.beforeEach(async ({ page }) => {
  // The visual contract uses German UI labels (e.g.
  // "Validieren & importieren"). Pin the language before the
  // app boots — `useLanguage` defaults to English and the
  // i18n mockups speak German.
  await page.addInitScript(() => localStorage.setItem('lasttest.language', 'de'))
  await page.goto('/')
})

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

  // Turn the demo toggle OFF for this test's own page. The
  // server-side toggle may be enabled by another worker running
  // in parallel (or by a previous test in this worker); if it
  // is, `App.tsx`'s auto-load effect asynchronously `fetch`es
  // the bundled demo spec into the SAME textarea this test is
  // about to fill via `setInputFiles`, and that fetch can
  // resolve AFTER our upload and silently overwrite it. Turning
  // the toggle off routes the effect into its synchronous
  // `else` branch instead, removing the race entirely.
  //
  // IMPORTANT: unchecking this switch calls `setDemoEnabled(false)`,
  // which is a PROCESS-WIDE server toggle
  // (`POST /api/demo-traffic/enabled` — DemoTrafficController.kt
  // documents it as having "no per-user state"). This file is
  // therefore pinned to the serial `chromium-demo-traffic`
  // project in playwright.config.ts, so no other spec file's
  // tests can be in flight while this toggle is off.
  await page.getByRole('button', { name: 'Einstellungen' }).click()
  await page.locator('[data-testid="settings-demo-api-switch"]').uncheck()
  await page.keyboard.press('Escape')

  await page.locator('input[type="file"]').setInputFiles({
    name: 'refused.yaml',
    mimeType: 'application/yaml',
    buffer: Buffer.from(unreachableSpec),
  })
  await expect(page.getByLabel('Swagger / OpenAPI-Dokumentation')).toContainText('Connection Refused')
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

import { expect, test } from '@playwright/test'
import { ensureDemoApiEnabled } from './demoToggleFixture.ts'

// Visual snapshot of the ABORTED result-header pill so it can be
// compared with the FAILED pill — they should share the same
// tonal palette now.

test.beforeEach(async ({ page }) => {
  // See demoToggleFixture.ts: an earlier spec file in this
  // sequential suite may have disabled the demo-API toggle on
  // the server; this suite imports the demo spec, so it must
  // always start from an enabled toggle.
  await ensureDemoApiEnabled()
  // The visual contract uses German UI labels (e.g.
  // "Validieren & importieren"). Pin the language before the
  // app boots — `useLanguage` defaults to English and the
  // i18n mockups speak German.
  await page.addInitScript(() => localStorage.setItem('lasttest.language', 'de'))
  await page.goto('/')
})

test('ABORTED pill — visual snapshot for design parity', async ({ page }) => {
  // Start the run from the UI so the dashboard knows about it
  // (cross-session runs are not loaded from the server).
  const unreachableSpec = `openapi: 3.0.3
info:
  title: Pill Aborted Probe
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
  // Turn the demo toggle OFF for this test's own page. The
  // `beforeEach` above only guarantees the SERVER-side toggle
  // is enabled at navigation time; `App.tsx`'s auto-load effect
  // then asynchronously `fetch`es the bundled demo spec into
  // the SAME textarea this test is about to fill via
  // `setInputFiles`. Under load (parallel workers), that fetch
  // can resolve AFTER our upload and silently overwrite it —
  // no amount of waiting on the textarea's content closes that
  // window, because the fetch can still be in flight when the
  // wait succeeds and land afterwards. Disabling the toggle
  // before uploading routes the effect into its `else` branch
  // (`setSpecification(sample)`, a synchronous, one-shot reset)
  // instead of the racy `fetch` branch, removing the race
  // entirely rather than trying to out-wait it.
  //
  // IMPORTANT: unchecking this switch calls `setDemoEnabled(false)`,
  // which is a PROCESS-WIDE server toggle
  // (`POST /api/demo-traffic/enabled` — DemoTrafficController.kt
  // documents it as having "no per-user state"). Doing this while
  // other files run in parallel workers would 404 their demo-API
  // calls. This file is therefore pinned to the serial
  // `chromium-demo-traffic` project in playwright.config.ts
  // (alongside demo-traffic.spec.ts, which has the same
  // constraint), so no other spec file's tests can be in flight
  // while this toggle is off.
  await page.getByRole('button', { name: 'Einstellungen' }).click()
  await page.locator('[data-testid="settings-demo-api-switch"]').uncheck()
  await page.keyboard.press('Escape')

  await page.locator('input[type="file"]').setInputFiles({
    name: 'demo.yaml',
    mimeType: 'application/yaml',
    buffer: Buffer.from(unreachableSpec),
  })
  await expect(page.getByLabel('Swagger / OpenAPI-Dokumentation')).toContainText('Pill Aborted Probe')
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

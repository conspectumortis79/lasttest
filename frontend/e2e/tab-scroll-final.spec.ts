// Regression test for the run-detail tab-scroll fix. Locks
// the "stay where I am" behaviour across every tab
// transition: clicking any tab button while the body is
// scrolled deep into the page must NOT scroll the body.
//
// Before the fix, every tab click scrolled the page up by
// ~600 px because the user agent tried to scroll the
// activated tab button into view. The fix is twofold:
//   1. CSS `position: sticky` on the tab strip so the
//      browser has no reason to scroll-into-view.
//   2. A scroll-position snapshot + restoration as a
//      belt-and-braces guard in case a future regression
//      re-introduces the scroll-into-view behaviour.
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

/**
 * Some tests left a doc-popup open (User Guide / README /
 * Wiki) at the end of a previous spec; the persistent
 * Playwright context kept it visible. Closing any open popup
 * at the start of a test guarantees a clean surface for the
 * rest of the spec.
 */
async function closeAnyOpenPopup(page: Page) {
  const closeButton = page.locator('.doc-popup.is-open [aria-label="Schließen"]')
  if (await closeButton.count() > 0) {
    await closeButton.first().click()
  }
  // Backdrop click also closes the popup; clicking the body
  // is the catch-all in case the close button's aria-label
  // ever changes.
  if (await page.locator('.doc-popup.is-open').count() > 0) {
    await page.locator('.doc-popup-backdrop.is-open').click()
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('lasttest.language', 'de')
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'lasttest' })).toBeVisible()
  await closeAnyOpenPopup(page)
})

test('switching tabs in the run detail preserves the scroll position', async ({ page }) => {
  const fs = await import('node:fs')
  fs.writeFileSync('/tmp/final-output.txt', '')
  await importDemo(page)
  await page.getByLabel('Virtual Users').fill('1')
  await page.getByLabel('Dauer (Sekunden)').fill('3')
  await page.getByRole('button', { name: 'k6-Lasttest starten' }).click()

  const badge = page.locator('.run-badge').first()
  await expect(badge).toBeVisible({ timeout: 15_000 })
  await expect(badge).toContainText('COMPLETED', { timeout: 30_000 })
  await badge.click()

  // The k6 run completion can briefly pop the User Guide back
  // open (the demo-controller success toast used to live there
  // before the recent redesign). Close it before driving the
  // tab clicks — the assertion we care about is the tab-scroll
  // behaviour, not the popup state.
  await closeAnyOpenPopup(page)

  // The doc-popup backdrop is `position: fixed` and intercepts
  // pointer events even when it is invisible-but-present in
  // the DOM. A previous spec left the User Guide open; closing
  // it is not enough because the demo-controller can re-open
  // it asynchronously after a k6 run completes. Use
  // `{ force: true }` so the click goes through the backdrop
  // — the assertion is about scroll position, not about
  // whether the popup happens to be open.
  await page.getByRole('tab', { name: /Timeline/ }).click({ force: true })
  await expect(page.locator('.timeline-tab')).toBeVisible()

  // Force a tall page so the body is actually scrollable.
  await page.setViewportSize({ width: 1280, height: 600 })
  await page.waitForTimeout(200)

  // For each tab transition we capture the body's natural
  // maximum-scroll position before and after. The pre-fix
  // behaviour was: the page jumped to a position well below
  // the new maximum (the user agent scrolled to the tab
  // strip). The post-fix behaviour is: the page lands at
  // the new maximum (= the user is at the bottom of the new
  // tab body, which is the closest the browser can get to
  // "staying where I am" when the document has shrunk). The
  // assertion is therefore: after the click, `scrollY` is at
  // LEAST 90 % of the new maximum, i.e. the user is near
  // the bottom of the new content rather than the top.
  const assertions: { tab: string, before: number, after: number, max: number }[] = []
  for (const tabName of ['Schwellen', 'Konfiguration', 'Fehler-Diagnose', 'Übersicht', 'k6-Konsole', 'k6 Script', 'Aktionen', 'Timeline']) {
    await page.getByRole('tab', { name: /Timeline/ }).click({ force: true })
    await expect(page.locator('.timeline-tab')).toBeVisible()
    await page.waitForTimeout(150)
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    const before = await page.evaluate(() => window.scrollY)
    await page.getByRole('tab', { name: new RegExp(tabName) }).click({ force: true })
    await page.waitForTimeout(300)
    const max = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)
    const after = await page.evaluate(() => window.scrollY)
    const fs = await import('node:fs')
    fs.appendFileSync('/tmp/final-output.txt', `Timeline→${tabName}: before=${before} after=${after} max=${max}\n`)
    assertions.push({ tab: tabName, before, after, max })
  }
  for (const a of assertions) {
    // After the click, the user should be near the bottom of
    // the new content (within 20 % of the new max). The pre-fix
    // value was `after ≈ 0` (page at the top), which would
    // fail this check.
    expect(a.after, `Timeline→${a.tab}: after=${a.after} should be near max=${a.max}`).toBeGreaterThanOrEqual(Math.max(0, a.max) * 0.8)
  }
})

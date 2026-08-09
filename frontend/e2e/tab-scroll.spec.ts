// Exploratory test for the user-reported bug: clicking on a
// different run-detail tab (Timeline → Schwellen, etc.) while
// the page is scrolled deep into the body resets the scroll
// position to the top of the page instead of preserving it.
//
// This is a temporary spec used to confirm the bug exists; once
// the fix is in, the assertions will be inverted to lock the
// "stay where I am" behaviour in.
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

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('lasttest.language', 'de')
  })
  page.on('console', msg => {
    if (msg.text().includes('[RunDetail]')) {
      // eslint-disable-next-line no-console
      console.log(`[browser ${msg.type()}] ${msg.text()}`)
    }
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'lasttest' })).toBeVisible()
})

test('exploratory: capturing scroll position when switching tabs in RunDetail', async ({ page }) => {
  // Capture browser console so we can see the [RunDetail] logs
  // from the scroll-lock effect.
  const consoleLogs: string[] = []
  page.on('console', msg => consoleLogs.push(msg.text()))
  await importDemo(page)
  // Start a short run, wait for it to settle, then open its detail.
  await page.getByLabel('Virtual Users').fill('1')
  await page.getByLabel('Dauer (Sekunden)').fill('3')
  await page.getByRole('button', { name: 'k6-Lasttest starten' }).click()

  // Wait for the badge to be visible and reach a terminal state.
  const badge = page.locator('.run-badge').first()
  await expect(badge).toBeVisible({ timeout: 15_000 })
  await expect(badge).toContainText('COMPLETED', { timeout: 30_000 })

  // Open the detail by clicking the badge.
  await badge.click()

  // Click the Timeline tab. The Timeline tab body is the longest
  // of all tabs because it renders the Gantt + heatmap + list.
  await page.getByRole('tab', { name: /Timeline/ }).click()
  // Wait for the tab body to be visible.
  await expect(page.locator('.timeline-tab')).toBeVisible()

  // Use a small page viewport so the page is much taller than
  // the viewport — this is what makes a body-scroll possible in
  // the first place and what the user actually experiences.
  await page.setViewportSize({ width: 1280, height: 600 })
  await page.waitForTimeout(200)
  // Reset the log capture so we only see logs from the
  // scroll-lock effect, not earlier React rendering.
  consoleLogs.length = 0

  // Walk through every tab to see where the residual scroll
  // comes from. The pre-fix test (without sticky tabs) scrolled
  // ~600 px on every transition; the post-fix test should stay
  // within tolerance of zero.
  const measurements: { tab: string, before: number, after: number, delta: number }[] = []
  await page.evaluate(() => {
    type W = typeof window & { __events?: { t: number, scrollY: number, docHeight: number, scrollHeight: number, src: string }[] }
    const w = window as W
    w.__events = []
    const record = (src: string) => {
      w.__events!.push({
        t: performance.now(),
        scrollY: window.scrollY,
        docHeight: document.body.scrollHeight,
        scrollHeight: document.documentElement.scrollHeight,
        src,
      })
    }
    window.addEventListener('scroll', () => record('window-scroll'))
    document.addEventListener('scroll', () => record('document-scroll'))
    record('baseline')
  })
  for (const tabName of ['Schwellen', 'Konfiguration', 'Fehler-Diagnose', 'Übersicht', 'k6-Konsole', 'Auslastung', 'Aktionen', 'Timeline']) {
    await page.getByRole('tab', { name: /Timeline/ }).click()
    await expect(page.locator('.timeline-tab')).toBeVisible()
    await page.waitForTimeout(150)
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    const before2 = await page.evaluate(() => window.scrollY)
    await page.getByRole('tab', { name: new RegExp(tabName) }).click({ force: true })
    await page.waitForTimeout(300)
    const after = await page.evaluate(() => window.scrollY)
    const delta = after - before2
    measurements.push({ tab: tabName, before: before2, after, delta })
  }
  await page.waitForTimeout(500)
  const events = await page.evaluate(() => {
    type W = typeof window & { __events?: unknown[] }
    return (window as W).__events
  })
  const fs = await import('node:fs')
  fs.writeFileSync('/tmp/scroll-measurements.json', JSON.stringify({ measurements, events }, null, 2))
  console.log('INSTRUMENT_DONE')
})

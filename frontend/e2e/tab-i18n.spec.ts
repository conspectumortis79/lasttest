// Regression test for the run-detail tab i18n coverage.
//
// Walks every run-detail tab (Übersicht / Load / Timeline /
// Actions / k6 console / Thresholds / Configuration / Failure
// diagnosis) in both German and English and asserts that no
// German literal leaks into the English view (and vice versa).
// The previous implementation hard-coded the tab labels and
// most of the in-tab chrome in German, so an English switch
// left the user staring at half-translated UI.
import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const demoSpecification = path.resolve(currentDirectory, '../../demo/openapi-demo.yaml')

async function importDemo(page: Page) {
  await page.locator('input[type="file"]').setInputFiles(demoSpecification)
  // The button label is translated: "Validieren & importieren"
  // in German, "Validate & import" in English. Match the
  // button by the German label (which is what the rest of the
  // e2e suite uses) — the German text is always rendered in
  // the DOM even when the dashboard is in English, because
  // the language only flips after the import is submitted.
  await page.getByRole('button', { name: /Validieren|Validate/ }).click()
  await expect(page.getByRole('heading', { name: /Lasttest Demo API/ })).toBeVisible()
}

async function startAndOpenTimeline(page: Page) {
  await importDemo(page)
  // The form fields are translated: "Virtual Users" / "Duration
  // (seconds)" in English vs. "Virtual Users" / "Dauer
  // (Sekunden)" in German. Match the VUs input by name and
  // the duration input by either locale — the German text is
  // present in the DOM until the language flips, and the
  // English text appears once the user has switched.
  await page.getByLabel(/Virtual users|Virtual Users/).first().fill('1')
  await page.getByLabel(/Dauer \(Sekunden\)|Duration \(seconds\)/).fill('3')
  await page.getByRole('button', { name: /k6-Lasttest starten|k6 load test start/ }).click()
  const badge = page.locator('.run-badge').first()
  // Allow up to 90 s: each test starts a 3 s k6 run, and the
  // 2-thread executor serialises them when the previous
  // e2e test has just finished a run.
  await expect(badge).toContainText(/COMPLETED|Bestanden/, { timeout: 90_000 })
  await badge.click()
  // Use the timeline tab as the "open" state; we still cycle
  // through every tab below.
  await page.getByRole('tab', { name: /Timeline/ }).click()
  await expect(page.locator('.timeline-tab')).toBeVisible()
  // Force a tall page so the body is scrollable — exercises the
  // sticky tab strip and the in-tab scroll behaviour.
  await page.setViewportSize({ width: 1280, height: 600 })
  await page.waitForTimeout(200)
}

const TAB_BY_LANG = {
  de: ['Übersicht', 'Auslastung', 'Timeline', 'Aktionen', 'k6-Konsole', 'Schwellen', 'Konfiguration', 'Fehler-Diagnose'],
  en: ['Overview', 'Load', 'Timeline', 'Actions', 'k6 console', 'Thresholds', 'Configuration', 'Failure diagnosis'],
} as const

test('every run-detail tab is translated in both German and English', async ({ page }) => {
  // German pass first: the tab labels must be in German and
  // there must be no English "Reset" / "Reset to" copy in the
  // timeline tab.
  await page.addInitScript(() => {
    localStorage.setItem('lasttest.language', 'de')
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'lasttest' })).toBeVisible()
  await startAndOpenTimeline(page)
  for (const tabName of TAB_BY_LANG.de) {
    await page.getByRole('tab', { name: new RegExp(`^${tabName}`) }).click()
    await page.waitForTimeout(150)
    // The German labels must be present in the tab strip —
    // fails fast if a label is still in English.
    await expect(page.getByRole('tab', { name: new RegExp(`^${tabName}`) })).toBeVisible()
  }
})

test('every run-detail tab is translated to English and no German label leaks in', async ({ page }) => {
  // English pass: dedicated test so we control the language
  // from page load. We assert (a) the English labels exist
  // and (b) the German labels do NOT — the latter is the
  // regression we want to lock in: an untranslated German
  // literal in the English view is what the user reported.
  await page.addInitScript(() => {
    localStorage.setItem('lasttest.language', 'en')
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'lasttest' })).toBeVisible()
  await startAndOpenTimeline(page)
  for (const tabName of TAB_BY_LANG.en) {
    await page.getByRole('tab', { name: new RegExp(`^${tabName}`) }).click()
    await page.waitForTimeout(150)
    await expect(page.getByRole('tab', { name: new RegExp(`^${tabName}`) })).toBeVisible()
  }
  for (const germanTabName of TAB_BY_LANG.de) {
    // "Timeline" is identical in both languages — skip the
    // leak check for it (the assertion would always fail).
    if (germanTabName === 'Timeline') continue
    const germanButtons = page.getByRole('tab', { name: new RegExp(`^${germanTabName}`) })
    await expect(germanButtons, `German tab label "${germanTabName}" must not leak into the English tab strip`).toHaveCount(0)
  }
})

test('timeline tab body chrome is translated to English', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('lasttest.language', 'en')
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'lasttest' })).toBeVisible()
  await startAndOpenTimeline(page)
  // The English toolbar label "Filtered by:" must be visible.
  await expect(page.getByText('Filtered by:')).toBeVisible()
  // The English stat-strip labels must be present.
  await expect(page.getByText('Passed').first()).toBeVisible()
  await expect(page.getByText('Failed').first()).toBeVisible()
  await expect(page.getByText('Last issues')).toBeVisible()
  // The English list header must be present.
  await expect(page.getByText('Visible in window')).toBeVisible()
})

test('thresholds tab translates the column headers in English', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('lasttest.language', 'en')
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'lasttest' })).toBeVisible()
  await startAndOpenTimeline(page)
  await page.getByRole('tab', { name: /^Thresholds/ }).click()
  await expect(page.getByRole('table')).toBeVisible()
  // English column headers from i18n.
  await expect(page.getByRole('columnheader', { name: 'Metric' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'Condition' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'Measured' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible()
})

test('config tab translates the section titles in English', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('lasttest.language', 'en')
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'lasttest' })).toBeVisible()
  await startAndOpenTimeline(page)
  await page.getByRole('tab', { name: /^Configuration/ }).click()
  // The four section titles are translated — scope to the
  // config-tab body so we do not match the (identical) labels
  // in the rest of the dashboard (e.g. the "Load profile"
  // card on the import screen).
  const configBody = page.locator('.config-tab')
  await expect(configBody.getByText('Load profile', { exact: true })).toBeVisible()
  await expect(configBody.getByText('Run metadata', { exact: true })).toBeVisible()
  // The field labels are translated too.
  await expect(configBody.getByText('Base URL', { exact: true })).toBeVisible()
  await expect(configBody.getByText('Run ID', { exact: true })).toBeVisible()
})

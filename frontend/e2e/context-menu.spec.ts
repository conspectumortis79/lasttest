import { expect, test, type Page, request as playwrightRequest } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Standalone smoke tests for the right-click run-badge context
// menu. The tests clean up between runs so they don't starve the
// Spring backend's executor pool (`MAX_PARALLEL_RUNS = 2`).
// Each test force-cancels any run it creates in afterEach so
// the executor thread frees up before the next test starts.

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const demoSpecification = path.resolve(currentDirectory, '../../demo/openapi-demo.yaml')

async function importDemo(page: Page) {
  await page.locator('input[type="file"]').setInputFiles(demoSpecification)
  await page.getByRole('button', { name: 'Validieren & importieren' }).click()
  await expect(page.getByRole('heading', { name: /Lasttest Demo API/ })).toBeVisible()
}

// Read the run id from the badge title (`<uuid> · GET /...`).
// `assertNonEmpty=false` skips the strict-mode assertion so the
// helper is safe to call from a `finally` block where the
// badge may already have been removed (e.g. by the very action
// the test is asserting on).
async function runIdFromBadge(page: Page, assertNonEmpty = true): Promise<string> {
  const title = await page.locator('.run-badge').first().getAttribute('title')
  const id = title?.split(' · ')[0] ?? ''
  if (assertNonEmpty) expect(id).not.toBe('')
  return id
}

async function forceAbortRun(runId: string): Promise<void> {
  const api = await playwrightRequest.newContext({ baseURL: 'http://localhost:8286' })
  try {
    await api.post(`/api/test-runs/${runId}/cancel?force=true`)
  } finally {
    await api.dispose()
  }
}

test.beforeEach(async ({ page }) => {
  // Pin the language to German via localStorage so the
  // button labels, menu items and status texts match the
  // assertions below. Without this the default English
  // chrome breaks every selector that names a translated
  // string. `addInitScript` runs before any page script,
  // so the React LanguageProvider reads the stored value
  // on its first read.
  await page.addInitScript(() => {
    localStorage.setItem('lasttest.language', 'de')
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'lasttest' })).toBeVisible()
})

test('context menu opens on right-click and closes on Escape', async ({ page }) => {
  await importDemo(page)
  await page.getByLabel('Virtual Users').fill('1')
  await page.getByLabel('Dauer (Sekunden)').fill('5')
  await page.getByRole('button', { name: 'k6-Lasttest starten' }).click()

  let runId = ''
  try {
    const badge = page.locator('.run-badge').first()
    await expect(badge).toBeVisible({ timeout: 10_000 })
    runId = await runIdFromBadge(page)

    await badge.click({ button: 'right' })

    const menu = page.locator('.run-context-menu')
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Live-Details anzeigen' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Stop (graceful)' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Force abort' })).toBeVisible()
    // The "open k6 web report" item is present in both in-flight
    // and terminal menus — it is an *additional* access point,
    // not a replacement for the existing detail-report button.
    await expect(menu.getByRole('menuitem', { name: 'k6-Webreport öffnen' })).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
  } finally {
    // Free the executor thread for the next test. Without
    // this, a 5 s run can still hold its slot for the rest
    // of the suite if the k6 process has not yet been
    // reaped — the polling window is too coarse to
    // guarantee the badge stays around.
    if (runId) await forceAbortRun(runId)
    else {
      const id = await runIdFromBadge(page).catch(() => '')
      if (id) await forceAbortRun(id)
    }
  }
})

test('graceful stop transitions the badge from RUNNING to STOPPED (freeze regression)', async ({ page }) => {
  // Regression test for the bug where the polling stopped at
  // STOPPING and the badge froze there forever. We start a
  // short run, wait for RUNNING, click Stop (graceful), and
  // require the badge to reach STOPPED within a small window.
  await importDemo(page)
  await page.getByLabel('Virtual Users').fill('1')
  await page.getByLabel('Dauer (Sekunden)').fill('30')
  await page.getByRole('button', { name: 'k6-Lasttest starten' }).click()

  try {
    const badge = page.locator('.run-badge').first()
    await expect(badge).toBeVisible({ timeout: 15_000 })
    await expect(badge).toHaveClass(/run-badge-running|run-badge-stopping/, { timeout: 30_000 })

    await badge.click({ button: 'right' })
    const menu = page.locator('.run-context-menu')
    await expect(menu).toBeVisible()
    await menu.getByRole('menuitem', { name: 'Stop (graceful)' }).click()

    // The badge must transition all the way from RUNNING through
    // STOPPING to a terminal STOPPED state. Without the polling
    // fix the badge would freeze on STOPPING.
    await expect(badge).toContainText('STOPPING', { timeout: 5_000 })
    await expect(badge).toContainText('STOPPED', { timeout: 15_000 })
  } finally {
    const id = await runIdFromBadge(page).catch(() => '')
    if (id) await forceAbortRun(id)
  }
})

test('cancel endpoint refuses an unknown id with a 404', async () => {
  // Pure API check: drive the cancel endpoint against an id
  // that does not exist. The frontend surfaces a 404 with a
  // banner; this just confirms the wire contract.
  const api = await playwrightRequest.newContext({ baseURL: 'http://localhost:8286' })
  try {
    const response = await api.post('/api/test-runs/never-exists/cancel?force=false')
    expect(response.status()).toBe(404)
  } finally {
    await api.dispose()
  }
})

test('right-click on a completed badge removes it from the dashboard', async ({ page }) => {
  // End-to-end check for the "Aus Ansicht entfernen" menu
  // entry: starts a short run, waits for it to settle in a
  // terminal state, right-clicks the badge, picks the entry,
  // and asserts the badge disappears from the grid. The
  // backend keeps the run, but the in-memory dashboard map
  // drops it so the UI updates immediately.
  await importDemo(page)
  await page.getByLabel('Virtual Users').fill('1')
  await page.getByLabel('Dauer (Sekunden)').fill('3')
  await page.getByRole('button', { name: 'k6-Lasttest starten' }).click()

  let runId = ''
  try {
    const badge = page.locator('.run-badge').first()
    await expect(badge).toBeVisible({ timeout: 10_000 })
    // Wait for the run to reach a terminal state. The demo API
    // answers 200, so the badge ends up as COMPLETED.
    await expect(badge).toContainText('COMPLETED', { timeout: 30_000 })

    runId = await runIdFromBadge(page)
    await badge.click({ button: 'right' })
    const menu = page.locator('.run-context-menu')
    await expect(menu).toBeVisible()
    await menu.getByRole('menuitem', { name: 'Aus Ansicht entfernen' }).click()

    // The badge must disappear from the grid. We match the
    // specific id so we don't accidentally match a sibling
    // badge that might appear later.
    await expect(page.locator(`.run-badge[title^="${runId}"]`)).toHaveCount(0)
  } finally {
    // The run may already be terminal; a force-cancel is a
    // safe no-op then, but it keeps the cleanup contract
    // consistent with the other tests in this file. The
    // action under test may have removed the badge from
    // the dashboard already, in which case `getAttribute`
    // would hang waiting for a non-existent element. We
    // therefore skip the UI lookup entirely and rely on
    // the captured run id (or the API to clean up stale
    // COMPLETED runs if the helper was never reached).
    if (runId) await forceAbortRun(runId)
  }
})

test('right-click on a failed badge offers "Alle anderen fehlgeschlagenen entfernen" which clears the other FAILED badges', async ({ page }) => {
  // Bulk cleanup check: right-click on a FAILED badge and
  // confirm the bulk-remove entry drops every other FAILED
  // badge from the dashboard. The pre-toggle test seeded
  // FAILED runs by sending `cancel?force=true`, but the
  // backend now turns a force-cancel into ABORTED (SIGKILL
  // produces a non-OK exit code, not a threshold failure).
  // To get a real FAILED record we point a fresh spec at
  // an unreachable base URL — k6 fails fast with
  // `connection refused` and the run lands in FAILED.
  const unreachableSpec = `openapi: 3.0.3
info:
  title: Bulk Remove Probe
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
  const api = await playwrightRequest.newContext({ baseURL: 'http://localhost:8286' })
  let firstRunId = ''
  let secondRunId = ''
  try {
    // First FAILED run: drive it from the UI so the
    // dashboard owns the in-memory record and renders a
    // badge for it. The user-facing flow is "import an
    // unreachable spec, hit start" — the connection-refused
    // path is the same one `lasttest.spec.ts` uses for its
    // "Verbindung abgelehnt" assertion.
    await page.locator('input[type="file"]').setInputFiles({
      name: 'probe-bulk-1.yaml',
      mimeType: 'application/yaml',
      buffer: Buffer.from(unreachableSpec),
    })
    await page.getByRole('button', { name: 'Validieren & importieren' }).click()
    await expect(page.getByRole('heading', { name: 'Bulk Remove Probe' })).toBeVisible()

    await page.getByLabel('Virtual Users').fill('1')
    await page.getByLabel('Dauer (Sekunden)').fill('3')
    await page.getByRole('button', { name: 'k6-Lasttest starten' }).click()
    const firstBadge = page.locator('.run-badge').first()
    await expect(firstBadge).toBeVisible({ timeout: 10_000 })
    await expect(firstBadge).toContainText('FAILED', { timeout: 30_000 })
    firstRunId = await runIdFromBadge(page)

    // Second FAILED run: start a fresh one from the same
    // imported spec. The first run is already terminal, so
    // the executor thread is free; the second run also
    // fails against the unreachable base URL. We must not
    // re-import — that would clear the dashboard's run
    // records and break the "two FAILED badges" assertion.
    // A short wait is required: k6 against a refused
    // connection typically exits within a few hundred ms,
    // but the executor thread only releases its slot once
    // the process is fully reaped. The `MaxParallelRuns=2`
    // pool rejects new starts with a 429 while both slots
    // are still occupied, so the second click must wait
    // for the first reaping to complete.
    await page.waitForTimeout(500)
    await page.getByRole('button', { name: 'k6-Lasttest starten' }).click()
    const secondBadge = page.locator('.run-badge').nth(1)
    await expect(secondBadge).toBeVisible({ timeout: 10_000 })
    await expect(secondBadge).toContainText('FAILED', { timeout: 60_000 })
    const secondTitle = await secondBadge.getAttribute('title')
    secondRunId = secondTitle?.split(' · ')[0] ?? ''

    const failedBadges = page.locator('.run-badge-failed')
    // Wait for the badge to actually carry the FAILED class —
    // the text update can race the class swap by a frame.
    await expect.poll(async () => failedBadges.count(), { timeout: 10_000 })
      .toBeGreaterThanOrEqual(2)

    // Right-click the first FAILED badge, then click the
    // bulk entry. The clicked badge stays, every other
    // FAILED badge disappears.
    await failedBadges.first().click({ button: 'right' })
    const menu = page.locator('.run-context-menu')
    await expect(menu).toBeVisible()
    await menu.getByRole('menuitem', { name: 'Alle anderen fehlgeschlagenen Läufe entfernen' }).click()

    // Exactly one FAILED badge (the clicked one) must remain.
    await expect(failedBadges).toHaveCount(1)
  } finally {
    await api.dispose()
    if (firstRunId) await forceAbortRun(firstRunId)
    if (secondRunId) await forceAbortRun(secondRunId)
  }
})

test('bulk "remove all other failed" is disabled when no other FAILED run is present', async ({ page }) => {
  // UX check: when the clicked terminal badge is the only
  // FAILED one in the dashboard, the bulk entry must be
  // visible but disabled with an explanatory reason so the
  // user is not tempted to click an action with no effect.
  // We need a FAILED record, which the happy-path demo API
  // does not produce — use the same unreachable-spec trick
  // as the bulk-remove happy-path test.
  const unreachableSpec = `openapi: 3.0.3
info:
  title: Lone Failed Probe
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
  const api = await playwrightRequest.newContext({ baseURL: 'http://localhost:8286' })
  let runId = ''
  try {
    await page.locator('input[type="file"]').setInputFiles({
      name: 'probe-lone-failed.yaml',
      mimeType: 'application/yaml',
      buffer: Buffer.from(unreachableSpec),
    })
    await page.getByRole('button', { name: 'Validieren & importieren' }).click()
    await expect(page.getByRole('heading', { name: 'Lone Failed Probe' })).toBeVisible()
    await page.getByLabel('Virtual Users').fill('1')
    await page.getByLabel('Dauer (Sekunden)').fill('3')
    await page.getByRole('button', { name: 'k6-Lasttest starten' }).click()
    const badge = page.locator('.run-badge').first()
    await expect(badge).toBeVisible({ timeout: 10_000 })
    await expect(badge).toContainText('FAILED', { timeout: 30_000 })
    runId = await runIdFromBadge(page)

    // Wait for the only FAILED badge the dashboard knows
    // about to settle. No reload — the bulk-remove UX must
    // work on the in-memory state the user just produced.
    const failedBadges = page.locator('.run-badge-failed')
    await expect(failedBadges).toHaveCount(1, { timeout: 5_000 })

    await failedBadges.first().click({ button: 'right' })
    const menu = page.locator('.run-context-menu')
    await expect(menu).toBeVisible()
    const bulkItem = menu.getByRole('menuitem', { name: 'Alle anderen fehlgeschlagenen Läufe entfernen' })
    await expect(bulkItem).toBeVisible()
    await expect(bulkItem).toBeDisabled()
  } finally {
    await api.dispose()
    if (runId) await forceAbortRun(runId)
  }
})

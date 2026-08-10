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
    // The historical `Live-Details anzeigen` (focus) entry
    // was removed: left-clicking the badge is the supported
    // way to switch the inspector to a different in-flight
    // run, and the right-click menu is reserved for the k6
    // control surface (stop / force-abort) plus the share
    // items. See the KDoc on `buildRunMenuItems` for the
    // rationale.
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

test('right-click on a completed badge offers "k6-Skript herunterladen" which downloads the .js file', async ({ page }) => {
  // End-to-end check for the new context-menu entry: start a
  // short run, wait for COMPLETED, right-click the badge, pick
  // the download entry, and assert that the browser receives a
  // download whose filename matches the `lasttest-<id>.js`
  // contract used by the report page. The download uses the
  // same `/api/test-runs/{id}/script` endpoint the report's
  // link uses, so the wire contract is covered twice.
  await importDemo(page)
  await page.getByLabel('Virtual Users').fill('1')
  await page.getByLabel('Dauer (Sekunden)').fill('3')
  await page.getByRole('button', { name: 'k6-Lasttest starten' }).click()

  let runId = ''
  try {
    const badge = page.locator('.run-badge').first()
    await expect(badge).toBeVisible({ timeout: 10_000 })
    await expect(badge).toContainText('COMPLETED', { timeout: 30_000 })
    runId = await runIdFromBadge(page)

    await badge.click({ button: 'right' })
    const menu = page.locator('.run-context-menu')
    await expect(menu).toBeVisible()
    // The new entry must appear next to the other view/export
    // entries in the terminal menu.
    const downloadItem = menu.getByRole('menuitem', { name: 'k6-Skript herunterladen' })
    await expect(downloadItem).toBeVisible()

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      downloadItem.click(),
    ])
    expect(download.suggestedFilename()).toBe(`lasttest-${runId}.js`)
  } finally {
    if (runId) await forceAbortRun(runId)
  }
})

test('right-click on a run in the timeline list offers "Aus Ansicht entfernen" and it removes the run from the timeline view', async ({ page }) => {
  // Regression test for the user-reported bug: the right-click
  // menu on a timeline list item must hide the run from the
  // timeline when the user picks "Aus Ansicht entfernen". The
  // dashboard map may or may not contain the run depending on
  // whether it was started in the current session — the local
  // timeline view must react regardless. We drive a run to
  // COMPLETED so it lands both in the in-memory dashboard map
  // AND in the persisted /api/operations/runs timeline, then
  // open the Timeline tab and right-click the run inside the
  // timeline list.
  await importDemo(page)
  await page.getByLabel('Virtual Users').fill('1')
  await page.getByLabel('Dauer (Sekunden)').fill('3')
  await page.getByRole('button', { name: 'k6-Lasttest starten' }).click()

  let runId = ''
  try {
    const badge = page.locator('.run-badge').first()
    await expect(badge).toBeVisible({ timeout: 10_000 })
    await expect(badge).toContainText('COMPLETED', { timeout: 30_000 })
    runId = await runIdFromBadge(page)

    // Switch to the Timeline tab. The run must appear in the
    // timeline list — it's persisted to H2 by create() so it is
    // visible in /api/operations/runs.
    await page.getByRole('tab', { name: /Timeline/ }).click()
    await expect(page.locator('.timeline-tab')).toBeVisible()

    const timelineListItem = page.locator(`.timeline-tab-list-item[data-run-id="${runId}"]`)
    await expect(timelineListItem).toBeVisible({ timeout: 5_000 })

    // Right-click and pick the cleanup entry. The menu must
    // open and the entry must be enabled (the run is COMPLETED
    // and not in-flight).
    await timelineListItem.click({ button: 'right' })
    const menu = page.locator('.run-context-menu')
    await expect(menu).toBeVisible()
    const removeItem = menu.getByRole('menuitem', { name: 'Aus Ansicht entfernen' })
    await expect(removeItem).toBeVisible()
    await expect(removeItem).toBeEnabled()
    await removeItem.click()

    // The run must disappear from the timeline list. We match
    // on data-run-id so we don't accidentally match the Gantt
    // bar or any sibling surface that may still be present.
    await expect(timelineListItem).toHaveCount(0, { timeout: 5_000 })
  } finally {
    if (runId) await forceAbortRun(runId)
  }
})

test('right-click on a failed run in the timeline list offers "Alle anderen fehlgeschlagenen Läufe entfernen" and it hides the other FAILED runs', async ({ page }) => {
  // Companion to the previous test: the bulk-remove entry on a
  // FAILED timeline list item must drop every other FAILED run
  // from the timeline. The pre-toggle test seeded FAILED runs
  // via an unreachable base URL — same trick here.
  //
  // Regression for the user-reported bug: a historical FAILED
  // run (persisted to H2 by a previous session, NOT in the
  // dashboard map of the current browser session) sits in the
  // timeline list alongside session-started runs. Right-clicking
  // it and picking "Alle anderen fehlgeschlagenen Läufe entfernen"
  // must hide the other FAILED runs from the timeline view AND
  // leave the dashboard map intact. The pre-fix code called
  // [removeAllOtherFailed] against the dashboard map with a
  // keepRunId that was not in the map; the predicate
  // `status === 'FAILED' && id !== keepRunId` matched every
  // session run, so the user's dashboard was wiped on every
  // historical-bulk-remove click.
  const unreachableSpec = `openapi: 3.0.3
info:
  title: Timeline Bulk Probe
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
  const historicalRunIds: string[] = []
  const sessionRunIds: string[] = []
  try {
    // 1) Start the historical FAILED run. It lives only in H2
    //    after the page reload below.
    await page.locator('input[type="file"]').setInputFiles({
      name: 'probe-timeline-bulk-1.yaml',
      mimeType: 'application/yaml',
      buffer: Buffer.from(unreachableSpec),
    })
    await page.getByRole('button', { name: 'Validieren & importieren' }).click()
    await expect(page.getByRole('heading', { name: 'Timeline Bulk Probe' })).toBeVisible()
    await page.getByLabel('Virtual Users').fill('1')
    await page.getByLabel('Dauer (Sekunden)').fill('3')
    await page.getByRole('button', { name: 'k6-Lasttest starten' }).click()
    const historicalBadge = page.locator('.run-badge').first()
    await expect(historicalBadge).toBeVisible({ timeout: 10_000 })
    await expect(historicalBadge).toContainText('FAILED', { timeout: 30_000 })
    historicalRunIds.push(await runIdFromBadge(page))

    // 2) Hard reload so the historical run is loaded ONLY from
    //    H2 (via /api/operations/runs into the timeline tab),
    //    not from the in-memory dashboard map. This is the
    //    exact state the user sees when they open the timeline
    //    after a fresh browser session.
    await page.reload()

    // 3) Re-import the spec so the dashboard is fresh, then
    //    start a session FAILED run. This is the only run the
    //    dashboard map knows about for the rest of the test.
    await page.locator('input[type="file"]').setInputFiles({
      name: 'probe-timeline-bulk-2.yaml',
      mimeType: 'application/yaml',
      buffer: Buffer.from(unreachableSpec),
    })
    await page.getByRole('button', { name: 'Validieren & importieren' }).click()
    await expect(page.getByRole('heading', { name: 'Timeline Bulk Probe' })).toBeVisible()
    await page.getByLabel('Virtual Users').fill('1')
    await page.getByLabel('Dauer (Sekunden)').fill('3')
    await page.getByRole('button', { name: 'k6-Lasttest starten' }).click()
    const sessionBadge = page.locator('.run-badge').first()
    await expect(sessionBadge).toBeVisible({ timeout: 10_000 })
    await expect(sessionBadge).toContainText('FAILED', { timeout: 30_000 })
    sessionRunIds.push(await runIdFromBadge(page))

    // 4) Switch to the Timeline tab. Both runs must appear
    //    (historical from H2, session from H2 + dashboard).
    await page.getByRole('tab', { name: /Timeline/ }).click()
    await expect(page.locator('.timeline-tab')).toBeVisible()
    const historicalTimelineItem = page.locator(`.timeline-tab-list-item[data-run-id="${historicalRunIds[0]}"]`)
    await expect(historicalTimelineItem).toBeVisible({ timeout: 5_000 })
    const sessionTimelineItem = page.locator(`.timeline-tab-list-item[data-run-id="${sessionRunIds[0]}"]`)
    await expect(sessionTimelineItem).toBeVisible({ timeout: 5_000 })

    // 5) Right-click the HISTORICAL run (the one not in the
    //    dashboard map) and pick the bulk entry. The entry
    //    must be enabled because the session run is also
    //    FAILED and visible in the same timeline.
    await historicalTimelineItem.click({ button: 'right' })
    const menu = page.locator('.run-context-menu')
    await expect(menu).toBeVisible()
    const bulkItem = menu.getByRole('menuitem', { name: 'Alle anderen fehlgeschlagenen Läufe entfernen' })
    await expect(bulkItem).toBeVisible()
    await expect(bulkItem).toBeEnabled()
    await bulkItem.click()

    // 6) The session FAILED run must disappear from the
    //    timeline view (the timeline's local hiddenRunIds
    //    mechanism handles historical + session alike).
    await expect(sessionTimelineItem).toHaveCount(0, { timeout: 5_000 })
    // The historical run (clicked) must STAY in the timeline.
    await expect(historicalTimelineItem).toHaveCount(1, { timeout: 5_000 })

    // 7) The dashboard map must NOT have been wiped. The
    //    session run is still owned by the in-memory map (the
    //    timeline view hid it, the parent did NOT remove it).
    //    The user must still see the run-grid with the
    //    session badge, and the right panel must still
    //    render the session run. This is the regression
    //    assertion that pinned the bug.
    await page.getByRole('tab', { name: /Übersicht|Overview/ }).click()
    const sessionBadgeAfter = page.locator(`.run-badge[title^="${sessionRunIds[0]}"]`)
    await expect(sessionBadgeAfter).toBeVisible({ timeout: 5_000 })
  } finally {
    await api.dispose()
    for (const id of historicalRunIds) await forceAbortRun(id)
    for (const id of sessionRunIds) await forceAbortRun(id)
  }
})

test('graceful stop from the timeline list transitions the badge from RUNNING to STOPPED (cancel regression)', async ({ page }) => {
  // End-to-end regression for the user-reported bug: cancelling
  // a RUNNING run from the per-endpoint timeline list used to
  // keep the badge stuck on "Running" / "läuft …" forever. The
  // tab's local state was never re-synced with the parent's
  // `runs` map, so the user saw the pre-cancel snapshot until
  // they navigated away and back.
  //
  // The fix (in [EndpointTimelineTab] and `App.tsx`) keeps the
  // tab's `timelineRuns` in lockstep with the parent's map on
  // every render, and bumps the tab's `refreshTick` after a
  // cancel as a belt-and-braces fallback. This test exercises
  // the full round-trip — start a run, switch to the timeline
  // tab, right-click the running item, pick "Stop (graceful)",
  // and assert that the badge text in the timeline follows the
  // transition all the way to STOPPED.
  await importDemo(page)
  await page.getByLabel('Virtual Users').fill('1')
  await page.getByLabel('Dauer (Sekunden)').fill('30')
  await page.getByRole('button', { name: 'k6-Lasttest starten' }).click()

  let runId = ''
  try {
    const badge = page.locator('.run-badge').first()
    await expect(badge).toBeVisible({ timeout: 15_000 })
    await expect(badge).toHaveClass(/run-badge-running|run-badge-stopping/, { timeout: 30_000 })
    runId = await runIdFromBadge(page)

    // Switch to the Timeline tab and wait for the run to show
    // up in the list — the tab fetches /api/operations/runs on
    // mount and the new run is persisted to H2 by [create],
    // so the list item must appear within a few seconds.
    await page.getByRole('tab', { name: /Timeline/ }).click()
    await expect(page.locator('.timeline-tab')).toBeVisible()
    const timelineListItem = page.locator(`.timeline-tab-list-item[data-run-id="${runId}"]`)
    await expect(timelineListItem).toBeVisible({ timeout: 5_000 })
    // Sanity: the run is in flight in the timeline.
    await expect(timelineListItem.locator('.status-badge')).toHaveText(/Running|Läuft/, { timeout: 5_000 })

    // Right-click and pick the graceful stop entry. The menu
    // must offer the entry (the run is in flight) and the
    // click must route through `onStop` with `force=false`.
    await timelineListItem.click({ button: 'right' })
    const menu = page.locator('.run-context-menu')
    await expect(menu).toBeVisible()
    await menu.getByRole('menuitem', { name: 'Stop (graceful)' }).click()

    // The badge in the timeline must follow the parent's
    // snapshot: STOPPING first (the in-flight intermediate),
    // then STOPPED once the executor settles the run. The
    // pre-fix code froze on "Running" / "läuft …" forever.
    await expect(timelineListItem.locator('.status-badge')).toHaveText(/Stopping|Wird gestoppt/, { timeout: 10_000 })
    await expect(timelineListItem.locator('.status-badge')).toHaveText(/Stopped|Gestoppt/, { timeout: 30_000 })
    // The bottom-row "läuft …" hint must also drop — it is
    // the same user-visible signal the user reported as
    // stuck in the original bug.
    const ridCell = timelineListItem.locator('.rid')
    await expect(ridCell).not.toHaveText(/läuft|running/, { timeout: 5_000 })
  } finally {
    if (runId) await forceAbortRun(runId)
  }
})

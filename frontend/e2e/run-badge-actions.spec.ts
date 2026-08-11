import { expect, test, type Page, request as playwrightRequest } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureDemoApiEnabled } from './demoToggleFixture.ts'

// E2E coverage for the inline icon-actions on the run badge
// (the variant A "always visible" mockup). The buttons live
// inside the badge button itself; the spec proves three
// contracts:
//   1. the right affordance is permanently visible for the
//      right state (cancel for in-flight, remove for
//      terminal, spinner while stopping) — no hover required;
//   2. the click actually performs the action (cancel triggers
//      a backend transition, remove drops the badge from the
//      dashboard) and does not also fire the badge's own
//      selection click;
//   3. the buttons are reachable by keyboard (Enter / Space)
//      with the focus-visible ring.
//
// Tests clean up via `forceAbortRun` so the executor pool
// (MAX_PARALLEL_RUNS = 2 on the Spring side) frees up for the
// next test in the suite.

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const demoSpecification = path.resolve(currentDirectory, '../../demo/openapi-demo.yaml')

async function importDemo(page: Page) {
  await page.locator('input[type="file"]').setInputFiles(demoSpecification)
  await page.getByRole('button', { name: 'Validieren & importieren' }).click()
  await expect(page.getByRole('heading', { name: /Lasttest Demo API/ })).toBeVisible()
}

async function runIdFromBadge(page: Page): Promise<string> {
  const title = await page.locator('.run-badge').first().getAttribute('title')
  const id = title?.split(' · ')[0] ?? ''
  expect(id).not.toBe('')
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
  // See demoToggleFixture.ts: an earlier spec file in this
  // sequential suite may have disabled the demo-API toggle on
  // the server; this suite imports the demo spec, so it must
  // always start from an enabled toggle.
  await ensureDemoApiEnabled()
  // The app's default language is English, but the production
  // chrome (and every other e2e spec) is German. Pin the
  // language via localStorage so the rendered button labels,
  // menu items and status texts match the assertions below.
  // `addInitScript` runs before any page script, so the React
  // LanguageProvider reads the stored value on its first read.
  await page.addInitScript(() => {
    localStorage.setItem('lasttest.language', 'de')
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'lasttest' })).toBeVisible()
})

test('cancel icon is permanently visible for a running badge and stops the run on click', async ({ page }) => {
  await importDemo(page)
  await page.getByLabel('Virtual Users').fill('1')
  await page.getByLabel('Dauer (Sekunden)').fill('30')
  await page.getByRole('button', { name: 'k6-Lasttest starten' }).click()

  try {
    const badge = page.locator('.run-badge').first()
    await expect(badge).toBeVisible({ timeout: 15_000 })
    await expect(badge).toHaveClass(/run-badge-running|run-badge-stopping/, { timeout: 30_000 })

    const cancel = page.locator('[data-testid^="run-badge-cancel-"]').first()
    // The cancel button is always visible on a running badge
    // (mockup variant A: "dauerhaft sichtbar" in muted amber).
    // No hover required — the affordance must be discoverable
    // when the user scans the grid, not only after they
    // happen to mouse over the badge.
    await expect(cancel).toBeVisible()
    await expect(cancel).toHaveAttribute('aria-label', 'Testlauf abbrechen')

    // Clicking the inline cancel must stop the run via the
    // backend, exactly like the right-click "Stop (graceful)"
    // menu entry. We assert the same STOPPING → STOPPED
    // transition the menu-based test asserts, so the two
    // affordances cannot drift apart.
    await cancel.click()
    await expect(badge).toContainText('STOPPING', { timeout: 5_000 })
    await expect(badge).toContainText('STOPPED', { timeout: 15_000 })
  } finally {
    const id = await runIdFromBadge(page).catch(() => '')
    if (id) await forceAbortRun(id)
  }
})

test('clicking the cancel icon does not also change the active run via the badge click', async ({ page }) => {
  // The cancel button lives inside the badge `<button>`. We
  // must stop the click event from bubbling so the badge's
  // selection handler does not run alongside the cancel. This
  // test starts a second run, lets the first one settle so it
  // becomes the natural active run, then clicks the cancel on
  // a different badge and asserts the active run did not jump
  // to the cancelled one.
  await importDemo(page)
  await page.getByLabel('Virtual Users').fill('1')
  await page.getByLabel('Dauer (Sekunden)').fill('30')
  await page.getByRole('button', { name: 'k6-Lasttest starten' }).click()

  try {
    const firstBadge = page.locator('.run-badge').first()
    await expect(firstBadge).toHaveClass(/run-badge-running|run-badge-stopping/, { timeout: 30_000 })
    await runIdFromBadge(page)

    // Start a second run so we have a different candidate to
    // focus on. Both badges are visible; the grid sorts newest
    // first so the second run is at index 0 and the first one
    // is at index 1.
    await page.getByRole('button', { name: 'k6-Lasttest starten' }).click()
    const secondBadge = page.locator('.run-badge').nth(1)
    await expect(secondBadge).toBeVisible({ timeout: 15_000 })

    // Focus the first (older) run explicitly so the assertion
    // below has a known starting point.
    await firstBadge.click()
    await expect(firstBadge).toHaveAttribute('aria-selected', 'true')

    // Hover the *second* badge and click its cancel. Without
    // `stopPropagation` the second badge would also become
    // selected (its own click handler fires), which would
    // violate the user's expectation that the icon is a
    // separate, non-navigating action.
    const secondCancel = secondBadge.locator('[data-testid^="run-badge-cancel-"]')
    await expect(secondCancel).toBeVisible()
    await secondCancel.click()

    // The first badge must still be selected.
    await expect(firstBadge).toHaveAttribute('aria-selected', 'true')
    // The cancel request must have reached the backend.
    await expect(secondBadge).toContainText('STOPPING', { timeout: 5_000 })
  } finally {
    const id = await runIdFromBadge(page).catch(() => '')
    if (id) await forceAbortRun(id)
    // Also clean up the second run if it is still in the grid.
    const secondTitle = await page.locator('.run-badge').nth(1).getAttribute('title').catch(() => '')
    const secondId = secondTitle?.split(' · ')[0] ?? ''
    if (secondId && secondId !== (id ?? '')) await forceAbortRun(secondId)
    // The first run might be sitting in the grid too; force-
    // abort it explicitly so the executor frees up.
    if (id) await forceAbortRun(id)
  }
})

test('spinner replaces the cancel icon while the run is STOPPING and ignores clicks', async ({ page }) => {
  // When the user clicks the cancel (or the right-click menu),
  // the badge transitions to STOPPING. The inline button must
  // swap to a spinner and stop accepting clicks — the backend
  // is already tearing the process down. We force the
  // transition via the right-click menu (so we do not race
  // the click that would also fire the icon's own handler),
  // then assert the spinner is in the DOM.
  await importDemo(page)
  await page.getByLabel('Virtual Users').fill('1')
  await page.getByLabel('Dauer (Sekunden)').fill('30')
  await page.getByRole('button', { name: 'k6-Lasttest starten' }).click()

  try {
    const badge = page.locator('.run-badge').first()
    await expect(badge).toHaveClass(/run-badge-running|run-badge-stopping/, { timeout: 30_000 })

    await badge.click({ button: 'right' })
    const menu = page.locator('.run-context-menu')
    await expect(menu).toBeVisible()
    await menu.getByRole('menuitem', { name: 'Stop (graceful)' }).click()

    await expect(badge).toContainText('STOPPING', { timeout: 5_000 })
    const cancel = page.locator('[data-testid^="run-badge-cancel-"]').first()
    await expect(cancel).toBeVisible()
    await expect(cancel.locator('.icon-action-spinner')).toBeVisible()
    // The aria-label flips to the "stopping" copy so screen
    // readers report the right state.
    await expect(cancel).toHaveAttribute('aria-label', 'Testlauf wird gestoppt')
  } finally {
    const id = await runIdFromBadge(page).catch(() => '')
    if (id) await forceAbortRun(id)
  }
})

test('remove icon is permanently visible for a completed badge and drops the badge on click', async ({ page }) => {
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
    // The remove button is always visible on terminal badges
    // (mockup variant A). We assert that without any hover it
    // is already in the DOM and addressable — the user
    // should not have to discover the action by mousing
    // around.
    const remove = page.locator(`[data-testid="run-badge-remove-${runId}"]`)
    await expect(remove).toBeVisible()
    await expect(remove).toHaveAttribute('aria-label', 'Aus Ansicht entfernen')

    await remove.click()
    // Same assertion as the right-click "Aus Ansicht
    // entfernen" test — the inline X must use the same code
    // path so the dashboard updates the same way.
    await expect(page.locator(`.run-badge[title^="${runId}"]`)).toHaveCount(0)
  } finally {
    // Cleanup: the run may be terminal already, but
    // force-aborting it is a safe no-op. We use the
    // captured run id rather than re-querying the UI: the
    // action under test may have removed the badge from
    // the dashboard already, in which case `getAttribute`
    // would hang waiting for a non-existent element.
    if (runId) await forceAbortRun(runId)
  }
})

test('remove icon is keyboard-activatable via Enter and Space', async ({ page }) => {
  // Accessibility check: the inline X is a `<span>` with
  // `role="button"` and `tabIndex={0}`. Tabbing to it must
  // make the focus-visible ring appear, and pressing Enter or
  // Space must trigger the same removal as a click. This
  // mirrors what the right-click menu gets from the native
  // browser focus handling — the inline affordance should
  // not be a step backwards for keyboard users.
  await importDemo(page)
  await page.getByLabel('Virtual Users').fill('1')
  await page.getByLabel('Dauer (Sekunden)').fill('3')
  await page.getByRole('button', { name: 'k6-Lasttest starten' }).click()

  let runId = ''
  try {
    const badge = page.locator('.run-badge').first()
    await expect(badge).toContainText('COMPLETED', { timeout: 30_000 })
    runId = await runIdFromBadge(page)

    // Tab through the page until the remove button is
    // focused. The exact number of tabs depends on the page
    // chrome (toolbar links etc.), so we look up by role
    // + name instead of counting — that is the same way
    // screen-reader users reach the control.
    await page.keyboard.press('Tab') // first Tab moves focus into the page
    // Cycle through focusable elements until we land on the
    // remove button. We bound the loop so a regression in
    // focus order does not hang the test forever.
    let foundFocus = false
    for (let i = 0; i < 30; i++) {
      const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? '')
      if (focused === `run-badge-remove-${runId}`) { foundFocus = true; break }
      await page.keyboard.press('Tab')
    }
    expect(foundFocus).toBe(true)

    await page.keyboard.press('Enter')
    await expect(page.locator(`.run-badge[title^="${runId}"]`)).toHaveCount(0)
  } finally {
    if (runId) await forceAbortRun(runId)
  }
})

test('remove icon does not appear on a running badge', async ({ page }) => {
  // The two affordances are mutually exclusive: an in-flight
  // badge gets the cancel button, a terminal badge gets the
  // X. A regression that accidentally rendered the X on a
  // running badge would let the user drop a live run from
  // the dashboard before the backend even saw a cancel —
  // i.e. they would lose visibility of an actively running
  // process. Lock the contract in.
  await importDemo(page)
  await page.getByLabel('Virtual Users').fill('1')
  await page.getByLabel('Dauer (Sekunden)').fill('30')
  await page.getByRole('button', { name: 'k6-Lasttest starten' }).click()

  try {
    const badge = page.locator('.run-badge').first()
    await expect(badge).toHaveClass(/run-badge-running|run-badge-stopping/, { timeout: 30_000 })
    // The cancel button must be there…
    await expect(page.locator('[data-testid^="run-badge-cancel-"]').first()).toBeVisible()
    // …and the remove button must NOT be on this badge.
    await expect(page.locator('[data-testid^="run-badge-remove-"]')).toHaveCount(0)
  } finally {
    const id = await runIdFromBadge(page).catch(() => '')
    if (id) await forceAbortRun(id)
  }
})

test('running badge shows a live spinner and a stopwatch that ticks every second', async ({ page }) => {
  // The badge must communicate "this is in flight" beyond the
  // RUNNING label: a small rotating ring + an M:SS stopwatch
  // that the user can read at a glance. The contract here is
  // that the spinner element is in the DOM, the time element
  // has the monospace tabular-nums treatment, and the value
  // actually changes while the run is still going.
  await importDemo(page)
  await page.getByLabel('Virtual Users').fill('1')
  await page.getByLabel('Dauer (Sekunden)').fill('30')
  await page.getByRole('button', { name: 'k6-Lasttest starten' }).click()

  try {
    const badge = page.locator('.run-badge').first()
    await expect(badge).toHaveClass(/run-badge-running/, { timeout: 30_000 })
    const id = await runIdFromBadge(page)

    const spinner = badge.locator('.status-spinner')
    await expect(spinner).toBeVisible()
    // The ring is rendered as a CSS border with one accent
    // edge; the `border-top-color` is what actually paints the
    // visible arc, so we assert on the inline style the
    // browser computes. Catches regressions that re-style the
    // spinner as a solid disc.
    const topColor = await spinner.evaluate(el => getComputedStyle(el).borderTopColor)
    expect(topColor).toBe('rgb(212, 167, 44)')

    const time = page.locator(`[data-testid="run-badge-time-${id}"]`)
    await expect(time).toBeVisible()
    const firstReading = await time.textContent()
    // The stopwatch starts after the run actually begins, so
    // we do not assert the exact value — only the M:SS shape
    // (`--:--` until the first tick, then a single-digit
    // minute and a two-digit second). The regex covers both
    // the not-yet-started and the started cases.
    expect(firstReading ?? '').toMatch(/^(\d+|\d):\d{2}$/)

    // Wait for at least one tick (the badge grid uses a
    // 500 ms ticker) and assert the value moved. The format
    // pattern is identical, so the change is purely numeric.
    await page.waitForTimeout(1_500)
    const secondReading = await time.textContent()
    expect(secondReading).not.toBe(firstReading)
    expect(secondReading ?? '').toMatch(/^(\d+|\d):\d{2}$/)
  } finally {
    const id = await runIdFromBadge(page).catch(() => '')
    if (id) await forceAbortRun(id)
  }
})

test('spinner and stopwatch disappear once the run reaches a terminal state', async ({ page }) => {
  // The spinner + stopwatch are exclusive to RUNNING. Once the
  // run settles, the badge must drop them — otherwise the user
  // would see a "still ticking" indicator next to a finished
  // result, which contradicts the status text and keeps the
  // ticker alive needlessly.
  await importDemo(page)
  await page.getByLabel('Virtual Users').fill('1')
  await page.getByLabel('Dauer (Sekunden)').fill('3')
  await page.getByRole('button', { name: 'k6-Lasttest starten' }).click()

  try {
    const badge = page.locator('.run-badge').first()
    await expect(badge).toBeVisible({ timeout: 10_000 })
    // Wait for the terminal state. The demo API answers 200,
    // so the run ends as COMPLETED.
    await expect(badge).toContainText('COMPLETED', { timeout: 30_000 })

    await expect(badge.locator('.status-spinner')).toHaveCount(0)
    await expect(badge.locator('.status-time')).toHaveCount(0)
  } finally {
    const id = await page.locator('.run-badge').first().getAttribute('title').catch(() => '')
    if (id) await forceAbortRun(id.split(' · ')[0] ?? '')
  }
})

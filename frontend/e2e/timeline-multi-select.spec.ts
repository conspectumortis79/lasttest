// Standalone Playwright reproduction of the user-reported
// "rapidly-started runs all share the highlight" bug.
//
// The user-visible symptom is in the run-grid, not the
// timeline list: when several load tests are started
// back-to-back, the dashboard's "Laufende + Erledigte
// Tests" panel ends up with more than one run-badge
// carrying the `.active` class (the lila border). The
// class is set in App.tsx by
//   className={`run-badge ${candidate.id === activeRunId ? 'active' : ''} ...`}
// — `activeRunId` is a single-value React state, so the
// expectation is exactly one highlighted badge. Any other
// count means the previous-selection rule
// ([pickActiveRunIdAfterStart]) decided to keep more
// than one run "active" after a fast sequence of
// `setActiveRunId(...)` calls.
//
// The actual root cause we found while building this test
// was an unrelated CSS bug: the run-grid CSS rules
// `.run-badge.running` / `.run-badge.queued` etc. (with a
// dot separator) never matched the React-generated class
// `run-badge-running` (with a hyphen). The default
// `border-left: 4px solid #7d63ff` from `.run-badge` thus
// stayed visible on every queued/running badge, and the
// last started badge (the `.active` one) painted the same
// lila over the rest of the border via
// `.run-badge.active { border-color: #7d63ff }`. The net
// effect was a lila-bordered *cluster* of badges in
// `dd.png`. The fix in App.css replaces the dot-separated
// selectors with the hyphenated class names React actually
// emits.

import { test, expect, type Page } from '@playwright/test'

async function bootstrapDashboard(page: Page): Promise<void> {
  await page.request.post('http://localhost:8286/api/demo-traffic/enabled', {
    data: { enabled: true },
  })
  await page.goto('/')
  await page.addInitScript(() => {
    localStorage.setItem('lasttest.language', 'de')
  })
  await page.reload()
  await page
    .getByRole('button', { name: /Validieren & importieren|Validate & import/i })
    .click()
  const start = page.getByTestId('start-test-button')
  await expect(start).toBeEnabled({ timeout: 10_000 })
}

test('rapidly-started demo runs do not all share the .active class in the run-grid', async ({ page }) => {
  await bootstrapDashboard(page)

  // Fire four clicks back-to-back. Playwright awaits each
  // click before issuing the next, but the React side
  // queues all four click events inside the same render
  // frame, so all four `startTest` calls run before
  // `setBusy(true)` has a chance to disable the button.
  const start = page.getByTestId('start-test-button')
  await start.click()
  await start.click({ force: true })
  await start.click({ force: true })
  await start.click({ force: true })

  // Wait until the dashboard's run-grid shows at least two
  // badges. The polling tick (1 s) is the slowest thing
  // on the path; give it a few ticks.
  const badges = page.locator('.run-grid .run-badge')
  await expect(badges.nth(0)).toBeVisible({ timeout: 15_000 })
  await expect(badges).toHaveCount(4, { timeout: 15_000 })

  // The actual user-visible assertion: only one run-badge
  // in the run-grid may carry the `.active` class. This
  // matches the user's report (`dd.png`) where four
  // back-to-back starts left the grid with multiple
  // lila-bordered badges.
  const activeBadges = page.locator('.run-grid .run-badge.active')
  await page.locator('.run-grid').screenshot({ path: 'test-results/run-grid-debug.png' })
  const activeCount = await activeBadges.count()
  expect(
    activeCount,
    'only one run-badge must carry the .active class at a time, even when 4 runs were started back-to-back',
  ).toBe(1)
})

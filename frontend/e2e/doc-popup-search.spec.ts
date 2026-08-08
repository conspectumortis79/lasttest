// End-to-end tests for the prev/next hit navigation in the
// toolbar docs popup (README + User Guide). The tests guard
// against a regression of a real bug:
//
//   The previous implementation inferred the active hit from
//   `document.activeElement`. After the popup auto-scrolled to
//   the first hit the browser focus was still on the search
//   input, so every "next" press always jumped back to hit 0
//   and every "prev" press jumped to the last hit — the user
//   could never reach the matches in the middle.
//
// The fix tracks the active hit in a ref that the prev/next
// handlers read on every click, so the *currently active*
// highlight walks through every match in document order. These
// tests prove the cycling works by clicking the next button
// several times and asserting that the active highlight's index
// within the highlighted list moves forward (and back) to every
// position. We use the DOM index rather than the mark's
// `textContent` because a single-word query like "k6" produces
// hits whose `textContent` is identical for every match — the
// index is the only unique per-hit identifier the test can
// observe.

import { expect, test, type Page } from '@playwright/test'

async function openReadme(page: Page) {
  await page.getByRole('button', { name: 'README' }).click()
  await expect(page.locator('.doc-popup.is-open')).toBeVisible()
}

async function openUserGuide(page: Page) {
  await page.getByRole('button', { name: 'User Guide' }).click()
  await expect(page.locator('.doc-popup.is-open')).toBeVisible()
}

/**
 * Returns the zero-based index of the currently active `<mark>`
 * within the document order of every highlight. Returns `-1`
 * when no mark is active (e.g. before the first auto-scroll
 * has settled).
 */
async function activeHitIndex(page: Page): Promise<number> {
  return page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('mark.doc-search-hit'))
    return all.findIndex(mark => mark.classList.contains('doc-search-hit--active'))
  })
}

/**
 * Returns the count of highlighted matches. Used to size the
 * walk-through loop in the tests below.
 */
async function hitCount(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelectorAll('mark.doc-search-hit').length)
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('README search next button walks through every hit', async ({ page }) => {
  await openReadme(page)
  const searchInput = page.locator('.doc-popup.is-open input[type="search"]')
  await expect(searchInput).toBeVisible()

  // "k6" appears throughout the README in many sections, so the
  // search lights up more than three highlights. If the bug
  // returns, "next" would just keep returning hit 0.
  await searchInput.fill('k6')
  await page.waitForFunction(() => document.querySelectorAll('mark.doc-search-hit').length >= 3, undefined, { timeout: 5_000 })

  const total = await hitCount(page)
  expect(total).toBeGreaterThanOrEqual(3)

  const visited: number[] = []
  for (let step = 0; step < total + 1; step += 1) {
    const active = await activeHitIndex(page)
    expect(active, `expected an active highlight at step ${step}`).toBeGreaterThanOrEqual(0)
    visited.push(active)
    // Click "next". We use the aria-label rather than relying on
    // the visible text — both buttons carry a chevron icon, only
    // the aria label disambiguates them.
    await page.getByRole('button', { name: 'Next match' }).click()
    // Allow the smooth scroll and the pulse timeout to settle
    // before reading the next active mark.
    await page.waitForTimeout(50)
  }

  // The set of visited indices must cover every position in
  // [0, total). If the bug were present, `visited` would only
  // contain 0 and the test would fail with `unique.length < total`.
  const unique = Array.from(new Set(visited))
  expect(unique.length).toBe(total)
  expect(unique.sort((a, b) => a - b)).toEqual(Array.from({ length: total }, (_, i) => i))
})

test('README search prev button walks backwards through every hit', async ({ page }) => {
  await openReadme(page)
  const searchInput = page.locator('.doc-popup.is-open input[type="search"]')
  await expect(searchInput).toBeVisible()

  await searchInput.fill('k6')
  await page.waitForFunction(() => document.querySelectorAll('mark.doc-search-hit').length >= 3, undefined, { timeout: 5_000 })

  const total = await hitCount(page)
  expect(total).toBeGreaterThanOrEqual(3)

  // The auto-scroll already parked the active hit on hit 0, so
  // pressing prev once must take us to the last hit, then
  // walk backwards through the list. `total + 1` iterations
  // guarantees we land on every position at least once and
  // also catch a stuck "prev from 0" regression.
  const visited: number[] = []
  for (let step = 0; step < total + 1; step += 1) {
    const active = await activeHitIndex(page)
    expect(active, `expected an active highlight at step ${step}`).toBeGreaterThanOrEqual(0)
    visited.push(active)
    await page.getByRole('button', { name: 'Previous match' }).click()
    await page.waitForTimeout(50)
  }

  const unique = Array.from(new Set(visited))
  expect(unique.length).toBe(total)
  expect(unique.sort((a, b) => a - b)).toEqual(Array.from({ length: total }, (_, i) => i))
})

test('User Guide walkthrough next button walks through every hit', async ({ page }) => {
  await openUserGuide(page)
  const searchInput = page.locator('.doc-popup.is-open input[type="search"]')
  await expect(searchInput).toBeVisible()

  // "step" is present in every walkthrough step title, so the
  // search lights up at least one highlight per step (4 steps,
  // 4+ hits). The walkthrough's `data-step` containers mean the
  // popup has to switch steps before scrolling — this is exactly
  // the path that broke in the original bug.
  await searchInput.fill('step')
  await page.waitForFunction(() => document.querySelectorAll('mark.doc-search-hit').length >= 4, undefined, { timeout: 5_000 })

  const total = await hitCount(page)
  expect(total).toBeGreaterThanOrEqual(4)

  const visited: number[] = []
  for (let step = 0; step < total + 1; step += 1) {
    const active = await activeHitIndex(page)
    expect(active, `expected an active highlight at step ${step}`).toBeGreaterThanOrEqual(0)
    visited.push(active)
    await page.getByRole('button', { name: 'Next match' }).click()
    await page.waitForTimeout(100)
  }

  const unique = Array.from(new Set(visited))
  expect(unique.length).toBe(total)
  expect(unique.sort((a, b) => a - b)).toEqual(Array.from({ length: total }, (_, i) => i))
})

test('Enter key advances through hits the same way the next button does', async ({ page }) => {
  await openReadme(page)
  const searchInput = page.locator('.doc-popup.is-open input[type="search"]')
  await searchInput.fill('k6')
  await page.waitForFunction(() => document.querySelectorAll('mark.doc-search-hit').length >= 3, undefined, { timeout: 5_000 })

  const total = await hitCount(page)
  expect(total).toBeGreaterThanOrEqual(3)

  const visited: number[] = []
  for (let step = 0; step < total + 1; step += 1) {
    const active = await activeHitIndex(page)
    expect(active, `expected an active highlight at step ${step}`).toBeGreaterThanOrEqual(0)
    visited.push(active)
    // Plain Enter walks forwards (the Shift variant is exercised
    // by the prev-button test above) and must visit every hit.
    await searchInput.press('Enter')
    await page.waitForTimeout(50)
  }

  const unique = Array.from(new Set(visited))
  expect(unique.length).toBe(total)
  expect(unique.sort((a, b) => a - b)).toEqual(Array.from({ length: total }, (_, i) => i))
})

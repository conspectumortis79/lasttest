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
// The fix tracks the active hit in component state. These tests
// prove the cycling works by clicking the next button several
// times and asserting that the *currently active* highlight
// moves to a different paragraph each time. We measure the
// paragraph location via the in-view text content of the active
// `<mark>` (which is unique per match) rather than the absolute
// pixel position so the test stays robust to scroll height.

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
 * Reads the text content of the currently active `<mark>` — the
 * one that carries the `doc-search-hit--active` pulse class.
 * Returns `null` when no mark is active (e.g. before the first
 * auto-scroll has settled).
 */
async function activeHitText(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const active = document.querySelector('mark.doc-search-hit--active')
    return active?.textContent ?? null
  })
}

/**
 * Returns the text contents of every highlight in document order.
 * Used to assert that the active hit truly walks through the
 * list rather than oscillating between two values.
 */
async function allHitTexts(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('mark.doc-search-hit')).map(mark => mark.textContent ?? ''),
  )
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('README search next button walks through every hit', async ({ page }) => {
  await openReadme(page)
  const searchInput = page.locator('.doc-popup input[type="search"]')
  await expect(searchInput).toBeVisible()

  // "k6" appears throughout the README in many sections, so the
  // search lights up more than three highlights. If the bug
  // returns, "next" would just keep returning hit 0.
  await searchInput.fill('k6')
  await page.waitForFunction(() => document.querySelectorAll('mark.doc-search-hit').length >= 3, undefined, { timeout: 5_000 })

  const hitTexts = await allHitTexts(page)
  expect(hitTexts.length).toBeGreaterThanOrEqual(3)

  const visited: string[] = []
  for (let step = 0; step < hitTexts.length + 1; step += 1) {
    const active = await activeHitText(page)
    expect(active, `expected an active highlight at step ${step}`).not.toBeNull()
    if (active !== null) visited.push(active)
    // Click "next". We use the aria-label rather than relying on
    // the visible text — both buttons carry a chevron icon, only
    // the aria label disambiguates them.
    await page.getByRole('button', { name: 'Next match' }).click()
    // Allow the smooth scroll and the pulse timeout to settle
    // before reading the next active mark.
    await page.waitForTimeout(50)
  }

  // Removing consecutive duplicates (the previous active mark
  // can linger for a frame after the click) must still cover
  // every unique hit. If the bug were present, `visited` would
  // only contain the first hit's text over and over.
  const unique = Array.from(new Set(visited))
  expect(unique.length).toBe(hitTexts.length)
  expect(unique).toEqual(expect.arrayContaining(hitTexts))
})

test('README search prev button walks backwards through every hit', async ({ page }) => {
  await openReadme(page)
  const searchInput = page.locator('.doc-popup input[type="search"]')
  await expect(searchInput).toBeVisible()

  await searchInput.fill('k6')
  await page.waitForFunction(() => document.querySelectorAll('mark.doc-search-hit').length >= 3, undefined, { timeout: 5_000 })

  const hitTexts = await allHitTexts(page)
  expect(hitTexts.length).toBeGreaterThanOrEqual(3)

  // The auto-scroll already parked the active hit on hit 0, so
  // pressing prev once must take us to the last hit, then
  // walk backwards through the list.
  const visited: string[] = []
  for (let step = 0; step < hitTexts.length + 1; step += 1) {
    const active = await activeHitText(page)
    expect(active, `expected an active highlight at step ${step}`).not.toBeNull()
    if (active !== null) visited.push(active)
    await page.getByRole('button', { name: 'Previous match' }).click()
    await page.waitForTimeout(50)
  }

  const unique = Array.from(new Set(visited))
  expect(unique.length).toBe(hitTexts.length)
  expect(unique).toEqual(expect.arrayContaining(hitTexts))
})

test('User Guide walkthrough next button walks through every hit', async ({ page }) => {
  await openUserGuide(page)
  const searchInput = page.locator('.doc-popup input[type="search"]')
  await expect(searchInput).toBeVisible()

  // "step" is present in every walkthrough step title, so the
  // search lights up at least one highlight per step (4 steps,
  // 4+ hits). The walkthrough's `data-step` containers mean the
  // popup has to switch steps before scrolling — this is exactly
  // the path that broke in the original bug.
  await searchInput.fill('step')
  await page.waitForFunction(() => document.querySelectorAll('mark.doc-search-hit').length >= 4, undefined, { timeout: 5_000 })

  const hitTexts = await allHitTexts(page)
  expect(hitTexts.length).toBeGreaterThanOrEqual(4)

  const visited: string[] = []
  for (let step = 0; step < hitTexts.length + 1; step += 1) {
    const active = await activeHitText(page)
    expect(active, `expected an active highlight at step ${step}`).not.toBeNull()
    if (active !== null) visited.push(active)
    await page.getByRole('button', { name: 'Next match' }).click()
    await page.waitForTimeout(100)
  }

  const unique = Array.from(new Set(visited))
  expect(unique.length).toBe(hitTexts.length)
  expect(unique).toEqual(expect.arrayContaining(hitTexts))
})

test('Enter key advances through hits the same way the next button does', async ({ page }) => {
  await openReadme(page)
  const searchInput = page.locator('.doc-popup input[type="search"]')
  await searchInput.fill('k6')
  await page.waitForFunction(() => document.querySelectorAll('mark.doc-search-hit').length >= 3, undefined, { timeout: 5_000 })

  const hitTexts = await allHitTexts(page)
  expect(hitTexts.length).toBeGreaterThanOrEqual(3)

  const visited: string[] = []
  for (let step = 0; step < hitTexts.length + 1; step += 1) {
    const active = await activeHitText(page)
    expect(active, `expected an active highlight at step ${step}`).not.toBeNull()
    if (active !== null) visited.push(active)
    // Shift+Enter walks backwards, plain Enter walks forwards —
    // both must visit every hit.
    await searchInput.press('Enter')
    await page.waitForTimeout(50)
  }

  const unique = Array.from(new Set(visited))
  expect(unique.length).toBe(hitTexts.length)
  expect(unique).toEqual(expect.arrayContaining(hitTexts))
})

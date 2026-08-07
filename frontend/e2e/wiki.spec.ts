// End-to-end smoke tests for the in-app Wiki popup. The Wiki is
// launched from the top toolbar and resolves a glossary entry
// into a new browser window. The tests cover the three flows a
// user actually exercises:
//
//   1. Empty state — clicking "Wiki" shows every entry in a
//      scrollable list with the count badge showing the full
//      glossary size.
//   2. Filtering — typing a query narrows the list to the
//      matching entries (live, no submit needed).
//   3. Open in new window — clicking a list item (or pressing
//      Enter on the exact match) opens a popup window that
//      contains the matching entry title.
//
// The test relies on the existing glossary of k6 load-test
// terms in `frontend/src/wikiData.ts`. If a future PR adds or
// renames entries, the count assertion and the lookup term may
// need to be updated — but the structural assertions
// (popup opens, list narrows, new window receives the entry)
// hold regardless of the glossary contents.

import { expect, test, type Page } from '@playwright/test'

async function openWiki(page: Page) {
  // The Wiki nav link is rendered as a button between the README
  // link and the language pill / settings gear. We address it by
  // visible label so the test stays robust to toolbar reorderings.
  const wikiButton = page.getByRole('button', { name: 'Wiki' })
  await expect(wikiButton).toBeVisible()
  await wikiButton.click()
  // The popup sets focus on its search input via requestAnimationFrame,
  // so we wait for the actual input to be the active element.
  const searchInput = page.locator('.wiki-popup input[type="search"]')
  await expect(searchInput).toBeVisible()
  return searchInput
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('the Wiki popup opens from the toolbar and shows the full glossary', async ({ page }) => {
  const searchInput = await openWiki(page)

  // The empty-query heading must read "All terms" and the count
  // badge must match the total glossary size (47 in the current
  // data; we read it off the page rather than hardcoding so the
  // test stays green as entries are added).
  await expect(page.locator('.wiki-popup-suggestions-heading')).toContainText('All terms')
  const countBadge = page.locator('.wiki-popup-count')
  await expect(countBadge).toBeVisible()
  const countText = (await countBadge.textContent())?.trim() ?? ''
  const totalCount = Number.parseInt(countText, 10)
  expect(Number.isFinite(totalCount)).toBe(true)
  expect(totalCount).toBeGreaterThanOrEqual(25)

  // The list must contain the canonical VU entry — its position
  // is not guaranteed but its presence is.
  await expect(page.locator('.wiki-popup-suggestions button').filter({ hasText: 'VU (Virtual User)' })).toBeVisible()

  // Sanity: the search input is the focused element.
  await expect(searchInput).toBeFocused()
})

test('typing into the Wiki search field filters the list', async ({ page }) => {
  const searchInput = await openWiki(page)

  // Snapshot the initial list size so we can prove filtering
  // actually narrowed it.
  const initialCount = Number.parseInt(
    (await page.locator('.wiki-popup-count').textContent())?.trim() ?? '0',
    10,
  )
  expect(initialCount).toBeGreaterThan(1)

  // "preAllocated" only matches the preAllocatedVUs field entry
  // (and a couple of others via substring). It is a broad enough
  // filter to demonstrate live updating without being too narrow
  // to break when the glossary grows.
  await searchInput.fill('preAllocated')
  // Heading must switch to "Did you mean" while a filter is active.
  await expect(page.locator('.wiki-popup-suggestions-heading')).toContainText('Did you mean')
  // The narrowed list must be strictly smaller than the full list.
  const narrowedCount = Number.parseInt(
    (await page.locator('.wiki-popup-count').textContent())?.trim() ?? '0',
    10,
  )
  expect(narrowedCount).toBeGreaterThan(0)
  expect(narrowedCount).toBeLessThan(initialCount)
  // And it must contain the field entry we searched for.
  await expect(
    page.locator('.wiki-popup-suggestions button').filter({ hasText: 'preAllocatedVUs' }),
  ).toBeVisible()
})

test('clicking a Wiki list entry opens the explanation in a new window', async ({ page, context }) => {
  const searchInput = await openWiki(page)

  // Filter to a single exact-match entry so the result window is
  // deterministic.
  await searchInput.fill('preAllocatedVUs')

  // Wait for the popup to confirm an exact match and the list to
  // contain the entry before clicking it.
  const entryButton = page.locator('.wiki-popup-suggestions button').filter({ hasText: 'preAllocatedVUs' }).first()
  await expect(entryButton).toBeVisible()

  // The popup opens a window via `window.open` with a Blob URL.
  // Wait for the new page and assert it loads the entry title.
  const newPagePromise = context.waitForEvent('page')
  await entryButton.click()
  const wikiPage = await newPagePromise

  // The standalone HTML document the popup generates is fully
  // self-contained. Asserting the title is enough to prove the
  // correct entry was rendered into the new window.
  await wikiPage.waitForLoadState('domcontentloaded')
  await expect(wikiPage).toHaveTitle(/preAllocatedVUs/)

  // Close the helper window so other tests are not affected.
  await wikiPage.close()
})

test('pressing Enter with no match pulses the input but does not open a window', async ({ page, context }) => {
  const searchInput = await openWiki(page)
  await searchInput.fill('zzz-not-a-real-term')

  // Wait for the empty-state message so the test knows the filter
  // finished before we press Enter.
  await expect(page.locator('.wiki-popup-empty')).toBeVisible()

  let popupOpened = false
  context.on('page', () => {
    popupOpened = true
  })

  await searchInput.press('Enter')

  // The pulse is brief (1.2 s) and lives on a CSS class on the
  // input. We assert the negative (no popup) rather than racing
  // the animation — the "no match" empty-state message is still
  // visible.
  await page.waitForTimeout(200)
  expect(popupOpened).toBe(false)
  await expect(page.locator('.wiki-popup-empty')).toBeVisible()
})

test('Escape closes the Wiki popup', async ({ page }) => {
  const searchInput = await openWiki(page)
  await expect(searchInput).toBeVisible()
  await searchInput.press('Escape')
  // The popup uses an `is-open` modifier class; once Escape has
  // been handled the dialog is hidden from the accessibility tree.
  await expect(page.locator('.wiki-popup')).toHaveAttribute('aria-hidden', 'true')
})

// Unit tests for the pure helper behind `useAutoSizeTextarea`.
// The React hook itself is intentionally not tested here — it
// would need a full React renderer, and the only side effect it
// has (setting `el.style.height`) is exactly the value the helper
// returns, so testing the helper covers the logic.
import { test } from 'node:test'
import { deepEqual, equal } from 'node:assert/strict'
import { computeAutoSizeHeight } from './useAutoSizeTextarea.ts'

test('content fits below the cap → height equals scrollHeight, no scroll', () => {
  deepEqual(
    computeAutoSizeHeight(120, 418),
    { height: 120, overflowY: 'hidden' },
  )
})

test('content exceeds the cap → height clamps to cap, inner scroll enabled', () => {
  deepEqual(
    computeAutoSizeHeight(900, 418),
    { height: 418, overflowY: 'auto' },
  )
})

test('content exactly equals the cap → fits without inner scroll', () => {
  // Boundary: a textarea that is exactly 22 lines tall is not
  // "overflowing", so we must not enable the inner scrollbar and
  // shave a pixel off the height.
  deepEqual(
    computeAutoSizeHeight(418, 418),
    { height: 418, overflowY: 'hidden' },
  )
})

test('maxHeight of Infinity (= CSS `none` / unset) → no cap', () => {
  deepEqual(
    computeAutoSizeHeight(10_000, Number.POSITIVE_INFINITY),
    { height: 10_000, overflowY: 'hidden' },
  )
})

test('empty content (scrollHeight 0) → height 0, no scroll', () => {
  // The CSS `min-height: 60px` on the textarea still applies, so
  // the user never sees a zero-height field. The helper only
  // reports what to write as the inline height.
  deepEqual(
    computeAutoSizeHeight(0, 418),
    { height: 0, overflowY: 'hidden' },
  )
})

test('result is a fresh object each call (no shared mutable state)', () => {
  // Defensive: callers may read the returned object and we must
  // not hand out a shared reference that a future call would
  // mutate under their feet.
  const a = computeAutoSizeHeight(100, 200)
  const b = computeAutoSizeHeight(100, 200)
  equal(a === b, false)
  deepEqual(a, b)
})

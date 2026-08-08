// Auto-grow for the JSON Request-Body textarea in the payload
// pool. The CSS rule on the textarea already declares
// `field-sizing: content` and a `max-height` cap, so in modern
// browsers (Chrome / Edge 123+, Safari 18+, Firefox once the flag
// is gone) the browser handles the resize natively and this hook
// is a no-op. In older browsers we fall back to measuring
// `scrollHeight` after each value change and writing the result
// back as an inline `height`. The inline height is clamped to the
// CSS `max-height` so the soft cap from the design mockup is
// honoured everywhere — above the cap, the textarea shows an
// internal scrollbar instead of stretching the table row to
// hundreds of pixels.
import { useEffect, useLayoutEffect, type RefObject } from 'react'

// Feature-detect `field-sizing: content` once at module load.
// `CSS.supports` is a no-op when `CSS` is undefined (older test
// environments) — in that case we always run the JS fallback.
const supportsFieldSizing =
  typeof CSS !== 'undefined' && typeof CSS.supports === 'function'
    ? CSS.supports('field-sizing', 'content')
    : false

// `useLayoutEffect` warns during server-side rendering. The app is
// a Vite SPA so SSR is not a concern today, but the isomorphic
// wrapper keeps the hook safe to reuse from any future
// server-rendered entry point.
const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect

/**
 * Pure helper: given the textarea's natural scroll height and the
 * CSS `max-height` (already parsed as a number), return the height
 * we should write back, and whether the inner scrollbar should be
 * enabled. Extracted so it can be unit-tested without rendering
 * React or touching the DOM.
 */
export function computeAutoSizeHeight(
  scrollHeight: number,
  maxHeight: number,
): { height: number; overflowY: 'auto' | 'hidden' } {
  // `Number.POSITIVE_INFINITY` is the sentinel for "no cap" — we
  // get it from `parseFloat` of an unset / `none` `max-height`.
  const cap = Number.isFinite(maxHeight) ? maxHeight : Number.POSITIVE_INFINITY
  const fits = scrollHeight <= cap
  return {
    height: fits ? scrollHeight : cap,
    overflowY: fits ? 'hidden' : 'auto',
  }
}

/**
 * Resize the referenced `<textarea>` to fit its current content.
 * No-op in browsers that support `field-sizing: content` natively.
 */
export function useAutoSizeTextarea(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
): void {
  useIsomorphicLayoutEffect(() => {
    const el = ref.current
    if (!el || supportsFieldSizing) return
    // Reset to `auto` first: if the user (or a previous run of
    // this effect) dragged the textarea to a custom height,
    // `scrollHeight` would otherwise be clipped to that custom
    // height. The reset lets the browser recompute the natural
    // content height.
    el.style.height = 'auto'
    const maxHeightPx = parseFloat(getComputedStyle(el).maxHeight)
    const { height, overflowY } = computeAutoSizeHeight(
      el.scrollHeight,
      Number.isFinite(maxHeightPx) ? maxHeightPx : Number.POSITIVE_INFINITY,
    )
    el.style.height = `${height}px`
    el.style.overflowY = overflowY
  }, [ref, value])
}

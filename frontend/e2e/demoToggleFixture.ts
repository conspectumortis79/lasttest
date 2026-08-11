// Shared helper that re-asserts the demo-API toggle's server-side
// state before each test.
//
// Root cause this fixes: `global-setup.ts` enables the demo toggle
// exactly ONCE, before the entire suite starts. The suite runs
// sequentially (`fullyParallel: false`, `workers: 1` in
// `playwright.config.ts`), and several tests in
// `demo-traffic.spec.ts` (e.g. "flipping the Settings switch off
// hides the demo link and the demo API returns 404 again") turn the
// toggle OFF as part of their own assertions and never turn it back
// on. Every test that runs later in the same worker process then
// silently inherits a disabled demo API — `GET /demo-api/*` returns
// 404 instead of 200, which cascades into k6 runs finishing FAILED
// instead of COMPLETED across unrelated spec files
// (`context-menu.spec.ts`, `lasttest.spec.ts`, `tab-i18n.spec.ts`, …).
//
// Calling this at the top of every test's `beforeEach` restores the
// "demo is on" baseline that `global-setup.ts` established, so a
// test that disables the toggle can no longer poison any test that
// runs after it.
import { request as playwrightRequest } from '@playwright/test'

export async function ensureDemoApiEnabled(): Promise<void> {
  const api = await playwrightRequest.newContext({ baseURL: 'http://localhost:8286' })
  try {
    const response = await api.post('/api/demo-traffic/enabled', { data: { enabled: true } })
    if (!response.ok()) {
      throw new Error(
        `Failed to re-enable the demo-API toggle before a test: ${response.status()} ${response.statusText()}`,
      )
    }
  } finally {
    await api.dispose()
  }
}

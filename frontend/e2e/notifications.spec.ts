// End-to-end coverage for the per-run completion notifications
// feature wired into the Settings drawer. The spec exercises the
// observable behaviours the user cares about:
//
//   1. The notifications section is rendered in the drawer
//      alongside the language picker.
//   2. A single master toggle drives the feature — every
//      terminal transition (success or failure) is announced
//      while the toggle is on, no per-kind sub-checkboxes
//      anymore.
//   3. A browser notification is fired when a run crosses the
//      `in-flight → terminal` boundary while the tab is in the
//      background.
//
// The notification permission is granted via the Playwright
// context so the prompt is bypassed. The `Notification`
// constructor is replaced with a spy before the page loads so
// the spec can assert on the title/body the App would have
// fired, without firing a real OS notification.
import { expect, test, type Page } from '@playwright/test'

async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'Einstellungen öffnen' }).click()
  const drawer = page.getByRole('dialog', { name: 'Einstellungen' })
  await expect(drawer).toBeVisible()
  return drawer
}

async function closeSettings(page: Page) {
  await page.getByRole('button', { name: 'Schließen' }).click()
  await expect(page.getByRole('dialog', { name: 'Einstellungen' })).toBeHidden()
}

test.describe('Settings drawer — notifications', () => {
  test.beforeEach(async ({ context, page }) => {
    // The browser would normally ask the user for permission
    // via a one-shot prompt. Granting the permission up-front
    // makes the spec deterministic and avoids the prompt
    // refusing to resolve in headless Chromium.
    await context.grantPermissions(['notifications'], { origin: 'http://localhost:8286' })
    // Pin the language so the German button labels match the
    // assertions below. Without this the page defaults to
    // English and `getByRole('button', { name: 'k6-Lasttest
    // starten' })` would never resolve.
    await page.addInitScript(() => {
      localStorage.setItem('lasttest.language', 'de')
    })
    // Install a spy on the Notification constructor so the
    // spec can assert on the title/body the App would have
    // fired. The patch runs before any page script (Vite and
    // the React app) so the App's `Notification.permission`
    // read inside the initial useState returns the value we
    // want.
    await page.addInitScript(() => {
      const w = window as unknown as {
        Notification: typeof Notification
        __notifications: { title: string, options?: NotificationOptions }[]
      }
      w.__notifications = []
      const OriginalNotification = w.Notification
      function PatchedNotification(this: unknown, title: string, options?: NotificationOptions) {
        w.__notifications.push({ title, options })
        // eslint-disable-next-line new-cap
        return new OriginalNotification(title, options)
      }
      PatchedNotification.permission = 'granted'
      PatchedNotification.requestPermission = async () => 'granted'
      Object.defineProperty(window, 'Notification', {
        value: PatchedNotification,
        writable: true,
        configurable: true,
      })
      // Pretend the tab is hidden so the App's `document.hidden`
      // check passes and notifications actually fire. The real
      // browser keeps the page visible in headless mode, but
      // the App only checks `document.hidden`, not the actual
      // rendering state.
      Object.defineProperty(document, 'hidden', {
        configurable: true,
        get: () => true,
      })
    })
    await page.goto('/')
  })

  test('renders the notifications section with the language section', async ({ page }) => {
    const drawer = await openSettings(page)
    // The notifications group is the second section in the
    // drawer; the spec asserts presence by its accessible name
    // (the section heading), not by DOM position, so the test
    // does not break when extra sections are added later.
    await expect(drawer.getByRole('group', { name: 'Benachrichtigungen' })).toBeVisible()
    // A single master toggle controls every terminal
    // notification (success + failure). No per-kind sub-toggles
    // anymore.
    await expect(drawer.getByRole('checkbox', { name: 'Browser-Benachrichtigungen' })).toBeVisible()
    await expect(drawer.getByRole('checkbox', { name: 'On successful completion' })).toHaveCount(0)
    await expect(drawer.getByRole('checkbox', { name: 'On failure (FAILED, STOPPED, ABORTED)' })).toHaveCount(0)
    await expect(drawer.getByText('Benachrichtigungen sind im Browser blockiert.')).toHaveCount(0)
  })

  test('persists the toggle state across a page reload', async ({ page }) => {
    const drawer = await openSettings(page)
    await drawer.getByRole('checkbox', { name: 'Browser-Benachrichtigungen' }).check()
    await closeSettings(page)

    // Reload and reopen the drawer. The master must still be
    // on, which proves the settings are persisted in
    // localStorage and reloaded on the next mount.
    await page.reload()
    const reopened = await openSettings(page)
    await expect(reopened.getByRole('checkbox', { name: 'Browser-Benachrichtigungen' })).toBeChecked()
  })

  test('shows the permission-denied warning when the browser blocks notifications', async ({ context, page }) => {
    // Override the permission grant from beforeEach so the
    // browser reports 'denied' instead of 'granted'. We have
    // to clear the permission by clearing the context, then
    // explicitly deny it.
    await context.clearPermissions()
    await page.addInitScript(() => {
      const w = window as unknown as { Notification: typeof Notification }
      const OriginalNotification = w.Notification
      function PatchedNotification(this: unknown, title: string, options?: NotificationOptions) {
        // eslint-disable-next-line new-cap
        return new OriginalNotification(title, options)
      }
      PatchedNotification.permission = 'denied'
      PatchedNotification.requestPermission = async () => 'denied'
      Object.defineProperty(window, 'Notification', {
        value: PatchedNotification,
        writable: true,
        configurable: true,
      })
    })
    await page.goto('/')

    const drawer = await openSettings(page)
    const master = drawer.getByRole('checkbox', { name: 'Browser-Benachrichtigungen' })
    await expect(master).toBeDisabled()
    await expect(drawer.getByText('Benachrichtigungen sind im Browser blockiert.')).toBeVisible()
  })

  test('fires a browser notification when a run fails while the tab is in the background', async ({ page }) => {
    // Enable notifications: the master toggle is the only knob
    // now, every terminal transition (success + failure) is
    // covered by it.
    const drawer = await openSettings(page)
    await drawer.getByRole('checkbox', { name: 'Browser-Benachrichtigungen' }).check()
    await closeSettings(page)

    // Start a minimal load test. The bundled demo spec plus
    // a 3 s duration finishes well within the spec's timeout.
    const unreachableSpec = `openapi: 3.0.3
info:
  title: Notification Probe
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

    // Wait for the auto-loaded demo spec to land in the textarea
    // before we replace it with the probe spec. The auto-load is
    // a network fetch that can race the file-input replacement;
    // picking the probe spec first and then being overwritten by
    // the demo spec would lead to importing the wrong document.
    const spec = page.getByLabel('Swagger / OpenAPI-Dokumentation')
    await expect(spec).toContainText('Lasttest Demo API')
    await page.locator('input[type="file"]').setInputFiles({
      name: 'probe.yaml',
      mimeType: 'application/yaml',
      buffer: Buffer.from(unreachableSpec),
    })
    await expect(spec).toContainText('Notification Probe')
    await page.getByRole('button', { name: 'Validieren & importieren' }).click()
    await expect(page.getByRole('heading', { name: 'Notification Probe' })).toBeVisible()

    await page.getByLabel('Virtual Users').fill('1')
    await page.getByLabel('Dauer (Sekunden)').fill('3')
    await page.getByRole('button', { name: 'k6-Lasttest starten' }).click()

    // Wait for the run to reach a terminal state. The probe
    // points at a port nothing listens on, so k6 fails fast
    // (connection refused) — well inside the 30 s budget.
    await expect(page.locator('.status-badge.is-fail')).toBeVisible({ timeout: 60_000 })

    // The notification spy must have at least one entry — the
    // FAILED transition. The body is the localised template
    // with the run id and the terminal status substituted.
    const notifications = await page.evaluate(() => {
      const w = window as unknown as {
        __notifications: { title: string, options?: NotificationOptions }[]
      }
      return w.__notifications
    })
    expect(notifications.length).toBeGreaterThanOrEqual(1)
    const failed = notifications.find(n => n.title === 'k6-Lauf mit Fehler beendet')
    expect(failed, 'expected a FAILED notification').toBeDefined()
    expect(failed?.options?.body).toContain('FAILED')
  })
})

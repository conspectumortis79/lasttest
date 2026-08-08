// Playwright global setup that runs once before the suite starts.
// The pre-toggle test suite expected the bundled demo spec to be
// loaded into the spec textarea on every page load; with the
// opt-in demo-API toggle, that only happens when the user has
// either flipped the Settings switch on or has the persisted
// `lasttest.demo.enabled` localStorage value set to `true`.
//
// The E2E suite does not want to click the Settings switch in
// every spec — that would couple every test to UI copy that is
// allowed to change. Instead, the setup makes the demo the
// "ambient" state for the entire run:
//
//   1. POST `/api/demo-traffic/enabled` so the backend has the
//      toggle on (the controllers and the demo spec endpoint
//      both consult the toggle on the hot path).
//   2. Write a Playwright `storageState` JSON file with the
//      `lasttest.demo.enabled` localStorage entry pre-set, so
//      the very first React render inside `useDemoStatus`
//      already agrees with the backend and does not flip the
//      toggle off again during the synchronisation pass.
//
// The storage state lives next to the setup so the cleanup of
// the e2e directory is straightforward.
import { request } from '@playwright/test'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const currentDirectory = dirname(fileURLToPath(import.meta.url))
const storageStatePath = resolve(currentDirectory, '.demo-enabled-storage.json')
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8286'

export default async function globalSetup(): Promise<void> {
  const context = await request.newContext({ baseURL })
  try {
    const response = await context.post('/api/demo-traffic/enabled', {
      data: { enabled: true },
    })
    if (!response.ok()) {
      throw new Error(
        `Failed to enable the demo-API toggle for the e2e suite: `
        + `${response.status()} ${response.statusText()}`,
      )
    }
  } finally {
    await context.dispose()
  }

  mkdirSync(dirname(storageStatePath), { recursive: true })
  const storageState = {
    cookies: [],
    origins: [
      {
        origin: baseURL,
        localStorage: [
          { name: 'lasttest.demo.enabled', value: 'true' },
        ],
      },
    ],
  }
  writeFileSync(storageStatePath, JSON.stringify(storageState, null, 2), 'utf8')
}

export { storageStatePath }

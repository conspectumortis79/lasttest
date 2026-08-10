import { defineConfig, devices } from '@playwright/test'
import { storageStatePath } from './e2e/global-setup.ts'

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5173',
    storageState: storageStatePath,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  // The `projects[].use` block REPLACES the top-level `use`
  // block entirely for the matching project — it does not merge.
  // We must re-state every shared setting (baseURL,
  // storageState, …) here, otherwise tests run against a
  // browser that has no base URL and `page.goto('/')` blows up
  // with "Cannot navigate to invalid URL".
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:5173',
        storageState: storageStatePath,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
      },
    },
  ],
  webServer: {
    command: 'docker compose -f ../docker-compose.yml up --build',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 180_000,
  },
})

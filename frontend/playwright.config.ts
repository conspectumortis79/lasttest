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
    baseURL: 'http://localhost:8286',
    storageState: storageStatePath,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'docker compose -f ../docker-compose.yml up --build',
    url: 'http://localhost:8286',
    reuseExistingServer: true,
    timeout: 180_000,
  },
})

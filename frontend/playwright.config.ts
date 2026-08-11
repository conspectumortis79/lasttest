import { defineConfig, devices } from '@playwright/test'
import { storageStatePath } from './e2e/global-setup.ts'

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  // `fullyParallel: false` (Playwright's default) keeps tests
  // WITHIN a single file running in order, in the same worker
  // — several files here mutate shared, file-scoped backend
  // state across their own tests (e.g. `demo-traffic.spec.ts`'s
  // "the toolbar reset button drops every captured request"
  // clears the global demo-traffic ring buffer that other tests
  // in the same file read from). `fullyParallel: true` would let
  // Playwright interleave those tests across workers and produce
  // exactly the kind of cross-test interference the suite was
  // written to avoid.
  //
  // Different FILES, however, are independent of each other (no
  // shared `let` state at module scope, no test in one file
  // reads output written by a test in another file), so raising
  // `workers` still parallelises the suite one whole spec file
  // at a time. The count is capped at 4, not the CPU count: the
  // backend enforces `MAX_PARALLEL_RUNS = 2`
  // (AsyncConfiguration.kt) as a hard ceiling on concurrently
  // executing k6 processes, and the demo-API toggle (`/api/
  // demo-traffic/enabled`) is a single process-wide switch every
  // file relies on being "on". Only `demo-traffic.spec.ts` turns
  // it off as part of its own assertions; every `beforeEach`
  // across the suite now re-enables it via `ensureDemoApiEnabled()`
  // (demoToggleFixture.ts) before touching the page, so a worker
  // running `demo-traffic.spec.ts` cannot poison a sibling worker
  // running a different file. 4 workers keeps queueing on the
  // 2-slot k6 executor bounded (at most 2 extra runs waiting at
  // any time) while cutting wall-clock time roughly to a
  // quarter versus the previous single-worker setup.
  fullyParallel: false,
  workers: 4,
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
      // Three files are excluded here and run in the serial
      // `chromium-demo-traffic` project below instead:
      //
      //  - `demo-traffic.spec.ts` reads/mutates the backend's
      //    PROCESS-WIDE demo-traffic ring buffer
      //    (RingBufferDemoRequestLog — a single in-memory
      //    buffer, not scoped per test or per run) as its own
      //    assertion target. Any other file's tests that hit
      //    the demo API while this file is asserting "the
      //    buffer is now empty" / "has exactly N entries" race
      //    that shared buffer. Verified directly: running the
      //    full suite with `workers: 4` and no isolation
      //    produced `expect(payload.count).toBe(0)` failures
      //    with `Received: 3` — traffic from an unrelated spec
      //    file's k6 run landing in the buffer between the
      //    reset click and the follow-up assertion.
      //  - `pill-aborted.spec.ts` and `pill-failed.spec.ts`
      //    both flip the demo-API switch OFF in the Settings
      //    drawer to sidestep an unrelated race in `App.tsx`'s
      //    demo-auto-load effect (fetching the bundled demo
      //    spec into the same textarea a manual file upload
      //    targets). That switch calls
      //    `POST /api/demo-traffic/enabled`, the SAME
      //    process-wide toggle — turning it off while another
      //    worker's file relies on the demo API being reachable
      //    would 404 that worker's requests.
      testIgnore: [/demo-traffic\.spec\.ts$/, /pill-aborted\.spec\.ts$/, /pill-failed\.spec\.ts$/],
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:5173',
        storageState: storageStatePath,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
      },
    },
    {
      name: 'chromium-demo-traffic',
      testMatch: [/demo-traffic\.spec\.ts$/, /pill-aborted\.spec\.ts$/, /pill-failed\.spec\.ts$/],
      // `dependencies` makes Playwright wait for EVERY test in
      // the `chromium` project to finish before this project's
      // first test starts — not just file-ordering within one
      // worker. That is the actual isolation guarantee these
      // files need: no other spec file's k6 run / demo-API
      // request can still be in flight while this project
      // mutates the process-wide demo-traffic ring buffer or
      // the process-wide demo-API toggle.
      dependencies: ['chromium'],
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

# lasttest

`lasttest` imports Swagger 2.0 and OpenAPI 3 specifications (YAML or JSON),
generates one k6 request per operation, and runs selected load tests
asynchronously. Swagger 2.0 documents are automatically converted to the
internal OpenAPI 3 model during import. The application is supported on
**Linux and macOS**. For a reproducible runtime across both operating systems,
Docker is the recommended deployment path.

## What lasttest does

For every imported spec lasttest lets you:

1. **Select** one operation and configure its parameters, request body,
   and optional Bearer token.
2. **Pick a load profile** that maps to one of four k6 executors —
   `constant-vus`, `shared-iterations`, `ramping-vus`, or
   `constant-arrival-rate` — with one-click presets for Smoke, Load,
   Stress, Spike, Soak, Anfragen, and Arrival-Rate.
3. **Run the test** and watch the status cycle through `QUEUED` →
   `RUNNING` → `COMPLETED` (or `FAILED`).
4. **Open the report** in a new tab. It contains a printable summary, the
   generated k6 script, and — if InfluxDB is running — a
   **ramp-grafik** that compares the planned load (Soll) with the
   measured load (Ist) over time.

## Quick start with a single container

```bash
docker build -t lasttest:latest .
docker run -d --name lasttest -p 8286:8286 --restart unless-stopped lasttest:latest
```

Or with Docker Compose:

```bash
docker compose up --build -d
```

<<<<<<< HEAD
This starts three containers: `lasttest` (the application), `lasttest-influxdb`
(a Time-Series database for the ramp-grafik), and `lasttest-grafana`
(optional dashboards). Access them at:

- `http://localhost:8286` — lasttest web UI
- `http://localhost:8086` — InfluxDB UI (login `admin` / `lasttest-admin-password`)
- `http://localhost:3000` — Grafana (login `admin` / `admin`)

If you only need lasttest without the time-series parts, start it alone
with `docker run` and the ramp-grafik will then show only the Soll line.

Once Spring Boot has finished starting, a clearly visible success message with
a link to the web UI is written to the container log:

```text
============================================================
lasttest wurde erfolgreich gestartet.
Jetzt im Browser öffnen: http://localhost:8286/
============================================================
```

If a different public host or port is used, the displayed link can be
overridden via the `LASTTEST_PUBLIC_URL` environment variable.
=======
Once Spring Boot has finished starting, the web UI is reachable on the
configured port (default `8286`). The startup log only contains the
standard Spring Boot output — no extra banner is emitted by lasttest.
>>>>>>> ffe00f7ec7e0eebe0a0fe17c903fbf09914889be

Open the application in your browser:

- `http://localhost:8286` (when running on the Docker host)
- `http://<IP-of-the-Docker-host>:8286` (from another machine)

The final runtime image contains Java 25, the compiled Kotlin / Spring
backend with all JVM libraries, the built React frontend, and k6. Gradle,
the Kotlin compiler, and Node.js are only used inside isolated build stages
and are not required on the host or inside the final image.

The demo specification lives at `demo/openapi-demo.yaml`. It includes GET
requests with editable query and path parameters, POST requests with a JSON
body, as well as PUT and DELETE. `POST /products/search` demonstrates
Bearer authentication; any non-empty demo token is accepted. After the
import, the UI shows one input box per endpoint for parameters, request
body, and Bearer token.

The demo also declares four `servers` entries (local demo, staging,
integration, production) so that the **Base-URL dropdown** in the load
profile card is visible immediately. Only the local entry actually
responds; the other three are placeholders to illustrate how a
multi-environment spec looks in the UI.

After a test run, the link “Open detailed k6 report in a new tab” opens a
print-optimised result view. It contains the summary, thresholds, run and
API configuration, the actually used endpoint parameters, the **ramp-grafik**
with Soll/Ist comparison (when InfluxDB is running), detailed k6 metrics,
and console / JSON raw data. Use “Print / Save as PDF” to archive this view
directly as a PDF.

Below the k6 JSON export, “Generated k6 test script” can be expanded. It
shows the exact script that lasttest executed and offers a download as
“Download k6 test script (.js)”. The report also shows the matching
manual start command, for example:

```bash
k6 run -e BASE_URL="https://example.test" lasttest-<run-id>.js
```

The script is also available via `GET /api/test-runs/{id}/script` with
`Content-Disposition: attachment`. Because the exact test script may
contain configured headers or Bearer tokens, the exported file must be
stored securely.

The import endpoint accepts raw YAML or JSON content with `swagger: "2.0"`
or `openapi: 3.x`. In addition to pasting or uploading a document, the
UI exposes a **URL field** that fetches the spec from any Swagger UI page
or direct OpenAPI document URL. The backend inspects the Swagger UI HTML,
extracts the embedded `url` / `urls` entries, downloads the spec, and
imports it transparently. Cross-origin targets are rejected, the response
is capped at 5 MB with a 10 s timeout, and a bundled demo Swagger UI
is served at `http://localhost:8286/demo-swagger-ui` once lasttest is
running so the URL flow can be exercised end-to-end without external
dependencies.

## Requirements for local development

- Java 25+
- Node.js 22+
- k6

Docker Engine with Compose is a complete alternative on Linux and macOS.

## Local development on Linux / macOS

```bash
# Terminal 1
cd backend
./gradlew bootRun

# Terminal 2
cd frontend
npm install
npm run dev
```

Then open: <http://localhost:5173>

Or simply run the helper script, which detects and stops any previously
running lasttest instance (including Docker containers) and then starts
both services:

```bash
./start-linux.sh
```

The script starts the project in **dev mode**: the Vite dev-server serves
the React UI with hot-reload on **http://localhost:5173**, and Spring
Boot runs the JSON API on **http://localhost:8286**. The backend URL
does **not** serve a UI in dev mode (it returns Spring's Whitelabel 404
page, because `../frontend/dist/` is not built). Always open the dev-UI
URL in your browser:

- Dev-UI (Vite, hot-reload): <http://localhost:5173>
- API (Spring Boot, JSON only): <http://localhost:8286>

If you want a single-URL deployment where the backend serves both the
API and the UI on port 8286, use `./docker-start.sh` (or `docker compose up --build`)
instead — the Dockerfile builds `frontend/dist/` and the Spring app
serves it as static files.

To try the demo, import `demo/openapi-demo.yaml` via “Datei öffnen”
(“Open file”). The write operations POST, PUT, and DELETE must be enabled
explicitly.

## Documentation

- **[`USER_GUIDE.md`](./USER_GUIDE.md)** — comprehensive, end-to-end
  English user manual covering the workflow, the demo API, the
  configuration of every endpoint, running load tests, the report view,
  and troubleshooting.
- **[`start-linux.sh`](./start-linux.sh)** — one-command local startup
  (kills any previous instance, then launches backend + frontend).

## Tests and quality checks

### Backend: unit / integration tests with mandatory 100 % coverage

```bash
cd backend
./gradlew clean check jacocoTestReport
```

`jacocoTestCoverageVerification` fails the build as soon as the tested
production logic falls below 100 % for instructions, lines, or branches.
Framework bootstrap and pure DTO data classes are not part of this
business coverage rule. The HTML report is available at
`backend/build/reports/jacoco/test/html/index.html`.

### Frontend: unit tests with 100 % coverage

```bash
cd frontend
npm test
```

The tests enforce 100 % lines, branches, and functions for the frontend
logic.

### Frontend E2E tests with Playwright

```bash
cd frontend
npm run test:e2e:install   # once per machine
npm run test:e2e
```

Playwright starts `docker compose up --build` when needed, uses Chromium,
and verifies import errors, file import, parameter / body / Bearer
configuration, load profile limits, successful k6 execution, polling,
raw data, the display and download of the exact k6 script, the report in
a new tab, the print / PDF trigger, and unknown report IDs. The HTML
report is available at `frontend/playwright-report/index.html`.

All frontend tests together:

```bash
cd frontend && npm run test:all
```

Lint and build:

```bash
cd backend && ./gradlew ktlintCheck
cd frontend && npm run lint && npm run build
```

## Security boundaries of the MVP

- Load profile values are hard-capped per executor (max 30 000 VUs, max
  3 600 s duration, max 1 000 000 iterations, max 100 000 req/s, etc.)
  to keep runaway tests from melting your target.
- Destructive operations are deactivated in the UI by default.
- Only HTTP(S) targets are accepted.
- For a productive, multi-tenant deployment k6 must additionally run in
  isolated containers with a target allowlist, egress rules, resource
  limits, and secret management.
- Test runs are currently kept in memory only.

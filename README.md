# lasttest

`lasttest` imports Swagger 2.0 and OpenAPI 3 specifications (YAML or JSON),
generates one k6 request per operation, and runs selected load tests
asynchronously. Swagger 2.0 documents are automatically converted to the
internal OpenAPI 3 model during import. The application is supported on
**Linux and macOS**. For a reproducible runtime across both operating systems,
Docker is the recommended deployment path.

## Quick start with a single container

```bash
docker build -t lasttest:latest .
docker run -d --name lasttest -p 8286:8286 --restart unless-stopped lasttest:latest
```

Or with Docker Compose:

```bash
docker compose up --build -d
```

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
API configuration, the actually used endpoint parameters, detailed k6
metrics, and console / JSON raw data. Use “Print / Save as PDF” to archive
this view directly as a PDF.

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
or `openapi: 3.x`. A rendered Swagger UI HTML page is **not** a valid
import; instead, download the raw document from Swagger UI (for example
`/swagger.json`, `/swagger.yaml`, `/v3/api-docs`, or `/v3/api-docs.yaml`).

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

- Maximum 1000 VUs and 3600 seconds per run.
- Destructive operations are deactivated in the UI by default.
- Only HTTP(S) targets are accepted.
- For a productive, multi-tenant deployment k6 must additionally run in
  isolated containers with a target allowlist, egress rules, resource
  limits, and secret management.
- Test runs are currently kept in memory only.

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
   Bearer token — and (since the payload-pool release) **build a pool of
   distinct datasets** that k6 iterates through with either a sequential
   or a random strategy.
2. **Pick a load profile** that maps to one of four k6 executors —
   `constant-vus`, `shared-iterations`, `ramping-vus`, or
   `constant-arrival-rate` — with one-click presets for Smoke, Load,
   Stress, Spike, Soak, Burst, and Arrival-Rate.
3. **Run the test** and watch the status cycle through `QUEUED` →
   `RUNNING` → `COMPLETED` (or `FAILED`, `STOPPED`, `ABORTED`).
   Every run shows up as a **row** in the multi-run dashboard
   (`Letzte Läufe` panel) with a **× N** badge showing how often
   that endpoint has already been tested. **A right-click on a row
   opens an action menu** that lets you stop (graceful),
   force-abort (SIGKILL), rerun with the same configuration, copy
   the run id, copy the report link, open the report in a new tab,
   or export the raw k6 JSON summary.
4. **Inspect the run** through a tabbed detail view that contains:
   the live status, the **live ramp-grafik** (`Auslastung — Soll vs
   Ist`) that compares the planned load (Soll) with the measured
   load (Ist) over time, the **Timeline** tab (a per-endpoint
   7-day heatmap plus a Gantt-style timeline of every historical
   run), the **Aktionen** tab (one-click controls), the **k6
   console**, the **Thresholds** table, the **Configuration**
   recap, and the **Failure diagnosis**. **Open the printable
   report** in a new tab for a print-ready A4 view that includes
   the full summary, the generated k6 script, the ramp-grafik with
   Soll/Ist comparison (when InfluxDB is running), and detailed k6
   metrics.

## Quick start with a single container

```bash
docker build -t lasttest:latest .
docker run -d --name lasttest -p 8286:8286 --restart unless-stopped lasttest:latest
```

Or with Docker Compose:

```bash
docker compose up --build -d
```

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

Open the application in your browser:

- `http://localhost:8286` (when running on the Docker host)
- `http://<IP-of-the-Docker-host>:8286` (from another machine)

The final runtime image contains Java 25, the compiled Kotlin / Spring
backend with all JVM libraries, the built React frontend, and k6. Gradle,
the Kotlin compiler, and Node.js are only used inside isolated build stages
and are not required on the host or inside the final image.

## Trusting custom TLS certificates

When the target API uses a TLS certificate that is not signed by a
public CA — for example a self-signed certificate in a staging
environment, or a certificate issued by a corporate / internal CA —
the JVM refuses the TLS handshake and lasttest reports
`PKIX path building failed: unable to find valid certification path to
requested target`.

Configure lasttest with an additional TrustStore that contains the
missing certificate(s) or CA chain. The Java system TrustStore is
still used, so public CAs keep working — only the additional
certificates are layered on top.

| Variable | Required | Description |
| --- | --- | --- |
| `LASTTEST_TRUSTSTORE_PATH` | yes | Absolute path to a file containing the certificate(s). Supported formats: `PKCS12` (`.p12`, `.pfx`), `JKS` (`.jks`), or PEM (`.pem`, `.crt`, `.cer` — one or more `CERTIFICATE` blocks). |
| `LASTTEST_TRUSTSTORE_PASSWORD` | only for PKCS12 / JKS | Password for the TrustStore. Empty string is allowed for PEM files. |

The bundled `docker-compose.yml` already wires both variables for the
backend and mounts the host path `certs/custom-ca.pem` into the
container read-only at `/etc/lasttest/custom-ca.pem`. Drop your
company's root CA at that path (PEM format, possibly with multiple
`-----BEGIN CERTIFICATE-----` blocks) and restart:

```bash
docker compose restart lasttest
```

The backend logs show one of these lines on startup:

```text
Lade zusätzlichen TrustStore aus /etc/lasttest/custom-ca.pem (Variable LASTTEST_TRUSTSTORE_PATH) …
TrustStore /etc/lasttest/custom-ca.pem erfolgreich geladen.
```

If the load fails, the backend logs a warning and falls back to the
JVM defaults — the TLS error resurfaces at the next request.

Generate a PEM file from a target host with OpenSSL:

```bash
openssl s_client -showcerts -connect api.example.com:443 </dev/null 2>/dev/null \
  | openssl x509 -outform PEM > staging-ca.pem
```

Or build a PKCS12 TrustStore from a downloaded certificate:

```bash
keytool -importcert -alias staging -file staging-ca.pem \
  -keystore staging.p12 -storetype PKCS12 -storepass changeit -noprompt
```

> **k6 runs as a separate process and uses Go's TLS stack.** It does
> **not** read the Java TrustStore, so the spec import may succeed
> while the load test then fails with `x509: certificate signed by
> unknown authority`. k6 reads its CA bundle from the standard Go
> variable `SSL_CERT_FILE` — point it at the same PEM inside the
> container. Note that `SSL_CERT_FILE` **replaces** the system bundle
> (it does not layer), so only use it when every target your tests
> hit is signed by the same custom CA, or concatenate multiple CA
> certificates into one PEM. For a directory of PEM files, use
> `SSL_CERT_DIR` instead.

Local development (`./gradlew bootRun` + `npm run dev`) uses the same
variables — export them in the shell that launches the backend and
the host `k6` binary:

```bash
export LASTTEST_TRUSTSTORE_PATH=$PWD/certs/custom-ca.pem
export LASTTEST_TRUSTSTORE_PASSWORD=
export SSL_CERT_FILE=$PWD/certs/custom-ca.pem
```

Restart is required: the TrustStore is loaded once at backend startup
and `SSL_CERT_FILE` is read once per `k6` process. For the full
end-to-end walkthrough (including limitations around mTLS, multi-CA
PEMs, and `direnv`-based dev workflows) see the **User Guide**
section *Trusting custom TLS certificates*.

## UI language

The lasttest frontend is **fully bilingual**. A pill in the top toolbar
shows the active language (English / Deutsch) and a gear icon opens the
**Settings drawer**, where the language can be switched at any time.

- The selection is **persisted in `localStorage`** under the key
  `lasttest.language`, so the next visit lands in the language the user
  picked.
- All toolbar chrome, settings, walkthrough, status pills, report
  headers, and the markdown documentation popups respect the active
  language.
- The bundled **User Guide** and **README** markdown popups (toolbar
  → *User Guide* / *README*) automatically render in the chosen
  language, with live in-document search (`Ctrl/⌘ + F`),
  previous / next match navigation, and an Esc-to-close affordance.

## The run-row action menu (right-click)

Every k6 test run appears as a **row** in the **multi-run dashboard**
(`Letzte Läufe` panel — step 4). The row shows a status dot, the
HTTP method, status badge, path, a **× N** counter that summarises
how often the same endpoint has been tested before, a meta string
(`VUs · duration`) and a relative `when` stamp. A single left-click
focuses the run; a **right-click opens the action menu** at the
cursor position. The menu adapts to the run's current status so it
only offers actions that make sense:

| Menu item | Visible when | Effect |
| --- | --- | --- |
| **Show live details / Show summary / Show aborted details** | Always | Brings the run's detail card into focus (the label changes with the run status) |
| **Copy run id** | Always | Copies the UUID to the clipboard |
| **Copy report link** | Terminal runs | Copies `http://…/?report=<run-id>` to the clipboard |
| **Open k6 web report** | Always | Opens the printable report in a new tab |
| **Export k6 JSON** | Terminal runs with a complete summary | Downloads `lasttest-<run-id>-summary.json` for offline analysis |
| **Stop (graceful)** | `QUEUED`, `RUNNING`, `STOPPING` | Sends `SIGTERM`; k6 winds down, the run ends as `STOPPED` |
| **Force abort** | `QUEUED`, `RUNNING`, `STOPPING` | Sends `SIGKILL`; the run ends immediately as `ABORTED` (metrics may be partial) |
| **Rerun** | Terminal runs (`COMPLETED` / `FAILED` / `STOPPED` / `ABORTED`) | Re-runs the same scenario against the original base URL with a fresh run id |
| **Remove from view** | Terminal runs (`COMPLETED` / `FAILED` / `STOPPED` / `ABORTED`) | Drops the row from the in-memory dashboard. The backend still holds the run, so a page refresh re-hydrates it from `/api/test-runs`. The remaining rows re-sort by their original `createdAt` so the dashboard stays in newest-first order. |
| **Remove all other failed runs** | Terminal runs, when at least one other `FAILED` row is present | Bulk-drops every other `FAILED` row from the dashboard. Disabled (with a reason) when there is nothing to remove. `STOPPED` and `ABORTED` runs are intentionally preserved |

> 💡 **Worked example — rerun via right-click:** you ran a 30 s
> `Smoke` profile against the demo and want to confirm the result
> is reproducible. Right-click the green `COMPLETED` row, pick
> **Rerun** and lasttest POSTs `/api/test-runs/{id}/rerun`. The
> backend re-queues the same `CreateTestRunRequest` it preserved
> when the original run was started, k6 starts fresh, and the new
> row appears in the dashboard with focus automatically moved to
> it.

A click outside the menu (or `Esc`) closes it. The menu does not
trigger on `Left-Click`; that stays reserved for focusing the run.

## Payload pool (parameter variability)

Each endpoint card in step 2 lets you build a **pool of multiple
payloads** (datasets) per operation — not just one. Every row of the
pool is a complete dataset with its own parameter values, request body
and Bearer token. k6 then walks through the pool according to the
**Payload Strategy** chosen in the load profile card:

- **Sequential** — the pool is used top-to-bottom, wrapping around at
  the end (round-robin).
- **Random** — one payload is picked at random per iteration.

The pool is rendered as a compact table with `+ Payload hinzufügen`
to add a row and `×` to remove one (the last row stays — at least
one payload is always required). The strategy selector sits in the
load profile card together with the executor dropdown.

## Multi-run dashboard — the `Letzte Läufe` panel

Since the *Letzte Läufe* release, every k6 run you start in the
current session appears as a **row** in a compact list panel above
the detail card. The panel replaces the older badge grid and adds:

- a **status dot** + status badge (`EINGEREIHT` / `LÄUFT` /
  `GESTOPPT` / `BESTANDEN` / `FEHLGESCHLAGEN` / `ABGEBROCHEN`),
- a human-readable identifier (`METHOD /path`),
- a small **× N** badge next to the operation name that shows how
  often the same endpoint has been tested before — powered by
  `/api/operations/stats` and polled on the same cadence as the
  run list,
- a one-line meta string (`VUs · duration`),
- the elapsed/planned duration column,
- a relative `when` stamp (`just now` / `5 min ago` / `yesterday` …).

Left-clicking the row focuses it (same as the old badge).
Right-clicking opens the same action menu (stop, abort, rerun,
remove, share, export) at the cursor position, so the gesture
contract from the badge grid stays unchanged.

## Per-endpoint timeline tab

The run-detail tabs include a dedicated **Timeline** tab that turns
the run history of one specific (method, path) endpoint into a
single visual story. It contains:

- a **24 h / 7 d / 30 d / 90 d** window selector,
- a **stat strip** with the run count, success / failure counts
  and the timestamp of the last failed run,
- a **heat map** of one cell per day, coloured by the day's
  outcome (green = all `COMPLETED`, yellow = at least one
  `STOPPED`, red = at least one `FAILED` / `ABORTED`),
- a **Gantt-style single-row timeline** with one bar per run,
  centred on the focused run (or "now" when none is focused);
  clicking a bar jumps the chart to that run's `createdAt`,
- a compact **list** of the most-recent runs in the window with
  status badges, relative `when` stamps and a right-click menu
  that mirrors the overview's actions.

The data source is `/api/operations/runs?method=…&path=…`, polled
on the same cadence as the run list. A right-click on a bar in
the Gantt or on a list entry opens the same per-run context menu
as on the overview badges.

## Live ramp-grafik (Auslastung — Soll vs Ist)

While a run is in flight the **Übersicht** (Overview) tab shows a
live SVG chart that compares the **Soll** (planned) curve —
derived deterministically from the configured load profile —
against the **Ist** (actual) curve streamed from the time-series
container. The chart:

- renders the planned line as a flat or stepped curve depending
  on the executor (constant-vus, ramping-vus,
  constant-arrival-rate …),
- updates the actual polyline every few seconds while the run is
  in flight,
- shows a yellow cursor at the latest sample,
- freezes the actual curve at the final measured values once the
  run completes, so the same chart doubles as a post-mortem view,
- labels the y-axis as `VUs` for VU-based executors and as
  `Anfragen/s` for arrival-rate executors.

Without InfluxDB the chart still renders the planned line; the
`Ist` curve is simply not available. The same chart also appears
in the printable report (`/?report=<id>`) as the **Ramp-Grafik**
section.

## Run-detail tab strip

The detail card for a run is organised as a horizontal tab strip:

| Tab | Purpose |
| --- | --- |
| **Übersicht** | Live status, metric cards, live ramp-grafik |
| **Timeline** | Per-endpoint heat map + Gantt (see above) |
| **Aktionen** | Status-aware controls: Stop, Abort, Rerun, Copy run id, Copy report link, Open report, Download k6 script, Export raw summary, Remove from dashboard, Remove all other failed |
| **k6-Konsole** | Full k6 stdout/stderr of the run |
| **Schwellen** | Every configured k6 threshold with the measured value |
| **Konfiguration** | API, load profile, operations, run metadata |
| **Fehler-Diagnose** | Typed failure diagnosis for `FAILED` / `ABORTED` runs |
| **↗ k6-Bericht öffnen** | Opens the printable report in a new tab |

Switching tabs preserves the user's reading position so the detail
card does not jump back to the top of the page on every click.

The detailed report (`/?report=<id>`) breaks down the call distribution
**per payload** using the k6 per-payload counters so you can verify
how often each row was actually sent.

The demo specification lives at `demo/openapi-demo.yaml`. It includes GET
requests with editable query and path parameters, POST requests with a JSON
body, as well as PUT and DELETE. Four dedicated demo endpoints exercise
the four authentication schemes lasttest recognises:

- `GET /products/admin/stats` — HTTP Basic (username `alice`, password `s3cret`)
- `POST /products/search` — HTTP Bearer (token `demo-bearer-token`)
- `GET /products/lookup-by-id?id=1` — API Key in custom header (`X-API-Key: demo-api-key-12345`)
- `GET /products/me` — OAuth 2.0 access token (`Bearer demo-oauth2-token-12345`)

The demo backend is strict — every auth endpoint accepts *only* the exact
demo credentials and returns `401` for anything else, so a typo in the
pool-editor input is immediately visible in the k6 report. A yellow
"Demo-Credentials" banner appears on each of these endpoints in the UI
with a one-click **Apply to fields** button so the user does not have to
type the values by hand.

The demo also declares four `servers` entries (local demo, staging,
integration, production) so that the **Base-URL dropdown** in the load
profile card is visible immediately. Only the local entry actually
responds; the other three are placeholders to illustrate how a
multi-environment spec looks in the UI.

After a test run, the link "Open detailed k6 report in a new tab" opens a
print-optimised result view. It contains the summary, thresholds, run and
API configuration, the actually used endpoint parameters, the **ramp-grafik**
with Soll/Ist comparison (when InfluxDB is running), and detailed k6
metrics. Use "Print / Save as PDF" to archive this view directly as a PDF.

The generated k6 script and the captured console output live on the
dashboard, under the run-detail tabs **k6 script** and **k6 console**.
The script tab offers the same "Download k6 test script (.js)" action
and the matching manual start command, for example:

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

> **Note**: `./gradlew bootRun` is a blocking task — Gradle stays in
> the foreground and keeps showing a progress bar (`EXECUTING [Ns]`)
> until you press `Ctrl+C`, even though the Spring Boot app is already
> up. As soon as you see
> `Started LasttestApplicationKt in N.N seconds` in the log, the API is
> reachable on `http://localhost:8286/`. Open the dev-UI URL below in
> your browser while the Gradle process keeps running.

Then open: <http://localhost:5173>

In dev mode the Vite dev-server serves the React UI with hot-reload on
**http://localhost:5173**, and Spring Boot runs the JSON API on
**http://localhost:8286**. The backend URL does **not** serve a UI in
dev mode (it returns Spring's Whitelabel 404 page, because
`../frontend/dist/` is not built). Always open the dev-UI URL in your
browser:

- Dev-UI (Vite, hot-reload): <http://localhost:5173>
- API (Spring Boot, JSON only): <http://localhost:8286>

For a single-URL deployment where the backend serves both the API and
the UI on port 8286, use `./docker-start.sh` (or `docker compose up --build`)
instead — the Dockerfile builds `frontend/dist/` and the Spring app
serves it as static files.

To try the demo, import `demo/openapi-demo.yaml` via "Datei öffnen"
("Open file"). The write operations POST, PUT, and DELETE must be enabled
explicitly.

## Documentation

- **[`USER_GUIDE.md`](./USER_GUIDE.md)** — comprehensive, end-to-end
  English user manual covering the workflow, the demo API, the
  configuration of every endpoint, running load tests, the
  `Letzte Läufe` panel and its `× N` test counter, the run-detail
  tab strip (Übersicht · Timeline · Aktionen · k6-Konsole ·
  Schwellen · Konfiguration · Fehler-Diagnose), the per-endpoint
  timeline (heat map + Gantt), the live ramp-grafik
  (Auslastung — Soll vs Ist), the printable report view, the
  right-click run-row menu, the settings drawer for language
  switching, and troubleshooting.
- The same guides are available **inside the running application** at
  the top toolbar's **User Guide** and **README** links. They open as
  searchable markdown popups (`Ctrl/⌘ + F` to search, `Enter` for next
  match, `Shift + Enter` for previous, `Esc` to close) and follow the
  language picked in the Settings drawer.

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
logic. They cover the run-row context-menu classifier (`in-flight` /
`terminal` / `terminal-aborted`), the payload-pool helpers, the
multi-run dashboard focus picker, the per-endpoint timeline
(`EndpointTimelineTab.tsx`) helpers (window slicing, day-bucket
colouring, day-label resolution), the live ramp chart layout
(`liveRampChartLayout.ts`), the operation-stats helper, the
settings drawer / i18n dictionary parity (every key exists in both
English and German) and the toolbar / status pills / report chrome.

### Frontend E2E tests with Playwright

```bash
cd frontend
npm run test:e2e:install   # once per machine
npm run test:e2e
```

Playwright starts `docker compose up --build` when needed, uses Chromium,
and verifies import errors, file import, parameter / body / Bearer
configuration, payload strategy selection, load profile limits, successful
k6 execution, polling, the run-row right-click menu (rerun, stop, copy
actions), the multi-run dashboard focus transfer, the `Letzte Läufe`
row list and `× N` counter, the timeline tab (heatmap, Gantt bars,
window selector), the run-detail tab strip (Übersicht · Timeline ·
Aktionen · k6 console · Thresholds · Configuration · Failure
diagnosis), the live ramp-grafik (Soll vs Ist), the report in a new
tab, the print / PDF trigger, the settings drawer language switch,
and unknown report IDs. The HTML report is available at
`frontend/playwright-report/index.html`.

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
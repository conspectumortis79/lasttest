# lasttest — User Guide

> A practical, end-to-end manual for **lasttest**, the Swagger / OpenAPI
> driven load-testing workbench built on Spring Boot, React, and k6.
>
> Audience: developers, QA engineers, and SREs who want to turn an existing
> HTTP API description into a reproducible load test in minutes.

---

## Table of contents

1. [What lasttest is — and is not](#1-what-lasttest-is--and-is-not)
2. [Supported platforms](#2-supported-platforms)
3. [Installation](#3-installation)
   - 3.1 [Docker (recommended)](#31-docker-recommended)
   - 3.2 [Local development install](#32-local-development-install)
4. [First run and the demo API](#4-first-run-and-the-demo-api)
5. [The main workflow at a glance](#5-the-main-workflow-at-a-glance)
6. [Step 1 — Importing a specification](#6-step-1--importing-a-specification)
   - 6.1 [Accepted formats](#61-accepted-formats)
   - 6.2 [Swagger UI URLs](#62-swagger-ui-urls)
   - 6.3 [What is *not* an importable document](#63-what-is-not-an-importable-document)
   - 6.4 [Importing Swagger 2.0](#64-importing-swagger-20)
7. [Step 2 — Selecting and configuring endpoints](#7-step-2--selecting-and-configuring-endpoints)
   - 7.1 [Selection and destructive operations](#71-selection-and-destructive-operations)
   - 7.2 [Endpoint card anatomy](#72-endpoint-card-anatomy)
   - 7.3 [Per-endpoint parameters](#73-per-endpoint-parameters)
   - 7.4 [Request body (JSON)](#74-request-body-json)
   - 7.5 [Bearer token](#75-bearer-token)
8. [Step 3 — Choosing the load profile](#8-step-3--choosing-the-load-profile)
   - 8.1 [Base URL and server selection](#81-base-url-and-server-selection)
   - 8.2 [Virtual users and duration](#82-virtual-users-and-duration)
   - 8.3 [Limits](#83-limits)
9. [Step 4 — Running the test and reading the result](#9-step-4--running-the-test-and-reading-the-result)
   - 9.1 [Live status](#91-live-status)
   - 9.2 [Console output and raw JSON](#92-console-output-and-raw-json)
   - 9.3 [Re-running](#93-re-running)
10. [The detailed report](#10-the-detailed-report)
    - 10.1 [Opening the report](#101-opening-the-report)
    - 10.2 [Sections of the report](#102-sections-of-the-report)
    - 10.3 [Printing and exporting to PDF](#103-printing-and-exporting-to-pdf)
11. [The generated k6 script](#11-the-generated-k6-script)
    - 11.1 [Inspecting the script](#111-inspecting-the-script)
    - 11.2 [Downloading the script](#112-downloading-the-script)
    - 11.3 [Running the script outside lasttest](#113-running-the-script-outside-lasttest)
12. [CLI helper scripts](#12-cli-helper-scripts)
    - 12.1 [`start-linux.sh`](#121-start-linuxsh)
    - 12.2 [`docker-start.sh`](#122-docker-startsh)
13. [Troubleshooting](#13-troubleshooting)
14. [Glossary](#14-glossary)

---

## 1. What lasttest is — and is not

**lasttest is**

- a small web application that turns an OpenAPI / Swagger document into
  k6-based load tests,
- a *configuration UI* over the operations that the spec describes,
- a *runner* for k6 inside the same container, with live status updates
  and a printable report,
- a *generator* of self-contained, reproducible k6 scripts that you can
  re-run on any k6-capable host.

**lasttest is not**

- a k6 IDE. It generates standard k6 scripts that you can also run by
  hand.
- a multi-tenant SaaS. It is a single-binary, single-process tool.
- a security scanner or API fuzzer. It runs only the operations you
  select, with the parameters you provide.
- a long-term store for test results. Runs are kept in memory and are
  lost when the process restarts.

---

## 2. Supported platforms

`lasttest` is developed and tested on:

- **Linux** (x86_64, arm64) — primary target.
- **macOS** (Apple Silicon and Intel) — fully supported.

The official Docker image is multi-arch (`linux/amd64`, `linux/arm64`)
and runs identically on both.

**Windows is not supported.** The repository no longer ships a
Windows-specific launcher. If you need to run lasttest on Windows, use
the Docker image under WSL 2 with Docker Desktop or Rancher Desktop.
The native Windows launcher has been retired.

> ℹ️ Files removed: `start-windows.bat`, `docker-start.bat`. Use the
> Linux / macOS scripts or the Docker image.

---

## 3. Installation

You have two options. Pick the one that matches your use case.

### 3.1 Docker (recommended)

**Prerequisite:** Docker Engine 24+ with `docker compose` v2.

```bash
# build the image once
docker build -t lasttest:latest .

# run it in the background
docker run -d --name lasttest -p 8286:8286 --restart unless-stopped \
  lasttest:latest
```

Or use the bundled Compose file:

```bash
docker compose up --build -d
```

Either way, lasttest will be available at
**http://localhost:8286**.

To follow the startup log:

```bash
docker logs -f lasttest
```

To stop:

```bash
docker compose down
# or, if you started with `docker run`:
docker stop lasttest && docker rm lasttest
```

### 3.2 Local development install

**Prerequisites:**

| Tool | Version | Why |
| --- | --- | --- |
| JDK | 25 or newer | runs the Spring Boot backend |
| Node.js | 22 or newer | builds the React frontend |
| k6 | latest stable | executes the generated scripts |
| Bash | 4+ | runs the helper scripts |
| `curl` | any recent | health checks inside the scripts |

On Debian / Ubuntu:

```bash
sudo apt-get update
sudo apt-get install -y openjdk-25-jdk-headless nodejs npm curl
# k6 — see https://k6.io/docs/getting-started/installation/
sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6
```

On macOS (with [Homebrew](https://brew.sh/)):

```bash
brew install openjdk@25 node k6
# Make JDK 25 the default for the current shell:
export JAVA_HOME="$(brew --prefix openjdk@25)/libexec/openjdk.jdk/Contents/Home"
```

Then start the two services manually:

```bash
# Terminal 1 — backend on :8286
cd backend
./gradlew bootRun

# Terminal 2 — frontend on :5173
cd frontend
npm install
npm run dev
```

Or use the one-shot helper that stops any previous instance and launches
both:

```bash
./start-linux.sh
```

---

## 4. First run and the demo API

The repository ships a small but complete demo API at
`demo/openapi-demo.yaml`. It exercises the three things lasttest cares
about most:

- **GET** with query and path parameters
- **POST** with a JSON body
- **Bearer authentication**, demonstrated by `POST /products/search`

After the import, lasttest itself runs a tiny in-process server that
answers the same paths under `/demo-api/*`. That means you can do a full
end-to-end exercise — import → configure → run — without any external
dependency.

> 💡 The demo API in lasttest is **not** a real persistence layer. Data
> is generated from the URL parameters and is discarded after the
> response. It exists so that newcomers can see the full pipeline work
> on a single machine.

### Loading the demo

1. Open the app at <http://localhost:5173> (local) or
   <http://localhost:8286> (Docker).
2. The Swagger textarea is pre-populated with the bundled demo. If it is
   empty, click **Datei öffnen** and pick `demo/openapi-demo.yaml` from
   the repository.
3. Click **Validieren & importieren**.

You should see a card with six operations, four of which are
pre-selected (the read-only ones).

---

## 5. The main workflow at a glance

lasttest is structured as four numbered cards:

1. **Swagger / OpenAPI-Dokumentation** — paste or upload a spec.
2. **<title> v<version>** — select and configure endpoints.
3. **Lastprofil** — choose base URL, virtual users, and duration.
4. **Testlauf** — start, monitor, and inspect the result.

You move top-to-bottom. Each step is independent and idempotent: you can
re-import a spec, re-configure endpoints, or change the load profile
without losing the others.

---

## 6. Step 1 — Importing a specification

The first card accepts three input modes that share the same target:

1. **URL** — point lasttest at a Swagger UI page or a direct OpenAPI
   document. The backend fetches the URL, resolves the spec (extracting
   `url` / `urls` from a Swagger UI bundle if necessary), and imports
   the result.
2. **Datei** — pick a `.yaml`, `.yml`, or `.json` file from disk.
3. **Textarea** — paste raw YAML or JSON directly.

When the URL field is filled, clicking **Validieren &amp; importieren**
first calls `POST /api/specifications/fetch-url` and then transparently
validates the fetched content through the normal import endpoint. The
textarea is updated with the resolved spec so you can tweak it before
starting a test run.

### 6.1 Accepted formats

| Field | Value |
| --- | --- |
| Format | YAML or JSON (in the textarea or fetched automatically) |
| Swagger version | 2.0 |
| OpenAPI version | 3.0.x, 3.1.x |
| Encoding | UTF-8 |
| Maximum size | a few MB (the import endpoint accepts a JSON envelope with the spec as a string) |

lasttest sends the raw text to `POST /api/specifications/import`. The
server returns a normalised representation that the UI uses to render
endpoint cards.

### 6.2 Swagger UI URLs

Pointing lasttest at a Swagger UI HTML page is fully supported. The
fetcher:

- downloads the HTML,
- looks for the `url` (or first `urls[]`) entry in the
  `SwaggerUIBundle({...})` configuration,
- follows the same-origin `url` heuristic to common endpoints such as
  `/v3/api-docs`, `/v3/api-docs.yaml`, `/v2/api-docs`, `/swagger.json`,
  `/swagger.yaml`, `/openapi.json`, `/openapi.yaml` if no config is
  found,
- refuses to follow cross-origin redirects (basic SSRF protection),
- enforces a 10 s timeout and a 5 MB response cap.

The response payload includes the resolved URL and a `source` flag so
the UI can show whether the document came directly from the URL or
via a Swagger UI page.

A bundled demo Swagger UI lives at
`http://localhost:8286/demo-swagger-ui` once lasttest is running. It
serves the same `demo/openapi-demo.yaml` document so the URL feature
can be exercised end-to-end without any external system.

### 6.3 What is *not* an importable document

- A Swagger UI JSON blob with `swaggerUrl` / `urls` references but no
  inline definition.
- A Postman collection. (Postman can export OpenAPI; use that.)

If a Swagger UI URL serves neither a spec URL nor a Swagger UI bundle,
lasttest prints the missing URL convention and asks you to point at one
of the well-known endpoints instead:

- `/swagger.json` or `/swagger.yaml`
- `/v3/api-docs` (Springdoc) or `/v3/api-docs.yaml`
- `/openapi.json` (FastAPI, NestJS, and similar)

### 6.4 Importing Swagger 2.0

Swagger 2.0 is accepted on the wire and converted internally to OpenAPI
3 so that the rest of lasttest only has to deal with one model. You do
not need to convert the file yourself.

---

## 7. Step 2 — Selecting and configuring endpoints

After a successful import, lasttest renders one **operation card** per
endpoint. Each card has three states:

- **Collapsed (default)** — you see only the HTTP method, the path, and
  a one-line summary. The `▸` toggle on the right opens the card.
- **Expanded** — the full parameter / body / token editor appears below
  the heading.
- **Selected** — the checkbox on the left decides whether the endpoint
  is included in the next test run.

The summary line is always left-aligned and never moves when you open or
close the configuration. Endpoints that mutate state are flagged with a
small red **SCHREIBEND** badge in the top-right of the card, so you can
spot them at a glance without opening the card.

### 7.1 Selection and destructive operations

By default, only the read-only operations are pre-selected. Write
operations (POST, PUT, DELETE, PATCH) start **unchecked** and must be
enabled explicitly. This protects against accidental writes to a real
API.

> ⚠️ Be careful when pointing lasttest at a real environment. The
> generated k6 script will hit every selected endpoint with the
> configured parameters at the configured concurrency.

### 7.2 Endpoint card anatomy

```
┌──────────────────────────────────────────────────────────┐
│ ☐  [GET]   /products/{id}                ▸              │  ← heading
│        Produkt anhand seiner ID abrufen                  │  ← summary (left-aligned)
│  ─────────────────────────────────────────────────────   │
│  ┌──────────────────┐  ┌──────────────────┐             │  ← only when expanded
│  │ id         path  │  │ Bearer   auth    │             │
│  │ [  42         ]  │  │ [  ••••••      ] │             │
│  └──────────────────┘  └──────────────────┘             │
└──────────────────────────────────────────────────────────┘
```

### 7.3 Per-endpoint parameters

Each parameter of the operation is rendered as a labelled input. The
label always shows:

- the parameter **name**,
- the **location** (`path`, `query`, `header`, `cookie`) as a small
  code-style badge,
- a **PFLICHT** (“required”) tag when the spec marks the parameter as
  required.

Values default to the OpenAPI `example`, falling back to the schema’s
`default`, and finally to an empty string. You can clear optional
parameters; the runner simply sends an empty value.

For required parameters, lasttest refuses to start a test run until
every required field has a non-empty value. The error message names the
offending operation ID and parameter.

### 7.4 Request body (JSON)

When the operation declares a request body, the card shows a large
**JSON Request-Body** editor pre-populated with the spec’s example. You
can edit it freely; the runner validates the JSON before starting the
test. If the body is optional and you want to send no body, clear the
textarea.

### 7.5 Bearer token

The very last input on every card is a **Bearer-Token** field. Its
behaviour depends on the spec:

- If the spec defines a Bearer security scheme, the field is labelled
  `Swagger / OpenAPI Auth` and the placeholder reminds you to enter the
  token *without* the `Bearer ` prefix.
- If the spec does not define any auth, the field is still there
  (labelled `Optional für diesen Endpunkt`) so that you can add ad-hoc
  authentication to a public endpoint.

The value is sent on every iteration of the load test as
`Authorization: Bearer <token>`.

---

## 8. Step 3 — Choosing the load profile

### 8.1 Base URL and server selection

The spec’s `servers` list is used as the default. If there is more than
one entry, a dropdown appears in the load profile card so you can
choose between them. The base URL field below it always overrides the
selection — that is the place to type a custom URL, e.g. an internal
staging hostname that the spec does not know about.

To see the dropdown in action, import the bundled demo
(`demo/openapi-demo.yaml`). It declares four servers:

- `http://localhost:8286/demo-api` — the local demo (this one actually
  answers and is the recommended starting point),
- `https://staging.lasttest.example.com/demo-api` — staging,
- `https://integration.lasttest.example.com/demo-api` — integration,
- `https://api.lasttest.example.com/demo-api` — production.

Only the first URL responds; the other three are placeholders that
demonstrate how a multi-environment spec looks in the UI. They are
included so that you can exercise the dropdown without writing your
own spec.

> 💡 When you point the runner at an internal host, remember that the
> `docker compose` setup runs the test *inside* the container. `localhost`
> inside the container is not your laptop. Use the host’s routable IP
> or the special `host.docker.internal` host on Docker Desktop.

### 8.2 Virtual users and duration

| Field | Default | Notes |
| --- | --- | --- |
| Virtual Users (`vus`) | 1 | concurrent virtual users |
| Duration (seconds) | 10 | total test wall time |

The k6 script uses the `constant-vus` executor with these values, so
all VUs start together and the test runs for the full duration.

### 8.3 Limits

The MVP hard-caps both knobs to keep runaway tests from melting your
target:

- `vus`: 1 – **1000**
- `durationSeconds`: 1 – **3600**

The form will refuse to start a run outside this range and display a
clear error.

---

## 9. Step 4 — Running the test and reading the result

Click **k6-Lasttest starten**. If anything is missing (no endpoints
selected, a required parameter empty, an invalid base URL), the run is
not started and the first card with the problem is highlighted.

Once the run is accepted, the fourth card appears with:

- a coloured status badge,
- the run ID,
- a deep-link to the printable report,
- optionally, the captured k6 console output and raw JSON.

### 9.1 Live status

The status badge cycles through:

- `QUEUED` — accepted, k6 has not been spawned yet
- `RUNNING` — k6 is executing
- `COMPLETED` — the run finished, all metrics are available
- `FAILED` — the run was rejected, the spec was invalid, or k6
  crashed. The console output explains why.

The UI polls `/api/test-runs/{id}` every second while the run is
`QUEUED` or `RUNNING`, so the badge updates without a page reload.

### 9.2 Console output and raw JSON

If the run failed, the k6 stderr/stdout is captured and shown in a
collapsible **k6-Konsolenausgabe** block. For completed runs, the
**k6-JSON-Rohdaten** block contains the full summary as printed by
`k6 run --summary-export=/dev/stdout`, including every metric, every
threshold, and every sub-metric.

### 9.3 Re-running

To re-run the same scenario, change the values you want and click the
start button again. Each click produces a new run with a fresh ID and
its own report.

---

## 10. The detailed report

### 10.1 Opening the report

The card **Ausführlichen k6-Testbericht in neuem Tab öffnen** opens
`/?report=<run-id>` in a new tab. The link keeps working as long as the
process is alive — there is no token, no session, no expiry. Anyone who
knows the run ID can open the report, so treat it as semi-public.

### 10.2 Sections of the report

The printable report contains:

1. **Header** — title, status, run ID, timestamp.
2. **Summary cards** — duration, total requests, request rate, failed
   checks, average / p95 latency, data received / sent.
3. **Thresholds** — every k6 threshold, coloured green for passed and
   red for failed, with the actual measured value.
4. **Run configuration** — base URL, VUs, duration.
5. **API configuration** — every selected operation with its actual
   parameters, body, and Bearer token as sent to the target.
6. **Detailed metrics** — extended k6 metrics tables broken down per
   endpoint and per status code.
7. **Generated script** — the exact k6 script that was executed.
8. **Console output and raw JSON** — the same blocks as in the main
   UI, formatted for print.

### 10.3 Printing and exporting to PDF

The report is laid out in a print-friendly A4 style sheet. Open the
browser print dialog (`Ctrl/⌘ + P`) and pick **Save as PDF** as the
target. Margins, colours, and page breaks are tuned so that the
resulting PDF is readable on paper and on screen.

---

## 11. The generated k6 script

### 11.1 Inspecting the script

Expand the **Generiertes k6-Testskript** section at the bottom of the
report. You will see a self-contained JavaScript file that:

- imports the k6 standard modules only,
- sets the base URL, VUs, and duration from the form,
- defines one `http.request(...)` call per selected operation,
- attaches headers and a Bearer token where configured,
- applies per-parameter substitution from the form,
- records metrics in named groups so that the report can break down
  results by endpoint.

### 11.2 Downloading the script

Click **k6-Testskript herunterladen (.js)**. The file is downloaded
with the filename `lasttest-<run-id>.js`. It is also served from
`GET /api/test-runs/{id}/script` with `Content-Disposition: attachment`
— useful for CI pipelines that talk to the API directly.

> 🔒 Because the script may contain Bearer tokens or custom headers,
> treat the downloaded file as you would treat a credential: do not
> commit it, do not post it in chat, do not leave it in shared folders.

### 11.3 Running the script outside lasttest

The same script runs against any host with k6 installed:

```bash
# from the report
k6 run -e BASE_URL="https://example.test" lasttest-<run-id>.js

# if you only have the script locally and want to keep the original
# base URL embedded in it
k6 run lasttest-<run-id>.js
```

The script reads the base URL from the `BASE_URL` environment variable
first, falling back to the value that was current when the test was
started.

---

## 12. CLI helper scripts

Two thin shell scripts are shipped in the repository root to make
local iteration fast and safe.

### 12.1 `start-linux.sh`

- Detects any previous lasttest instance:
  - host processes (Java Spring Boot, Vite, npm `run dev`),
  - Docker containers whose name or image contains `lasttest`,
  - processes whose working directory or command line is inside the
    repository.
- Stops the previous instance (SIGTERM, then SIGKILL) before starting
  the new one.
- Launches the backend (`./gradlew bootRun`) and the frontend
  (`npm install && npm run dev`) in the background.
- Polls both URLs and prints a clear success banner.
- Registers a cleanup trap so that `Ctrl/⌘ + C` stops both children
  cleanly.

```bash
./start-linux.sh
# open http://localhost:5173 in a browser
```

### 12.2 `docker-start.sh`

- Runs `docker compose up -d --build`.
- Waits for the container’s healthcheck to report `healthy` (timeout
  300 s).
- Prints a success banner with the URL.
- On failure, dumps the last 80 lines of the compose log so you can
  see what went wrong.

```bash
./docker-start.sh
# open http://localhost:8286 in a browser
```

---

## 13. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `Validieren & importieren` shows an error and no endpoint cards | Spec is invalid YAML / JSON, or the spec declares a Swagger UI URL instead of the document itself | Open the file directly; for Swagger UI, download `/swagger.json` or `/v3/api-docs` instead |
| `Start` button is disabled | No endpoint is selected | Tick at least one checkbox |
| `Start` rejects with “Pflichtparameter … darf nicht leer sein.” | A required parameter is empty in the UI | Fill the highlighted field |
| `Start` rejects with “Request-Body … ist kein gültiges JSON.” | The JSON body editor contains a syntax error | Fix the JSON; the validator points at the line number |
| `BindException: Address already in use` on the backend | Another process is listening on 8286 | `./start-linux.sh` will normally clean this up; otherwise, `sudo lsof -i :8286` and stop the offending process |
| The status badge stays on `RUNNING` forever | k6 is blocked because the target is slow or unreachable | Cancel the run from the UI, or `docker compose logs lasttest` to see the k6 output |
| Report opens but shows “unbekannte Report-ID” | The lasttest process was restarted since the run finished | Test runs are in-memory only; re-run the test to get a fresh report |
| Bearer-authenticated requests come back as `401` | The placeholder misled you into including the `Bearer ` prefix | Strip the prefix; lasttest adds it for you |
| CORS error in the browser console when calling the target API | The target does not allow cross-origin requests from the frontend | lasttest runs the test from the backend, not the browser — open the report and check the k6 output; the CORS error is from the browser, not from the test |

---

## 14. Glossary

| Term | Meaning in lasttest |
| --- | --- |
| **Operation** | A single HTTP endpoint described by a path and method in the spec. |
| **Endpoint card** | The collapsible UI block that represents one operation. |
| **VU (Virtual User)** | A concurrent loop in k6 that issues requests as fast as the script allows. |
| **Iteration** | One full execution of the script by one VU. |
| **Threshold** | A k6 expression (e.g. `http_req_duration{p95:200}`) that the script evaluates at the end; pass / fail is shown in the report. |
| **Run ID** | UUID assigned to each test run; used in deep-links and for downloading the script. |
| **Spec** | The OpenAPI or Swagger document that describes the target API. |
| **Demo API** | The in-process server lasttest exposes under `/demo-api/*` so that you can exercise the full pipeline without an external dependency. |

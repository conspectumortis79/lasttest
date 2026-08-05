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
   - 3.2 [Docker with InfluxDB + Grafana (time-series)](#32-docker-with-influxdb--grafana-time-series)
   - 3.3 [Local development install](#33-local-development-install)
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
   - 8.2 [The four load-profile executors](#82-the-four-load-profile-executors)
     - 8.2.1 [Constant-VUs (default)](#821-constant-vus-default)
     - 8.2.2 [Shared-Iterations](#822-shared-iterations)
     - 8.2.3 [Ramping-VUs](#823-ramping-vus)
     - 8.2.4 [Constant-Arrival-Rate](#824-constant-arrival-rate)
   - 8.3 [Presets](#83-presets)
   - 8.4 [Editing ramping stages](#84-editing-ramping-stages)
   - 8.5 [Validation and limits](#85-validation-and-limits)
9. [Step 4 — Running the test and reading the result](#9-step-4--running-the-test-and-reading-the-result)
   - 9.1 [Live status](#91-live-status)
   - 9.2 [Console output and raw JSON](#92-console-output-and-raw-json)
   - 9.3 [Re-running](#93-re-running)
10. [The detailed report](#10-the-detailed-report)
    - 10.1 [Opening the report](#101-opening-the-report)
    - 10.2 [Sections of the report](#102-sections-of-the-report)
    - 10.3 [The ramp-grafik (load chart)](#103-the-ramp-grafik-load-chart)
    - 10.4 [Printing and exporting to PDF](#104-printing-and-exporting-to-pdf)
11. [The generated k6 script](#11-the-generated-k6-script)
    - 11.1 [Inspecting the script](#111-inspecting-the-script)
    - 11.2 [Downloading the script](#112-downloading-the-script)
    - 11.3 [Running the script outside lasttest](#113-running-the-script-outside-lasttest)
12. [CLI helper scripts](#12-cli-helper-scripts)
    - 12.1 [`start-linux.sh`](#121-start-linuxsh)
    - 12.2 [`docker-start.sh`](#122-docker-startsh)
    - 12.3 [InfluxDB-UI and Grafana](#123-influxdb-ui-and-grafana)
13. [Troubleshooting](#13-troubleshooting)
    - 13.1 [Trusting custom TLS certificates](#131-trusting-custom-tls-certificates)
    - 13.2 [InfluxDB is not reachable](#132-influxdb-is-not-reachable)
    - 13.3 [Ramp-grafik shows only the Soll line](#133-ramp-grafik-shows-only-the-soll-line)
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

### 3.2 Docker with InfluxDB + Grafana (time-series)

The standard `docker compose up` brings up only lasttest. To get the
**ramp-grafik** in the report (see [Section 10.3](#103-the-ramp-grafik-load-chart)),
you also need an InfluxDB instance where k6 streams its per-second
metrics. The Compose file ships with InfluxDB 1.11 and Grafana as
optional services. They start automatically when you use `docker compose up`
without arguments — no extra command is required.

```bash
docker compose up -d --build
```

After startup you will see three healthy containers:

| Container | Port | Purpose |
| --- | --- | --- |
| `lasttest` | 8286 | Spring Boot + frontend bundle |
| `lasttest-influxdb` | 8086 | InfluxDB 1.11, receives k6's per-second metrics |
| `lasttest-grafana` | 3000 | optional, for ad-hoc exploration of the raw time-series |

Both InfluxDB and Grafana use named volumes (`lasttest_influxdb-data`,
`lasttest_grafana-data`) so the data survives container restarts.

The credentials are baked into the image (and intentionally
non-secret because they are only relevant for local development):

| Service | URL | Credentials |
| --- | --- | --- |
| lasttest UI | http://localhost:8286 | — |
| InfluxDB UI | http://localhost:8086 | `admin` / `lasttest-admin-password` |
| Grafana | http://localhost:3000 | `admin` / `admin` (anonymous viewer enabled) |

If you do **not** want InfluxDB, pass `LASTTEST_INFLUXDB_ENABLED=false`
when starting lasttest. The ramp-grafik will then show only the Soll
line; everything else still works.

### 3.3 Local development install

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

> ⚠️  **`start-linux.sh` starts the project in dev mode.**
> Two URLs are exposed; they are **not** interchangeable:
>
> | URL | What it serves |
> | --- | --- |
> | <http://localhost:5173> | **Web-UI** (Vite dev-server with hot-reload) — open this in your browser |
> | <http://localhost:8286> | **API only** (Spring Boot, JSON) — returns Whitelabel 404 on `/` because the frontend bundle is not built in dev mode |
>
> For a single-URL deployment where the backend serves both the API and
> the UI on port 8286, use `./docker-start.sh` (or `docker compose up --build`)
> instead.

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

You should see a card with six operations (two read-only GETs and four
destructive writes). The first read-only operation is pre-selected
as a safe starting point — every other endpoint, including the
remaining read-only one, has to be ticked explicitly.

---

## 5. The main workflow at a glance

lasttest is structured as four numbered cards:

1. **Swagger / OpenAPI-Dokumentation** — paste or upload a spec.
2. **<title> v<version>** — select and configure endpoints.
3. **Lastprofil** — pick an executor (constant-vus, shared-iterations,
   ramping-vus, or constant-arrival-rate), tune the fields, optionally
   load a preset (Smoke, Load, Stress, Spike, Soak, Arrival-Rate).
4. **Testlauf** — start, monitor, and inspect the result.

You move top-to-bottom. Each step is independent and idempotent: you can
re-import a spec, re-configure endpoints, or change the load profile
without losing the others.

The report in step 4 contains a [ramp-grafik](#103-the-ramp-grafik-load-chart)
that compares the load you *planned* (Soll) with the load k6 actually
generated (Ist). The Ist line is only available when InfluxDB is
running; see [Section 3.2](#32-docker-with-influxdb--grafana-time-series).

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

By default, the **first** read-only operation is pre-selected as a
safe starting point. All other operations — including the remaining
read-only ones and every write operation (POST, PUT, DELETE, PATCH) —
start **unchecked** and must be enabled explicitly. This protects
against accidental writes to a real API and against firing multiple
endpoints in parallel when you are still exploring the spec.

> 💡 The UI uses a **single-selection** model: ticking another
> operation's checkbox replaces the current selection rather than
> adding to it. Each k6 run therefore exercises exactly one
> endpoint. To load-test a different endpoint, tick its checkbox
> and start a new run.

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

### 8.2 The four load-profile executors

The load-profile card contains a single **Executor** dropdown with four
options. They map directly to k6's executor types; pick the one that
matches what you want to learn about your target.

| Executor | k6 type | Best for |
| --- | --- | --- |
| **Konstante Last** (default) | `constant-vus` | Smoke test, steady-state load, repeatable benchmarks |
| **N Anfragen, so schnell wie möglich** | `shared-iterations` | Reproducible *request count* across releases (compare p95 between v1.2 and v1.3) |
| **Ramping-VUs** | `ramping-vus` | Spike, stress, soak; load that ramps up and down in *stages* |
| **Constant-Arrival-Rate** | `constant-arrival-rate` | Decoupling RPS from response time (the server's true throughput ceiling) |

The bottom half of the card swaps its fields automatically depending
on the selected executor. A row of one-click **presets** above the
fields pre-fills sensible values for common scenarios.

#### 8.2.1 Constant-VUs (default)

```
┌─ Schnellauswahl ──────────────────────────────────┐
│ [Smoke] [Load] [Stress] [Spike] [Soak] [Arrival] │
└────────────────────────────────────────────────┘

  Lastprofil:  ( Konstante Last  ) ▾
  Virtual Users:  [ 10    ]
  Dauer (Sekunden): [ 30    ]
```

All VUs start together and run for the full duration. The defaults
(10 VUs / 30 s) are tuned so that smoke-testing the demo spec completes
in under a minute.

#### 8.2.2 Shared-Iterations

```
  Lastprofil:  ( N Anfragen, so schnell wie möglich ) ▾
  Virtual Users:  [ 100   ]
  Iterationen:   [ 1000  ]
```

Every Virtual User fires exactly one request and the run finishes
as soon as the last response comes back. The *Iterations* field is
the total request count across all VUs.

#### 8.2.3 Ramping-VUs

This is the most flexible mode. k6 runs through a list of
**stages**; each stage has a target VU count and a duration. Between
two stages k6 ramps linearly from the previous target to the next
target during that stage's duration.

```
  Lastprofil:  ( Ramping-VUs ) ▾
  Start-VUs:    [ 0     ]
  Stages: 4          Gesamtdauer 80 s · Spitze 800 VUs
  ┌──┬───────────┬───────────┐
  │# │ Ziel-VUs  │ Dauer (s) │
  ├──┼───────────┼───────────┤
  │1 │ [    0   ]│ [   10   ]│
  │2 │ [  800   ]│ [   10   ]│
  │3 │ [  800   ]│ [   30   ]│
  │4 │ [    0   ]│ [   30   ]│
  └──┴───────────┴───────────┘
  [ + Stage hinzufügen ]
```

The example above is the **Spike** preset: 10 s at 0 VUs, then a
10 s ramp up to 800 VUs, hold the spike for 30 s, then ramp down
again. A **Plateau** (two consecutive stages with the same target)
is allowed — the example's stages 2 and 3 are a plateau at 800 VUs.

For a Soak test, use a long plateau (e.g. 50 VUs for 3 600 s).

#### 8.2.4 Constant-Arrival-Rate

```
  Lastprofil:  ( Constant-Arrival-Rate ) ▾
  Rate (Anfragen):  [ 50    ]
  pro Sekunden:     [  1    ]
  Dauer (Sekunden): [ 120   ]
  preAllocatedVUs:  [ 10    ]
  maxVUs:           [ 200   ]
```

k6 decouples the request rate from the response time: it keeps firing
exactly *N* requests per second regardless of how slow the target
gets. **preAllocatedVUs** is the size of the initial VU pool; **maxVUs**
is the upper bound k6 may grow the pool to when latency spikes. Use
this executor when you want to find the server's true throughput
ceiling — the constant-VUs executor will only find a ceiling when VUs
saturate, which mixes response-time and concurrency effects.

### 8.3 Presets

The preset row above the executor fields loads a complete profile with
one click. After loading, every field remains editable so you can
fine-tune. The presets are designed for common load-testing scenarios:

| Preset | Executor | Stages | Total duration | Use |
| --- | --- | --- | --- | --- |
| **Smoke** | constant-vus | 1 VU for 30 s | 30 s | CI pre-flight gate |
| **Load** | ramping-vus | 0 → 50 VUs over 90 s, hold 5 min, ramp down | 6.5 min | textbook k6 example |
| **Stress** | ramping-vus | stepwise 0 → 50 → 100 → 200 → 400 VUs | ~5 min | find the breaking point |
| **Spike** | ramping-vus | 0 → 800 VUs in 10 s, hold 30 s, ramp down | 80 s | Black-Friday scenario |
| **Soak** | ramping-vus | 50 VUs for 1 hour after a 5 min warm-up | ~66 min | leaks, slow degradation |
| **Anfragen** | shared-iterations | 10 VUs, 1 000 iterations | ends when done | reproduce request count across releases |
| **Arrival-Rate** | constant-arrival-rate | 50 req/s for 2 min | 2 min | decouple RPS from response time |

Hover any preset button to read its one-line description in the help
text below the row. The descriptions summarise the trade-off so you
can pick the right profile without reading the full executor docs:

| Preset | Hover description |
| --- | --- |
| **Smoke** | 1 VU für 30 s — idealer CI-Pre-Flight-Check |
| **Load** | Schrittweise auf 50 VUs, 5 min Plateau |
| **Stress** | Stufenweise bis 400 VUs, findet den Knick |
| **Spike** | Plötzlicher Sprung auf 800 VUs, 30 s Plateau |
| **Soak** | 50 VUs über eine Stunde, deckt Leaks auf |
| **Anfragen** | 1 000 Anfragen so schnell wie möglich — vergleicht Releases mit fester Request-Anzahl |
| **Arrival-Rate** | 50 Anfragen/s unabhängig von der Antwortzeit |

### 8.4 Editing ramping stages

Click **+ Stage hinzufügen** to append a stage to the end of the list.
Each stage row has:

- **Ziel-VUs** — the VU count k6 should reach at the *end* of the
  stage. k6 ramps linearly from the previous stage's target during
  the stage's duration.
- **Dauer (s)** — how long the stage lasts. Minimum 1 s, maximum 3 600 s.

Click **×** on the right of a row to remove that stage. Removing is
immediate; the remaining stages are renumbered automatically.

You can change the order of stages by editing them in sequence: k6 walks
through them in the order shown. **Plateaus are allowed** (two
consecutive stages with the same target); the validator will not
reject them.

### 8.5 Validation and limits

The validator runs on every change and rejects profiles that would
otherwise crash k6 or melt your target:

| Executor | Field | Range |
| --- | --- | --- |
| `constant-vus` | Virtual Users | 1 – 30 000 |
| `constant-vus` | Duration | 1 – 3 600 s |
| `shared-iterations` | Virtual Users | 1 – 30 000 |
| `shared-iterations` | Iterations | 1 – 1 000 000 |
| `ramping-vus` | Start-VUs | 0 – 30 000 |
| `ramping-vus` | Stage Ziel-VUs | 0 – 30 000 |
| `ramping-vus` | Stage Dauer | 1 – 3 600 s |
| `ramping-vus` | Stages | 1 – ∞ |
| `constant-arrival-rate` | Rate | 1 – 100 000 / timeUnit |
| `constant-arrival-rate` | timeUnit | 1 – 60 s |
| `constant-arrival-rate` | Duration | 1 – 3 600 s |
| `constant-arrival-rate` | preAllocatedVUs | 1 – 30 000 |
| `constant-arrival-rate` | maxVUs | preAllocatedVUs … 30 000 |

Invalid values show an inline error below the field and the **Start**
button stays disabled. Validation runs in the browser *and* on the
backend; the backend is the last line of defence so a misconfigured
profile cannot reach k6.

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

### 9.2 Diagnosis, metrics, console output and raw JSON

The status row always shows the badge plus a short hint while the run is
still in flight ("läuft seit X s", "wartet auf Executor"). When the run
settles, the card expands with three additional blocks:

1. **Diagnosis + Detail** — a one-line classification of what went wrong
   and the concrete value the user can act on. lasttest recognises the
   following categories from `run.error` and `run.summary`:

   | Diagnosis | Triggered by | Hint |
   |---|---|---|
   | Ziel nicht erreichbar | `ERR_CONNECTION_REFUSED`, "connection refused" | TCP-Target lehnt ab — Port offen? Container-Egress? |
   | DNS-Auflösung fehlgeschlagen | `ENOTFOUND`, `EAI_AGAIN` | DNS-Forwarder im Container-Netz vorhanden? |
   | TLS-Handshake fehlgeschlagen | `CERT_AUTHORITY_INVALID`, `x509`, `PKIX` | TrustStore über `LASTTEST_TRUSTSTORE_PATH` setzen (siehe §13.1) |
   | Antwortzeit zu hoch | p(95) > 1000 ms oder k6-Timeout | Server antwortet langsam — siehe §13 |
   | Viele Server-Fehler (5xx) | ≥ 5 % aller Antworten sind 5xx | Backend liefert 502/503/504 — siehe Backend-Logs |
   | Hohe Client-Fehlerrate (4xx) | ≥ 5 % aller Antworten sind 4xx | Bearer-Token / Berechtigungen prüfen |
   | k6-Skriptfehler | `ReferenceError`, `GoError`, "script exception" | OpenAPI-Definition enthält ein Feld, das lasttest nicht mappt |
   | k6 konnte nicht gestartet werden | `Cannot run program "k6"` | k6-Binary im Container / auf dem PATH vorhanden? |

2. **Metrik-Zeile** — `Requests`, `p(95)`, `Fehlerquote`, ggf.
   `Status 0 (Netzwerkfehler)`, `5xx` / `2xx` / `4xx`, sowie
   `Durchsatz` und `Daten empfangen` bei vollständig erfassten Läufen.
   Problematische Werte werden rot hervorgehoben.

3. **Bullet-Liste** — 2–4 konkrete Belege aus dem k6-Summary, z. B.
   "Endpunkt `searchProducts` antwortete 480× mit HTTP 401 — Bearer-Token
   prüfen."

Darunter bleiben die ausklappbaren Blöcke **k6-Konsolenausgabe** (volle
k6-stdout/stderr) und **k6-JSON-Rohdaten** (Summary-JSON) für die
volle Fehlersuche.

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
4. **Run configuration** — base URL, lastprofil summary, planned runtime.
5. **API configuration** — every selected operation with its actual
   parameters, body, and Bearer token as sent to the target.
6. **Lastprofil & Lastverlauf** — the **ramp-grafik** showing the
   scheduled load (Soll) and the actually achieved load (Ist) over
   time. See [Section 10.3](#103-the-ramp-grafik-load-chart) for details.
7. **Stages im Detail** — for ramping-vus profiles, a table that
   describes each stage in plain German ("+50 VUs (Rampe auf 50)",
   "Plateau", "−800 VUs (Rampe auf 0)").
8. **Statuscode-Verteilung** — exact HTTP status codes per endpoint
   (`200`, `429`, `5xx`, `err`, `other`).
9. **Detailed metrics** — extended k6 metrics tables broken down per
   endpoint and per status code.
10. **Generated script** — the exact k6 script that was executed.
11. **Console output and raw JSON** — the same blocks as in the main
    UI, formatted for print.

### 10.3 The ramp-grafik (load chart)

When the test completes, the report shows a **ramp-grafik** that
visualises the load over time. Two lines are drawn:

- **Soll (planned)** — purple, solid. Computed deterministically from
  the configured load profile. For a ramping-vus run, the line is a
  staircase: a flat segment for each stage's plateau, with linear ramps
  between consecutive stages.
- **Ist (actual)** — orange, dashed. Drawn from k6's per-second
  VU-count measurements streamed to InfluxDB during the run.

Three callout cards summarise the gap:

| Callout | Meaning |
| --- | --- |
| **Geplante Spitze** | Peak target VUs from the stages (or `virtualUsers` for constant-vus) |
| **Tatsächliche Spitze** | Highest measured VU count during the run |
| **Datenpunkte** | Number of per-second samples written to InfluxDB |

Use the gap between Geplant and Tatsächlich to see whether your target
could absorb the load you intended. A large gap (e.g. planned 800 VUs,
actual 600 VUs) means the target was saturated before k6 reached the
desired concurrency — that is the kind of information a constant-VUs
test cannot give you, because a saturating target looks identical to a
slow target at constant concurrency.

**Requirements:** the ramp-grafik requires the InfluxDB container from
[Section 3.2](#32-docker-with-influxdb--grafana-time-series) to be
running. Without InfluxDB, the report shows only the Soll line; the
Ist data is simply not available. See
[Section 13.3](#133-ramp-grafik-shows-only-the-soll-line) for
troubleshooting.

### 10.4 Printing and exporting to PDF

### 10.4 Printing and exporting to PDF

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

### 12.3 InfluxDB-UI and Grafana

When you started with `docker compose up` (rather than `docker run`),
two additional containers are running:

- **InfluxDB UI** at http://localhost:8086 — login with
  `admin` / `lasttest-admin-password`. The default bucket is `k6`.
  Useful to spot-check whether k6 actually wrote data during a run
  (you should see measurements `vus`, `http_reqs`, `http_req_duration`).
- **Grafana** at http://localhost:3000 — anonymous viewer mode is
  enabled; log in with `admin` / `admin` to make changes. The InfluxDB
  data source is pre-configured, so you can build queries and dashboards
  without re-entering credentials.

These services are intended for **local development**. For a
production deployment you would isolate them behind authentication
and use a managed time-series database.

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
| `PKIX path building failed: unable to find valid certification path to requested target` | The target API uses a TLS certificate that is not trusted by the JVM (self-signed, internal CA, missing intermediate) | See [Section 13.1 — Trusting custom TLS certificates](#131-trusting-custom-tls-certificates) |
| The ramp-grafik shows only the Soll line, no Ist line | InfluxDB is not reachable, or no data was written during the run | See [Section 13.2](#132-influxdb-is-not-reachable) and [13.3](#133-ramp-grafik-shows-only-the-soll-line) |
| k6 run logs contain `could not create the 'influxdb' output: unknown query parameter: org` | The InfluxDB image version is 2.x; k6 v2 only supports InfluxDB v1 | Use the bundled Compose file (it ships with InfluxDB 1.11) |

### 13.1 Trusting custom TLS certificates

When the target API uses a TLS certificate that is not signed by a public CA — for example a self-signed certificate in a staging environment, or a certificate issued by a corporate / internal CA — the JVM refuses the TLS handshake and lasttest reports `PKIX path building failed: unable to find valid certification path to requested target`.

Configure lasttest with an additional TrustStore that contains the missing certificate(s) or CA chain. The Java system TrustStore is still used, so public CAs keep working — only the additional certificates are layered on top.

| Variable | Required | Description |
| --- | --- | --- |
| `LASTTEST_TRUSTSTORE_PATH` | yes | Absolute path to a file containing the certificate(s). Supported formats: `PKCS12` (`.p12`, `.pfx`), `JKS` (`.jks`), or PEM (`.pem`, `.crt`, `.cer` — one or more CERTIFICATE blocks). |
| `LASTTEST_TRUSTSTORE_PASSWORD` | only for PKCS12 / JKS | Password for the TrustStore. Empty string is allowed for PEM files. |

Examples:

```bash
# PEM file with one or more CERTIFICATE blocks
export LASTTEST_TRUSTSTORE_PATH=/etc/lasttest/staging-ca.pem
export LASTTEST_TRUSTSTORE_PASSWORD=

# PKCS12 TrustStore created with keytool
export LASTTEST_TRUSTSTORE_PATH=/etc/lasttest/staging.p12
export LASTTEST_TRUSTSTORE_PASSWORD=changeit
```

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

The variables only have to be set in the environment that runs the lasttest backend (Docker container, systemd unit, terminal, …). Restart lasttest after changing them.

### 13.2 InfluxDB is not reachable

The backend probes InfluxDB at startup via `LASTTEST_INFLUXDB_URL/health`
and the run's lasttest container logs will show a warning if it is
unreachable. Common causes and their fixes:

| Cause | Fix |
| --- | --- |
| InfluxDB container not started | `docker compose up -d influxdb` |
| Wrong URL | Set `LASTTEST_INFLUXDB_URL=http://influxdb:8086` (must match the Docker network name) |
| Wrong credentials | Set `LASTTEST_INFLUXDB_USER` and `LASTTEST_INFLUXDB_PASSWORD` to match the `docker-compose.yml` defaults (`k6-writer` / `lasttest-writer-password`) |
| You use the plain `docker run` command, not Compose | InfluxDB is **not** started by `docker run`; either switch to Compose or run InfluxDB separately and point `LASTTEST_INFLUXDB_URL` at it |

If InfluxDB is unreachable, lasttest still works — you just lose the
Ist line in the ramp-grafik.

### 13.3 Ramp-grafik shows only the Soll line

Two reasons are common:

1. **InfluxDB was unreachable** (see above). The backend returns an
   empty time-series array; the SVG renderer draws only the Soll line
   and the "Tatsächliche Spitze" callout shows "–".
2. **The run was very short** (< 2 s). k6 may not have written enough
   per-second samples to InfluxDB yet. Wait for the next run.

If neither applies, check the k6 container's logs for
`could not write stats, ...` warnings — they indicate the k6 → InfluxDB
write path is broken.

---

## 14. Glossary

| Term | Meaning in lasttest |
| --- | --- |
| **Operation** | A single HTTP endpoint described by a path and method in the spec. |
| **Endpoint card** | The collapsible UI block that represents one operation. |
| **VU (Virtual User)** | A concurrent loop in k6 that issues requests as fast as the script allows. |
| **Iteration** | One full execution of the script by one VU. |
| **Executor** | The k6 strategy for issuing requests. lasttest exposes four: `constant-vus`, `shared-iterations`, `ramping-vus`, `constant-arrival-rate`. |
| **Stage** | In a Ramping-VUs profile, one row of the stages table. Each stage has a target VU count and a duration; k6 ramps linearly between consecutive stages. |
| **Soll / Ist** | "Planned / Actual" — the ramp-grafik compares the scheduled load profile (Soll, deterministic) with the measured per-second VU counts from k6 (Ist, streamed via InfluxDB). |
| **InfluxDB** | The optional time-series database that lasttest ships with. Stores per-second k6 metrics so the ramp-grafik can show the Ist line. |
| **Grafana** | The optional dashboard UI on top of InfluxDB, included in the Compose file for ad-hoc exploration. |
| **Preset** | One-click load profile in the editor: Smoke, Load, Stress, Spike, Soak, Arrival-Rate. |
| **Threshold** | A k6 expression (e.g. `http_req_duration{p95:200}`) that the script evaluates at the end; pass / fail is shown in the report. |
| **Run ID** | UUID assigned to each test run; used in deep-links and for downloading the script. |
| **Spec** | The OpenAPI or Swagger document that describes the target API. |
| **Demo API** | The in-process server lasttest exposes under `/demo-api/*` so that you can exercise the full pipeline without an external dependency. |

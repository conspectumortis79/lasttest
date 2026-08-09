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
   - 4.1 [Loading the demo](#loading-the-demo)
   - 4.2 [Toggling the demo on and off](#toggling-the-demo-on-and-off)
5. [The main workflow at a glance](#5-the-main-workflow-at-a-glance)
6. [The top toolbar, settings and language](#6-the-top-toolbar-settings-and-language)
   - 6.1 [Toolbar layout](#61-toolbar-layout)
   - 6.2 [Settings drawer (language switch)](#62-settings-drawer-language-switch)
   - 6.3 [In-app documentation popups](#63-in-app-documentation-popups)
     - 6.3.1 [Search across walkthrough steps](#631-search-across-walkthrough-steps)
7. [Step 1 — Importing a specification](#7-step-1--importing-a-specification)
   - 7.1 [Accepted formats](#71-accepted-formats)
   - 7.2 [Swagger UI URLs](#72-swagger-ui-urls)
   - 7.3 [What is *not* an importable document](#73-what-is-not-an-importable-document)
   - 7.4 [Importing Swagger 2.0](#74-importing-swagger-20)
8. [Step 2 — Selecting and configuring endpoints](#8-step-2--selecting-and-configuring-endpoints)
   - 8.1 [Selection and destructive operations](#81-selection-and-destructive-operations)
   - 8.2 [Endpoint card anatomy](#82-endpoint-card-anatomy)
   - 8.3 [Per-endpoint parameters](#83-per-endpoint-parameters)
   - 8.4 [Request body (JSON)](#84-request-body-json)
   - 8.5 [Bearer token](#85-bearer-token)
   - 8.6 [Payload pool — multiple datasets per endpoint](#86-payload-pool--multiple-datasets-per-endpoint)
9. [Step 3 — Choosing the load profile](#9-step-3--choosing-the-load-profile)
   - 9.1 [Base URL and server selection](#91-base-url-and-server-selection)
   - 9.2 [The four load-profile executors](#92-the-four-load-profile-executors)
     - 9.2.1 [Constant-VUs (default)](#921-constant-vus-default)
     - 9.2.2 [Shared-Iterations](#922-shared-iterations)
     - 9.2.3 [Ramping-VUs](#923-ramping-vus)
     - 9.2.4 [Constant-Arrival-Rate](#924-constant-arrival-rate)
   - 9.3 [Presets](#93-presets)
   - 9.4 [Editing ramping stages](#94-editing-ramping-stages)
   - 9.5 [Payload strategy — sequential vs. random](#95-payload-strategy--sequential-vs-random)
   - 9.6 [Validation and limits](#96-validation-and-limits)
10. [Step 4 — Running the test and reading the result](#10-step-4--running-the-test-and-reading-the-result)
    - 10.1 [The `Letzte Läufe` panel — multi-run dashboard](#101-the-letzte-läufe-panel--multi-run-dashboard)
    - 10.2 [The run-row action menu (right-click)](#102-the-run-row-action-menu-right-click)
    - 10.3 [Live status and the `Live · Lasttest läuft` banner](#103-live-status-and-the-live--lasttest-läuft-banner)
    - 10.4 [Diagnosis and metrics](#104-diagnosis-and-metrics)
    - 10.5 [Re-running](#105-re-running)
    - 10.6 [Run-detail tab strip](#106-run-detail-tab-strip)
    - 10.7 [Per-endpoint timeline (heat map + Gantt)](#107-per-endpoint-timeline-heat-map--gantt)
    - 10.8 [Live ramp-grafik (Auslastung — Soll vs Ist)](#108-live-ramp-grafik-auslastung--soll-vs-ist)
11. [Step 5 — Reading the detailed k6 report](#11-step-5--reading-the-detailed-k6-report)
    - 11.1 [Opening the report](#111-opening-the-report)
    - 11.2 [Visual tour of the report](#112-visual-tour-of-the-report)
    - 11.3 [The ramp-grafik (load chart)](#113-the-ramp-grafik-load-chart)
    - 11.4 [Printing and exporting to PDF](#114-printing-and-exporting-to-pdf)
12. [The generated k6 script](#12-the-generated-k6-script)
    - 12.1 [Inspecting the script](#121-inspecting-the-script)
    - 12.2 [Downloading the script](#122-downloading-the-script)
    - 12.3 [Running the script outside lasttest](#123-running-the-script-outside-lasttest)
13. [CLI helper scripts](#13-cli-helper-scripts)
    - 13.1 [`docker-start.sh`](#131-docker-startsh)
    - 13.2 [InfluxDB-UI and Grafana](#132-influxdb-ui-and-grafana)
14. [Troubleshooting](#14-troubleshooting)
    - 14.1 [Trusting custom TLS certificates](#141-trusting-custom-tls-certificates)
      - 14.1.1 [The k6 side: `SSL_CERT_FILE`](#1411-the-k6-side-ssl_cert_file)
      - 14.1.2 [Bundled Docker Compose workflow](#1412-bundled-docker-compose-workflow)
      - 14.1.3 [Verifying the certificate is loaded](#1413-verifying-the-certificate-is-loaded)
      - 14.1.4 [Local development mode](#1414-local-development-mode)
      - 14.1.5 [Limitations](#1415-limitations)
    - 14.2 [InfluxDB is not reachable](#142-influxdb-is-not-reachable)
    - 14.3 [Ramp-grafik shows only the Soll line](#143-ramp-grafik-shows-only-the-soll-line)
    - 14.4 [Right-click menu does not appear](#144-right-click-menu-does-not-appear)
15. [Glossary](#15-glossary)

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
**ramp-grafik** in the report (see [Section 11.3](#113-the-ramp-grafik-load-chart)),
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

> **Note**: `./gradlew bootRun` is a blocking task — Gradle stays in
> the foreground and keeps showing a progress bar (`EXECUTING [Ns]`)
> until you press `Ctrl+C`, even though the Spring Boot app is already
> up. As soon as you see `Started LasttestApplicationKt in N.N seconds`
> in the log, the API is reachable on `http://localhost:8286/`. Open
> the dev-UI URL below in your browser while the Gradle process keeps
> running.

In dev mode two URLs are exposed; they are **not** interchangeable:

| URL | What it serves |
| --- | --- |
| <http://localhost:5173> | **Web-UI** (Vite dev-server with hot-reload) — open this in your browser |
| <http://localhost:8286> | **API only** (Spring Boot, JSON) — returns Whitelabel 404 on `/` because the frontend bundle is not built in dev mode |

For a single-URL deployment where the backend serves both the API and
the UI on port 8286, use `./docker-start.sh` (or `docker compose up --build`)
instead.

---

## 4. First run and the demo API

The repository ships a small but complete demo API at
`demo/openapi-demo.yaml`. It exercises the four authentication
schemes lasttest recognises plus the request shapes it cares about
most:

- **GET** with query and path parameters
- **POST** with a JSON body
- **HTTP Basic** authentication, demonstrated by `GET /products/admin/stats`
- **HTTP Bearer** authentication, demonstrated by `POST /products/search`
- **API Key** in a custom header, demonstrated by `GET /products/lookup-by-id`
- **OAuth 2.0** access tokens, demonstrated by `GET /products/me`
- **OpenID Connect (OIDC)** ID tokens, demonstrated by `GET /products/my-profile`

After the import, lasttest itself runs a tiny in-process server that
answers the same paths under `/demo-api/*`. The demo backend is
strict — every auth endpoint accepts *only* the exact demo
credentials and returns `401` for anything else, so a typo in the
pool-editor input is immediately visible in the k6 report instead
of silently passing. That means you can do a full end-to-end
exercise — import → configure → run → observe the 200/401 in the
report — without any external dependency.

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

### Toggling the demo on and off

The demo is opt-in. The Settings drawer (top toolbar → **⚙ gear**)
exposes a **Demo API** master switch in its own section. Flipping the
switch is the only path that turns the demo on or off — there is no
auto-detection, no hidden default, no URL magic. The bundled
`/demo-api/*` server, the `/?demo-traffic` dashboard link in the
top toolbar, the `/demo-swagger-ui` page and the bundled
`openapi-demo.yaml` are all gated behind this single switch.

The switch is a **process-wide** setting (not per-user) and is
persisted in `localStorage` under `lasttest.demo.enabled`, so the
choice survives a page reload and a fresh tab.

**What happens when you flip the switch — in both directions:**

| Direction | Effect |
| --- | --- |
| **Off → On** (enable) | The bundled `openapi-demo.yaml` is fetched from `/api/demo-specification` and dropped into the Swagger textarea. The `Demo-API` link appears in the top toolbar (with an "active" pill while the switch stays on). `/demo-api/*` and `/demo-swagger-ui` start answering requests. |
| **On → Off** (disable) | The Swagger textarea is cleared back to the empty sample. The `Demo-API` link disappears from the toolbar. `/demo-api/*` and `/demo-swagger-ui` return 404 again. |

**Both directions trigger a full dashboard reset — exactly the same
as a page reload.** Whatever the user had on screen before the
toggle belongs to the previous session, so flipping the switch is a
hard cut:

- Every in-flight k6 run is cancelled with the same graceful
  `SIGTERM` the inline Stop button sends, so the k6 processes go
  away before the rest of the state is wiped. The cancel request
  is best-effort: if the backend already settled the run, the
  call is a no-op.
- The runs map is cleared — no rows, no detail card, no
  run-menu state.
- The imported spec is forgotten — the operations card (Step 2)
  disappears, the `selected` / `collapsed` / `operationSettings`
  sets are dropped.
- The load profile resets to the default (`constant-vus`, 10 VUs
  for 30 s). Picking a preset, switching the executor type or
  tuning the fields is reverted.
- The error and run-action banners are cleared.
- The right-click context menu on a run row, if it was open,
  is dismissed.

> 💡 **Why the reset is symmetric.** Toggling the demo means "I
> want a clean session against the demo backend". Whether the
> user is moving into the demo (off → on) or out of it (on → off)
> the previous contents of the dashboard are stale: imported
> endpoints were picked for the previous backend, the load
> profile was tuned for the previous target, and a running test
> is hitting the wrong server. Resetting the dashboard in both
> directions is the only way to keep the two mental models — "I
> am testing the demo" and "I am testing my own API" — strictly
> separate. A user who wants to keep their configuration can
> finish the current test, copy the settings out by hand, then
> flip the switch.


---

## 5. The main workflow at a glance

lasttest is structured as four numbered cards:

1. **Swagger / OpenAPI-Dokumentation** — paste or upload a spec.
2. **<title> v<version>** — select and configure endpoints.
3. **Lastprofil** — pick an executor (constant-vus, shared-iterations,
   ramping-vus, or constant-arrival-rate), tune the fields, optionally
   load a preset (Smoke, Load, Stress, Spike, Soak, Arrival-Rate).
4. **Testlauf** — start, monitor, and inspect the result. The run
   list (`Letzte Läufe` panel) shows every k6 run from the current
   session as a row with a `× N` test counter. The detail card uses
   a tab strip (Übersicht · Timeline · Aktionen · k6-Konsole ·
   Schwellen · Konfiguration · Fehler-Diagnose). The **Übersicht**
   tab shows the **live ramp-grafik** (`Auslastung — Soll vs Ist`)
   while the run is in flight; the **Timeline** tab shows a
   per-endpoint heat map + Gantt of every historical run for the
   same operation.

You move top-to-bottom. Each step is independent and idempotent: you can
re-import a spec, re-configure endpoints, or change the load profile
without losing the others.

The report in step 4 contains a [ramp-grafik](#113-the-ramp-grafik-load-chart)
that compares the load you *planned* (Soll) with the load k6 actually
generated (Ist). The Ist line is only available when InfluxDB is
running; see [Section 3.2](#32-docker-with-influxdb--grafana-time-series).
The same chart also lives on the **Übersicht** tab of the dashboard
as a live SVG that updates while the run is in flight — see
[§10.8](#108-live-ramp-grafik-auslastung--soll-vs-ist).

---

## 6. The top toolbar, settings and language

A sticky bar runs along the top of the application. It contains the
brand mark, the primary navigation, a passive language pill, and the
settings button. The toolbar chrome itself follows the language picked
in the settings drawer (see [Section 6.2](#62-settings-drawer-language-switch)),
so the same UI surfaces English or German labels without a page reload.

### 6.1 Toolbar layout

```
┌───────────────────────────────────────────────────────────────────────┐
│ [k6] lasttest     Dashboard  User Guide  README   …  🇬🇧 EN   ⚙        │
└───────────────────────────────────────────────────────────────────────┘
```

| Element | Purpose |
| --- | --- |
| **k6 mark + lasttest** | Static brand; the mark uses the same colour as the k6 logo to signal that lasttest is the load-test workbench built around k6. |
| **Dashboard** | Placeholder link that always represents the current card view. Marked as `aria-current="page"`. |
| **User Guide** | Opens the bundled `USER_GUIDE.md` as a searchable markdown popup — see [Section 6.3](#63-in-app-documentation-popups). |
| **README** | Opens the bundled `README.md` as a searchable markdown popup. |
| **🇬🇧 EN** (language pill) | Read-only display of the active language; the icon and code change with the selection (🇩🇪 DE for German). Pressing the gear next to it is the supported way to change the language. |
| **⚙ gear** | Opens the [settings drawer](#62-settings-drawer-language-switch). |

The toolbar is keyboard-accessible (`tabindex` flows from left to
right) and screen-reader friendly (`aria-label`s name every
control). It is rendered by `TopToolbar.tsx`; the popup is rendered by
`DocPopup.tsx`. Both live in `frontend/src/`.

### 6.2 Settings drawer (language switch)

Clicking the gear opens a slide-in drawer from the right edge of the
viewport. The drawer is modal: it traps focus while open, closes on
`Esc`, on backdrop click, and on the close button. The drawer
exposes three sections — **Language**, **Notifications** and
**Demo API** — so every user-facing toggle lives in one place. The
Language section is the only one that affects localisation chrome;
the other two are described in their own sub-sections.

**Switching language, step by step:**

1. Click the **⚙ gear** in the top toolbar. The drawer slides in from
   the right and focus moves to the close button.
2. Under the heading **Language** you see two radio rows:
   - **🇬🇧 English** — labelled `Default` on the right.
   - **🇩🇪 Deutsch** — labelled `German` on the right.
3. Click the radio of your choice. The whole UI re-renders immediately:
   toolbar labels, settings copy, walkthrough, status pills, error
   messages and the markdown documentation popups all flip to the new
   language.
4. The selection is **persisted in `localStorage`** under the key
   `lasttest.language`. Reloading the page or revisiting lasttest in
   a fresh tab keeps the language you picked.
5. Close the drawer with `Esc`, the close button, or a click on the
   dimmed backdrop.

> 💡 **Toggling the Demo API.** The third section of the drawer
> carries the **Demo API** master switch. Flipping it on enables
> the bundled `/demo-api/*` server and the `/?demo-traffic`
> dashboard link; flipping it off disables both. **Both
> directions wipe the dashboard** — every running k6 test is
> cancelled (the same graceful `SIGTERM` the inline Stop button
> sends), the imported spec is forgotten and the load profile
> resets to the default. The full behaviour is documented in
> [Section 4.2](#toggling-the-demo-on-and-off). The choice is
> persisted in `localStorage` under `lasttest.demo.enabled`.

> 💡 **Worked example — switching to German for a demo session:** you
> start lasttest in English because the README pointed you here. For
> a sales call with a German-speaking team you want every label in
> German: click ⚙, pick **🇩🇪 Deutsch**, close the drawer. The
> toolbar now shows `Dashboard / User Guide / README / DE`, the
> status pills render `EINGEREIHT`, `LÄUFT`, `GESTOPPT`, `BESTANDEN`,
> `FEHLGESCHLAGEN`, `ABGEBROCHEN`, and the right-click menu on a run
> badge says **Erneut ausführen** instead of *Rerun*. Reload the
> page — German is still active. To go back to English, click ⚙
> again and pick **🇬🇧 English**.

The drawer is implemented by `SettingsDrawer.tsx`. The radio entries
are read from a single registry (`i18nRegistry.ts`) so adding a third
language is a one-file change: add the code to `SUPPORTED_LANGUAGES`
and mirror the keys in the dictionary in `i18n.ts`.

### 6.3 In-app documentation popups

The **User Guide** and **README** links open the corresponding markdown
file as a centred modal popup. The popup is bilingual: it reads the
`USER_GUIDE.md` / `USER_GUIDE.de.md` (or README pair) matching the
active language. The header shows the document title, the canonical
filename, a search field, a hit counter (`n matches`), prev / next
match arrows, and a close button.

The search field works the same way for **both** documents. For the
README it scans the rendered markdown HTML; for the User Guide it
scans the interactive walkthrough (see
[Section 6.3.1](#631-search-across-walkthrough-steps) below for the
walkthrough-specific behaviour).

**Keyboard shortcuts inside the popup:**

| Shortcut | Action |
| --- | --- |
| `Esc` | Close the popup |
| `Ctrl/⌘ + F` | Move focus into the search field |
| `Enter` | Jump to the next match |
| `Shift + Enter` | Jump to the previous match |
| Click outside (backdrop) | Close the popup |

**Live search, step by step:**

1. Open a doc (toolbar → **User Guide** or **README**).
2. Click the search field (or press `Ctrl/⌘ + F`). Type a few
   characters — every match in headings, paragraphs, list items and
   code blocks is highlighted in yellow; the counter in the header
   updates as you type. The yellow highlight uses the
   `.doc-search-hit` CSS class with `rgba(245, 158, 11, .4)` so it
   stays legible on the dark theme.
3. The popup **scrolls to the first match** and gives it a 1.2 s
   pulse (`.doc-search-hit--active` class, brighter yellow with an
   outline) so you can spot it on long pages.
4. Press `Enter` to jump to the next match, `Shift + Enter` to go
   back. The focused match gets the same pulse on every step.
5. Clear the field to remove all highlights; close the popup with
   `Esc` or the X button when you are done.

> 💡 **Worked example — finding a phrase in the User Guide:** you
> want to re-read the section about the **payload strategy**. Open
> the User Guide popup (toolbar → **User Guide**), press
> `Ctrl/⌘ + F`, type *payload*. The counter says, e.g., *3
> matches*; the first hit is in the tab labels of step 2. The
> popup scrolls to the hit, highlights it yellow, and pulses it.
> Press `Enter` twice to walk through the remaining hits — one in
> the step-2 intro, one in the annotation body. The yellow
> highlights stay so you can see the full context.

> 💡 **Worked example — search across walkthrough tabs:** you
> type *force* in the User Guide search. The match is in step 4's
> annotation about *Force abort* but the walkthrough is currently
> on step 1. The popup automatically switches the active step to
> step 4 (the user-visible tab at the top changes) **before** it
> scrolls to the match, so the match is already laid out and
> visible. The yellow highlight and the 1.2 s pulse mark the
> matched text. No extra click required.

#### 6.3.1 Search across walkthrough steps

The User Guide is a four-step walkthrough (import → endpoints →
load profile → test runs). Internally all four steps are
rendered into the DOM at all times so the search can scan every
step's text content in a single pass; the inactive three carry
the `hidden` attribute so they take no layout space.

When a match lands in a non-active step:

1. The popup asks the walkthrough to switch its active step to
   the one that contains the match (via the `focusStepId` prop).
2. The walkthrough re-renders with the new step visible.
3. After one animation frame (enough for React's commit and the
   browser's layout pass), the popup scrolls the match into
   view and applies the yellow pulse.

The previous/next buttons (`Enter` / `Shift + Enter`) and the
counter (e.g. *3 matches*) work across all four tabs, so the
user can walk through every match in document order without
manually switching tabs.

The popup is implemented by `DocPopup.tsx`. The doc registry lives in
`docs.ts` and `docsRegistry.ts`; the markdown bodies are bundled at
build time via Vite's `?raw` import suffix so the popup works without
a backend round-trip. The pure search helpers (`buildSearchRegex`,
`highlightTextNodes`, `clearHighlights`, `collectHits`) live in
`docSearch.ts` so they can be unit-tested without rendering React.

---

## 7. Step 1 — Importing a specification

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

### 7.1 Accepted formats

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

### 7.2 Swagger UI URLs

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

### 7.3 What is *not* an importable document

- A Swagger UI JSON blob with `swaggerUrl` / `urls` references but no
  inline definition.
- A Postman collection. (Postman can export OpenAPI; use that.)

If a Swagger UI URL serves neither a spec URL nor a Swagger UI bundle,
lasttest prints the missing URL convention and asks you to point at one
of the well-known endpoints instead:

- `/swagger.json` or `/swagger.yaml`
- `/v3/api-docs` (Springdoc) or `/v3/api-docs.yaml`
- `/openapi.json` (FastAPI, NestJS, and similar)

### 7.4 Importing Swagger 2.0

Swagger 2.0 is accepted on the wire and converted internally to OpenAPI
3 so that the rest of lasttest only has to deal with one model. You do
not need to convert the file yourself.

---

## 8. Step 2 — Selecting and configuring endpoints

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

### 8.1 Selection and destructive operations

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

### 8.2 Endpoint card anatomy

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

### 8.3 Per-endpoint parameters

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

### 8.4 Request body (JSON)

When the operation declares a request body, the card shows a large
**JSON Request-Body** editor pre-populated with the spec’s example. You
can edit it freely; the runner validates the JSON before starting the
test. If the body is optional and you want to send no body, clear the
textarea.

### 8.5 Authentication

`lasttest` recognises the four most common authentication schemes
declared in a Swagger 2.0 or OpenAPI 3 document. Each recognised
scheme adds a dedicated credential input to the endpoint card
(visible only when the operation references that scheme), and the
yellow *demo banner* lights up on the four bundled demo endpoints so
the user can copy the demo secrets into the input with one click.

| Scheme | Spec declaration | Wire format | Demo endpoint | Demo credentials |
|---|---|---|---|---|
| **HTTP Basic** (RFC 7617) | `type: http, scheme: basic` | `Authorization: Basic <base64(user:pass)>` | `GET /products/admin/stats` | `alice` / `s3cret` |
| **HTTP Bearer** (RFC 6750) | `type: http, scheme: bearer` | `Authorization: Bearer <token>` | `POST /products/search` | `demo-bearer-token` |
| **API Key in custom header** | `type: apiKey, in: header, name: X-…` | `X-…: <key>` | `GET /products/lookup-by-id?id=1` | `X-API-Key: demo-api-key-12345` |
| **OAuth 2.0** (RFC 6749, RFC 6750) | `type: oauth2, flows: {…}` | `Authorization: Bearer <access_token>` | `GET /products/me` | `Bearer demo-oauth2-token-12345` |
| **OpenID Connect** (OIDC, identity layer on top of OAuth 2.0) | `type: openIdConnect, openIdConnectUrl: <discovery-URL>` | `Authorization: Bearer <id_token>` | `GET /products/my-profile` | `Bearer demo-oidc-id-token-12345` |

The legacy `apiKey in: query`, `apiKey in: cookie` and
mutual-TLS schemes are reported in the import as *unsupported* (so
the user sees which scheme was detected, even if lasttest does not
yet know how to use it). They can always be added manually as a
regular header parameter on the operation card.

#### 8.5.1 HTTP Basic

When the operation's `security` list references a Basic auth
securityScheme, the card renders two password-style inputs labelled
**Username** and **Password** under the column header `Basic auth`.
The k6 script emits `Authorization: Basic <base64(username:password)>`.
Whitespace around the credentials is trimmed; an empty username
*and* empty password is treated as "not configured" so the
generator omits the `Authorization` header entirely (the demo
backend then responds `401`).

#### 8.5.2 HTTP Bearer

A dedicated password-style input labelled **Bearer** is rendered
under the column header `Bearer`. The k6 script emits
`Authorization: Bearer <token>`. The user types the raw token; the
`Bearer ` prefix is added by the generator. An empty token omits
the header.

#### 8.5.3 API Key in a custom header

A single password-style input is rendered under the column header
`API key`. The k6 script emits the *spec-declared header name* with
the value the user typed. For the spec
`apiKeyAuth: { type: apiKey, in: header, name: X-API-Key }` the
generated request carries `X-API-Key: <key>`. An apiKey in the
`Authorization` header is detected as plain Bearer instead (the
historical convention).

#### 8.5.4 OAuth 2.0

OAuth 2.0 access tokens ride the same Bearer wire format as plain
Bearer (RFC 6750). lasttest renders a separate password-style input
under the column header `OAuth 2.0` so the user types the access
token in a dedicated slot, but the generated script still emits
`Authorization: Bearer <access_token>`. The yellow demo banner
additionally shows the *flow name* (e.g. `clientCredentials`) and
the *scopes* (e.g. `read:products, write:products`) declared in the
securityScheme's `flows` object, so the user knows which scopes
their token is allowed to exercise.

#### 8.5.5 OpenID Connect (OIDC)

OpenID Connect is the identity layer on top of OAuth 2.0. The
spec declares it as `type: openIdConnect, openIdConnectUrl: <URL>`
where the URL points to the OP's discovery document (the
`.well-known/openid-configuration` endpoint). From the k6
generator's point of view an OIDC ID token rides exactly the same
`Authorization: Bearer <id_token>` header (RFC 6750) as Bearer and
OAuth 2.0 — the `openIdConnect` subtype is split out because the
banner shows the discovery URL and the typical OIDC scopes
(`openid`, `profile`, `email`, …) so the user can see at a glance
that the token came from an OIDC provider rather than a plain
OAuth 2.0 authorization server.

lasttest renders a separate password-style input under the column
header `OIDC` so the user types the ID token in a dedicated slot,
but the generated k6 script still emits
`Authorization: Bearer <id_token>`. The yellow demo banner
additionally shows the **discovery URL** declared on the security
scheme and the **scopes** (`openid, profile, email` for the
bundled demo) so the user can verify that the ID token was
issued for the right audience.

#### 8.5.6 Per-endpoint configuration

A single endpoint can declare more than one requirement via the
spec's `security` list. lasttest surfaces every requirement in the
order the spec declares it and renders one credential column per
type. The pool editor treats each input as a separate cell — for
example an endpoint with `security: [{ basicAuth: [] }, {
apiKeyAuth: [] }]` gets both a `Basic auth` column (username +
password) and an `API key` column. The legacy single-token field
(`Optional für diesen Endpunkt`) is still shown when no security
scheme is declared, so the user can add ad-hoc authentication to a
public endpoint.

The yellow *Demo-Credentials* banner is hardcoded to the four demo
endpoints and is **only** shown on those. It surfaces the demo
credentials in monospace plus a one-click **In Felder übernehmen**
button that copies the values into the input fields. The banner is
the fastest way to verify that the spec is wired up correctly
without copy-pasting the demo secrets by hand.

### 8.6 Payload pool — multiple datasets per endpoint

By default an endpoint card contains a **single dataset** (one set of
parameter values, one request body, one Bearer token). lasttest also
supports a **payload pool**: a list of distinct datasets that k6 walks
through according to the strategy chosen in the load profile card
(see [Section 9.5](#95-payload-strategy--sequential-vs-random)). Use
this when you want to load-test with a mix of inputs (e.g. several
product IDs, several search queries, several bodies) instead of hitting
the same request a thousand times.

**Adding rows to the pool:**

1. Open the endpoint card (click the chevron on the right of the
   heading).
2. The card body now shows a table whose first row is the existing
   dataset. Each column is one parameter, the JSON body, or the
   Bearer token; the leftmost column shows the row index.
3. Click **+ Payload hinzufügen** below the table. A new row appears,
   pre-populated with a **clone** of the first row's values so you can
   tweak only the fields you care about.
4. Edit the new row's cells. Validation runs row-by-row; required
   parameters and required bodies stay enforced per row.
5. Remove a row with the **×** button on the right. The **last row
   stays** — lasttest enforces that at least one payload is present
   so the legacy single-dataset layout always works.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ☐  [POST]  /products/search                              ▾               │
│        Produkt nach Schlüsselwort suchen                                 │
│  ────────────────────────────────────────────────────────────────────    │
│ # │ q (query) | locale (query) | limit (query) | Bearer                  │
│ 1 │ [ book    ]| [ de          ]| [  10     ]  | [ •••••• ]               │
│ 2 │ [ shoe    ]| [ de          ]| [  10     ]  | [ •••••• ]  ×            │
│ 3 │ [ pen     ]| [ en          ]| [  10     ]  | [ •••••• ]  ×            │
│ [ + Payload hinzufügen ]                                                 │
└──────────────────────────────────────────────────────────────────────────┘
```

> 💡 **Worked example — search across multiple keywords:** you want to
> exercise the demo's `POST /products/search` with three different
> queries (`book`, `shoe`, `pen`) without changing the Bearer token.
> Open the card, add two rows via **+ Payload hinzufügen**, fill in the
> `q` column for each row, leave everything else as the clone. With
> `Sequential` strategy, k6 walks the rows top-to-bottom; with `Random`
> it picks one row per iteration. The detailed report breaks the call
> distribution down per row in the **Tatsächliche Aufrufverteilung**
> section, so you can verify how often each query actually fired.

The pool is stored on the backend as an ordered list of `payloads`
inside the operation settings. The frontend keeps a flat
`parameterValues` / `requestBodyJson` / `bearerToken` view in sync
with `payloads[0]` so the legacy single-dataset code path (validator,
k6 config builder, single-payload scripts) keeps working without further
refactors. The detail report shows the pool size as
`{n} payloads in pool` and renders a `Note` for older runs that pre-date
the feature.

---

## 9. Step 3 — Choosing the load profile

### 9.1 Base URL and server selection

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

### 9.2 The four load-profile executors

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

#### 9.2.1 Constant-VUs (default)

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

#### 9.2.2 Shared-Iterations

```
  Lastprofil:  ( N Anfragen, so schnell wie möglich ) ▾
  Virtual Users:  [ 100   ]
  Iterationen:   [ 1000  ]
```

Every Virtual User fires exactly one request and the run finishes
as soon as the last response comes back. The *Iterations* field is
the total request count across all VUs.

#### 9.2.3 Ramping-VUs

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

#### 9.2.4 Constant-Arrival-Rate

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

### 9.3 Presets

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
| **Burst** | shared-iterations | 10 VUs, 1 000 iterations | ends when done | reproduce request count across releases |
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
| **Burst** | 1 000 Anfragen so schnell wie möglich — vergleicht Releases mit fester Request-Anzahl |
| **Arrival-Rate** | 50 Anfragen/s unabhängig von der Antwortzeit |

### 9.4 Editing ramping stages

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

### 9.5 Payload strategy — sequential vs. random

In the load-profile card, next to the **Base URL** field, sits a
**Payload-Strategie** panel with two radio options:

| Strategy | What it does | When to pick it |
| --- | --- | --- |
| **Sequenziell** *(default)* | Each request uses the next row of the payload pool, wrapping around at the end. With a single-row pool this is the only behaviour that makes sense and it is identical to **Random**. | Reproducible request counts (e.g. every keyword in the pool fires exactly the same number of times), debugging specific failures against a known payload. |
| **Zufällig** | Each iteration picks one row at random. With a single-row pool this is identical to **Sequenziell**. | Realistic traffic mixes, fuzzing-style input variability, when you want to test "whatever users actually do" rather than a deterministic sequence. |

The strategy is persisted as part of the load profile and sent to the
backend with every test run. When the field is omitted on the wire,
the backend defaults to `sequential` (which is also the only behaviour
that makes sense for a single-payload pool, i.e. the legacy
single-dataset layout). The detailed report does **not** aggregate
the pool rows into one number; it shows the **Tatsächliche
Aufrufverteilung** table with one row per payload so you can verify
how often each row actually fired under the chosen strategy.

> 💡 **Worked example — comparing strategies on the demo:** with the
> pool from [Section 8.6](#86-payload-pool--multiple-datasets-per-endpoint)
> (`q` ∈ `book`, `shoe`, `pen`) and a 60 s `constant-vus` profile
> (10 VUs), pick **Sequenziell** first. The report's distribution
> table will show each row with roughly the same call count (drained
> round-robin). Switch to **Zufällig** and rerun (right-click →
> *Rerun*); the same rows now show uneven counts that follow the
> binomial distribution. Same pool, same target — only the order in
> which k6 pulls rows changes.

### 9.6 Validation and limits

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

## 10. Step 4 — Running the test and reading the result

Click **k6-Lasttest starten**. If anything is missing (no endpoints
selected, a required parameter empty, an invalid base URL), the run is
not started and the first card with the problem is highlighted.

Once the run is accepted, the fourth card appears with:

- a **`Letzte Läufe` panel** (one row per run started in the current
  session, with a `× N` test counter per endpoint),
- the run-detail card for the focused run, organised as a tab strip
  (Übersicht · Timeline · Aktionen · k6-Konsole · Schwellen ·
  Konfiguration · Fehler-Diagnose · ↗ k6-Bericht),
- a deep-link to the printable report.

### 10.1 The `Letzte Läufe` panel — multi-run dashboard

Every k6 run you start in the current session appears as a compact
**row** in the `Letzte Läufe` panel above the detail card. The row is
the focus target — a single left-click moves the detail card to that
run, and a right-click opens the action menu (see
[Section 10.2](#102-the-run-row-action-menu-right-click)). A
status-coloured stripe on the left edge encodes the run state:

| Status | Stripe colour | Meaning |
| --- | --- | --- |
| `QUEUED` / `RUNNING` / `STOPPING` | orange | The run is still owned by the k6 process. |
| `COMPLETED` | green | k6 exited normally; metrics are available. |
| `FAILED` | red | The spec was invalid, k6 crashed, or the target was unreachable. |
| `STOPPED` | purple | You asked for a graceful stop (`SIGTERM`); k6 wound down cleanly. |
| `ABORTED` | dark red | You escalated to `SIGKILL` (or `STOPPING` was followed by `force`); metrics may be partial. |

```svg
<svg viewBox="0 0 600 220" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="600" height="220" fill="#0b1220" rx="8"/>
  <text x="20" y="28" fill="#dbe5f3" font-family="Inter, sans-serif" font-size="13" font-weight="600">Letzte Läufe</text>
  <text x="120" y="28" fill="#93a2b8" font-family="Inter, sans-serif" font-size="11">Lasttest Demo API runs</text>
  <rect x="500" y="14" width="80" height="20" fill="#111b29" stroke="#2c3a52" rx="4"/>
  <text x="540" y="28" text-anchor="middle" fill="#93a2b8" font-family="Inter, sans-serif" font-size="10">Filter</text>
  <line x1="20" y1="46" x2="580" y2="46" stroke="#2c3a52" stroke-width="1"/>

  <!-- Row 1: COMPLETED (active row) -->
  <rect x="20" y="56" width="560" height="46" fill="#15233a" stroke="#2c3a52" rx="4"/>
  <rect x="20" y="56" width="3" height="46" fill="#22c55e"/>
  <circle cx="36" cy="79" r="5" fill="#22c55e"/>
  <rect x="48" y="71" width="36" height="16" fill="#0b3a25" stroke="#22c55e" rx="3"/>
  <text x="66" y="82" text-anchor="middle" fill="#8fe8c1" font-family="Inter, sans-serif" font-size="9" font-weight="600">GET</text>
  <rect x="90" y="71" width="76" height="16" fill="#0d3320" rx="8"/>
  <text x="128" y="82" text-anchor="middle" fill="#8fe8c1" font-family="Inter, sans-serif" font-size="9" font-weight="600">COMPLETED</text>
  <text x="174" y="82" fill="#dbe5f3" font-family="monospace" font-size="11">/products/me</text>
  <rect x="306" y="71" width="34" height="16" fill="#1f2a3d" rx="3"/>
  <text x="323" y="82" text-anchor="middle" fill="#93a2b8" font-family="Inter, sans-serif" font-size="9">× 4</text>
  <text x="174" y="96" fill="#93a2b8" font-family="Inter, sans-serif" font-size="10">10 VUs · 30 s · <tspan fill="#fb923c">right-click</tspan> for actions</text>
  <text x="475" y="78" text-anchor="end" fill="#dbe5f3" font-family="monospace" font-size="11">00:32 / ~00:30</text>
  <text x="572" y="78" text-anchor="end" fill="#93a2b8" font-family="Inter, sans-serif" font-size="10">just now</text>

  <!-- Row 2: RUNNING -->
  <rect x="20" y="108" width="560" height="46" fill="#0b1220" stroke="#2c3a52" rx="4"/>
  <rect x="20" y="108" width="3" height="46" fill="#fb923c"/>
  <circle cx="36" cy="131" r="5" fill="#fb923c"/>
  <rect x="48" y="123" width="46" height="16" fill="#3a2a0b" stroke="#fb923c" rx="3"/>
  <text x="71" y="134" text-anchor="middle" fill="#fb923c" font-family="Inter, sans-serif" font-size="9" font-weight="600">POST</text>
  <rect x="100" y="123" width="62" height="16" fill="#3a2a0b" rx="8"/>
  <text x="131" y="134" text-anchor="middle" fill="#fb923c" font-family="Inter, sans-serif" font-size="9" font-weight="600">RUNNING …</text>
  <text x="170" y="134" fill="#dbe5f3" font-family="monospace" font-size="11">/products/search</text>
  <rect x="306" y="123" width="34" height="16" fill="#1f2a3d" rx="3"/>
  <text x="323" y="134" text-anchor="middle" fill="#93a2b8" font-family="Inter, sans-serif" font-size="9">× 7</text>
  <text x="170" y="148" fill="#93a2b8" font-family="Inter, sans-serif" font-size="10">20 VUs · 60 s · <tspan fill="#fb923c">right-click</tspan> for actions</text>
  <text x="475" y="130" text-anchor="end" fill="#dbe5f3" font-family="monospace" font-size="11">00:18 / ~01:00</text>
  <text x="572" y="130" text-anchor="end" fill="#93a2b8" font-family="Inter, sans-serif" font-size="10">2 min ago</text>

  <!-- Row 3: FAILED -->
  <rect x="20" y="160" width="560" height="46" fill="#0b1220" stroke="#2c3a52" rx="4"/>
  <rect x="20" y="160" width="3" height="46" fill="#ef4444"/>
  <circle cx="36" cy="183" r="5" fill="#ef4444"/>
  <rect x="48" y="175" width="36" height="16" fill="#3a0b0b" stroke="#ef4444" rx="3"/>
  <text x="66" y="186" text-anchor="middle" fill="#ffb5c3" font-family="Inter, sans-serif" font-size="9" font-weight="600">GET</text>
  <rect x="90" y="175" width="60" height="16" fill="#3a0b0b" rx="8"/>
  <text x="120" y="186" text-anchor="middle" fill="#ffb5c3" font-family="Inter, sans-serif" font-size="9" font-weight="600">FAILED</text>
  <text x="158" y="186" fill="#dbe5f3" font-family="monospace" font-size="11">/products/admin/stats</text>
  <rect x="334" y="175" width="42" height="16" fill="#1f2a3d" rx="3"/>
  <text x="355" y="186" text-anchor="middle" fill="#93a2b8" font-family="Inter, sans-serif" font-size="9">× 2</text>
  <text x="158" y="200" fill="#93a2b8" font-family="Inter, sans-serif" font-size="10">10 VUs · 30 s · <tspan fill="#fb923c">right-click</tspan> for actions</text>
  <text x="475" y="182" text-anchor="end" fill="#dbe5f3" font-family="monospace" font-size="11">exit 1</text>
  <text x="572" y="182" text-anchor="end" fill="#93a2b8" font-family="Inter, sans-serif" font-size="10">5 min ago</text>
</svg>
```

A row in the list contains:

- the HTTP method as a coloured chip (green GET, brown POST, blue
  PUT/PATCH, red DELETE),
- the run status as a coloured badge,
- the operation path as monospace,
- a small **× N** chip showing how many times the same endpoint
  has already been tested (powered by `/api/operations/stats`),
- a one-line meta string (`10 VUs · 30 s`),
- the elapsed/planned duration column,
- a relative `when` stamp on the right (`just now`, `5 min ago`,
  `yesterday` …).

Focus transfer rules (see `runDashboard.pickActiveRunId`):

- **Starting a new run** focuses the new row (so the user sees
  live status immediately).
- **Rerunning via right-click** follows the same rule — the fresh
  row becomes active.
- **Clicking another row** focuses it. The previously focused run
  keeps polling until it reaches a terminal state, but the detail
  card only shows the focused one.
- **Stopping / aborting via right-click** does not move focus; the
  user keeps watching the same run as it transitions.

#### 10.1.1 The `× N` test counter

The `× N` chip next to each row's operation name comes from
`/api/operations/stats`, which is polled every 5 s while the
panel is mounted. The chip is data-driven by `useOperationStats`:

- shows the literal number when the same `(method, path)` pair
  has been tested before (e.g. `× 4`),
- falls back to `neu` (untested) when the backend has not yet
  answered, so the panel still works on cold start, offline, or
  when the backend is down,
- updates immediately after a new run is queued so the user
  sees the counter tick up without waiting for the next polling
  cycle.

The chip is purely informational; it does not affect run state
or focus. Hovering it surfaces the title *„This endpoint has
been tested N× in total"* (or *„This endpoint has not been
tested yet"* for `neu`).

#### 10.1.2 Right-clicking a row opens the action menu

Every row in the panel responds to a **right-click**: a small
context menu appears at the cursor position with a focused list of
actions for that run. The left-click is reserved for *focusing*
the run; the right-click is reserved for *acting on* it. `Esc` or
any click outside the menu closes it.

The visible items adapt to the run's current status — the full
reference with HTTP endpoints, keyboard shortcuts and disabled-state
rules lives in
[Section 10.2](#102-the-run-row-action-menu-right-click). Quick
overview of what the right-click exposes:

**For `QUEUED` / `RUNNING` / `STOPPING` runs (the run is still owned by k6):**

| Item | What it does |
| --- | --- |
| **Show live details** | Focuses the row (same as left-click). |
| **Copy run id** | Copies the run's UUID to the clipboard. |
| **Open k6 web report** | Opens the printable report in a new tab. |
| **Stop (graceful)** | Sends `SIGTERM`; k6 winds down, the run ends as `STOPPED`. |
| **Force abort** | Sends `SIGKILL`; the run ends immediately as `ABORTED` (metrics may be partial). |

**For terminal runs (`COMPLETED` / `FAILED` / `STOPPED` / `ABORTED`):**

| Item | What it does |
| --- | --- |
| **Show summary** / **Show aborted details** | Focuses the row (label adapts to the run status). |
| **Copy report link** | Copies the report URL to the clipboard. |
| **Open k6 web report** | Opens the printable report in a new tab. |
| **Export k6 JSON** | Downloads the raw k6 summary JSON (disabled when no summary is available). |
| **Rerun** | Re-runs the same scenario against the same base URL with a fresh run id. |
| **Remove from view** | Drops the clicked row from the in-memory dashboard (a page refresh reverses it). |
| **Remove all other failed runs** | Drops every other `FAILED` row from the dashboard (disabled when no other `FAILED` row exists). |

The dashboard polls `/api/test-runs/{id}` for **every non-terminal
run** in parallel once per second, so multiple rows can update
simultaneously. The terminal-state predicate is the single source
of truth in `runDashboard.isTerminalRun()` (unit-tested) — the
frontend keeps polling `STOPPING` runs on purpose, otherwise the
`STOPPING → STOPPED` transition would freeze the row forever.

> 💡 **Worked example — comparing two smoke runs:** you ran the demo
> with `Smoke` (10 s, 10 VUs) once at 14:00 and tweaked the Base URL
> before running it again at 14:02. Both rows are visible in the
> list. The first is green (`COMPLETED`), the second is the active
> row. Click the older one to inspect it; right-click it and pick
> **Rerun** to fire a third run that lasttest will add to the same
> list, with focus jumping back to the freshest in-flight run.

### 10.2 The run-row action menu (right-click)

Right-clicking a row opens a small **context menu** at the cursor
position. The menu only offers actions that make sense for the run's
current state — the visible items are computed by
`runMenuItems.buildRunMenuItems(run)` and unit-tested for every
status combination.

**For `QUEUED` / `RUNNING` / `STOPPING` runs** the menu has two
groups:

| Item | Shortcut | Effect |
| --- | --- | --- |
| **Show live details** | — | Focuses the row (same as left-click). |
| **Copy run id** | — | Copies the UUID to the clipboard. |
| **Open k6 web report** | — | Opens the printable report in a new tab (the report page exists from the moment the run is queued). |
| **Stop (graceful)** | `S` | `POST /api/test-runs/{id}/cancel?force=false`. k6 receives `SIGTERM`, the run transitions `RUNNING → STOPPING → STOPPED`. |
| **Force abort** | `⇧S` | `POST /api/test-runs/{id}/cancel?force=true`. k6 receives `SIGKILL`, the run ends immediately as `ABORTED`. |

**For terminal runs (`COMPLETED` / `FAILED` / `STOPPED` / `ABORTED`)**
the menu offers:

| Item | Visible when | Effect |
| --- | --- | --- |
| **Show summary** / **Show aborted details** *(label adapts to status)* | always | Focuses the row. |
| **Copy report link** | always | Copies `http://…/?report=<run-id>` to the clipboard — drop it into chat, a ticket, or a runbook. |
| **Open k6 web report** | always | Opens the printable report in a new tab. |
| **Export k6 JSON** | only when a complete summary is available (`ABORTED` runs and runs without a summary are disabled) | Downloads `lasttest-<run-id>-summary.json` for offline analysis or to feed into another tool. |
| **Rerun** | always (terminal runs only) | `POST /api/test-runs/{id}/rerun`. The backend replays the `CreateTestRunRequest` it preserved when the original run was started, k6 starts fresh, the new row appears in the dashboard and gets focus. The new run shares the operation, payload pool, load profile and base URL of the original. |
| **Remove from view** | always (terminal runs only) | Frontend-only cleanup that drops the clicked row from the in-memory map. The backend still holds the run, so a page refresh re-hydrates it from `/api/test-runs`. The remaining rows re-sort by their original `createdAt` so the dashboard stays in newest-first order; the dashboard focus is re-evaluated so the detail card survives the removal. |
| **Remove all other failed runs** | terminal runs that have at least one other `FAILED` badge in the map (otherwise the item is disabled with the reason *“No other failed runs to remove.”*) | Bulk frontend cleanup: drops every other `FAILED` badge except the clicked one. `STOPPED` and `ABORTED` runs are intentionally preserved — the menu entry targets the `FAILED` status only, not every non-success outcome. |

The menu closes on any click outside (`Esc` also closes it). The
**left-click** is reserved for focusing the run, so it never opens
the menu. Items that would not work in the current state are kept in
the list but rendered as **disabled** with a `title` explaining why
(for example *“Aborted runs have no complete summary to export”*).

> 💡 **Worked example — rerun via right-click:** you ran the demo
> with `Smoke` (10 VUs, 30 s) and want to confirm the result is
> reproducible. Right-click the green `COMPLETED` row, pick
> **Rerun**. lasttest posts `/api/test-runs/{id}/rerun`, the
> backend re-queues the preserved `CreateTestRunRequest`, k6 starts
> a fresh process against the same base URL, and the new row
> appears in the dashboard with focus moved to it. The dashboard
> starts polling immediately; the old `COMPLETED` badge stays put so
> you can still compare the two runs side-by-side.

> 💡 **Worked example — escalating a stuck run:** you ran a `Load`
> profile against a slow staging server. After 5 minutes it has not
> finished and you want the metrics you already have. Right-click
> the orange `RUNNING` row, pick **Stop (graceful)** (or press
> `S` inside the menu). The status transitions `RUNNING → STOPPING`
> and the row stripe turns purple while k6 winds down. If the
> graceful stop hangs, right-click again and pick **Force abort**
> (`⇧S`). The badge turns dark red and the detail card renders the
> *“Aborted by user — k6 was killed via SIGKILL”* notice with a
> warning that only partial counters are available.

> 💡 **Worked example — sharing a report link:** a colleague asks
> for the numbers from a 5-minute `Stress` run you did yesterday.
> Right-click its row, pick **Copy report link**, and paste the
> URL into the chat. Anyone with access to the running lasttest
> instance can open `/?report=<run-id>` and inspect the printable
> report — the link stays valid for the lifetime of the process.

> 💡 **Worked example — cleaning up the dashboard:** you ran five
> back-to-back smoke tests and three of them failed (DNS lookup
> issues). You do not need the failed rows in the dashboard
> anymore but you want to keep the two `COMPLETED` ones. Right-click
> any of the failed rows, pick **Remove all other failed runs**,
> and the dashboard keeps only the clicked `FAILED` plus the two
> successful ones. To drop a single row without affecting the
> rest, right-click it and pick **Remove from view**. Both actions
> are frontend-only; reload the page and the removed rows return
> (the backend still has them), which is the safety net for users
> who changed their mind mid-cleanup.

### 10.3 Live status and the `Live · Lasttest läuft` banner

The status badge in the detail header cycles through:

- `QUEUED` — accepted, k6 has not been spawned yet
- `RUNNING` — k6 is executing
- `STOPPING` — you asked for a graceful stop; k6 is winding down
- `COMPLETED` — the run finished, all metrics are available
- `FAILED` — the run was rejected, the spec was invalid, or k6
  crashed. The console output explains why.
- `STOPPED` — you stopped the run with `SIGTERM`; metrics up to the
  stop are preserved
- `ABORTED` — you stopped the run with `SIGKILL`; metrics may be partial

The UI polls `/api/test-runs/{id}` every second while the run is
in flight (`QUEUED`, `RUNNING` or `STOPPING`), so the status badge
updates without a page reload.

While a run is `QUEUED`, `RUNNING` or `STOPPING`, the detail card
shows a pulsing **Live · Lasttest läuft** banner at the top with
the method+path being tested, a one-line summary of the active
load profile (e.g. `ramping-vus · 50 VUs · 60 s`) and the same
Stop / Abort buttons the Aktionen tab offers — so the user can
halt a stuck run without having to leave the Übersicht tab.

```svg
<svg viewBox="0 0 600 80" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="600" height="80" fill="#0b1220" rx="8"/>
  <rect x="0" y="0" width="600" height="80" fill="#111b29" stroke="#fb923c" stroke-width="1" rx="8"/>

  <!-- Pulsing dot -->
  <circle cx="22" cy="40" r="7" fill="#fb923c"/>
  <circle cx="22" cy="40" r="11" fill="none" stroke="#fb923c" stroke-width="1" opacity="0.4"/>

  <!-- Live label -->
  <text x="40" y="32" fill="#fb923c" font-family="Inter, sans-serif" font-size="10" font-weight="600">Live · Lasttest läuft</text>
  <text x="40" y="52" fill="#dbe5f3" font-family="Inter, sans-serif" font-size="13" font-weight="600">POST /products/search</text>

  <!-- Profile summary -->
  <text x="220" y="30" fill="#93a2b8" font-family="Inter, sans-serif" font-size="10">Load-Profil</text>
  <text x="220" y="48" fill="#dbe5f3" font-family="monospace" font-size="11" font-weight="600">ramping-vus · 50 VUs · 60s</text>
  <text x="220" y="64" fill="#6b7c95" font-family="monospace" font-size="9">http_req_duration p(95) aktualisiert sich alle 2 s</text>

  <!-- Stop button -->
  <rect x="430" y="22" width="64" height="36" fill="#3a2a0b" stroke="#d4a72c" rx="4"/>
  <text x="462" y="38" text-anchor="middle" fill="#d4a72c" font-family="Inter, sans-serif" font-size="10" font-weight="600">Stop</text>
  <text x="462" y="50" text-anchor="middle" fill="#d4a72c" font-family="Inter, sans-serif" font-size="8">graceful</text>

  <!-- Abort button -->
  <rect x="502" y="22" width="80" height="36" fill="#3a0b0b" stroke="#ef4444" rx="4"/>
  <text x="542" y="38" text-anchor="middle" fill="#ffb5c3" font-family="Inter, sans-serif" font-size="10" font-weight="600">Abort</text>
  <text x="542" y="50" text-anchor="middle" fill="#ffb5c3" font-family="Inter, sans-serif" font-size="8">SIGKILL</text>
</svg>
```

The banner is hidden the moment the run reaches a terminal state.
It is purely a presentation surface: the same Stop / Abort actions
are still reachable from the Aktionen tab and from the run-row
context menu.

### 10.4 Diagnosis and metrics

The status row always shows the status badge plus a short hint while the run is
still in flight ("läuft seit X s", "wartet auf Executor"). When the run
settles, the card expands with three additional blocks:

1. **Diagnosis + Detail** — a one-line classification of what went wrong
   and the concrete value the user can act on. lasttest recognises the
   following categories from `run.error` and `run.summary`:

   | Diagnosis | Triggered by | Hint |
   |---|---|---|
   | Ziel nicht erreichbar | `ERR_CONNECTION_REFUSED`, "connection refused" | TCP-Target lehnt ab — Port offen? Container-Egress? |
   | DNS-Auflösung fehlgeschlagen | `ENOTFOUND`, `EAI_AGAIN` | DNS-Forwarder im Container-Netz vorhanden? |
   | TLS-Handshake fehlgeschlagen | `CERT_AUTHORITY_INVALID`, `x509`, `PKIX` | TrustStore über `LASTTEST_TRUSTSTORE_PATH` setzen (siehe §14.1) |
   | Antwortzeit zu hoch | p(95) > 1000 ms oder k6-Timeout | Server antwortet langsam — siehe §14 |
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

The full k6 stdout/stderr and the raw summary JSON are reachable from
the dashboard's run-detail tabs (**k6 console**, **k6 script**) or
the failure diagnosis card on the run itself.

### 10.5 Re-running

You have two ways to re-run the same scenario:

- **Via the right-click menu** on a terminal row — see
  [Section 10.2](#102-the-run-row-action-menu-right-click). This is
  the recommended path because it preserves the exact
  `CreateTestRunRequest` that was originally sent (operation,
  payloads, load profile, base URL). The new run gets a fresh UUID
  and gets focus automatically.
- **By re-configuring the form** — change any value in steps 2 or 3
  and click **k6-Lasttest starten** again. The new run has no
  genealogical link to the old one; the old row stays in the
  dashboard unchanged.

---

### 10.6 Run-detail tab strip

The detail card for a run is organised as a horizontal tab strip
(plus an external link at the end). Switching tabs preserves the
user's reading position so the detail card does not jump back to
the top of the page on every click.

```svg
<svg viewBox="0 0 600 60" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="600" height="60" fill="#0b1220" rx="6"/>
  <line x1="0" y1="48" x2="600" y2="48" stroke="#2c3a52" stroke-width="1"/>

  <!-- Active tab: Übersicht -->
  <rect x="12" y="14" width="92" height="34" fill="#15233a" stroke="#7d63ff" rx="4"/>
  <rect x="12" y="44" width="92" height="4" fill="#7d63ff"/>
  <text x="58" y="35" text-anchor="middle" fill="#dbe5f3" font-family="Inter, sans-serif" font-size="11" font-weight="600">Übersicht</text>

  <!-- Timeline (Plan badge) -->
  <text x="135" y="35" fill="#93a2b8" font-family="Inter, sans-serif" font-size="11">Timeline</text>
  <rect x="178" y="22" width="28" height="14" fill="#2d6a4f" rx="7"/>
  <text x="192" y="32" text-anchor="middle" fill="#8fe8c1" font-family="Inter, sans-serif" font-size="8" font-weight="600">Plan</text>

  <!-- Aktionen -->
  <text x="226" y="35" fill="#93a2b8" font-family="Inter, sans-serif" font-size="11">Aktionen</text>

  <!-- k6-Konsole -->
  <text x="288" y="35" fill="#93a2b8" font-family="Inter, sans-serif" font-size="11">k6-Konsole</text>

  <!-- Schwellen -->
  <text x="365" y="35" fill="#93a2b8" font-family="Inter, sans-serif" font-size="11">Schwellen</text>

  <!-- Konfiguration -->
  <text x="434" y="35" fill="#93a2b8" font-family="Inter, sans-serif" font-size="11">Konfiguration</text>

  <!-- Fehler-Diagnose (with alert badge) -->
  <text x="518" y="35" fill="#93a2b8" font-family="Inter, sans-serif" font-size="11">Fehler-Diagnose</text>
  <circle cx="590" cy="28" r="7" fill="#793b4b" stroke="#ef4444"/>
  <text x="590" y="32" text-anchor="middle" fill="#fff" font-family="Inter, sans-serif" font-size="9" font-weight="700">!</text>

  <!-- Separator -->
  <line x1="0" y1="50" x2="600" y2="50" stroke="#2c3a52" stroke-width="1"/>

  <!-- Caption / role -->
  <text x="12" y="58" fill="#93a2b8" font-family="Inter, sans-serif" font-size="9" font-style="italic">tab strip — click switches the body; right-click on a row in Letzte Läufe keeps the Timeline tab open and re-centres on the new run</text>
</svg>
```

| Tab | Purpose |
| --- | --- |
| **Übersicht** | Live status banner, metric cards, console/summary blocks, **live ramp-grafik** (see [§10.8](#108-live-ramp-grafik-auslastung--soll-vs-ist)) |
| **Timeline** | Per-endpoint heat map + Gantt (see [§10.7](#107-per-endpoint-timeline-heat-map--gantt)) |
| **Aktionen** | Status-aware controls: Stop, Abort, Rerun, Copy run id, Copy report link, Open report, Download k6 script, Export raw summary, Remove from dashboard, Remove all other failed |
| **k6-Konsole** | Full k6 stdout/stderr of the run |
| **Schwellen** | Every configured k6 threshold with the measured value |
| **Konfiguration** | API, load profile, operations, run metadata |
| **Fehler-Diagnose** | Typed failure diagnosis for `FAILED` / `ABORTED` runs |
| **� k6-Bericht öffnen** | Opens the printable report in a new tab |

**Tab-switching rules.** When you click another row in the
`Letzte Läufe` panel while the Timeline tab is open, the Timeline
stays open and re-centres on the new run's `createdAt` — closing
the tab would throw away the very context (focused Gantt bar,
heatmap, "Centred on …" label) that makes the timeline useful as
a navigation surface. For all other tabs the new run lands on
Übersicht, which is the natural starting point.

**Scroll preservation.** Switching tabs captures `window.scrollY`
in `mousedown` (before the browser's click-event default can
scroll the page) and re-applies it in a layout effect after the
new tab body commits, so a click on a tab button never throws
the user back to the top of the page.

---

### 10.7 Per-endpoint timeline (heat map + Gantt)

The **Timeline** tab is built from `EndpointTimelineTab.tsx` and
turns the run history of a single `(method, path)` endpoint into
one visual story. It is data-driven from
`/api/operations/runs?method=…&path=…`, polled on the same
cadence as the run list, so a freshly-started (or rerun) test
shows up in the chart within a few seconds.

#### 10.7.1 Layout

```svg
<svg viewBox="0 0 600 380" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="600" height="380" fill="#0b1220" rx="8"/>

  <!-- Toolbar: endpoint chip + window selector + reset -->
  <rect x="14" y="14" width="220" height="34" fill="#111b29" stroke="#2c3a52" rx="4"/>
  <text x="26" y="34" fill="#93a2b8" font-family="Inter, sans-serif" font-size="10">Filtered by:</text>
  <rect x="98" y="22" width="32" height="16" fill="#0b3a25" stroke="#22c55e" rx="3"/>
  <text x="114" y="33" text-anchor="middle" fill="#8fe8c1" font-family="Inter, sans-serif" font-size="9" font-weight="600">GET</text>
  <text x="138" y="34" fill="#dbe5f3" font-family="monospace" font-size="10">/products/lookup-by-id</text>

  <!-- Window selector (segmented control) -->
  <rect x="246" y="14" width="200" height="34" fill="#111b29" stroke="#2c3a52" rx="4"/>
  <rect x="248" y="16" width="48" height="30" fill="#7d63ff" rx="3"/>
  <text x="272" y="35" text-anchor="middle" fill="#fff" font-family="Inter, sans-serif" font-size="10" font-weight="600">24 h</text>
  <text x="328" y="35" text-anchor="middle" fill="#93a2b8" font-family="Inter, sans-serif" font-size="10">7 d</text>
  <text x="376" y="35" text-anchor="middle" fill="#93a2b8" font-family="Inter, sans-serif" font-size="10">30 d</text>
  <text x="424" y="35" text-anchor="middle" fill="#93a2b8" font-family="Inter, sans-serif" font-size="10">90 d</text>

  <!-- Reset button -->
  <rect x="460" y="14" width="126" height="34" fill="#111b29" stroke="#7d63ff" rx="4"/>
  <text x="523" y="34" text-anchor="middle" fill="#c5b8ff" font-family="Inter, sans-serif" font-size="10">↺ Reset to "now"</text>

  <!-- Stat strip -->
  <g transform="translate(14,62)">
    <rect width="140" height="56" fill="#111b29" stroke="#2c3a52" rx="4"/>
    <text x="10" y="18" fill="#93a2b8" font-family="Inter, sans-serif" font-size="9">Runs (24 h)</text>
    <text x="10" y="40" fill="#dbe5f3" font-family="Inter, sans-serif" font-size="18" font-weight="700">14</text>
    <text x="10" y="52" fill="#8fe8c1" font-family="Inter, sans-serif" font-size="8">in window</text>
  </g>
  <g transform="translate(160,62)">
    <rect width="140" height="56" fill="#111b29" stroke="#22c55e" rx="4"/>
    <text x="10" y="18" fill="#93a2b8" font-family="Inter, sans-serif" font-size="9">Passed</text>
    <text x="10" y="40" fill="#8fe8c1" font-family="Inter, sans-serif" font-size="18" font-weight="700">10</text>
    <text x="10" y="52" fill="#8fe8c1" font-family="Inter, sans-serif" font-size="8">71 % success rate</text>
  </g>
  <g transform="translate(306,62)">
    <rect width="140" height="56" fill="#111b29" stroke="#ef4444" rx="4"/>
    <text x="10" y="18" fill="#93a2b8" font-family="Inter, sans-serif" font-size="9">Failed</text>
    <text x="10" y="40" fill="#ffb5c3" font-family="Inter, sans-serif" font-size="18" font-weight="700">4</text>
    <text x="10" y="52" fill="#ffb5c3" font-family="Inter, sans-serif" font-size="8">Needs attention</text>
  </g>
  <g transform="translate(452,62)">
    <rect width="134" height="56" fill="#111b29" stroke="#2c3a52" rx="4"/>
    <text x="10" y="18" fill="#93a2b8" font-family="Inter, sans-serif" font-size="9">Last issues</text>
    <text x="10" y="36" fill="#ffb5c3" font-family="Inter, sans-serif" font-size="12" font-weight="700">11:42</text>
    <text x="10" y="52" fill="#93a2b8" font-family="Inter, sans-serif" font-size="8">last run: 11:55</text>
  </g>

  <!-- Heat map -->
  <text x="14" y="146" fill="#dbe5f3" font-family="Inter, sans-serif" font-size="10" font-weight="600">Runs per day · colour = day outcome · 7 days · centred on 12:00</text>
  <g transform="translate(14,154)">
    <!-- Day cells (7) -->
    <rect x="0"   y="0" width="78" height="60" fill="#1f2a3d" stroke="#2c3a52" rx="4"/>
    <text x="39" y="22" text-anchor="middle" fill="#dbe5f3" font-family="Inter, sans-serif" font-size="14" font-weight="700">2</text>
    <text x="39" y="38" text-anchor="middle" fill="#8fe8c1" font-family="Inter, sans-serif" font-size="8">all ok</text>
    <text x="39" y="54" text-anchor="middle" fill="#93a2b8" font-family="Inter, sans-serif" font-size="8">−3 d</text>

    <rect x="86"  y="0" width="78" height="60" fill="#3a2a0b" stroke="#d4a72c" rx="4"/>
    <text x="125" y="22" text-anchor="middle" fill="#dbe5f3" font-family="Inter, sans-serif" font-size="14" font-weight="700">3</text>
    <text x="125" y="38" text-anchor="middle" fill="#d4a72c" font-family="Inter, sans-serif" font-size="8">1 stopped</text>
    <text x="125" y="54" text-anchor="middle" fill="#93a2b8" font-family="Inter, sans-serif" font-size="8">−2 d</text>

    <rect x="172" y="0" width="78" height="60" fill="#3a0b0b" stroke="#ef4444" rx="4"/>
    <text x="211" y="22" text-anchor="middle" fill="#dbe5f3" font-family="Inter, sans-serif" font-size="14" font-weight="700">2</text>
    <text x="211" y="38" text-anchor="middle" fill="#ffb5c3" font-family="Inter, sans-serif" font-size="8">2 errors</text>
    <text x="211" y="54" text-anchor="middle" fill="#93a2b8" font-family="Inter, sans-serif" font-size="8">−1 d</text>

    <!-- Centre / today -->
    <rect x="258" y="-4" width="78" height="68" fill="#0b3a25" stroke="#22c55e" stroke-width="2" rx="4"/>
    <text x="297" y="20" text-anchor="middle" fill="#dbe5f3" font-family="Inter, sans-serif" font-size="14" font-weight="700">4</text>
    <text x="297" y="36" text-anchor="middle" fill="#8fe8c1" font-family="Inter, sans-serif" font-size="8">all ok</text>
    <text x="297" y="60" text-anchor="middle" fill="#8fe8c1" font-family="Inter, sans-serif" font-size="8" font-weight="700">today</text>

    <rect x="344" y="0" width="78" height="60" fill="#3a0b0b" stroke="#ef4444" rx="4"/>
    <text x="383" y="22" text-anchor="middle" fill="#dbe5f3" font-family="Inter, sans-serif" font-size="14" font-weight="700">1</text>
    <text x="383" y="38" text-anchor="middle" fill="#ffb5c3" font-family="Inter, sans-serif" font-size="8">1 error</text>
    <text x="383" y="54" text-anchor="middle" fill="#93a2b8" font-family="Inter, sans-serif" font-size="8">+1 d</text>

    <rect x="430" y="0" width="78" height="60" fill="#1f2a3d" stroke="#2c3a52" rx="4"/>
    <text x="469" y="22" text-anchor="middle" fill="#dbe5f3" font-family="Inter, sans-serif" font-size="14" font-weight="700">2</text>
    <text x="469" y="38" text-anchor="middle" fill="#dbe5f3" font-family="Inter, sans-serif" font-size="8">—</text>
    <text x="469" y="54" text-anchor="middle" fill="#93a2b8" font-family="Inter, sans-serif" font-size="8">+2 d</text>

    <rect x="516" y="0" width="56" height="60" fill="#1f2a3d" stroke="#2c3a52" rx="4"/>
    <text x="544" y="34" text-anchor="middle" fill="#93a2b8" font-family="Inter, sans-serif" font-size="10">—</text>
    <text x="544" y="54" text-anchor="middle" fill="#93a2b8" font-family="Inter, sans-serif" font-size="8">+3 d</text>
  </g>

  <!-- Gantt timeline -->
  <text x="14" y="232" fill="#dbe5f3" font-family="Inter, sans-serif" font-size="10" font-weight="600">Single-row timeline · one bar per run · centred on 12:00</text>
  <g transform="translate(60,242)">
    <!-- Axis ticks -->
    <line x1="0" y1="46" x2="500" y2="46" stroke="#2c3a52" stroke-width="1"/>
    <text x="0"   y="60" text-anchor="middle" fill="#93a2b8" font-family="monospace" font-size="9">06:00</text>
    <text x="125" y="60" text-anchor="middle" fill="#93a2b8" font-family="monospace" font-size="9">09:00</text>
    <text x="250" y="60" text-anchor="middle" fill="#c5b8ff" font-family="monospace" font-size="9" font-weight="700">12:00</text>
    <text x="375" y="60" text-anchor="middle" fill="#93a2b8" font-family="monospace" font-size="9">15:00</text>
    <text x="500" y="60" text-anchor="middle" fill="#93a2b8" font-family="monospace" font-size="9">18:00</text>

    <!-- Day separators -->
    <line x1="83"  y1="4" x2="83"  y2="46" stroke="#1f2a3d" stroke-dasharray="2,2"/>
    <line x1="333" y1="4" x2="333" y2="46" stroke="#1f2a3d" stroke-dasharray="2,2"/>
    <line x1="417" y1="4" x2="417" y2="46" stroke="#1f2a3d" stroke-dasharray="2,2"/>

    <!-- Now / Focus line -->
    <line x1="250" y1="0" x2="250" y2="46" stroke="#c5b8ff" stroke-width="2"/>
    <text x="250" y="-2" text-anchor="middle" fill="#c5b8ff" font-family="Inter, sans-serif" font-size="9" font-weight="700">◀ Focus ▶</text>

    <!-- Run bars -->
    <rect x="40"  y="14" width="6" height="20" fill="#8fe8c1" rx="1"/>
    <rect x="90"  y="14" width="6" height="20" fill="#8fe8c1" rx="1"/>
    <rect x="120" y="14" width="6" height="20" fill="#d4a72c" rx="1"/>
    <rect x="170" y="14" width="6" height="20" fill="#ffb5c3" rx="1"/>
    <rect x="200" y="14" width="6" height="20" fill="#ffb5c3" rx="1"/>
    <rect x="248" y="14" width="6" height="20" fill="#8fe8c1" stroke="#c5b8ff" stroke-width="2" rx="1"/>
    <rect x="290" y="14" width="6" height="20" fill="#8fe8c1" rx="1"/>
    <rect x="340" y="14" width="6" height="20" fill="#8fe8c1" rx="1"/>
    <rect x="395" y="14" width="6" height="20" fill="#ffb5c3" rx="1"/>
    <rect x="445" y="14" width="6" height="20" fill="#8fe8c1" rx="1"/>
    <rect x="470" y="14" width="6" height="20" fill="#8fe8c1" rx="1"/>

    <!-- Lane label -->
    <text x="-58" y="28" fill="#93a2b8" font-family="monospace" font-size="9">GET</text>
    <text x="-58" y="40" fill="#93a2b8" font-family="monospace" font-size="8">/lookup</text>
  </g>

  <!-- Legend -->
  <g transform="translate(14,318)">
    <rect x="0"   y="0" width="12" height="10" fill="#8fe8c1" rx="2"/>
    <text x="18"  y="9" fill="#93a2b8" font-family="Inter, sans-serif" font-size="9">Passed</text>
    <rect x="78"  y="0" width="12" height="10" fill="#ffb5c3" rx="2"/>
    <text x="96"  y="9" fill="#93a2b8" font-family="Inter, sans-serif" font-size="9">Failed</text>
    <rect x="148" y="0" width="12" height="10" fill="#d4a72c" rx="2"/>
    <text x="166" y="9" fill="#93a2b8" font-family="Inter, sans-serif" font-size="9">Stopped</text>
    <rect x="226" y="0" width="12" height="10" fill="#c5b8ff" rx="2"/>
    <text x="244" y="9" fill="#93a2b8" font-family="Inter, sans-serif" font-size="9">Selected / focus</text>
  </g>

  <!-- Caption -->
  <text x="14" y="350" fill="#93a2b8" font-family="Inter, sans-serif" font-size="9" font-style="italic">click a bar or list row to re-centre the chart on that run</text>
  <line x1="14" y1="360" x2="586" y2="360" stroke="#2c3a52" stroke-width="1"/>
  <text x="14" y="372" fill="#dbe5f3" font-family="Inter, sans-serif" font-size="10" font-weight="600">Visible in window</text>
  <text x="160" y="372" fill="#93a2b8" font-family="Inter, sans-serif" font-size="10">· 12 runs · newest first</text>
</svg>
```

#### 10.7.2 Window and focus

- **24 h** uses hourly ticks (`HH:MM`) centred on the anchor
  with major ticks every 6 h.
- **7 d** uses daily ticks (`DD.MM`); the centre tick carries
  an additional `HH:MM` label.
- **30 d / 90 d** thin out to ticks every 5 d / 15 d so the
  axis stays readable.

When the user clicks a Gantt bar or a list entry, the chart
re-anchors on that run's `createdAt`; the day labels switch
from absolute (`+1d` / `−2d`) to relative (`heute` / `gestern`
/ `vor N Tagen`) so the centre bucket always reads `heute`
regardless of which run you jumped to. The `Reset to "now"`
button restores the default behaviour.

#### 10.7.3 Right-click in the timeline

Right-clicking on a Gantt bar or a list entry opens the same
per-run context menu as the overview rows — stop, abort, rerun,
copy run id, copy report link, open report, export, remove from
view, remove all other failed. The timeline keeps its own
`hiddenRunIds` set so a removed run stays out of view across
the next poll, while the dashboard map (where it may also live)
stays untouched.

#### 10.7.4 Worked example — investigating a flaky endpoint

You notice that `GET /products/lookup-by-id` has been returning
`429`s lately. Open the run, click the **Timeline** tab, and
the chart shows the last 7 days for that exact endpoint. The
heatmap reveals two red cells from yesterday and the day
before. Click one of the red bars in the Gantt: the chart
re-centres on that run's `createdAt`, the stats strip updates
with the run's success rate, and the list below highlights the
same row with a `●` pin. Right-click the bar, pick **Rerun**,
and the new run shows up in the dashboard — the timeline will
refresh within a few seconds and the new bar appears in its
chronological spot.

---

### 10.8 Live ramp-grafik (Auslastung — Soll vs Ist)

While a run is in flight, the **Übersicht** (Overview) tab shows
a live SVG chart that compares the **Soll** (planned) curve —
derived deterministically from the configured load profile —
against the **Ist** (actual) curve streamed from the time-series
container.

```svg
<svg viewBox="0 0 600 240" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="600" height="240" fill="#0b1220" rx="8"/>

  <!-- Header -->
  <text x="20" y="28" fill="#7d63ff" font-family="Inter, sans-serif" font-size="11" font-weight="600">AUSLASTUNG</text>
  <text x="100" y="28" fill="#dbe5f3" font-family="Inter, sans-serif" font-size="11" font-weight="600">Soll vs Ist</text>
  <text x="180" y="28" fill="#93a2b8" font-family="Inter, sans-serif" font-size="10">· Spike (5 → 200 → 5 VUs, 60 s)</text>

  <text x="20" y="46" fill="#93a2b8" font-family="Inter, sans-serif" font-size="10">läuft seit</text>
  <text x="78" y="46" fill="#dbe5f3" font-family="monospace" font-size="11" font-weight="700">00:42</text>
  <text x="120" y="46" fill="#93a2b8" font-family="Inter, sans-serif" font-size="10">· 38 Messpunkte</text>

  <!-- Y-axis grid + labels -->
  <line x1="60" y1="180" x2="580" y2="180" stroke="#2c3a52" stroke-width="1"/>
  <line x1="60" y1="140" x2="580" y2="140" stroke="#1a2435" stroke-width="1"/>
  <line x1="60" y1="100" x2="580" y2="100" stroke="#1a2435" stroke-width="1"/>
  <line x1="60" y1="60"  x2="580" y2="60"  stroke="#1a2435" stroke-width="1"/>
  <line x1="60" y1="60"  x2="60"  y2="180" stroke="#2c3a52" stroke-width="1"/>

  <text x="52" y="184" text-anchor="end" fill="#93a2b8" font-family="monospace" font-size="10">0</text>
  <text x="52" y="144" text-anchor="end" fill="#93a2b8" font-family="monospace" font-size="10">50</text>
  <text x="52" y="104" text-anchor="end" fill="#93a2b8" font-family="monospace" font-size="10">100</text>
  <text x="52" y="64"  text-anchor="end" fill="#93a2b8" font-family="monospace" font-size="10">200</text>

  <!-- X-axis ticks -->
  <text x="60"  y="200" fill="#93a2b8" font-family="monospace" font-size="10">0s</text>
  <text x="160" y="200" fill="#93a2b8" font-family="monospace" font-size="10">10s</text>
  <text x="260" y="200" fill="#93a2b8" font-family="monospace" font-size="10">20s</text>
  <text x="360" y="200" fill="#93a2b8" font-family="monospace" font-size="10">30s</text>
  <text x="460" y="200" fill="#93a2b8" font-family="monospace" font-size="10">40s</text>
  <text x="560" y="200" fill="#93a2b8" font-family="monospace" font-size="10">50s</text>

  <!-- Soll line (planned): ramp 5→200→5 -->
  <polyline fill="none" stroke="#5fcb95" stroke-width="2"
    points="60,176 76,176 160,66 460,66 476,176 580,176"/>

  <!-- Ist line (actual): measured, slightly below target near peak -->
  <polyline fill="none" stroke="#4f8bff" stroke-width="2"
    points="60,176 76,176 100,170 130,150 160,90 200,72 240,68 280,68 320,70 360,72 400,76 440,82 460,86 476,176 580,176"/>

  <!-- Cursor (latest sample) -->
  <circle cx="460" cy="82" r="4" fill="#fbbf24" stroke="#0c131e" stroke-width="2"/>

  <!-- Cursor label callout -->
  <line x1="460" y1="76" x2="460" y2="40" stroke="#fbbf24" stroke-dasharray="2,2"/>
  <rect x="430" y="22" width="78" height="18" fill="#111b29" stroke="#fbbf24" rx="4"/>
  <text x="469" y="34" text-anchor="middle" fill="#fbbf24" font-family="monospace" font-size="10">118 VUs</text>

  <!-- Legend -->
  <g transform="translate(380,212)">
    <rect width="220" height="20" fill="#111b29" rx="4"/>
    <line x1="10" y1="10" x2="30" y2="10" stroke="#4f8bff" stroke-width="2"/>
    <text x="36" y="13" fill="#dbe5f3" font-family="Inter, sans-serif" font-size="9">Ist (gemessen · live)</text>
    <line x1="10" y1="10" x2="30" y2="10" stroke="#5fcb95" stroke-width="2" transform="translate(120,0)"/>
    <text x="156" y="13" fill="#dbe5f3" font-family="Inter, sans-serif" font-size="9">Soll (geplant)</text>
  </g>
  <text x="20" y="226" fill="#93a2b8" font-family="Inter, sans-serif" font-size="9" font-style="italic">Y-Achse: VUs</text>
</svg>
```

#### 10.8.1 What the chart shows

- The **planned line** is rendered as a flat or stepped polyline
  depending on the executor: `constant-vus` is a horizontal line
  at the target VU count, `ramping-vus` is a staircase with
  linear ramps between consecutive stages, `constant-arrival-rate`
  is a horizontal line at the target RPS. `shared-iterations`
  produces no planned line (its concurrency is unbounded by
  design); the legend then hides the `Soll (geplant)` entry.
- The **actual polyline** updates every few seconds while the
  run is in flight. A yellow cursor marks the latest sample.
- The **y-axis** is labelled `VUs` for VU-based executors and
  `Anfragen/s` for arrival-rate executors so a 50 req/s spike
  test is no longer mis-labelled as `VUs`.
- The header strip carries the elapsed duration (`läuft seit
  HH:MM:SS`) and the number of received samples (`12 Messpunkte`
  / `noch keine Messpunkte`).
- When the run finishes, the actual polyline freezes at the
  final measured values so the same chart doubles as a
  post-mortem view — open the report to compare against the
  same data rendered at full resolution.

#### 10.8.2 Data sources

- The **planned curve** is computed client-side from
  `run.configuration.loadProfile` via `computeRampChartParams`
  in `liveRampChartLayout.ts`. The helper is unit-tested and is
  the single source of truth for both the live tab and the
  printable report, so the two views can never disagree on the
  planned shape.
- The **actual curve** is fetched from
  `/api/test-runs/{id}/time-series` (sourced from H2 so the
  data is stable across container restarts). The polling loop
  fires only while the run is in flight, so a finished run does
  not keep generating traffic in the background.

#### 10.8.3 Worked example — watching a Spike profile

You start a `Spike` profile (5 VUs baseline → 200 VUs in 10 s
→ 5 VUs again). The Übersicht tab shows the planned staircase
in green and starts receiving Ist samples as k6 ramps up. After
~5 s the blue Ist line begins climbing; the gap to the green
Soll line tells you whether the target can absorb the spike
faster than the configured ramp. Around the 12 s mark the
yellow cursor sits near the Soll peak of 200 VUs — that is the
moment the target is under the most stress. When the profile
ends, the cursor jumps back to baseline and the polyline
freezes; open the **Ramp-Grafik** section of the printable
report to see the same data rendered at full resolution.

#### 10.8.4 Without InfluxDB

If you start lasttest without InfluxDB (`LASTTEST_INFLUXDB_ENABLED=false`
or a bare `docker run`), the planned line still renders and the
header strip still shows the elapsed duration. The actual
polyline is simply not available — the same applies to the
printable report (see
[Section 14.3](#143-ramp-grafik-shows-only-the-soll-line)).

---

## 11. Step 5 — Reading the detailed k6 report

Step 5 is the printable report you open with the **Ausführlichen
k6-Testbericht in neuem Tab öffnen** link. It collects everything
that Step 4 showed on the dashboard in a single, print-ready A4
view — suitable for sharing, archiving, and PDF export.

### 11.1 Opening the report

The card **Ausführlichen k6-Testbericht in neuem Tab öffnen** opens
`/?report=<run-id>` in a new tab. The link keeps working as long as the
process is alive — there is no token, no session, no expiry. Anyone who
knows the run ID can open the report, so treat it as semi-public.

### 11.2 Visual tour of the report

The printable report contains the following sections in order.
Each block has a clear purpose and a colour scheme that mirrors the
dashboard — the same `COMPLETED` green pill in the header, the same
`Soll`/`Ist` purple/orange pair in the ramp-grafik.

1. **Header** — title (the API title from your OpenAPI document),
   the run ID, the configured base URL, and a colour-coded status pill
   that mirrors the dashboard (`COMPLETED` green, `FAILED` red,
   `STOPPED` purple, `ABORTED` dark red).

   ```svg
   <svg viewBox="0 0 600 110" xmlns="http://www.w3.org/2000/svg">
     <rect x="0" y="0" width="600" height="110" fill="#0b1220" rx="8"/>
     <rect x="20" y="20" width="46" height="46" fill="#7d63ff" rx="6"/>
     <text x="43" y="50" text-anchor="middle" fill="#fff" font-family="Inter, sans-serif" font-size="16" font-weight="bold">k6</text>
     <text x="78" y="36" fill="#dbe5f3" font-family="Inter, sans-serif" font-size="14" font-weight="600">lasttest</text>
     <text x="78" y="54" fill="#93a2b8" font-family="Inter, sans-serif" font-size="10">k6 load test report</text>
     <line x1="20" y1="80" x2="580" y2="80" stroke="#2c3a52" stroke-width="1"/>
     <text x="20" y="100" fill="#7d63ff" font-family="Inter, sans-serif" font-size="10" font-weight="500">TESTLAUF</text>
     <text x="92" y="100" fill="#dbe5f3" font-family="Inter, sans-serif" font-size="13" font-weight="600">Lasttest Demo API</text>
     <text x="240" y="100" fill="#93a2b8" font-family="monospace" font-size="11">v1.0.0 · http://localhost:8286</text>
     <rect x="470" y="86" width="110" height="22" fill="#2d6a4f" rx="11"/>
     <text x="525" y="101" text-anchor="middle" fill="#fff" font-family="Inter, sans-serif" font-size="11" font-weight="600">COMPLETED</text>
   </svg>
   ```

2. **Summary cards** — a 3 × 2 grid of the most important k6 numbers:
   the check-success rate (green when 100 %), the HTTP failure rate
   (red when ≥ 5 %), the p(95) latency with the configured 1 s
   threshold, the total request count and rate, the iteration count
   and rate, and the max / average response time. Each card carries a
   one-line detail (e.g. `120 passed · 0 failed`) so the headline
   number never sits alone.

   ```svg
   <svg viewBox="0 0 600 220" xmlns="http://www.w3.org/2000/svg">
     <g transform="translate(20,20)">
       <rect width="180" height="90" fill="#0b1220" stroke="#2c3a52" rx="6"/>
       <text x="14" y="22" fill="#93a2b8" font-family="Inter, sans-serif" font-size="10">Checks erfolgreich</text>
       <text x="14" y="56" fill="#8fe8c1" font-family="Inter, sans-serif" font-size="24" font-weight="700">100.0 %</text>
       <text x="14" y="78" fill="#93a2b8" font-family="Inter, sans-serif" font-size="9">120 passed · 0 failed</text>
     </g>
     <g transform="translate(210,20)">
       <rect width="180" height="90" fill="#0b1220" stroke="#2c3a52" rx="6"/>
       <text x="14" y="22" fill="#93a2b8" font-family="Inter, sans-serif" font-size="10">HTTP-Fehlerrate</text>
       <text x="14" y="56" fill="#8fe8c1" font-family="Inter, sans-serif" font-size="24" font-weight="700">0.0 %</text>
       <text x="14" y="78" fill="#93a2b8" font-family="Inter, sans-serif" font-size="9">120 Requests</text>
     </g>
     <g transform="translate(400,20)">
       <rect width="180" height="90" fill="#0b1220" stroke="#2c3a52" rx="6"/>
       <text x="14" y="22" fill="#93a2b8" font-family="Inter, sans-serif" font-size="10">p(95) Antwortzeit</text>
       <text x="14" y="56" fill="#dbe5f3" font-family="Inter, sans-serif" font-size="24" font-weight="700">42 ms</text>
       <text x="14" y="78" fill="#93a2b8" font-family="Inter, sans-serif" font-size="9">Grenzwert: &lt; 1.000 ms</text>
     </g>
     <g transform="translate(20,120)">
       <rect width="180" height="90" fill="#0b1220" stroke="#2c3a52" rx="6"/>
       <text x="14" y="22" fill="#93a2b8" font-family="Inter, sans-serif" font-size="10">HTTP Requests</text>
       <text x="14" y="56" fill="#dbe5f3" font-family="Inter, sans-serif" font-size="24" font-weight="700">120</text>
       <text x="14" y="78" fill="#93a2b8" font-family="Inter, sans-serif" font-size="9">12.5 Requests/s</text>
     </g>
     <g transform="translate(210,120)">
       <rect width="180" height="90" fill="#0b1220" stroke="#2c3a52" rx="6"/>
       <text x="14" y="22" fill="#93a2b8" font-family="Inter, sans-serif" font-size="10">Iterationen</text>
       <text x="14" y="56" fill="#dbe5f3" font-family="Inter, sans-serif" font-size="24" font-weight="700">60</text>
       <text x="14" y="78" fill="#93a2b8" font-family="Inter, sans-serif" font-size="9">6.2 Iterationen/s</text>
     </g>
     <g transform="translate(400,120)">
       <rect width="180" height="90" fill="#0b1220" stroke="#2c3a52" rx="6"/>
       <text x="14" y="22" fill="#93a2b8" font-family="Inter, sans-serif" font-size="10">Max Antwortzeit</text>
       <text x="14" y="56" fill="#dbe5f3" font-family="Inter, sans-serif" font-size="24" font-weight="700">187 ms</text>
       <text x="14" y="78" fill="#93a2b8" font-family="Inter, sans-serif" font-size="9">Durchschnitt 28 ms</text>
     </g>
   </svg>
   ```

3. **Thresholds** — every k6 threshold that the run evaluated. A
   green bar with a `✓` means the threshold passed; a red bar with a
   `✕` means it failed. The right side shows the actual measured value
   next to the configured limit, e.g. `p(95) = 42 ms < 1.000 ms`.

   ```svg
   <svg viewBox="0 0 600 80" xmlns="http://www.w3.org/2000/svg">
     <g transform="translate(20,14)">
       <rect width="560" height="26" fill="#0b1220" stroke="#2d6a4f" rx="4"/>
       <text x="14" y="17" fill="#8fe8c1" font-family="monospace" font-size="12">✓ http_req_duration</text>
       <text x="546" y="17" text-anchor="end" fill="#dbe5f3" font-family="monospace" font-size="11">p(95) = 42 ms &lt; 1.000 ms</text>
     </g>
     <g transform="translate(20,46)">
       <rect width="560" height="26" fill="#0b1220" stroke="#2d6a4f" rx="4"/>
       <text x="14" y="17" fill="#8fe8c1" font-family="monospace" font-size="12">✓ http_req_failed</text>
       <text x="546" y="17" text-anchor="end" fill="#dbe5f3" font-family="monospace" font-size="11">Rate = 0.00 % &lt; 5 %</text>
     </g>
   </svg>
   ```

4. **Run configuration** — base URL, lastprofil summary, planned
   runtime, payload strategy, run timestamp, and the run ID.

5. **API configuration** — every selected operation with the actual
   parameters, body, and Bearer token that were sent to the target.
   With a payload pool, each row of the pool is listed next to the
   per-payload call count from the k6 summary, so you can verify
   that the `sequential` / `random` strategy actually cycled through
   the rows the way you intended.

6. **Lastprofil & Lastverlauf** — the **ramp-grafik** showing the
   scheduled load (Soll) and the actually achieved load (Ist) over
   time. See [Section 11.3](#113-the-ramp-grafik-load-chart) for a
   full breakdown.

7. **Stages im Detail** — for ramping-vus profiles, a table that
   describes each stage in plain German ("+50 VUs (Rampe auf 50)",
   "Plateau", "−800 VUs (Rampe auf 0)").

8. **Statuscode-Verteilung** — the exact HTTP status codes that the
   run produced, broken down per endpoint. Green bars (`200`,
   `201`, …) are successful responses, yellow (`429`) is
   rate-limiting, red (`5xx`, `err`) is a server-side problem.

   ```svg
   <svg viewBox="0 0 600 180" xmlns="http://www.w3.org/2000/svg">
     <text x="20" y="24" fill="#7d63ff" font-family="Inter, sans-serif" font-size="11" font-weight="600">STATUSCODE-VERTEILUNG</text>
     <g transform="translate(80,60)">
       <line x1="0" y1="0" x2="0" y2="100" stroke="#2c3a52" stroke-width="1"/>
       <line x1="0" y1="100" x2="500" y2="100" stroke="#2c3a52" stroke-width="1"/>
       <rect x="20" y="20" width="40" height="80" fill="#8fe8c1" rx="2"/>
       <text x="40" y="115" text-anchor="middle" fill="#93a2b8" font-family="monospace" font-size="10">200</text>
       <text x="40" y="14" text-anchor="middle" fill="#dbe5f3" font-family="monospace" font-size="10">98</text>
       <rect x="80" y="80" width="40" height="20" fill="#d4a72c" rx="2"/>
       <text x="100" y="115" text-anchor="middle" fill="#93a2b8" font-family="monospace" font-size="10">404</text>
       <text x="100" y="74" text-anchor="middle" fill="#dbe5f3" font-family="monospace" font-size="10">3</text>
       <rect x="140" y="92" width="40" height="8" fill="#d4a72c" rx="2"/>
       <text x="160" y="115" text-anchor="middle" fill="#93a2b8" font-family="monospace" font-size="10">429</text>
       <text x="160" y="86" text-anchor="middle" fill="#dbe5f3" font-family="monospace" font-size="10">1</text>
       <rect x="200" y="92" width="40" height="8" fill="#ffb5c3" rx="2"/>
       <text x="220" y="115" text-anchor="middle" fill="#93a2b8" font-family="monospace" font-size="10">5xx</text>
       <text x="220" y="86" text-anchor="middle" fill="#dbe5f3" font-family="monospace" font-size="10">1</text>
       <rect x="260" y="98" width="40" height="2" fill="#ffb5c3" rx="2"/>
       <text x="280" y="115" text-anchor="middle" fill="#93a2b8" font-family="monospace" font-size="10">err</text>
       <text x="280" y="92" text-anchor="middle" fill="#dbe5f3" font-family="monospace" font-size="10">0</text>
       <rect x="320" y="98" width="40" height="2" fill="#93a2b8" rx="2"/>
       <text x="340" y="115" text-anchor="middle" fill="#93a2b8" font-family="monospace" font-size="10">other</text>
       <text x="340" y="92" text-anchor="middle" fill="#dbe5f3" font-family="monospace" font-size="10">0</text>
     </g>
   </svg>
   ```

9. **Detailed metrics** — extended k6 metrics tables broken down per
   endpoint and per status code (counts, rates, percentiles).

### 11.3 The ramp-grafik (load chart)

When the test completes, the report shows a **ramp-grafik** that
visualises the load over time. Two lines are drawn:

- **Soll (planned)** — purple, solid. Computed deterministically from
  the configured load profile. For a ramping-vus run, the line is a
  staircase: a flat segment for each stage's plateau, with linear ramps
  between consecutive stages.
- **Ist (actual)** — orange, dashed. Drawn from k6's per-second
  VU-count measurements streamed to InfluxDB during the run.

```svg
<svg viewBox="0 0 600 240" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="600" height="240" fill="#0b1220" rx="8"/>
  <text x="20" y="28" fill="#7d63ff" font-family="Inter, sans-serif" font-size="11" font-weight="600">LASTPROFIL &amp; LASTVERLAUF</text>
  <text x="20" y="46" fill="#dbe5f3" font-family="Inter, sans-serif" font-size="13" font-weight="600">Smoke (10 VUs, 30 s)</text>
  <line x1="60" y1="180" x2="580" y2="180" stroke="#2c3a52" stroke-width="1"/>
  <line x1="60" y1="60" x2="60" y2="180" stroke="#2c3a52" stroke-width="1"/>
  <text x="52" y="184" text-anchor="end" fill="#93a2b8" font-family="monospace" font-size="10">0</text>
  <text x="52" y="124" text-anchor="end" fill="#93a2b8" font-family="monospace" font-size="10">5</text>
  <text x="52" y="64" text-anchor="end" fill="#93a2b8" font-family="monospace" font-size="10">10</text>
  <text x="60" y="200" fill="#93a2b8" font-family="monospace" font-size="10">0s</text>
  <text x="320" y="200" fill="#93a2b8" font-family="monospace" font-size="10">15s</text>
  <text x="580" y="200" text-anchor="end" fill="#93a2b8" font-family="monospace" font-size="10">30s</text>
  <polyline points="60,180 80,180 80,80 560,80 560,180" fill="none" stroke="#c5b8ff" stroke-width="2"/>
  <polyline points="60,180 80,180 80,84 200,82 360,78 480,80 560,82" fill="none" stroke="#d4a72c" stroke-width="2" stroke-dasharray="6,4"/>
  <g transform="translate(440,40)">
    <rect width="140" height="40" fill="#111b29" rx="4"/>
    <line x1="10" y1="14" x2="30" y2="14" stroke="#c5b8ff" stroke-width="2"/>
    <text x="36" y="18" fill="#dbe5f3" font-family="Inter, sans-serif" font-size="10">Soll (planned)</text>
    <line x1="10" y1="30" x2="30" y2="30" stroke="#d4a72c" stroke-width="2" stroke-dasharray="4,3"/>
    <text x="36" y="34" fill="#dbe5f3" font-family="Inter, sans-serif" font-size="10">Ist (actual)</text>
  </g>
</svg>
```

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
[Section 14.3](#143-ramp-grafik-shows-only-the-soll-line) for
troubleshooting.

### 11.4 Printing and exporting to PDF

The report is laid out in a print-friendly A4 style sheet. Open the
browser print dialog (`Ctrl/⌘ + P`) and pick **Save as PDF** as the
target. Margins, colours, and page breaks are tuned so that the
resulting PDF is readable on paper and on screen.

---

## 12. The generated k6 script

### 12.1 Inspecting the script

The generated script lives on the dashboard, under the run-detail
tab **k6 script**. You will see a self-contained JavaScript file that:

- imports the k6 standard modules only,
- sets the base URL, VUs, and duration from the form,
- defines one `http.request(...)` call per selected operation,
- attaches headers and a Bearer token where configured,
- applies per-parameter substitution from the form,
- records metrics in named groups so that the report can break down
  results by endpoint.

### 12.2 Downloading the script

Click **k6-Testskript herunterladen (.js)**. The file is downloaded
with the filename `lasttest-<run-id>.js`. It is also served from
`GET /api/test-runs/{id}/script` with `Content-Disposition: attachment`
— useful for CI pipelines that talk to the API directly.

> 🔒 Because the script may contain Bearer tokens or custom headers,
> treat the downloaded file as you would treat a credential: do not
> commit it, do not post it in chat, do not leave it in shared folders.

### 12.3 Running the script outside lasttest

The same script runs against any host with k6 installed:

```bash
# from the dashboard "k6 script" tab or via /api/test-runs/{id}/script
k6 run -e BASE_URL="https://example.test" lasttest-<run-id>.js

# if you only have the script locally and want to keep the original
# base URL embedded in it
k6 run lasttest-<run-id>.js
```

The script reads the base URL from the `BASE_URL` environment variable
first, falling back to the value that was current when the test was
started.

---

## 13. CLI helper scripts

One thin shell script is shipped in the repository root to make the
Docker start a one-liner with a clear success banner.

### 13.1 `docker-start.sh`

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

### 13.2 InfluxDB-UI and Grafana

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

## 14. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `Validieren & importieren` shows an error and no endpoint cards | Spec is invalid YAML / JSON, or the spec declares a Swagger UI URL instead of the document itself | Open the file directly; for Swagger UI, download `/swagger.json` or `/v3/api-docs` instead |
| `Start` button is disabled | No endpoint is selected | Tick at least one checkbox |
| `Start` rejects with “Pflichtparameter … darf nicht leer sein.” | A required parameter is empty in the UI | Fill the highlighted field |
| `Start` rejects with “Request-Body … ist kein gültiges JSON.” | The JSON body editor contains a syntax error | Fix the JSON; the validator points at the line number |
| `BindException: Address already in use` on the backend | Another process is listening on 8286 | `docker compose down` (if the previous container is still running) or `sudo lsof -i :8286` and stop the offending process |
| The status badge stays on `RUNNING` forever | k6 is blocked because the target is slow or unreachable | Cancel the run from the UI, or `docker compose logs lasttest` to see the k6 output |
| Report opens but shows “unbekannte Report-ID” | The lasttest process was restarted since the run finished | Test runs are in-memory only; re-run the test to get a fresh report |
| Bearer-authenticated requests come back as `401` | The placeholder misled you into including the `Bearer ` prefix | Strip the prefix; lasttest adds it for you |
| CORS error in the browser console when calling the target API | The target does not allow cross-origin requests from the frontend | lasttest runs the test from the backend, not the browser — open the report and check the k6 output; the CORS error is from the browser, not from the test |
| `PKIX path building failed: unable to find valid certification path to requested target` | The target API uses a TLS certificate that is not trusted by the JVM (self-signed, internal CA, missing intermediate) | See [Section 14.1 — Trusting custom TLS certificates](#141-trusting-custom-tls-certificates) |
| k6 run logs contain `x509: certificate signed by unknown authority` (but the spec import worked) | The backend TrustStore is fine, but k6 itself has not been told about the custom CA | Set `SSL_CERT_FILE` — see [Section 14.1.1](#1411-the-k6-side-ssl_cert_file) |
| The ramp-grafik shows only the Soll line, no Ist line | InfluxDB is not reachable, or no data was written during the run | See [Section 14.2](#142-influxdb-is-not-reachable) and [14.3](#143-ramp-grafik-shows-only-the-soll-line) |
| Right-click on a run row does nothing | Cursor outside the row, browser extension suppressing contextmenu, or mid-transition render | See [Section 14.4](#144-right-click-menu-does-not-appear) |
| Toolbar language pill shows the wrong language | A previous session's `localStorage` entry is stale, or the browser blocks storage in private mode | See [Section 6.2](#62-settings-drawer-language-switch) — pick the language again; the selection falls back to English if `localStorage` is unavailable |
| k6 run logs contain `could not create the 'influxdb' output: unknown query parameter: org` | The InfluxDB image version is 2.x; k6 v2 only supports InfluxDB v1 | Use the bundled Compose file (it ships with InfluxDB 1.11) |

### 14.1 Trusting custom TLS certificates

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

#### 14.1.1 The k6 side: `SSL_CERT_FILE`

The TrustStore above only covers the **lasttest backend** — i.e. Step 1's spec import over HTTPS. k6 runs as a separate process and uses Go's TLS stack; it does **not** read the Java TrustStore. Without configuring k6 separately, the spec import succeeds but the actual load test fails with `x509: certificate signed by unknown authority` in the k6 logs.

k6 reads its CA bundle from the standard Go environment variable:

| Variable | Required | Description |
| --- | --- | --- |
| `SSL_CERT_FILE` | recommended | Absolute path to a PEM file containing the CA certificate(s) k6 should trust. Multiple `-----BEGIN CERTIFICATE-----` blocks in one file are fine. |

```bash
# Reuse the same PEM you mounted for the backend
export SSL_CERT_FILE=/etc/lasttest/custom-ca.pem
```

> **Important — `SSL_CERT_FILE` replaces, it does not layer.** Unlike the Java TrustStore (which *adds* your certificates on top of the JVM defaults), `SSL_CERT_FILE` *replaces* the system CA bundle for k6. Use it only when every target your tests hit is signed by the same custom CA, or concatenate multiple CA certificates into one PEM.

#### 14.1.2 Bundled Docker Compose workflow

The shipped `docker-compose.yml` already wires both sides for you. The relevant block:

```yaml
volumes:
  - ./certs/custom-ca.pem:/etc/lasttest/custom-ca.pem:ro
environment:
  LASTTEST_TRUSTSTORE_PATH: /etc/lasttest/custom-ca.pem
  LASTTEST_TRUSTSTORE_PASSWORD: ""
  SSL_CERT_FILE: /etc/lasttest/custom-ca.pem
```

Drop your company's root CA (PEM format, possibly with multiple `-----BEGIN CERTIFICATE-----` blocks) at `certs/custom-ca.pem` on the host, then restart the container:

```bash
docker compose restart lasttest
```

The mounted path inside the container is read-only, so the certificate is never accidentally written to.

#### 14.1.3 Verifying the certificate is loaded

After restart, the backend logs show one of these lines:

```
Lade zusätzlichen TrustStore aus /etc/lasttest/custom-ca.pem (Variable LASTTEST_TRUSTSTORE_PATH) …
TrustStore /etc/lasttest/custom-ca.pem erfolgreich geladen.
```

If you instead see `TrustStore unter … konnte nicht geladen werden (…)`, the file is unreadable, malformed, or not a valid PEM/PKCS12/JKS — the backend falls back to the JVM defaults and the TLS error will resurface at the next request.

For k6, the certificate validation happens during the run itself: k6 logs `x509: certificate signed by unknown authority` on every failing request, and the run's report surfaces the same error in the *Console / JSON* section. If the spec import worked but the run still fails, `SSL_CERT_FILE` is missing or unreadable by the k6 process.

#### 14.1.4 Local development mode

When you run the backend without Docker (`./gradlew bootRun` plus `npm run dev`), export the variables in the same shell that launches the backend and (separately) the host k6 binary:

```bash
export LASTTEST_TRUSTSTORE_PATH=$PWD/certs/custom-ca.pem
export LASTTEST_TRUSTSTORE_PASSWORD=
export SSL_CERT_FILE=$PWD/certs/custom-ca.pem

# 1) start the backend in the same shell
./gradlew bootRun

# 2) start a host k6 binary (NOT the Docker one) in the same shell
#    so it inherits SSL_CERT_FILE; the backend spawns `k6 run` on PATH.
```

`./gradlew bootRun` reads its environment from the launching shell, so the export must be visible to Gradle. Tools like `direnv` or a project-local `.envrc` work well for keeping the variables sticky without polluting your global shell.

#### 14.1.5 Limitations

- **Server certificates only.** lasttest trusts *additional* server certificates — there is no UI for client certificates (mTLS). If your target API requires a client cert / client key, you have to add that support outside lasttest (for example a reverse proxy in front of k6 that terminates the client-cert side).
- **One PEM for k6.** `SSL_CERT_FILE` *replaces* the system bundle; if you load-test multiple targets signed by different internal CAs, concatenate the certificates into one PEM (each in its own `-----BEGIN CERTIFICATE-----` block) or use the `SSL_CERT_DIR` variable to point at a directory of PEM files instead.
- **Restart required.** The TrustStore is loaded once at backend startup; `SSL_CERT_FILE` is read once per k6 process. Changing either requires restarting the backend container / process and re-running the k6 test.

### 14.2 InfluxDB is not reachable

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

### 14.3 Ramp-grafik shows only the Soll line

Two reasons are common:

1. **InfluxDB was unreachable** (see above). The backend returns an
   empty time-series array; the SVG renderer draws only the Soll line
   and the "Tatsächliche Spitze" callout shows "–".
2. **The run was very short** (< 2 s). k6 may not have written enough
   per-second samples to InfluxDB yet. Wait for the next run.

If neither applies, check the k6 container's logs for
`could not write stats, ...` warnings — they indicate the k6 → InfluxDB
write path is broken.

### 14.4 Right-click menu does not appear

The run-row context menu is opened with `onContextMenu` on the row
button. If a right-click on a row does nothing, walk through these
checks:

1. **You clicked the detail card, not the row.** The row lives in the
   `Letzte Läufe` panel (above the detail card). Right-click there.
2. **The row is focused but you right-clicked outside it.** Move the
   cursor over the row itself (the coloured chip with method,
   status and path) before right-clicking. The menu opens at the
   cursor location, so the cursor has to be on the row.
3. **Your browser overrode the menu.** Some kiosk / accessibility
   extensions suppress the browser context menu and with it
   lasttest's own menu. Disable the extension for the lasttest
   origin or use the keyboard alternative: focus the row with
   `Tab` and press the context-menu key (`Menu` on most keyboards,
   `Shift + F10` is the universal fallback).
4. **The run is mid-transition.** A run that just entered `STOPPING`
   re-renders very quickly; if you right-clicked during that frame
   the menu might have opened against the previous status and closed
   itself when the badge re-rendered. Click the badge once to
   re-focus it, then right-click again.

If none of the above helps, open the browser dev tools and check for
JavaScript errors after the right-click — the menu mount is wrapped
in a single effect that logs to the console on failure.

---

## 15. Glossary

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
| **Run row** | A single row in the `Letzte Läufe` panel that represents one test run. Shows method, status badge, path, a `× N` test counter, a meta string and a relative `when` stamp; left-click focuses it, right-click opens the action menu. |
| **`× N` test counter** | Small chip next to each run row's operation name that shows how many times the same `(method, path)` pair has been tested before. Sourced from `/api/operations/stats`, polled every 5 s, falls back to `neu` on cold start. |
| **Action menu (run row)** | Context menu that opens on right-click on a run row in the `Letzte Läufe` panel. Items adapt to the run's status (in-flight vs. terminal). Offers stop, force-abort, rerun, copy actions, export. |
| **Payload pool** | An ordered list of datasets (parameter values + request body + Bearer token) attached to a single endpoint. k6 walks through the pool according to the chosen strategy (sequential or random). |
| **Payload strategy** | How the runner picks the next payload from the pool each iteration: `sequential` (round-robin, wraps around) or `random` (uniform pick). With a one-row pool the two are identical. |
| **Settings drawer** | Slide-in modal opened from the gear in the top toolbar. Currently exposes the Language section for switching between English and German. Persists the choice in `localStorage`. |
| **Doc popup** | Centred markdown modal opened from the toolbar (User Guide / README). Bilingual, with live search (`Ctrl/⌘ + F`), prev/next match navigation and Esc to close. |
| **STOPPING** | Transient state of a test run after the user clicked *Stop (graceful)* but before k6 has actually exited. The badge stays polled until it transitions to `STOPPED` or `ABORTED`. |
| **STOPPED** | Terminal state after a graceful `SIGTERM` cancellation. Thresholds evaluated up to the stop are still reported. |
| **ABORTED** | Terminal state after a forced `SIGKILL` cancellation (or a `STOPPING → force` escalation). Only partial counters may be present; the threshold evaluation is not meaningful. |
| **Rerun** | Action that re-queues the `CreateTestRunRequest` of an existing terminal run with a fresh run id. Triggered from the right-click menu on terminal rows. |

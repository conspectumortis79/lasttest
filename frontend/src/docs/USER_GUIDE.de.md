# lasttest — Benutzerhandbuch

> Eine praktische End-to-End-Anleitung für **lasttest**, die Swagger-/
> OpenAPI-gestützte Lasttest-Werkbank auf Basis von Spring Boot, React
> und k6.

---

## Inhaltsverzeichnis

1. [Was lasttest ist — und was nicht](#1-was-lasttest-ist--und-was-nicht)
2. [Unterstützte Plattformen](#2-unterstützte-plattformen)
3. [Installation](#3-installation)
   - 3.1 [Docker (empfohlen)](#31-docker-empfohlen)
   - 3.2 [Docker mit InfluxDB + Grafana (Zeitreihen)](#32-docker-mit-influxdb--grafana-zeitreihen)
   - 3.3 [Lokales Entwicklungs-Setup](#33-lokales-entwicklungs-setup)
4. [Erster Start und die Demo-API](#4-erster-start-und-die-demo-api)
   - 4.1 [Demo laden](#demo-laden)
   - 4.2 [Demo an- und ausschalten](#demo-an-und-ausschalten)
5. [Der Haupt-Workflow auf einen Blick](#5-der-haupt-workflow-auf-einen-blick)
6. [Obere Toolbar, Einstellungen und Sprache](#6-obere-toolbar-einstellungen-und-sprache)
   - 6.1 [Aufbau der Toolbar](#61-aufbau-der-toolbar)
   - 6.2 [Einstellungs-Schublade (Sprachumstellung)](#62-einstellungs-schublade-sprachumstellung)
   - 6.3 [In-App-Dokumentations-Popups](#63-in-app-dokumentations-popups)
     - 6.3.1 [Suche über Walkthrough-Steps](#631-suche-über-walkthrough-steps)
7. [Schritt 1 — Spezifikation importieren](#7-schritt-1--spezifikation-importieren)
   - 7.1 [Akzeptierte Formate](#71-akzeptierte-formate)
   - 7.2 [Swagger-UI-URLs](#72-swagger-ui-urls)
   - 7.3 [Was *kein* importierbares Dokument ist](#73-was-kein-importierbares-dokument-ist)
   - 7.4 [Swagger 2.0 importieren](#74-swagger-20-importieren)
8. [Schritt 2 — Endpunkte wählen und konfigurieren](#8-schritt-2--endpunkte-wählen-und-konfigurieren)
   - 8.1 [Auswahl und schreibende Operationen](#81-auswahl-und-schreibende-operationen)
   - 8.2 [Anatomie der Endpunkt-Karte](#82-anatomie-der-endpunkt-karte)
   - 8.3 [Parameter pro Endpunkt](#83-parameter-pro-endpunkt)
   - 8.4 [Request-Body (JSON)](#84-request-body-json)
   - 8.5 [Bearer-Token](#85-bearer-token)
   - 8.6 [Payload-Pool — mehrere Datensätze pro Endpunkt](#86-payload-pool--mehrere-datensätze-pro-endpunkt)
9. [Schritt 3 — Lastprofil wählen](#9-schritt-3--lastprofil-wählen)
   - 9.1 [Base-URL und Server-Auswahl](#91-base-url-und-server-auswahl)
   - 9.2 [Die vier Lastprofil-Exekutoren](#92-die-vier-lastprofil-exekutoren)
     - 9.2.1 [Constant-VUs (Standard)](#921-constant-vus-standard)
     - 9.2.2 [Shared-Iterations](#922-shared-iterations)
     - 9.2.3 [Ramping-VUs](#923-ramping-vus)
     - 9.2.4 [Constant-Arrival-Rate](#924-constant-arrival-rate)
   - 9.3 [Presets](#93-presets)
   - 9.4 [Stages bearbeiten](#94-stages-bearbeiten)
   - 9.5 [Payload-Strategie — sequenziell vs. zufällig](#95-payload-strategie--sequenziell-vs-zufällig)
   - 9.6 [Validierung und Limits](#96-validierung-und-limits)
10. [Schritt 4 — Test starten und Ergebnis lesen](#10-schritt-4--test-starten-und-ergebnis-lesen)
    - 10.1 [Das Multi-Run-Dashboard](#101-das-multi-run-dashboard)
      - 10.1.1 [Rechtsklick auf ein Badge öffnet das Aktions-Menü](#1011-rechtsklick-auf-ein-badge-öffnet-das-aktions-menü)
    - 10.2 [Das Aktions-Menü am Run-Badge (Rechtsklick)](#102-das-aktions-menü-am-run-badge-rechtsklick)
    - 10.3 [Live-Status](#103-live-status)
    - 10.4 [Diagnose, Metriken, Konsolenausgabe und Roh-JSON](#104-diagnose-metriken-konsolenausgabe-und-roh-json)
    - 10.5 [Erneut ausführen](#105-erneut-ausführen)
11. [Schritt 5 — Den ausführlichen k6-Report lesen](#11-schritt-5--den-ausführlichen-k6-report-lesen)
    - 11.1 [Report öffnen](#111-report-öffnen)
    - 11.2 [Sektionen des Reports](#112-sektionen-des-reports)
    - 11.3 [Die Ramp-Grafik (Lastverlauf)](#113-die-ramp-grafik-lastverlauf)
    - 11.4 [Drucken und als PDF exportieren](#114-drucken-und-als-pdf-exportieren)
12. [Das generierte k6-Skript](#12-das-generierte-k6-skript)
    - 12.1 [Skript ansehen](#121-skript-ansehen)
    - 12.2 [Skript herunterladen](#122-skript-herunterladen)
    - 12.3 [Skript außerhalb von lasttest ausführen](#123-skript-außerhalb-von-lasttest-ausführen)
13. [CLI-Hilfsskripte](#13-cli-hilfsskripte)
    - 13.1 [`docker-start.sh`](#131-docker-startsh)
    - 13.2 [InfluxDB-UI und Grafana](#132-influxdb-ui-und-grafana)
14. [Fehlerbehebung](#14-fehlerbehebung)
    - 14.1 [Eigene TLS-Zertifikate vertrauen](#141-eigene-tls-zertifikate-vertrauen)
      - 14.1.1 [Die k6-Seite: `SSL_CERT_FILE`](#1411-die-k6-seite-ssl_cert_file)
      - 14.1.2 [Mitgelieferter Docker-Compose-Workflow](#1412-mitgelieferter-docker-compose-workflow)
      - 14.1.3 [Zertifikat verifizieren](#1413-zertifikat-verifizieren)
      - 14.1.4 [Lokaler Entwicklungsmodus](#1414-lokaler-entwicklungsmodus)
      - 14.1.5 [Einschränkungen](#1415-einschränkungen)
    - 14.2 [InfluxDB ist nicht erreichbar](#142-influxdb-ist-nicht-erreichbar)
    - 14.3 [Ramp-Grafik zeigt nur die Soll-Linie](#143-ramp-grafik-zeigt-nur-die-soll-linie)
    - 14.4 [Rechtsklick-Menü erscheint nicht](#144-rechtsklick-menü-erscheint-nicht)
15. [Glossar](#15-glossar)

---

## 1. Was lasttest ist — und was nicht

**lasttest ist**

- eine schlanke Web-Anwendung, die ein OpenAPI- / Swagger-Dokument in
  k6-basierte Lasttests verwandelt,
- eine *Konfigurations-UI* über die Operationen, die die Spec
  beschreibt,
- ein *Runner* für k6 im selben Container, mit Live-Status-Updates
  und einem druckoptimierten Report,
- ein *Generator* für eigenständige, reproduzierbare k6-Skripte, die
  auf jedem k6-fähigen Host lauffähig sind.

**lasttest ist nicht**

- eine k6-IDE. Es erzeugt Standard-k6-Skripte, die du auch per Hand
  ausführen kannst.
- ein Multi-Tenant-SaaS. Es ist ein Single-Binary-,
  Single-Process-Werkzeug.
- ein Security-Scanner oder API-Fuzzer. Es führt nur die Operationen
  aus, die du auswählst, mit den Parametern, die du vorgibst.
- ein Langzeit-Speicher für Testergebnisse. Läufe werden im Speicher
  gehalten und sind beim Neustart des Prozesses weg.

---

## 2. Unterstützte Plattformen

`lasttest` wird entwickelt und getestet auf:

- **Linux** (x86_64, arm64) — primäres Ziel.
- **macOS** (Apple Silicon und Intel) — voll unterstützt.

Das offizielle Docker-Image ist Multi-Arch (`linux/amd64`,
`linux/arm64`) und läuft auf beiden identisch.

**Windows wird nicht unterstützt.** Das Repository liefert keinen
Windows-spezifischen Launcher mehr aus. Wenn du lasttest auf Windows
brauchst, verwende das Docker-Image unter WSL 2 mit Docker Desktop
oder Rancher Desktop. Der native Windows-Launcher wurde entfernt.

> ℹ️ Entfernte Dateien: `start-windows.bat`, `docker-start.bat`.
> Verwende die Linux- / macOS-Skripte oder das Docker-Image.

---

## 3. Installation

Du hast zwei Optionen. Wähle die, die zu deinem Anwendungsfall passt.

### 3.1 Docker (empfohlen)

**Voraussetzung:** Docker Engine 24+ mit `docker compose` v2.

```bash
# Image einmal bauen
docker build -t lasttest:latest .

# im Hintergrund starten
docker run -d --name lasttest -p 8286:8286 --restart unless-stopped \
  lasttest:latest
```

Oder mit dem mitgelieferten Compose-File:

```bash
docker compose up --build -d
```

lasttest ist anschließend unter **http://localhost:8286** erreichbar.

Startup-Log verfolgen:

```bash
docker logs -f lasttest
```

Stoppen:

```bash
docker compose down
# oder, wenn du mit `docker run` gestartet hast:
docker stop lasttest && docker rm lasttest
```

### 3.2 Docker mit InfluxDB + Grafana (Zeitreihen)

Der Standard-Aufruf `docker compose up` startet nur lasttest. Für die
**Ramp-Grafik** im Report (siehe [Abschnitt 11.3](#113-die-ramp-grafik-lastverlauf))
brauchst du zusätzlich eine InfluxDB-Instanz, an die k6 seine
Per-Sekunden-Metriken streamt. Das Compose-File liefert InfluxDB 1.11
und Grafana als optionale Services. Sie starten automatisch, wenn du
`docker compose up` ohne Argumente verwendest — kein zusätzlicher
Befehl nötig.

```bash
docker compose up -d --build
```

Nach dem Start siehst du drei gesunde Container:

| Container | Port | Zweck |
| --- | --- | --- |
| `lasttest` | 8286 | Spring Boot + Frontend-Bundle |
| `lasttest-influxdb` | 8086 | InfluxDB 1.11, empfängt die Per-Sekunden-Metriken von k6 |
| `lasttest-grafana` | 3000 | optional, für Ad-hoc-Exploration der Roh-Zeitreihen |

InfluxDB und Grafana nutzen benannte Volumes
(`lasttest_influxdb-data`, `lasttest_grafana-data`), damit die Daten
Container-Neustarts überleben.

Die Zugangsdaten sind im Image hinterlegt (und absichtlich kein
Geheimnis, weil sie nur für lokale Entwicklung relevant sind):

| Service | URL | Zugangsdaten |
| --- | --- | --- |
| lasttest-UI | http://localhost:8286 | — |
| InfluxDB-UI | http://localhost:8086 | `admin` / `lasttest-admin-password` |
| Grafana | http://localhost:3000 | `admin` / `admin` (anonymer Viewer aktiviert) |

Wenn du **kein** InfluxDB willst, übergib beim Start
`LASTTEST_INFLUXDB_ENABLED=false`. Die Ramp-Grafik zeigt dann nur die
Soll-Linie; alles andere funktioniert weiter.

### 3.3 Lokales Entwicklungs-Setup

**Voraussetzungen:**

| Werkzeug | Version | Zweck |
| --- | --- | --- |
| JDK | 25 oder neuer | betreibt das Spring-Boot-Backend |
| Node.js | 22 oder neuer | baut das React-Frontend |
| k6 | aktueller Stable | führt die generierten Skripte aus |
| Bash | 4+ | führt die Hilfsskripte aus |
| `curl` | beliebig aktuell | Health-Checks in den Skripten |

Auf Debian / Ubuntu:

```bash
sudo apt-get update
sudo apt-get install -y openjdk-25-jdk-headless nodejs npm curl
# k6 — siehe https://k6.io/docs/getting-started/installation/
sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6
```

Auf macOS (mit [Homebrew](https://brew.sh/)):

```bash
brew install openjdk@25 node k6
# JDK 25 als Default für die aktuelle Shell:
export JAVA_HOME="$(brew --prefix openjdk@25)/libexec/openjdk.jdk/Contents/Home"
```

Dann beide Services manuell starten:

```bash
# Terminal 1 — Backend auf :8286
cd backend
./gradlew bootRun

# Terminal 2 — Frontend auf :5173
cd frontend
npm install
npm run dev
```

> **Hinweis**: `./gradlew bootRun` ist ein blockierender Task — Gradle
> bleibt im Vordergrund und zeigt weiter einen Fortschrittsbalken
> (`EXECUTING [Ns]`), bis du `Ctrl+C` drückst, obwohl die
> Spring-Boot-App bereits hochgefahren ist. Sobald im Log
> `Started LasttestApplicationKt in N.N seconds` erscheint, ist die
> API auf `http://localhost:8286/` erreichbar. Öffne die Dev-UI-URL
> unten im Browser, während der Gradle-Prozess weiterläuft.

Im Dev-Modus werden zwei URLs ausgeliefert; sie sind **nicht**
austauschbar:

| URL | Was wird bedient |
| --- | --- |
| <http://localhost:5173> | **Web-UI** (Vite Dev-Server mit Hot-Reload) — öffne das im Browser |
| <http://localhost:8286> | **nur API** (Spring Boot, JSON) — gibt auf `/` Whitelabel-404 zurück, weil das Frontend-Bundle im Dev-Modus nicht gebaut ist |

Für ein Single-URL-Deployment, bei dem das Backend API und UI auf
Port 8286 bedient, verwende stattdessen `./docker-start.sh` (oder
`docker compose up --build`).

---

## 4. Erster Start und die Demo-API

Das Repository enthält eine kleine, aber vollständige Demo-API unter
`demo/openapi-demo.yaml`. Sie übt die vier Authentifizierungs-Schemata,
die lasttest erkennt, plus die Request-Shapes, die lasttest am
meisten interessieren:

- **GET** mit Query- und Pfadparametern
- **POST** mit JSON-Body
- **HTTP-Basic**-Authentifizierung, demonstriert durch
  `GET /products/admin/stats`
- **HTTP-Bearer**-Authentifizierung, demonstriert durch
  `POST /products/search`
- **API Key** in einem eigenen Header, demonstriert durch
  `GET /products/lookup-by-id`
- **OAuth 2.0**-Access-Tokens, demonstriert durch
  `GET /products/me`
- **OpenID Connect (OIDC)**-ID-Tokens, demonstriert durch
  `GET /products/my-profile`

Nach dem Import betreibt lasttest selbst einen winzigen In-Process-
Server, der die gleichen Pfade unter `/demo-api/*` beantwortet. Das
Demo-Backend ist strikt — jeder Auth-Endpunkt akzeptiert **nur** die
exakten Demo-Credentials und antwortet sonst `401`, so dass ein
Tippfehler im Pool-Editor-Eingabefeld sofort im k6-Report sichtbar
wird, statt unbemerkt durchzurutschen. Damit kannst du den
kompletten End-to-End-Flow ausführen — Import → Konfiguration →
Run → 200/401 im Report beobachten — ohne externe Abhängigkeit.

> 💡 Die Demo-API in lasttest ist **kein** echter Persistenz-Layer.
> Die Daten werden aus den URL-Parametern erzeugt und nach der
> Antwort verworfen. Sie existiert, damit Einsteiger die volle
> Pipeline auf einer einzelnen Maschine laufen sehen können.

### Demo laden

1. Öffne die App unter <http://localhost:5173> (lokal) oder
   <http://localhost:8286> (Docker).
2. Die Swagger-Textarea ist bereits mit der gebündelten Demo
   vorbelegt. Falls sie leer ist, klick **Datei öffnen** und wähle
   `demo/openapi-demo.yaml` aus dem Repository.
3. Klick **Validieren & importieren**.

Du solltest eine Karte mit sechs Operationen sehen (zwei read-only
GETs und vier schreibende Writes). Die erste read-only-Operation ist
als sicherer Startpunkt vorausgewählt — jede andere Operation, auch
die verbleibende read-only, muss explizit angehakt werden.

### Demo an- und ausschalten

Die Demo ist Opt-in. Die Einstellungs-Schublade (obere Toolbar → **⚙
Zahnrad**) bietet einen **Demo-API**-Hauptschalter in einem eigenen
Abschnitt an. Der Schalter ist der einzige Weg, die Demo an- oder
auszuschalten — es gibt keine Auto-Erkennung, keinen versteckten
Default, keine URL-Magie. Der gebündelte `/demo-api/*`-Server, der
`/?demo-traffic`-Dashboard-Link in der oberen Toolbar, die
`/demo-swagger-ui`-Seite und die gebündelte `openapi-demo.yaml`
hängen alle an diesem einen Schalter.

Der Schalter ist eine **prozessweite** Einstellung (nicht pro
Benutzer) und wird in `localStorage` unter `lasttest.demo.enabled`
gespeichert, so dass die Wahl einen Reload und einen neuen Tab
überlebt.

**Was beim Umschalten passiert — in beide Richtungen:**

| Richtung | Effekt |
| --- | --- |
| **Aus → An** (aktivieren) | Die gebündelte `openapi-demo.yaml` wird von `/api/demo-specification` geladen und in die Swagger-Textarea geschrieben. Der `Demo-API`-Link erscheint in der oberen Toolbar (mit "Aktiv"-Pille, solange der Schalter an bleibt). `/demo-api/*` und `/demo-swagger-ui` antworten wieder. |
| **An → Aus** (deaktivieren) | Die Swagger-Textarea wird auf das leere Sample zurückgesetzt. Der `Demo-API`-Link verschwindet aus der Toolbar. `/demo-api/*` und `/demo-swagger-ui` antworten wieder mit 404. |

**Beide Richtungen lösen einen kompletten Dashboard-Reset aus —
genau wie ein Reload der Seite.** Was auch immer der Benutzer vor
dem Umschalten auf dem Bildschirm hatte, gehört zur vorherigen
Session, also ist das Umschalten ein harter Schnitt:

- Jeder laufende k6-Run wird mit dem gleichen sanften `SIGTERM`
  abgebrochen, den auch der Inline-Stop-Button sendet, so dass die
  k6-Prozesse verschwinden, bevor der Rest des States gelöscht
  wird. Der Cancel-Request ist best-effort: Wenn das Backend den
  Run bereits abgeschlossen hat, ist der Call ein No-op.
- Die Runs-Map wird geleert — keine Badges, keine Detail-Karte,
  kein Run-Menü-State.
- Die importierte Spec wird vergessen — die Operations-Karte
  (Schritt 2) verschwindet, die `selected` / `collapsed` /
  `operationSettings`-Sets werden verworfen.
- Das Lastprofil wird auf den Default zurückgesetzt
  (`constant-vus`, 10 VUs für 30 s). Preset-Auswahl,
  Exekutor-Wechsel oder Feldjustierungen werden zurückgenommen.
- Die Fehler- und Run-Action-Banner werden geleert.
- Das Rechtsklick-Kontextmenü an einem Run-Badge, falls es offen
  war, wird geschlossen.

> 💡 **Warum der Reset symmetrisch ist.** Die Demo umzuschalten
> bedeutet: "Ich will eine saubere Session gegen das
> Demo-Backend". Egal, ob der Benutzer in die Demo wechselt
> (aus → an) oder aus ihr heraus (an → aus), die vorherigen
> Inhalte des Dashboards sind veraltet: importierte Endpunkte
> waren für das vorherige Backend ausgewählt, das Lastprofil
> war auf das vorherige Ziel abgestimmt, und ein laufender Run
> trifft den falschen Server. Das Dashboard in beide Richtungen
> zurückzusetzen ist der einzige Weg, die zwei mentalen Modelle
> — "Ich teste die Demo" und "Ich teste meine eigene API" —
> strikt getrennt zu halten. Wer seine Konfiguration behalten
> will, beendet den aktuellen Test, kopiert die Einstellungen
> händisch heraus und schaltet dann erst um.


---

## 5. Der Haupt-Workflow auf einen Blick

lasttest ist in vier nummerierte Karten gegliedert:

1. **Swagger / OpenAPI-Dokumentation** — Spec einfügen oder hochladen.
2. **<title> v<version>** — Endpunkte wählen und konfigurieren.
3. **Lastprofil** — Exekutor wählen (constant-vus,
   shared-iterations, ramping-vus, constant-arrival-rate), Felder
   justieren, optional ein Preset laden (Smoke, Load, Stress, Spike,
   Soak, Arrival-Rate) und die **Payload-Strategie** festlegen
   (sequenziell oder zufällig — siehe [Abschnitt 9.5](#95-payload-strategie--sequenziell-vs-zufällig)).
4. **Testlauf** — starten, beobachten und Ergebnis prüfen. Ein
   **Rechtsklick auf ein Run-Badge** öffnet ein Aktions-Menü mit
   *Stop*, *Force Abort*, *Erneut ausführen* (Rerun), *Run-ID
   kopieren*, *Report-Link kopieren*, *Report öffnen* und
   *k6-JSON exportieren* (Details in
   [Abschnitt 10.2](#102-das-aktions-menü-am-run-badge-rechtsklick)).

Du gehst von oben nach unten vor. Jeder Schritt ist unabhängig und
idempotent: du kannst eine Spec neu importieren, Endpunkte neu
konfigurieren oder das Lastprofil ändern, ohne die anderen zu
verlieren.

Der Report in Schritt 4 enthält eine
[Ramp-Grafik](#113-die-ramp-grafik-lastverlauf), die die Last
vergleicht, die du *geplant* hast (Soll), mit der Last, die k6
tatsächlich erzeugt hat (Ist). Die Ist-Linie ist nur verfügbar, wenn
InfluxDB läuft; siehe [Abschnitt 3.2](#32-docker-mit-influxdb--grafana-zeitreihen).

---

## 6. Obere Toolbar, Einstellungen und Sprache

Eine sticky-Bar läuft am oberen Rand der Anwendung. Sie enthält die
Marke, die primäre Navigation, eine passive Sprach-Pille und den
Settings-Button. Die Toolbar-Chrome selbst folgt der in der
Settings-Schublade gewählten Sprache (siehe
[Abschnitt 6.2](#62-einstellungs-schublade-sprachumstellung)), sodass
dieselbe UI englische oder deutsche Beschriftungen ohne Page-Reload
anzeigt.

### 6.1 Aufbau der Toolbar

```
┌───────────────────────────────────────────────────────────────────────┐
│ [k6] lasttest     Dashboard  User Guide  README   …  🇬🇧 EN   ⚙        │
└───────────────────────────────────────────────────────────────────────┘
```

| Element | Zweck |
| --- | --- |
| **k6-Mark + lasttest** | Statische Marke; das Mark verwendet die gleiche Farbe wie das k6-Logo, um zu signalisieren, dass lasttest die um k6 herum gebaute Lasttest-Werkbank ist. |
| **Dashboard** | Platzhalter-Link, der immer die aktuelle Kartenansicht repräsentiert. Markiert als `aria-current="page"`. |
| **User Guide** | Öffnet die gebündelte `USER_GUIDE.md` als durchsuchbares Markdown-Popup — siehe [Abschnitt 6.3](#63-in-app-dokumentations-popups). |
| **README** | Öffnet die gebündelte `README.md` als durchsuchbares Markdown-Popup. |
| **🇬🇧 EN** (Sprach-Pille) | Read-only-Anzeige der aktiven Sprache; Icon und Code wechseln mit der Auswahl (🇩🇪 DE für Deutsch). Über das Zahnrad daneben wird die Sprache geändert. |
| **⚙ Zahnrad** | Öffnet die [Settings-Schublade](#62-einstellungs-schublade-sprachumstellung). |

Die Toolbar ist tastaturbedienbar (`tabindex` läuft von links nach
rechts) und Screenreader-freundlich (`aria-label`s benennen jedes
Steuerelement). Sie wird von `TopToolbar.tsx` gerendert; das Popup
von `DocPopup.tsx`. Beide leben in `frontend/src/`.

### 6.2 Einstellungs-Schublade (Sprachumstellung)

Ein Klick auf das Zahnrad öffnet eine Slide-in-Schublade von der
rechten Viewport-Kante. Die Schublade ist modal: Sie fängt den Fokus
ein, solange sie offen ist, und schließt auf `Esc`, auf Backdrop-Klick
und auf den Close-Button. Die Schublade bietet drei Abschnitte —
**Sprache**, **Benachrichtigungen** und **Demo-API** — damit jeder
benutzerorientierte Schalter an einer Stelle lebt. Der
Sprache-Abschnitt ist der einzige, der die Lokalisierungs-Chrome
beeinflusst; die anderen beiden sind in eigenen Unterabschnitten
beschrieben.

**Sprache wechseln, Schritt für Schritt:**

1. Klick auf das **⚙ Zahnrad** in der oberen Toolbar. Die Schublade
   schiebt sich von rechts herein und der Fokus wandert auf den
   Close-Button.
2. Unter der Überschrift **Sprache** siehst du zwei Radio-Zeilen:
   - **🇬🇧 English** — rechts mit `Default` beschriftet.
   - **🇩🇪 Deutsch** — rechts mit `German` beschriftet.
3. Klick auf den Radio deiner Wahl. Die gesamte UI rendert sofort
   neu: Toolbar-Labels, Settings-Texte, Walkthrough, Status-Pills,
   Fehlermeldungen und die Markdown-Dokumentations-Popups kippen
   alle auf die neue Sprache.
4. Die Auswahl wird in **`localStorage`** unter dem Schlüssel
   `lasttest.language` **gespeichert**. Reload der Seite oder erneuter
   Besuch von lasttest in einem neuen Tab behält die gewählte Sprache.
5. Schließe die Schublade mit `Esc`, dem Close-Button oder einem
   Klick auf den abgedunkelten Backdrop.

> 💡 **Demo-API umschalten.** Der dritte Abschnitt der Schublade
> trägt den **Demo-API**-Hauptschalter. An aktiviert den
> gebündelten `/demo-api/*`-Server und den
> `/?demo-traffic`-Dashboard-Link; aus deaktiviert beides. **Beide
> Richtungen wischen das Dashboard** — jeder laufende k6-Test
> wird abgebrochen (das gleiche sanfte `SIGTERM`, das der
> Inline-Stop-Button sendet), die importierte Spec wird vergessen
> und das Lastprofil wird auf den Default zurückgesetzt. Das
> vollständige Verhalten ist in
> [Abschnitt 4.2](#demo-an-und-ausschalten) dokumentiert. Die
> Auswahl wird in `localStorage` unter `lasttest.demo.enabled`
> gespeichert.

> 💡 **Beispiel — Sprachumstellung auf Deutsch für eine Demo-Session:**
> Du startest lasttest in Englisch, weil das README dich hierher
> geführt hat. Für einen Verkaufs-Call mit einem deutschsprachigen
> Team willst du alle Beschriftungen auf Deutsch: Klick ⚙, wähle
> **🇩🇪 Deutsch**, schließe die Schublade. Die Toolbar zeigt nun
> `Dashboard / User Guide / README / DE`, die Status-Pills rendern
> `EINGEREIHT`, `LÄUFT`, `GESTOPPT`, `BESTANDEN`,
> `FEHLGESCHLAGEN`, `ABGEBROCHEN`, und das Rechtsklick-Menü an
> einem Run-Badge sagt **Erneut ausführen** statt *Rerun*. Lade die
> Seite neu — Deutsch ist weiterhin aktiv. Um zu Englisch
> zurückzukehren, klick erneut ⚙ und wähle **🇬🇧 English**.

Die Schublade wird von `SettingsDrawer.tsx` implementiert. Die
Radio-Einträge werden aus einer einzigen Registry gelesen
(`i18nRegistry.ts`), sodass das Hinzufügen einer dritten Sprache
eine Ein-Datei-Änderung ist: Code zu `SUPPORTED_LANGUAGES`
hinzufügen und die Schlüssel im Dictionary in `i18n.ts` spiegeln.

### 6.3 In-App-Dokumentations-Popups

Die Links **User Guide** und **README** öffnen die zugehörige
Markdown-Datei als zentriertes modales Popup. Das Popup ist
zweisprachig: Es liest das Paar `USER_GUIDE.md` / `USER_GUIDE.de.md`
(bzw. das README-Paar), das zur aktiven Sprache passt. Der Header
zeigt den Dokumenttitel, den kanonischen Dateinamen, ein
Such-Feld, einen Treffer-Zähler (`n Treffer`), Vor- / Zurück-Pfeile
und einen Close-Button.

**Tastatur-Shortcuts im Popup:**

| Shortcut | Aktion |
| --- | --- |
| `Esc` | Popup schließen |
| `Ctrl/⌘ + F` | Fokus in das Such-Feld setzen |
| `Enter` | zum nächsten Treffer springen |
| `Shift + Enter` | zum vorherigen Treffer springen |
| Klick außerhalb (Backdrop) | Popup schließen |

**Live-Suche, Schritt für Schritt:**

1. Öffne ein Dokument (Toolbar → **User Guide** oder **README**).
2. Klick ins Such-Feld (oder drücke `Ctrl/⌘ + F`). Tippe ein paar
   Zeichen — jeder Treffer in Überschriften, Hängen, Listen-Items
   und Code-Blöcken wird gelb hervorgehoben; der Zähler im Header
   aktualisiert sich beim Tippen.
3. Drücke `Enter`, um zum nächsten Treffer zu springen,
   `Shift + Enter`, um zurückzugehen. Der aktuell fokussierte Treffer
   bekommt einen 1,2 s-Puls, damit du ihn auf langen Seiten findest.
4. Lösche das Feld, um alle Hervorhebungen zu entfernen; schließe
   das Popup mit `Esc` oder dem X-Button, wenn du fertig bist.

Das Popup wird von `DocPopup.tsx` implementiert. Die
Dokument-Registry liegt in `docs.ts` und `docsRegistry.ts`; die
Markdown-Bodies werden zur Build-Zeit via Vites `?raw`-Import-Suffix
gebündelt, damit das Popup ohne Backend-Round-Trip funktioniert.

**Die Suchfunktion arbeitet für beide Dokumente gleich.** Für die
README scant sie das gerenderte Markdown-HTML; für den User Guide
scannt sie den interaktiven Walkthrough (das
walkthrough-spezifische Verhalten ist in
[Abschnitt 6.3.1](#631-suche-über-walkthrough-steps) beschrieben).

**Tastatur-Shortcuts im Popup:**

| Shortcut | Aktion |
| --- | --- |
| `Esc` | Popup schließen |
| `Ctrl/⌘ + F` | Fokus in das Such-Feld setzen |
| `Enter` | zum nächsten Treffer springen |
| `Shift + Enter` | zum vorherigen Treffer springen |
| Klick außerhalb (Backdrop) | Popup schließen |

**Live-Suche, Schritt für Schritt:**

1. Öffne ein Dokument (Toolbar → **User Guide** oder **README**).
2. Klick ins Such-Feld (oder drücke `Ctrl/⌘ + F`). Tippe ein paar
   Zeichen — jeder Treffer in Überschriften, Absätzen, Listen-Items
   und Code-Blöcken wird gelb hervorgehoben; der Zähler im Header
   aktualisiert sich beim Tippen. Die gelbe Hervorhebung nutzt die
   CSS-Klasse `.doc-search-hit` mit `rgba(245, 158, 11, .4)`,
   damit sie auf dem dunklen Thema lesbar bleibt.
3. Das Popup **scrollt zum ersten Treffer** und lässt ihn 1,2 s
   pulsieren (Klasse `.doc-search-hit--active`, helleres Gelb mit
   Outline), damit du ihn auf langen Seiten findest.
4. Drücke `Enter`, um zum nächsten Treffer zu springen,
   `Shift + Enter`, um zurückzugehen. Der fokussierte Treffer
   bekommt bei jedem Schritt denselben Puls.
5. Lösche das Feld, um alle Hervorhebungen zu entfernen; schließe
   das Popup mit `Esc` oder dem X-Button, wenn du fertig bist.

> 💡 **Beispiel — eine Phrase im User Guide wiederfinden:** Du
> willst den Abschnitt zur **Payload-Strategie** nachlesen. Öffne
> das User-Guide-Popup (Toolbar → **User Guide**), drücke
> `Ctrl/⌘ + F`, tippe *Payload*. Der Zähler sagt z. B. *3
> Treffer*; der erste Treffer ist in den Tab-Labels von Schritt 2.
> Das Popup scrollt zum Treffer, hebt ihn gelb hervor und lässt
> ihn pulsieren. Drücke zweimal `Enter`, um die restlichen Treffer
> durchzugehen — einer in der Schritt-2-Einleitung, einer im
> Annotation-Body. Die gelben Hervorhebungen bleiben sichtbar, damit
> du den vollen Kontext siehst.

> 💡 **Beispiel — Suche über Walkthrough-Tabs hinweg:** Du tippst
> *Force* in die User-Guide-Suche. Der Treffer ist in Schritt 4
> bei der Annotation zu *Force abort*, aber der Walkthrough steht
> aktuell auf Schritt 1. Das Popup wechselt den aktiven Schritt
> automatisch auf Schritt 4 (der sichtbare Tab oben wechselt sich),
> **bevor** es zum Treffer scrollt — der Treffer ist dann bereits
> gelayoutet und sichtbar. Die gelbe Hervorhebung und der 1,2 s-Puls
> markieren den gefundenen Text. Kein zusätzlicher Klick
> erforderlich.

#### 6.3.1 Suche über Walkthrough-Steps

Der User Guide ist ein Vier-Schritt-Walkthrough (Import →
Endpunkte → Lastprofil → Testläufe). Intern werden alle vier
Steps gleichzeitig in den DOM gerendert, damit die Suche den
gesamten Text aller Steps in einem Durchgang scannen kann; die
drei inaktiven tragen das `hidden`-Attribut und nehmen keinen
Layout-Platz ein.

Wenn ein Treffer in einem nicht-aktiven Step landet:

1. Das Popup fordert den Walkthrough auf, den aktiven Step auf
   den zu wechseln, der den Treffer enthält (über die
   `focusStepId`-Prop).
2. Der Walkthrough rendert mit dem neuen sichtbaren Step neu.
3. Nach einem Animation-Frame (genug für Reacts Commit und den
   Layout-Pass des Browsers) scrollt das Popup den Treffer in
   den sichtbaren Bereich und wendet den gelben Puls an.

Die Vor-/Zurück-Buttons (`Enter` / `Shift + Enter`) und der
Zähler (z. B. *3 Treffer*) funktionieren über alle vier Tabs
hinweg, sodass der Nutzer in Dokument-Reihenfolge durch alle
Treffer gehen kann, ohne manuell Tabs zu wechseln.

---

## 7. Schritt 1 — Spezifikation importieren

Die erste Karte akzeptiert drei Eingabe-Modi, die das gleiche Ziel
haben:

1. **URL** — zeige lasttest auf eine Swagger-UI-Seite oder ein
   direktes OpenAPI-Dokument. Das Backend holt die URL, löst die
   Spec auf (extrahiert `url` / `urls` aus einem Swagger-UI-Bundle,
   falls nötig) und importiert das Ergebnis.
2. **Datei** — wähle eine `.yaml`, `.yml` oder `.json`-Datei von der
   Platte.
3. **Textarea** — rohen YAML- oder JSON-Inhalt direkt einfügen.

Wenn das URL-Feld gefüllt ist, ruft ein Klick auf **Validieren &
importieren** zuerst `POST /api/specifications/fetch-url` auf und
validiert den geholten Inhalt dann transparent über den normalen
Import-Endpunkt. Die Textarea wird mit der aufgelösten Spec
aktualisiert, damit du sie vor dem Start noch tweaken kannst.

### 7.1 Akzeptierte Formate

| Feld | Wert |
| --- | --- |
| Format | YAML oder JSON (in der Textarea oder automatisch geholt) |
| Swagger-Version | 2.0 |
| OpenAPI-Version | 3.0.x, 3.1.x |
| Encoding | UTF-8 |
| Maximale Größe | wenige MB (der Import-Endpunkt akzeptiert einen JSON-Umschlag mit der Spec als String) |

lasttest sendet den rohen Text an `POST /api/specifications/import`.
Der Server liefert eine normalisierte Repräsentation zurück, die die
UI nutzt, um Endpunkt-Karten zu rendern.

### 7.2 Swagger-UI-URLs

Auf eine Swagger-UI-HTML-Seite zu zeigen ist voll unterstützt. Der
Fetcher:

- lädt das HTML herunter,
- sucht den `url` (oder ersten `urls[]`)-Eintrag in der
  `SwaggerUIBundle({...})`-Konfiguration,
- folgt der Same-Origin-`url`-Heuristik zu üblichen Endpunkten wie
  `/v3/api-docs`, `/v3/api-docs.yaml`, `/v2/api-docs`,
  `/swagger.json`, `/swagger.yaml`, `/openapi.json`,
  `/openapi.yaml`, falls keine Konfiguration gefunden wird,
- lehnt Cross-Origin-Redirects ab (grundlegender SSRF-Schutz),
- erzwingt ein 10 s-Timeout und ein 5 MB-Antwort-Limit.

Die Antwort-Payload enthält die aufgelöste URL und ein `source`-Flag,
sodass die UI zeigen kann, ob das Dokument direkt von der URL kam
oder über eine Swagger-UI-Seite.

Eine gebündelte Demo-Swagger-UI liegt unter
`http://localhost:8286/demo-swagger-ui` bereit, sobald lasttest
läuft. Sie bedient das gleiche `demo/openapi-demo.yaml`-Dokument,
sodass das URL-Feature ohne externe Abhängigkeit durchgespielt
werden kann.

### 7.3 Was *kein* importierbares Dokument ist

- Ein Swagger-UI-JSON-Blob mit `swaggerUrl` / `urls`-Verweisen, aber
  ohne Inline-Definition.
- Eine Postman-Collection. (Postman kann nach OpenAPI exportieren;
  nutze das.)

Wenn eine Swagger-UI-URL weder eine Spec-URL noch ein
Swagger-UI-Bundle bedient, gibt lasttest die fehlende
URL-Konvention aus und bittet dich, auf einen der bekannten
Endpunkte zu zeigen:

- `/swagger.json` oder `/swagger.yaml`
- `/v3/api-docs` (Springdoc) oder `/v3/api-docs.yaml`
- `/openapi.json` (FastAPI, NestJS und ähnliche)

### 7.4 Swagger 2.0 importieren

Swagger 2.0 wird auf der Leitung akzeptiert und intern nach OpenAPI 3
konvertiert, damit der Rest von lasttest nur ein Modell behandeln
muss. Du musst die Datei nicht selbst konvertieren.

---

## 8. Schritt 2 — Endpunkte wählen und konfigurieren

Nach einem erfolgreichen Import rendert lasttest pro Endpunkt eine
**Operations-Karte**. Jede Karte hat drei Zustände:

- **Eingeklappt (Default)** — du siehst nur die HTTP-Methode, den
  Pfad und eine einzeilige Zusammenfassung. Der `▸`-Toggle rechts
  öffnet die Karte.
- **Ausgeklappt** — der volle Parameter- / Body- / Token-Editor
  erscheint unter der Überschrift.
- **Ausgewählt** — die Checkbox links entscheidet, ob der Endpunkt
  in den nächsten Testlauf einbezogen wird.

Die Zusammenfassungs-Zeile ist immer linksbündig und bewegt sich
nicht, wenn du die Konfiguration öffnest oder schließt. Endpunkte,
die State mutieren, sind mit einem kleinen roten **SCHREIBEND**-Badge
oben rechts auf der Karte markiert, damit du sie auf einen Blick
erkennst.

### 8.1 Auswahl und schreibende Operationen

Standardmäßig ist die **erste** read-only-Operation als sicherer
Startpunkt vorausgewählt. Alle anderen Operationen — einschließlich
der verbleibenden read-only und jeder schreibenden Operation (POST,
PUT, DELETE, PATCH) — starten **unangehakt** und müssen explizit
aktiviert werden. Das schützt vor versehentlichen Writes auf eine
echte API und davor, mehrere Endpunkte parallel feuern zu lassen,
wenn du die Spec noch erkundest.

> 💡 Die UI nutzt ein **Single-Selection**-Modell: das Ankreuzen
> einer anderen Operations-Checkbox ersetzt die aktuelle Auswahl,
> statt sie zu erweitern. Jeder k6-Lauf übt daher genau einen
> Endpunkt. Um einen anderen Endpunkt zu testen, hake dessen
> Checkbox an und starte einen neuen Lauf.

> ⚠️ Sei vorsichtig, wenn du lasttest auf eine echte Umgebung
> zeigst. Das generierte k6-Skript trifft jeden ausgewählten
> Endpunkt mit den konfigurierten Parametern und der konfigurierten
> Concurrency.

### 8.2 Anatomie der Endpunkt-Karte

```
┌──────────────────────────────────────────────────────────┐
│ ☐  [GET]   /products/{id}                ▸              │  ← Überschrift
│        Produkt anhand seiner ID abrufen                  │  ← Zusammenfassung (linksbündig)
│  ─────────────────────────────────────────────────────   │
│  ┌──────────────────┐  ┌──────────────────┐             │  ← nur wenn aufgeklappt
│  │ id         path  │  │ Bearer   auth    │             │
│  │ [  42         ]  │  │ [  ••••••      ] │
│  └──────────────────┘  └──────────────────┘             │
└──────────────────────────────────────────────────────────┘
```

### 8.3 Parameter pro Endpunkt

Jeder Parameter der Operation wird als beschriftete Eingabe
gerendert. Die Beschriftung zeigt immer:

- den Parameter-**Namen**,
- die **Location** (`path`, `query`, `header`, `cookie`) als
  kleines Code-Style-Badge,
- ein **PFLICHT**-Tag, wenn die Spec den Parameter als required
  markiert.

Werte defaulten auf das OpenAPI `example`, fallen zurück auf den
`default` des Schemas und schließlich auf einen leeren String. Du
kannst optionale Parameter leeren; der Runner sendet dann einfach
einen leeren Wert.

Für required-Parameter verweigert lasttest den Start eines Tests, bis
jedes Pflichtfeld einen nicht-leeren Wert hat. Die Fehlermeldung
nennt die betreffende Operation-ID und den Parameter.

### 8.4 Request-Body (JSON)

Wenn die Operation einen Request-Body deklariert, zeigt die Karte
einen großen **JSON-Request-Body**-Editor, der mit dem Beispiel der
Spec vorbelegt ist. Du kannst ihn frei bearbeiten; der Runner
validiert das JSON vor dem Test. Wenn der Body optional ist und du
keinen Body senden willst, leere die Textarea.

### 8.5 Authentifizierung

`lasttest` erkennt die vier gängigsten Authentifizierungs-Schemata,
die in einem Swagger 2.0- oder OpenAPI 3-Dokument deklariert werden
können. Jedes erkannte Schema fügt der Endpunkt-Karte ein dediziertes
Credential-Eingabefeld hinzu (nur sichtbar, wenn die Operation das
Schema referenziert), und das gelbe *Demo-Banner* leuchtet auf den
vier mitgelieferten Demo-Endpunkten auf, sodass der User die
Demo-Secrets mit einem Klick in die Eingabefelder übernehmen kann.

| Schema | Spec-Deklaration | Wire-Format | Demo-Endpunkt | Demo-Credentials |
|---|---|---|---|---|
| **HTTP Basic** (RFC 7617) | `type: http, scheme: basic` | `Authorization: Basic <base64(user:pass)>` | `GET /products/admin/stats` | `alice` / `s3cret` |
| **HTTP Bearer** (RFC 6750) | `type: http, scheme: bearer` | `Authorization: Bearer <token>` | `POST /products/search` | `demo-bearer-token` |
| **API Key in eigenem Header** | `type: apiKey, in: header, name: X-…` | `X-…: <key>` | `GET /products/lookup-by-id?id=1` | `X-API-Key: demo-api-key-12345` |
| **OAuth 2.0** (RFC 6749, RFC 6750) | `type: oauth2, flows: {…}` | `Authorization: Bearer <access_token>` | `GET /products/me` | `Bearer demo-oauth2-token-12345` |
| **OpenID Connect** (OIDC, Identitäts-Schicht über OAuth 2.0) | `type: openIdConnect, openIdConnectUrl: <Discovery-URL>` | `Authorization: Bearer <id_token>` | `GET /products/my-profile` | `Bearer demo-oidc-id-token-12345` |

Die Legacy-Schemata `apiKey in: query`, `apiKey in: cookie` und
mutual-TLS werden beim Import als *Unsupported* gemeldet (so
sieht der User, welches Schema erkannt wurde, auch wenn lasttest
es noch nicht nutzen kann). Sie können jederzeit manuell als
gewöhnlicher Header-Parameter auf der Endpunkt-Karte hinzugefügt
werden.

#### 8.5.1 HTTP Basic

Wenn die `security`-Liste der Operation ein Basic-Security-Schema
referenziert, rendert die Karte zwei Password-Eingabefelder mit den
Beschriftungen **Benutzername** und **Passwort** unter der
Spaltenüberschrift `Basic-Auth`. Das k6-Skript sendet
`Authorization: Basic <base64(Benutzername:Passwort)>`. Whitespace
rund um die Credentials wird getrimmt; ein leerer Benutzername
*und* ein leeres Passwort werden als "nicht konfiguriert"
behandelt, sodass der Generator den `Authorization`-Header
vollständig weglässt (das Demo-Backend antwortet dann `401`).

#### 8.5.2 HTTP Bearer

Ein dediziertes Password-Eingabefeld mit der Beschriftung **Token**
wird unter der Spaltenüberschrift `Bearer` gerendert. Das k6-Skript
sendet `Authorization: Bearer <Token>`. Der User tippt den
rohen Token ein; das `Bearer `-Präfix fügt der Generator hinzu. Ein
leerer Token lässt den Header weg.

#### 8.5.3 API Key in einem eigenen Header

Ein einzelnes Password-Eingabefeld wird unter der Spaltenüberschrift
`API-Key` gerendert. Das k6-Skript sendet den *in der Spec
deklarierten Header-Namen* mit dem vom User eingegebenen Wert. Für
die Spec `apiKeyAuth: { type: apiKey, in: header, name: X-API-Key }`
trägt die generierte Request `X-API-Key: <key>`. Ein apiKey im
`Authorization`-Header wird stattdessen als plainer Bearer erkannt
(historische Konvention).

#### 8.5.4 OAuth 2.0

OAuth 2.0-Access-Tokens verwenden dasselbe Bearer-Wire-Format wie
plain Bearer (RFC 6750). lasttest rendert ein separates
Password-Eingabefeld unter der Spaltenüberschrift `OAuth 2.0`, so
dass der User den Access-Token in einem dedizierten Slot tippt;
das generierte Skript sendet aber weiterhin
`Authorization: Bearer <access_token>`. Das gelbe Demo-Banner
zeigt zusätzlich den *Flow-Namen* (z. B. `clientCredentials`) und
die *Scopes* (z. B. `read:products, write:products`), die im
`flows`-Objekt des Security-Schemas deklariert sind — so weiß der
User, welche Scopes sein Token abdeckt.

#### 8.5.5 OpenID Connect (OIDC)

OpenID Connect ist die Identitäts-Schicht über OAuth 2.0. Die Spec
deklariert sie als `type: openIdConnect, openIdConnectUrl: <URL>`,
wobei die URL auf das Discovery-Dokument des OP zeigt (den
`.well-known/openid-configuration`-Endpunkt). Aus Sicht des
k6-Generators fährt ein OIDC-ID-Token exakt denselben
`Authorization: Bearer <id_token>`-Header (RFC 6750) wie Bearer
und OAuth 2.0 — der `openIdConnect`-Subtype ist separat, weil das
Banner die Discovery-URL und die typischen OIDC-Scopes
(`openid`, `profile`, `email`, …) anzeigt, so dass der User auf
einen Blick sieht, dass das Token von einem OIDC-Provider kommt
und nicht von einem plain OAuth 2.0-Authorization-Server.

lasttest rendert ein separates Password-Eingabefeld unter der
Spaltenüberschrift `OIDC`, so dass der User das ID-Token in
einem dedizierten Slot tippt; das generierte k6-Skript sendet
aber weiterhin `Authorization: Bearer <id_token>`. Das gelbe
Demo-Banner zeigt zusätzlich die **Discovery-URL**, die auf dem
Security-Schema deklariert ist, und die **Scopes** (`openid,
profile, email` für die gebündelte Demo) — so kann der User
verifizieren, dass das ID-Token für die richtige Audience
ausgestellt wurde.

#### 8.5.6 Konfiguration pro Endpunkt

Ein einzelner Endpunkt kann über die `security`-Liste der Spec
mehrere Requirements deklarieren. lasttest zeigt jedes Requirement
in der Reihenfolge an, in der die Spec es deklariert, und rendert
eine Credential-Spalte pro Typ. Der Pool-Editor behandelt jede
Eingabe als separate Zelle — ein Endpunkt mit
`security: [{ basicAuth: [] }, { apiKeyAuth: [] }]` bekommt
beispielsweise sowohl eine `Basic-Auth`-Spalte (Benutzername +
Passwort) als auch eine `API-Key`-Spalte. Das Legacy-Einzeltoken-Feld
(`Optional für diesen Endpunkt`) wird weiterhin angezeigt, wenn
kein Security-Schema deklariert ist, so dass der User
ad-hoc-Authentifizierung zu einem öffentlichen Endpunkt hinzufügen
kann.

Das gelbe *Demo-Credentials*-Banner ist fest mit den vier
Demo-Endpunkten verknüpft und wird **nur** auf diesen angezeigt. Es
zeigt die Demo-Credentials in Monospace plus einen
**In Felder übernehmen**-Button, mit dem der User die Werte mit
einem Klick in die Eingabefelder kopiert. Das Banner ist der
schnellste Weg, um zu prüfen, ob die Spec korrekt verdrahtet ist,
ohne die Demo-Secrets per Hand zu kopieren.

### 8.6 Payload-Pool — mehrere Datensätze pro Endpunkt

Standardmäßig enthält eine Endpunkt-Karte einen **einzelnen
Datensatz** (einen Satz Parameterwerte, einen Request-Body, einen
Bearer-Token). lasttest unterstützt auch einen **Payload-Pool**:
eine Liste von unterschiedlichen Datensätzen, die k6 entsprechend
der in der Lastprofil-Karte gewählten Strategie durchläuft (siehe
[Abschnitt 9.5](#95-payload-strategie--sequenziell-vs-zufällig)).
Nutze das, wenn du mit einer Mischung aus Eingaben testen willst
(z. B. mehrere Produkt-IDs, mehrere Suchanfragen, mehrere Bodies)
statt tausend Mal denselben Request abzufeuern.

**Zeilen zum Pool hinzufügen:**

1. Öffne die Endpunkt-Karte (Klick auf das Chevron rechts der
   Überschrift).
2. Der Karten-Body zeigt nun eine Tabelle, deren erste Zeile der
   bestehende Datensatz ist. Jede Spalte ist ein Parameter, der
   JSON-Body oder der Bearer-Token; die Spalte ganz links zeigt den
   Zeilenindex.
3. Klick **+ Payload hinzufügen** unter der Tabelle. Eine neue Zeile
   erscheint, vorbelegt mit einem **Klon** der ersten Zeile, sodass
   du nur die Felder ändern musst, die dich interessieren.
4. Bearbeite die Zellen der neuen Zeile. Die Validierung läuft
   zeilenweise; required-Parameter und required-Bodys bleiben pro
   Zeile erzwungen.
5. Entferne eine Zeile mit dem **×**-Button rechts. Die **letzte
   Zeile bleibt** — lasttest erzwingt, dass mindestens ein Payload
   vorhanden ist, damit das Legacy-Single-Dataset-Layout immer
   funktioniert.

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

> 💡 **Beispiel — Suche über mehrere Schlüsselwörter:** Du willst die
> Demo-`POST /products/search` mit drei unterschiedlichen Queries
> (`book`, `shoe`, `pen`) üben, ohne den Bearer-Token zu ändern.
> Öffne die Karte, füge zwei Zeilen über **+ Payload hinzufügen**
> hinzu, fülle die `q`-Spalte pro Zeile, lass alles andere als Klon.
> Mit Strategie **Sequenziell** durchläuft k6 die Zeilen
> oben-nach-unten; mit **Zufällig** zieht es pro Iteration eine
> Zeile. Der ausführliche Report schlüsselt die Aufrufverteilung
> pro Zeile in der Sektion **Tatsächliche Aufrufverteilung** auf,
> damit du prüfen kannst, wie oft jede Query tatsächlich gefeuert
> hat.

Der Pool wird auf dem Backend als geordnete Liste von `payloads`
innerhalb der Operation-Settings gespeichert. Das Frontend hält eine
flache `parameterValues` / `requestBodyJson` / `bearerToken`-Sicht
mit `payloads[0]` synchron, damit der Legacy-Single-Dataset-Codepfad
(Validator, k6-Config-Builder, Single-Payload-Skripte) ohne weitere
Refactors weiter funktioniert. Der Detail-Report zeigt die Poolgröße
als `{n} payloads in pool` und rendert einen `Note`-Hinweis für
ältere Läufe, die vor dem Feature gestartet wurden.

---

## 9. Schritt 3 — Lastprofil wählen

### 9.1 Base-URL und Server-Auswahl

Die `servers`-Liste der Spec wird als Default verwendet. Gibt es
mehr als einen Eintrag, erscheint ein Dropdown in der
Lastprofil-Karte, in dem du wählen kannst. Das Base-URL-Feld
darunter überschreibt die Auswahl immer — dort tippst du eine
eigene URL, z. B. einen internen Staging-Hostnamen, den die Spec
nicht kennt.

Um das Dropdown in Aktion zu sehen, importiere die gebündelte Demo
(`demo/openapi-demo.yaml`). Sie deklariert vier Server:

- `http://localhost:8286/demo-api` — die lokale Demo (diese
  antwortet tatsächlich und ist der empfohlene Startpunkt),
- `https://staging.lasttest.example.com/demo-api` — Staging,
- `https://integration.lasttest.example.com/demo-api` —
  Integration,
- `https://api.lasttest.example.com/demo-api` — Produktion.

Nur die erste URL antwortet; die anderen drei sind Platzhalter, die
zeigen, wie eine Multi-Environment-Spec in der UI aussieht. Sie
sind enthalten, damit du das Dropdown üben kannst, ohne eine eigene
Spec zu schreiben.

> 💡 Wenn du den Runner auf einen internen Host zeigst, denke daran,
> dass das `docker compose`-Setup den Test *innerhalb* des
> Containers laufen lässt. `localhost` im Container ist nicht dein
> Laptop. Verwende die routbare IP des Hosts oder den speziellen
> Host `host.docker.internal` auf Docker Desktop.

### 9.2 Die vier Lastprofil-Exekutoren

Die Lastprofil-Karte enthält eine einzige **Exekutor**-Dropdown mit
vier Optionen. Sie mappen direkt auf k6s Exekutor-Typen; wähle den,
der zu dem passt, was du über dein Target lernen willst.

| Exekutor | k6-Typ | Am besten für |
| --- | --- | --- |
| **Konstante Last** (Standard) | `constant-vus` | Smoke-Test, Steady-State-Last, reproduzierbare Benchmarks |
| **N Anfragen, so schnell wie möglich** | `shared-iterations` | Reproduzierbare *Request-Anzahl* über Releases (vergleiche p95 zwischen v1.2 und v1.3) |
| **Ramping-VUs** | `ramping-vus` | Spike, Stress, Soak; Last, die in *Stages* hoch- und runterfährt |
| **Constant-Arrival-Rate** | `constant-arrival-rate` | Entkopplung von RPS und Antwortzeit (das wahre Throughput-Limit des Servers) |

Die untere Hälfte der Karte tauscht ihre Felder automatisch je nach
gewähltem Exekutor. Eine Reihe von One-Click-**Presets** über den
Feldern füllt sinnvolle Werte für häufige Szenarien vor.

#### 9.2.1 Constant-VUs (Standard)

```
┌─ Schnellauswahl ──────────────────────────────────┐
│ [Smoke] [Load] [Stress] [Spike] [Soak] [Arrival] │
└────────────────────────────────────────────────┘

  Lastprofil:  ( Konstante Last  ) ▾
  Virtual Users:  [ 10    ]
  Dauer (Sekunden): [ 30    ]
```

Alle VUs starten gemeinsam und laufen die gesamte Dauer. Die
Defaults (10 VUs / 30 s) sind so getunt, dass ein Smoke-Test der
Demo-Spec in unter einer Minute durchläuft.

#### 9.2.2 Shared-Iterations

```
  Lastprofil:  ( N Anfragen, so schnell wie möglich ) ▾
  Virtual Users:  [ 100   ]
  Iterationen:   [ 1000  ]
```

Jeder Virtual User feuert genau einen Request und der Lauf endet,
sobald die letzte Antwort zurück ist. Das Feld *Iterationen* ist
die gesamte Request-Anzahl über alle VUs.

#### 9.2.3 Ramping-VUs

Das ist der flexibelste Modus. k6 läuft durch eine Liste von
**Stages**; jede Stage hat eine Ziel-VU-Anzahl und eine Dauer.
Zwischen zwei Stages rampt k6 linear vom vorherigen Ziel zum
nächsten Ziel während der Stage-Dauer.

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

Das Beispiel oben ist das **Spike**-Preset: 10 s bei 0 VUs, dann 10 s
Rampe auf 800 VUs, halte den Spike 30 s, dann Rampe wieder runter.
Ein **Plateau** (zwei aufeinanderfolgende Stages mit gleichem Ziel)
ist erlaubt — Stages 2 und 3 im Beispiel sind ein Plateau bei 800
VUs.

Für einen Soak-Test nutze ein langes Plateau (z. B. 50 VUs für
3 600 s).

#### 9.2.4 Constant-Arrival-Rate

```
  Lastprofil:  ( Constant-Arrival-Rate ) ▾
  Rate (Anfragen):  [ 50    ]
  pro Sekunden:     [  1    ]
  Dauer (Sekunden): [ 120   ]
  preAllocatedVUs:  [ 10    ]
  maxVUs:           [ 200   ]
```

k6 entkoppelt die Request-Rate von der Antwortzeit: es feuert genau
*N* Requests pro Sekunde, egal wie langsam das Target wird.
**preAllocatedVUs** ist die Größe des initialen VU-Pools;
**maxVUs** ist die Obergrenze, auf die k6 den Pool wachsen lassen
darf, wenn Latenz-Spitzen auftreten. Nutze diesen Exekutor, wenn du
das wahre Throughput-Limit des Servers finden willst — der
Constant-VUs-Exekutor findet nur dann ein Limit, wenn VUs
saturieren, was Antwortzeit- und Concurrency-Effekte vermischt.

### 9.3 Presets

Die Preset-Reihe über den Exekutor-Feldern lädt ein komplettes
Profil mit einem Klick. Nach dem Laden bleibt jedes Feld editierbar,
sodass du feinjustieren kannst. Die Presets sind auf übliche
Lasttest-Szenarien zugeschnitten:

| Preset | Exekutor | Stages | Gesamtdauer | Verwendung |
| --- | --- | --- | --- | --- |
| **Smoke** | constant-vus | 1 VU für 30 s | 30 s | CI-Pre-Flight-Gate |
| **Load** | ramping-vus | 0 → 50 VUs über 90 s, halte 5 min, Rampe runter | 6,5 min | k6-Lehrbuch-Beispiel |
| **Stress** | ramping-vus | stufenweise 0 → 50 → 100 → 200 → 400 VUs | ~5 min | finde den Knick |
| **Spike** | ramping-vus | 0 → 800 VUs in 10 s, halte 30 s, Rampe runter | 80 s | Black-Friday-Szenario |
| **Soak** | ramping-vus | 50 VUs für 1 Stunde nach 5 min Warm-up | ~66 min | Leaks, langsame Degradation |
| **Burst** | shared-iterations | 10 VUs, 1 000 Iterationen | endet, wenn fertig | reproduziere Request-Anzahl über Releases |
| **Arrival-Rate** | constant-arrival-rate | 50 req/s für 2 min | 2 min | entkopple RPS von Antwortzeit |

Hover über einen Preset-Button, um die Einzeiler-Beschreibung im
Hilfetext unter der Reihe zu lesen. Die Beschreibungen fassen den
Trade-off zusammen, sodass du das richtige Profil wählen kannst,
ohne die volle Exekutor-Doku zu lesen:

| Preset | Hover-Beschreibung |
| --- | --- |
| **Smoke** | 1 VU für 30 s — idealer CI-Pre-Flight-Check |
| **Load** | Schrittweise auf 50 VUs, 5 min Plateau |
| **Stress** | Stufenweise bis 400 VUs, findet den Knick |
| **Spike** | Plötzlicher Sprung auf 800 VUs, 30 s Plateau |
| **Soak** | 50 VUs über eine Stunde, deckt Leaks auf |
| **Burst** | 1 000 Anfragen so schnell wie möglich — vergleicht Releases mit fester Request-Anzahl |
| **Arrival-Rate** | 50 Anfragen/s unabhängig von der Antwortzeit |

### 9.4 Stages bearbeiten

Klick **+ Stage hinzufügen**, um eine Stage am Ende der Liste
anzuhängen. Jede Stage-Zeile hat:

- **Ziel-VUs** — die VU-Anzahl, die k6 am *Ende* der Stage erreichen
  soll. k6 rampt linear vom Ziel der vorherigen Stage während der
  Stage-Dauer.
- **Dauer (s)** — wie lange die Stage dauert. Minimum 1 s, Maximum
 3 600 s.

Klick **×** rechts in einer Zeile, um diese Stage zu entfernen. Das
Entfernen ist sofort wirksam; die verbleibenden Stages werden
automatisch renummeriert.

Du kannst die Reihenfolge der Stages ändern, indem du sie der Reihe
nach bearbeitest; k6 läuft sie in der gezeigten Reihenfolge ab.
**Plateaus sind erlaubt** (zwei aufeinanderfolgende Stages mit
gleichem Ziel); der Validator lehnt sie nicht ab.

### 9.5 Payload-Strategie — sequenziell vs. zufällig

In der Lastprofil-Karte, neben dem **Base-URL**-Feld, sitzt ein
**Payload-Strategie**-Panel mit zwei Radio-Optionen:

| Strategie | Was sie tut | Wann wählen |
| | --- | --- |
| **Sequenziell** *(Default)* | Jeder Request nutzt die nächste Zeile des Payload-Pools, mit Wrap-Around am Ende. Bei einem Pool mit einer Zeile ist das die einzige sinnvolle Verhaltensweise und identisch zu **Zufällig**. | Reproduzierbare Request-Anzahlen (z. B. jeder Suchbegriff im Pool feuert genau gleich oft), Debugging spezifischer Fehler gegen einen bekannten Payload. |
| **Zufällig** | Jede Iteration zieht eine Zeile nach dem Zufallsprinzip. Bei einem Pool mit einer Zeile identisch zu **Sequenziell**. | Realistische Traffic-Mischungen, Fuzzing-artige Eingabevariabilität, wenn du "was, was Nutzer tatsächlich tun" testen willst statt einer deterministischen Sequenz. |

Die Strategie wird als Teil des Lastprofils persistiert und mit
jedem Test an das Backend gesendet. Wenn das Feld auf der Leitung
fehlt, defaulted das Backend auf `sequential` (was auch die einzige
sinnvolle Verhaltensweise für einen Single-Payload-Pool ist, also
das Legacy-Single-Dataset-Layout). Der ausführliche Report
**aggregiert** die Pool-Zeilen nicht zu einer Zahl; er zeigt die
Tabelle **Tatsächliche Aufrufverteilung** mit einer Zeile pro
Payload, sodass du prüfen kannst, wie oft jede Zeile unter der
gewählten Strategie tatsächlich gefeuert hat.

> 💡 **Beispiel — Strategien auf der Demo vergleichen:** Mit dem Pool
> aus [Abschnitt 8.6](#86-payload-pool--mehrere-datensätze-pro-endpunkt)
> (`q` ∈ `book`, `shoe`, `pen`) und einem 60 s `constant-vus`-Profil
> (10 VUs) wähle zuerst **Sequenziell**. Die Verteilungs-Tabelle im
> Report zeigt jede Zeile mit ungefähr der gleichen Aufrufanzahl
> (round-robin abgearbeitet). Wechsle auf **Zufällig** und führe
> erneut aus (Rechtsklick → *Erneut ausführen*); dieselben Zeilen
> zeigen jetzt ungleichmäßige Anzahlen, die der Binomialverteilung
> folgen. Gleicher Pool, gleiches Target — nur die Reihenfolge, in
> der k6 Zeilen zieht, ändert sich.

### 9.6 Validierung und Limits

Der Validator läuft bei jeder Änderung und lehnt Profile ab, die
k6 zum Absturz bringen oder dein Target schmelzen würden:

| Exekutor | Feld | Bereich |
| --- | --- | --- |
| `constant-vus` | Virtual Users | 1 – 30 000 |
| `constant-vus` | Dauer | 1 – 3 600 s |
| `shared-iterations` | Virtual Users | 1 – 30 000 |
| `shared-iterations` | Iterationen | 1 – 1 000 000 |
| `ramping-vus` | Start-VUs | 0 – 30 000 |
| `ramping-vus` | Stage Ziel-VUs | 0 – 30 000 |
| `ramping-vus` | Stage Dauer | 1 – 3 600 s |
| `ramping-vus` | Stages | 1 – ∞ |
| `constant-arrival-rate` | Rate | 1 – 100 000 / timeUnit |
| `constant-arrival-rate` | timeUnit | 1 – 60 s |
| `constant-arrival-rate` | Dauer | 1 – 3 600 s |
| `constant-arrival-rate` | preAllocatedVUs | 1 – 30 000 |
| `constant-arrival-rate` | maxVUs | preAllocatedVUs … 30 000 |

Ungültige Werte zeigen einen Inline-Fehler unter dem Feld und der
**Start**-Button bleibt deaktiviert. Validierung läuft im Browser
*und* auf dem Backend; das Backend ist die letzte Verteidigungslinie,
damit ein fehlerhaft konfiguriertes Profil k6 nicht erreicht.

---

## 10. Schritt 4 — Test starten und Ergebnis lesen

Klick **k6-Lasttest starten**. Fehlt irgendetwas (kein Endpunkt
ausgewählt, ein required-Parameter leer, eine ungültige Base-URL),
wird der Lauf nicht gestartet und die erste Karte mit dem Problem
ist hervorgehoben.

Sobald der Lauf akzeptiert ist, erscheint die vierte Karte mit:

- einem **Multi-Run-Dashboard** (ein Badge pro Lauf, der in der
  aktuellen Session gestartet wurde),
- einem farbigen Status-Badge für den Lauf, den du gerade
  beobachtest,
- einem Deep-Link auf den druckoptimierten Report,
- optional die aufgefangene k6-Konsolenausgabe und das rohe JSON.

### 10.1 Das Multi-Run-Dashboard

Jeder k6-Lauf, den du in der aktuellen Session startest, erscheint
als kompaktes **Badge** in einem horizontalen Grid über der
Detail-Karte. Das Badge ist das Fokus-Ziel — ein einzelner Linksklick
bewegt die Detail-Karte zu diesem Lauf, ein Rechtsklick öffnet das
Aktions-Menü (siehe
[Abschnitt 10.2](#102-das-aktions-menü-am-run-badge-rechtsklick)). Ein
status-farbiger Streifen an der linken Kante kodiert den
Lauf-Zustand:

| Status | Streifen-Farbe | Bedeutung |
| --- | --- | --- |
| `QUEUED` / `RUNNING` / `STOPPING` | orange | Der Lauf wird noch vom k6-Prozess gehalten. |
| `COMPLETED` | grün | k6 ist normal beendet; Metriken sind verfügbar. |
| `FAILED` | rot | Die Spec war ungültig, k6 ist abgestürzt oder das Target war unerreichbar. |
| `STOPPED` | lila | Du hast einen graceful Stop angefordert (`SIGTERM`); k6 ist sauber ausgelaufen. |
| `ABORTED` | dunkelrot | Du hast auf `SIGKILL` eskaliert (oder `STOPPING` wurde von `force` gefolgt); Metriken können unvollständig sein. |

Eine Zeile im Grid enthält:

- die HTTP-Methode als farbiger Chip (grün GET, braun POST, blau
  PUT/PATCH, rot DELETE),
- den Lauf-Status als Text,
- den Operations-Pfad in Monospace.

Fokus-Übergabe-Regeln (siehe `runDashboard.pickActiveRunId`):

- **Neuen Lauf starten** fokussiert das neue Badge (damit der
  Nutzer den Live-Status sofort sieht).
- **Erneut ausführen via Rechtsklick** folgt derselben Regel — das
  frische Badge wird aktiv.
- **Anderes Badge anklicken** fokussiert es. Der zuvor fokussierte
  Lauf wird weiter gepollt, bis er einen Terminal-Zustand erreicht,
  aber die Detail-Karte zeigt nur den fokussierten.
- **Stoppen / Abbrechen via Rechtsklick** bewegt den Fokus nicht;
  der Nutzer beobachtet denselben Lauf weiter, während er
  transitiert.

#### 10.1.1 Rechtsklick auf ein Badge öffnet das Aktions-Menü

Jedes Badge im Dashboard reagiert auf einen **Rechtsklick**: ein
kleines Kontextmenü erscheint an der Cursor-Position mit einer
zugeschnittenen Aktionsliste für diesen Lauf. Der Linksklick ist
dem *Fokussieren* vorbehalten; der Rechtsklick dem *Handeln*. `Esc`
oder ein Klick außerhalb des Menüs schließt es.

Die sichtbaren Items passen sich dem aktuellen Status des Laufs an
— die vollständige Referenz mit HTTP-Endpunkten, Tastatur-Shortcuts
und Disabled-State-Regeln liegt in [Abschnitt 10.2](#102-das-aktions-menü-am-run-badge-rechtsklick).
Kurzüberblick, was der Rechtsklick freischaltet:

**Für `QUEUED` / `RUNNING` / `STOPPING`-Läufe (k6 besitzt den Prozess noch):**

| Item | Wirkung |
| --- | --- |
| **Live-Details anzeigen** | Fokussiert das Badge (wie Linksklick). |
| **Run-ID kopieren** | Kopiert die UUID des Laufs in die Zwischenablage. |
| **k6-Webreport öffnen** | Öffnet den druckoptimierten Report in einem neuen Tab. |
| **Stop (graceful)** | Sendet `SIGTERM`; k6 läuft sauber aus, der Lauf endet als `STOPPED`. |
| **Force abort** | Sendet `SIGKILL`; der Lauf endet sofort als `ABORTED` (Metriken ggf. unvollständig). |

**Für Terminal-Läufe (`COMPLETED` / `FAILED` / `STOPPED` / `ABORTED`):**

| Item | Wirkung |
| --- | --- |
| **Zusammenfassung anzeigen** / **Aborted-Details anzeigen** | Fokussiert das Badge (Label passt sich dem Status an). |
| **Report-Link kopieren** | Kopiert die Report-URL in die Zwischenablage. |
| **k6-Webreport öffnen** | Öffnet den druckoptimierten Report in einem neuen Tab. |
| **k6-JSON exportieren** | Lädt das rohe k6-Summary-JSON herunter (deaktiviert, wenn keine Summary vorliegt). |
| **Erneut ausführen** | Führt dasselbe Szenario gegen dieselbe Base-URL mit einer frischen Run-ID erneut aus. |
| **Aus Ansicht entfernen** | Entfernt das geklickte Badge aus dem In-Memory-Dashboard (Page-Refresh macht es rückgängig). |
| **Alle anderen fehlgeschlagenen Läufe entfernen** | Entfernt jedes andere `FAILED`-Badge aus dem Dashboard (deaktiviert, wenn kein weiteres `FAILED`-Badge existiert). |

Das Dashboard pollt `/api/test-runs/{id}` für **jeden non-terminalen
Lauf** parallel einmal pro Sekunde, sodass mehrere Badges
gleichzeitig aktualisieren können. Das Terminal-Zustand-Prädikat ist
die einzige Source of Truth in `runDashboard.isTerminalRun()`
(unit-getestet) — das Frontend pollt `STOPPING`-Läufe mit Absicht
weiter, sonst würde der Übergang `STOPPING → STOPPED` das Badge
für immer einfrieren.

> 💡 **Beispiel — zwei Smoke-Läufe vergleichen:** Du hast die Demo
> mit `Smoke` (10 s, 10 VUs) um 14:00 laufen lassen und die
> Base-URL vor einem zweiten Lauf um 14:02 geändert. Beide Badges
> sind im Grid sichtbar. Das erste ist grün (`COMPLETED`), das
> zweite ist das aktive Badge. Klick auf das ältere, um es zu
> prüfen; Rechtsklick darauf und wähle **Erneut ausführen**, um
> einen dritten Lauf zu feuern, den lasttest zum selben Grid
> hinzufügt — der Fokus springt automatisch auf den jüngsten
> in-flight-Lauf.

### 10.2 Das Aktions-Menü am Run-Badge (Rechtsklick)

Rechtsklick auf ein Badge öffnet ein kleines **Kontextmenü** an der
Cursor-Position. Das Menü bietet nur Aktionen, die für den aktuellen
Status des Laufs sinnvoll sind — die sichtbaren Items werden von
`runMenuItems.buildRunMenuItems(run)` berechnet und für jede
Status-Kombination unit-getestet.

**Für `QUEUED` / `RUNNING` / `STOPPING`-Läufe** hat das Menü zwei
Gruppen:

| Item | Shortcut | Wirkung |
| --- | --- | --- |
| **Live-Details anzeigen** | — | Fokussiert das Badge (wie Linksklick). |
| **Run-ID kopieren** | — | Kopiert die UUID in die Zwischenablage. |
| **k6-Webreport öffnen** | — | Öffnet den druckoptimierten Report in einem neuen Tab (die Report-Seite existiert ab dem Moment, in dem der Lauf eingereiht ist). |
| **Stop (graceful)** | `S` | `POST /api/test-runs/{id}/cancel?force=false`. k6 erhält `SIGTERM`, der Lauf transitiert `RUNNING → STOPPING → STOPPED`. |
| **Force abort** | `⇧S` | `POST /api/test-runs/{id}/cancel?force=true`. k6 erhält `SIGKILL`, der Lauf endet sofort als `ABORTED`. |

**Für Terminal-Läufe (`COMPLETED` / `FAILED` / `STOPPED` /
`ABORTED`)** bietet das Menü:

| Item | Sichtbar bei | Wirkung |
| --- | --- | --- |
| **Zusammenfassung anzeigen** / **Aborted-Details anzeigen** *(Label passt sich an)* | immer | Fokussiert das Badge. |
| **Report-Link kopieren** | immer | Kopiert `http://…/?report=<run-id>` in die Zwischenablage — in Chat, Ticket oder Runbook droppen. |
| **k6-Webreport öffnen** | immer | Öffnet den druckoptimierten Report in einem neuen Tab. |
| **k6-JSON exportieren** | nur wenn ein vollständiges Summary vorhanden ist (`ABORTED`-Läufe und Läufe ohne Summary sind deaktiviert) | Lädt `lasttest-<run-id>-summary.json` für Offline-Analysen oder zum Einspeisen in ein anderes Werkzeug. |
| **Erneut ausführen** | immer (nur Terminal-Läufe) | `POST /api/test-runs/{id}/rerun`. Das Backend spielt den `CreateTestRunRequest` erneut, den es beim ursprünglichen Start erhalten hat, k6 startet frisch, das neue Badge erscheint im Dashboard und erhält den Fokus. Der neue Lauf teilt Operation, Payload-Pool, Lastprofil und Base-URL des ursprünglichen Laufs. |
| **Aus Ansicht entfernen** | immer (nur Terminal-Läufe) | Frontend-only-Cleanup, der das geklickte Badge aus dem In-Memory-Map entfernt. Das Backend hält den Lauf weiterhin, sodass ein Page-Refresh ihn aus `/api/test-runs` wieder einliest. Der Dashboard-Fokus wird neu bewertet, damit die Detail-Karte die Entfernung überlebt. |
| **Alle anderen fehlgeschlagenen Läufe entfernen** | Terminal-Läufe, die mindestens ein anderes `FAILED`-Badge in der Map haben (sonst ist das Item deaktiviert mit dem Grund *„Keine weiteren fehlgeschlagenen Läufe zum Entfernen.“*) | Bulk-Frontend-Cleanup: entfernt jedes andere `FAILED`-Badge außer dem geklickten. `STOPPED`- und `ABORTED`-Läufe werden bewusst erhalten — der Nutzer hat nach *fehlgeschlagen* gefragt, nicht nach jedem Nicht-Erfolg-Outcome. |

Das Menü schließt bei jedem Klick außerhalb (`Esc` schließt
ebenfalls). Der **Linksklick** bleibt dem Fokussieren des Laufs
vorbehalten, also öffnet er nie das Menü. Items, die im aktuellen
Zustand nicht funktionieren würden, bleiben in der Liste, werden
aber als **disabled** gerendert, mit einem `title`, der erklärt
warum (z. B. *„Aborted runs have no complete summary to export"*).

> 💡 **Beispiel — Rerun via Rechtsklick:** Du hast die Demo mit
> `Smoke` (10 VUs, 30 s) laufen lassen und willst prüfen, ob das
> Ergebnis reproduzierbar ist. Rechtsklick auf das grüne
> `COMPLETED`-Badge, wähle **Erneut ausführen**. lasttest postet
> `/api/test-runs/{id}/rerun`, das Backend reiht den erhaltenen
> `CreateTestRunRequest` erneut ein, k6 startet einen frischen
> Prozess gegen dieselbe Base-URL, und das neue Badge erscheint im
> Dashboard mit verschobenem Fokus. Das Dashboard pollt sofort; das
> alte `COMPLETED`-Badge bleibt stehen, sodass du die zwei Läufe
> weiterhin nebeneinander vergleichen kannst.

> 💡 **Beispiel — einen hängenden Lauf eskalieren:** Du hast ein
> `Load`-Profil gegen einen langsamen Staging-Server laufen lassen.
> Nach 5 Minuten ist es nicht fertig und du willst die Metriken, die
> du bereits hast. Rechtsklick auf das orange `RUNNING`-Badge, wähle
> **Stop (graceful)** (oder drücke `S` im Menü). Der Status
> transitiert `RUNNING → STOPPING` und der Badge-Streifen wird lila,
> während k6 ausläuft. Hängt der graceful Stop, Rechtsklick erneut
> und wähle **Force abort** (`⇧S`). Das Badge wird dunkelrot und
> die Detail-Karte rendert den Hinweis *„Vom Benutzer abgebrochen
> — k6 wurde per SIGKILL beendet"* mit einer Warnung, dass nur
> Teilkennzahlen vorliegen.

> 💡 **Beispiel — Report-Link teilen:** Ein Kollege fragt nach den
> Zahlen eines 5-Minuten-`Stress`-Laufs, den du gestern gemacht
> hast. Rechtsklick auf das Badge, wähle **Report-Link kopieren**
> und paste die URL in den Chat. Wer Zugriff auf die laufende
> lasttest-Instanz hat, kann `/?report=<run-id>` öffnen und den
> druckoptimierten Report einsehen — der Link bleibt für die
> Lebenszeit des Prozesses gültig.

> 💡 **Beispiel — das Dashboard aufräumen:** Du hast fünf Smoke-Tests
> direkt hintereinander laufen lassen, drei davon sind
> fehlgeschlagen (DNS-Lookup-Probleme). Die fehlgeschlagenen
> Badges brauchst du nicht mehr im Dashboard, aber die zwei
> `COMPLETED`-Badges willst du behalten. Rechtsklick auf eines der
> fehlgeschlagenen Badges, wähle **Alle anderen fehlgeschlagenen
> Läufe entfernen**, und das Dashboard behält nur das geklickte
> `FAILED` plus die zwei erfolgreichen. Um ein einzelnes Badge zu
> entfernen, ohne die anderen zu beeinflussen, Rechtsklick darauf
> und wähle **Aus Ansicht entfernen**. Beide Aktionen sind
> Frontend-only; lade die Seite neu und die entfernten Badges
> kommen zurück (das Backend hat sie weiterhin), was das
> Sicherheitsnetz für Nutzer ist, die ihre Meinung mitten im
> Aufräumen ändern.

### 10.3 Live-Status

Das Status-Badge durchläuft:

- `QUEUED` — akzeptiert, k6 wurde noch nicht gespawnt
- `RUNNING` — k6 führt aus
- `STOPPING` — du hast einen graceful Stop angefordert; k6 läuft aus
- `COMPLETED` — der Lauf ist fertig, alle Metriken sind verfügbar
- `FAILED` — der Lauf wurde abgelehnt, die Spec war ungültig oder
  k6 ist abgestürzt. Die Konsolenausgabe erklärt warum.
- `STOPPED` — du hast den Lauf mit `SIGTERM` gestoppt; Metriken bis
  zum Stop sind erhalten
- `ABORTED` — du hast den Lauf mit `SIGKILL` gestoppt; Metriken
  können unvollständig sein

Die UI pollt `/api/test-runs/{id}` jede Sekunde, solange der Lauf
in flight ist (`QUEUED`, `RUNNING` oder `STOPPING`), damit das Badge
ohne Page-Reload aktualisiert.

### 10.4 Diagnose, Metriken, Konsolenausgabe und Roh-JSON

Die Status-Zeile zeigt immer das Badge plus einen kurzen Hinweis,
solange der Lauf noch in flight ist ("läuft seit X s", "wartet auf
Executor"). Wenn der Lauf sich setzt, expandiert die Karte mit drei
zusätzlichen Blöcken:

1. **Diagnose + Detail** — eine einzeilige Klassifikation dessen, was
   schief lief, und den konkreten Wert, auf den der Nutzer reagieren
   kann. lasttest erkennt die folgenden Kategorien aus `run.error`
   und `run.summary`:

   | Diagnose | Ausgelöst durch | Hinweis |
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
   `Durchsatz` und `Daten empfangen` bei vollständig erfassten
   Läufen. Problematische Werte werden rot hervorgehoben.

3. **Bullet-Liste** — 2–4 konkrete Belege aus dem k6-Summary, z. B.
   "Endpunkt `searchProducts` antwortete 480× mit HTTP 401 —
   Bearer-Token prüfen."

Darunter bleiben die ausklappbaren Blöcke **k6-Konsolenausgabe**
(volle k6-stdout/stderr) und **k6-JSON-Rohdaten** (Summary-JSON)
für die volle Fehlersuche.

### 10.5 Erneut ausführen

Du hast zwei Wege, dasselbe Szenario erneut auszuführen:

- **Über das Rechtsklick-Menü** auf einem Terminal-Badge — siehe
  [Abschnitt 10.2](#102-das-aktions-menü-am-run-badge-rechtsklick).
  Das ist der empfohlene Pfad, weil er den exakten
  `CreateTestRunRequest` bewahrt, der ursprünglich gesendet wurde
  (Operation, Payloads, Lastprofil, Base-URL). Der neue Lauf erhält
  eine frische UUID und automatisch den Fokus.
- **Durch Neu-Konfigurieren des Formulars** — ändere einen Wert in
  Schritt 2 oder 3 und klick erneut **k6-Lasttest starten**. Der neue
  Lauf hat keine genealogische Verbindung zum alten; das alte Badge
  bleibt unverändert im Dashboard.

---

## 11. Schritt 5 — Den ausführlichen k6-Report lesen

Schritt 5 ist der druckoptimierte Report, den du über den Link
**Ausführlichen k6-Testbericht in neuem Tab öffnen** aufmachst.
Er bündelt alles, was Schritt 4 im Dashboard gezeigt hat, in einer
druckoptimierten A4-Ansicht — geeignet zum Teilen, Archivieren und
PDF-Export.

### 11.1 Report öffnen

Die Karte **Ausführlichen k6-Testbericht in neuem Tab öffnen** öffnet
`/?report=<run-id>` in einem neuen Tab. Der Link bleibt gültig, solange
der Prozess lebt — es gibt keinen Token, keine Session, keinen
Expiry. Wer die Run-ID kennt, kann den Report öffnen, also behandle
ihn als semi-public.

### 11.2 Visueller Rundgang durch den Report

Der druckoptimierte Report enthält die folgenden Sektionen in der
angegebenen Reihenfolge. Jeder Block hat einen klaren Zweck und
nutzt dasselbe Farbschema wie das Dashboard — die gleiche grüne
`COMPLETED`-Pille in der Kopfzeile, das gleiche `Soll`/`Ist`-Paar
in Lila/Orange in der Ramp-Grafik.

1. **Header** — Titel (der API-Titel aus deinem OpenAPI-Dokument),
   die Run-ID, die konfigurierte Base-URL und eine farbcodierte
   Status-Pille, die das Dashboard spiegelt (`COMPLETED` grün,
   `FAILED` rot, `STOPPED` lila, `ABORTED` dunkelrot).

   ```svg
   <svg viewBox="0 0 600 110" xmlns="http://www.w3.org/2000/svg">
     <rect x="0" y="0" width="600" height="110" fill="#0b1220" rx="8"/>
     <rect x="20" y="20" width="46" height="46" fill="#7d63ff" rx="6"/>
     <text x="43" y="50" text-anchor="middle" fill="#fff" font-family="Inter, sans-serif" font-size="16" font-weight="bold">k6</text>
     <text x="78" y="36" fill="#dbe5f3" font-family="Inter, sans-serif" font-size="14" font-weight="600">lasttest</text>
     <text x="78" y="54" fill="#93a2b8" font-family="Inter, sans-serif" font-size="10">k6-Lasttest-Report</text>
     <line x1="20" y1="80" x2="580" y2="80" stroke="#2c3a52" stroke-width="1"/>
     <text x="20" y="100" fill="#7d63ff" font-family="Inter, sans-serif" font-size="10" font-weight="500">TESTLAUF</text>
     <text x="92" y="100" fill="#dbe5f3" font-family="Inter, sans-serif" font-size="13" font-weight="600">Lasttest Demo API</text>
     <text x="240" y="100" fill="#93a2b8" font-family="monospace" font-size="11">v1.0.0 · http://localhost:8286</text>
     <rect x="470" y="86" width="110" height="22" fill="#2d6a4f" rx="11"/>
     <text x="525" y="101" text-anchor="middle" fill="#fff" font-family="Inter, sans-serif" font-size="11" font-weight="600">COMPLETED</text>
   </svg>
   ```

2. **Summary-Karten** — ein 3×2-Raster der wichtigsten k6-Zahlen:
   Check-Erfolgsquote (grün bei 100 %), HTTP-Fehlerrate (rot bei
   ≥ 5 %), p(95)-Latenz mit dem konfigurierten 1-s-Threshold,
   Request-Anzahl und -Rate, Iterations-Anzahl und -Rate sowie
   Maximal- und Durchschnitts-Antwortzeit. Jede Karte trägt eine
   einzeilige Erläuterung (z. B. `120 passed · 0 failed`), damit
   die Hauptzahl nie allein steht.

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

3. **Thresholds** — jeder k6-Threshold, den der Lauf ausgewertet hat.
   Ein grüner Balken mit `✓` heißt Threshold eingehalten; ein roter
   Balken mit `✕` heißt Threshold verletzt. Rechts daneben steht
   der tatsächlich gemessene Wert neben dem konfigurierten Limit,
   z. B. `p(95) = 42 ms < 1.000 ms`.

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

4. **Run-Konfiguration** — Base-URL, Lastprofil-Zusammenfassung,
   geplante Laufzeit, Payload-Strategie, Lauf-Zeitstempel und die
   Run-ID.

5. **API-Konfiguration** — jede ausgewählte Operation mit ihren
   tatsächlichen Parametern, Body und Bearer-Token, wie sie an das
   Target gesendet wurden. Bei einem Payload-Pool wird jede Zeile
   des Pools neben der Anzahl der tatsächlich gesendeten Calls aus
   dem k6-Summary gelistet — so siehst du, ob die `sequenzielle` /
   `zufällige` Strategie den Pool wirklich wie erwartet durchlaufen
   hat.

6. **Lastprofil & Lastverlauf** — die **Ramp-Grafik**, die die
   geplante Last (Soll) und die tatsächlich erreichte Last (Ist)
   über die Zeit zeigt. Volle Erklärung in
   [Abschnitt 11.3](#113-die-ramp-grafik-lastverlauf).

7. **Stages im Detail** — für ramping-vus-Profile eine Tabelle, die
   jede Stage in einfachem Deutsch beschreibt ("+50 VUs (Rampe auf
   50)", "Plateau", "−800 VUs (Rampe auf 0)").

8. **Statuscode-Verteilung** — die genauen HTTP-Statuscodes, die der
   Lauf produziert hat, aufgeschlüsselt pro Endpunkt. Grüne Balken
   (`200`, `201`, …) sind erfolgreiche Antworten, gelb (`429`) ist
   Rate-Limiting, rot (`5xx`, `err`) ist ein Server-seitiges Problem.

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

9. **Detaillierte Metriken** — erweiterte k6-Metrik-Tabellen,
   aufgeschlüsselt pro Endpunkt und pro Statuscode.

10. **Generiertes Skript** — das exakte k6-Skript, das ausgeführt
    wurde. In dein Terminal kopieren, um den Lauf außerhalb von
    lasttest zu reproduzieren; Details in
    [Abschnitt 12](#12-das-generierte-k6-skript).

11. **Konsolenausgabe und rohes JSON** — dieselben Blöcke wie in der
    Haupt-UI, für Druck formatiert.

### 11.3 Die Ramp-Grafik (Lastverlauf)

Wenn der Test abschließt, zeigt der Report eine **Ramp-Grafik**, die
die Last über die Zeit visualisiert. Zwei Linien werden gezeichnet:

- **Soll (geplant)** — lila, durchgezogen. Deterministisch aus dem
  konfigurierten Lastprofil berechnet. Für einen ramping-vus-Lauf
  ist die Linie eine Treppe: ein flaches Segment für jedes
  Stage-Plateau, mit linearen Rampen zwischen aufeinanderfolgenden
  Stages.
- **Ist (tatsächlich)** — orange, gestrichelt. Aus k6s
  Per-Sekunden-VU-Count-Messungen gezeichnet, die während des Laufs
  nach InfluxDB gestreamt wurden.

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
    <text x="36" y="18" fill="#dbe5f3" font-family="Inter, sans-serif" font-size="10">Soll (geplant)</text>
    <line x1="10" y1="30" x2="30" y2="30" stroke="#d4a72c" stroke-width="2" stroke-dasharray="4,3"/>
    <text x="36" y="34" fill="#dbe5f3" font-family="Inter, sans-serif" font-size="10">Ist (tatsächlich)</text>
  </g>
</svg>
```

Drei Callout-Karten fassen die Lücke zusammen:

| Callout | Bedeutung |
| --- | --- |
| **Geplante Spitze** | Spitzen-Ziel-VUs aus den Stages (oder `virtualUsers` für constant-vus) |
| **Tatsächliche Spitze** | Höchste gemessene VU-Anzahl während des Laufs |
| **Datenpunkte** | Anzahl der Per-Sekunden-Samples, die nach InfluxDB geschrieben wurden |

Nutze die Lücke zwischen Geplant und Tatsächlich, um zu sehen, ob
dein Target die Last, die du beabsichtigt hast, absorbieren konnte.
Eine große Lücke (z. B. geplant 800 VUs, tatsächlich 600 VUs)
bedeutet, dass das Target saturiert war, bevor k6 die gewünschte
Concurrency erreichte — genau die Information, die ein
Constant-VUs-Test nicht geben kann, weil ein saturierendes Target
bei konstanter Concurrency identisch zu einem langsamen Target
aussieht.

**Anforderungen:** Die Ramp-Grafik braucht den InfluxDB-Container
aus
[Abschnitt 3.2](#32-docker-mit-influxdb--grafana-zeitreihen).
Ohne InfluxDB zeigt der Report nur die Soll-Linie; die Ist-Daten
sind schlicht nicht verfügbar. Siehe
[Abschnitt 14.3](#143-ramp-grafik-zeigt-nur-die-soll-linie) für
Fehlerbehebung.

### 11.4 Drucken und als PDF exportieren

Der Report ist in einem druckfreundlichen A4-Layout gesetzt. Öffne
den Browser-Druckdialog (`Ctrl/⌘ + P`) und wähle **Als PDF sichern**
 als Ziel. Ränder, Farben und Seitenumbrüche sind so getunt, dass
das resultierende PDF auf Papier und Bildschirm lesbar ist.

---

## 12. Das generierte k6-Skript

### 12.1 Skript ansehen

Klappe den Bereich **Generiertes k6-Testskript** am unteren Rand des
Reports aus. Du siehst eine eigenständige JavaScript-Datei, die:

- nur die k6-Standardmodule importiert,
- Base-URL, VUs und Dauer aus dem Formular setzt,
- einen `http.request(...)`-Aufruf pro ausgewählter Operation
  definiert,
- Header und Bearer-Token anhängt, wo konfiguriert,
- Parameter-Substitution aus dem Formular anwendet,
- Metriken in benannten Gruppen aufzeichnet, sodass der Report nach
  Endpunkt aufschlüsseln kann.

### 12.2 Skript herunterladen

Klick **k6-Testskript herunterladen (.js)**. Die Datei wird mit dem
Dateinamen `lasttest-<run-id>.js` heruntergeladen. Sie wird auch von
`GET /api/test-runs/{id}/script` mit `Content-Disposition: attachment`
bedient — nützlich für CI-Pipelines, die direkt mit der API
sprechen.

> 🔒 Da das Skript Bearer-Tokens oder konfigurierte Header enthalten
> kann, behandle die heruntergeladene Datei wie eine Credential:
> Committe sie nicht, poste sie nicht im Chat, lasse sie nicht in
> geteilten Ordnern liegen.

### 12.3 Skript außerhalb von lasttest ausführen

Dasselbe Skript läuft auf jedem Host mit installiertem k6:

```bash
# aus dem Report
k6 run -e BASE_URL="https://example.test" lasttest-<run-id>.js

# wenn du das Skript nur lokal hast und die ursprüngliche Base-URL
# eingebettet lassen willst
k6 run lasttest-<run-id>.js
```

Das Skript liest die Base-URL zuerst aus der Umgebungsvariable
`BASE_URL`, fällt zurück auf den Wert, der beim Start des Tests
aktuell war.

---

## 13. CLI-Hilfsskripte

Ein dünnes Shell-Skript wird im Repository-Root ausgeliefert, um den
Docker-Start zu einem Einzeiler mit klarem Erfolgs-Banner zu machen.

### 13.1 `docker-start.sh`

- Läuft `docker compose up -d --build`.
- Wartet darauf, dass der Healthcheck des Containers `healthy`
  meldet (Timeout 300 s).
- Druckt einen Erfolgs-Banner mit der URL.
- Im Fehlerfall werden die letzten 80 Zeilen des Compose-Logs
  ausgegeben, damit du sehen kannst, was schief lief.

```bash
./docker-start.sh
# http://localhost:8286 im Browser öffnen
```

### 13.2 InfluxDB-UI und Grafana

Wenn du mit `docker compose up` (statt `docker run`) gestartet hast,
laufen zwei zusätzliche Container:

- **InfluxDB-UI** unter http://localhost:8086 — Login mit `admin` /
  `lasttest-admin-password`. Der Default-Bucket ist `k6`. Nützlich,
  um zu prüfen, ob k6 während eines Laufs tatsächlich Daten
  geschrieben hat (du solltest Measurements `vus`, `http_reqs`,
  `http_req_duration` sehen).
- **Grafana** unter http://localhost:3000 — anonymer Viewer-Modus ist
  aktiviert; logge dich mit `admin` / `admin` ein, um Änderungen
  vorzunehmen. Die InfluxDB-Datenquelle ist vorkonfiguriert, sodass
  du Queries und Dashboards bauen kannst, ohne Credentials erneut
  einzugeben.

Diese Services sind für **lokale Entwicklung** gedacht. Für ein
Produktions-Deployment würdest du sie hinter Authentifizierung
isolieren und eine verwaltete Time-Series-Datenbank verwenden.

---

## 14. Fehlerbehebung

| Symptom | Wahrscheinliche Ursache | Fix |
| --- | --- | --- |
| `Validieren & importieren` zeigt einen Fehler und keine Endpunkt-Karten | Spec ist ungültiges YAML / JSON, oder die Spec deklariert eine Swagger-UI-URL statt des Dokuments selbst | Datei direkt öffnen; für Swagger-UI lade stattdessen `/swagger.json` oder `/v3/api-docs` herunter |
| `Start`-Button ist deaktiviert | Kein Endpunkt ausgewählt | Mindestens eine Checkbox anhaken |
| `Start` lehnt ab mit „Pflichtparameter … darf nicht leer sein." | Ein required-Parameter ist leer in der UI | Hervorgehobenes Feld füllen |
| `Start` lehnt ab mit „Request-Body … ist kein gültiges JSON." | Der JSON-Body-Editor enthält einen Syntaxfehler | JSON reparieren; der Validator zeigt auf die Zeilennummer |
| `BindException: Address already in use` auf dem Backend | Ein anderer Prozess hört auf 8286 | `docker compose down` (falls der vorherige Container noch läuft) oder `sudo lsof -i :8286` und den betreffenden Prozess stoppen |
| Das Status-Badge bleibt für immer auf `RUNNING` | k6 ist blockiert, weil das Target langsam oder unerreichbar ist | Lauf aus der UI abbrechen, oder `docker compose logs lasttest` für die k6-Ausgabe |
| Report öffnet sich, zeigt aber "unbekannte Report-ID" | Der lasttest-Prozess wurde seit dem Lauf neu gestartet | Testläufe werden nur im Speicher gehalten; führe den Test erneut aus, um einen frischen Report zu erhalten |
| Bearer-authentifizierte Requests kommen als `401` zurück | Der Placeholder hat dich dazu verleitet, das `Bearer `-Präfix einzufügen | Präfix entfernen; lasttest fügt es für dich hinzu |
| CORS-Fehler in der Browser-Konsole beim Aufrufen der Ziel-API | Das Target erlaubt keine Cross-Origin-Requests vom Frontend | lasttest führt den Test vom Backend aus, nicht vom Browser — öffne den Report und prüfe die k6-Ausgabe; der CORS-Fehler kommt vom Browser, nicht vom Test |
| `PKIX path building failed: unable to find valid certification path to requested target` | Das Target-API verwendet ein TLS-Zertifikat, das von der JVM nicht vertraut wird (self-signed, interne CA, fehlendes Intermediate) | Siehe [Abschnitt 14.1 — Eigene TLS-Zertifikate vertrauen](#141-eigene-tls-zertifikate-vertrauen) |
| k6-Lauf-Logs enthalten `x509: certificate signed by unknown authority` (Import hat aber funktioniert) | Der Backend-TrustStore ist korrekt, aber k6 selbst kennt die Custom-CA noch nicht | `SSL_CERT_FILE` setzen — siehe [Abschnitt 14.1.1](#1411-die-k6-seite-ssl_cert_file) |
| Die Ramp-Grafik zeigt nur die Soll-Linie, keine Ist-Linie | InfluxDB ist nicht erreichbar oder es wurden keine Daten geschrieben | Siehe [Abschnitt 14.2](#142-influxdb-ist-nicht-erreichbar) und [14.3](#143-ramp-grafik-zeigt-nur-die-soll-linie) |
| Rechtsklick auf ein Run-Badge tut nichts | Cursor außerhalb des Badges, Browser-Extension unterdrückt kontextmenu, oder Mid-Transition-Render | Siehe [Abschnitt 14.4](#144-rechtsklick-menü-erscheint-nicht) |
| Toolbar-Sprach-Pille zeigt die falsche Sprache | Veralteter `localStorage`-Eintrag aus früherer Session, oder Browser blockiert Storage im Privatmodus | Siehe [Abschnitt 6.2](#62-einstellungs-schublade-sprachumstellung) — Sprache erneut wählen; fällt auf Englisch zurück, wenn `localStorage` nicht verfügbar ist |
| k6-Lauf-Logs enthalten `could not create the 'influxdb' output: unknown query parameter: org` | InfluxDB-Image-Version ist 2.x; k6 v2 unterstützt nur InfluxDB v1 | Verwende das gebündelte Compose-File (es liefert InfluxDB 1.11) |

### 14.1 Eigene TLS-Zertifikate vertrauen

Wenn die Ziel-API ein TLS-Zertifikat verwendet, das nicht von einer
public CA signiert wurde — zum Beispiel ein self-signed Zertifikat
in einer Staging-Umgebung oder ein von einer internen CA
ausgestelltes Zertifikat — lehnt die JVM den TLS-Handshake ab und
lasttest meldet `PKIX path building failed: unable to find valid
certification path to requested target`.

Konfiguriere lasttest mit einem zusätzlichen TrustStore, der die
fehlenden Zertifikate oder die CA-Kette enthält. Der Java-System-
TrustStore wird weiterhin verwendet, sodass public CAs weiter
funktionieren — nur die zusätzlichen Zertifikate werden obendrauf
geschichtet.

| Variable | Erforderlich | Beschreibung |
| --- | --- | --- |
| `LASTTEST_TRUSTSTORE_PATH` | ja | Absoluter Pfad zu einer Datei mit den Zertifikaten. Unterstützte Formate: `PKCS12` (`.p12`, `.pfx`), `JKS` (`.jks`), oder PEM (`.pem`, `.crt`, `.cer` — einer oder mehrere CERTIFICATE-Blöcke). |
| `LASTTEST_TRUSTSTORE_PASSWORD` | nur für PKCS12 / JKS | Passwort für den TrustStore. Leerer String ist für PEM-Dateien erlaubt. |

Beispiele:

```bash
# PEM-Datei mit einem oder mehreren CERTIFICATE-Blöcken
export LASTTEST_TRUSTSTORE_PATH=/etc/lasttest/staging-ca.pem
export LASTTEST_TRUSTSTORE_PASSWORD=

# PKCS12-TrustStore, mit keytool erstellt
export LASTTEST_TRUSTSTORE_PATH=/etc/lasttest/staging.p12
export LASTTEST_TRUSTSTORE_PASSWORD=changeit
```

Eine PEM-Datei aus einem Target-Host mit OpenSSL generieren:

```bash
openssl s_client -showcerts -connect api.example.com:443 </dev/null 2>/dev/null \
  | openssl x509 -outform PEM > staging-ca.pem
```

Oder einen PKCS12-TrustStore aus einem heruntergeladenen Zertifikat
bauen:

```bash
keytool -importcert -alias staging -file staging-ca.pem \
  -keystore staging.p12 -storetype PKCS12 -storepass changeit -noprompt
```

Die Variablen müssen nur in der Umgebung gesetzt sein, die das
lasttest-Backend betreibt (Docker-Container, systemd-Unit,
Terminal, …). Starte lasttest nach Änderungen neu.

#### 14.1.1 Die k6-Seite: `SSL_CERT_FILE`

Der TrustStore oben deckt nur das **lasttest-Backend** ab — also
den Spec-Import per HTTPS in Schritt 1. k6 läuft als separater
Prozess und nutzt Gos TLS-Stack; es liest den Java-TrustStore
**nicht**. Ohne separate k6-Konfiguration klappt der Import, der
eigentliche Lasttest bricht aber mit `x509: certificate signed by
unknown authority` in den k6-Logs ab.

k6 liest sein CA-Bundle aus der Go-Standard-Umgebungsvariablen:

| Variable | Erforderlich | Beschreibung |
| --- | --- | --- |
| `SSL_CERT_FILE` | empfohlen | Absoluter Pfad zu einer PEM-Datei mit den CA-Zertifikaten, denen k6 vertrauen soll. Mehrere `-----BEGIN CERTIFICATE-----`-Blöcke in einer Datei sind erlaubt. |

```bash
# Dieselbe PEM wiederverwenden, die für das Backend gemountet ist
export SSL_CERT_FILE=/etc/lasttest/custom-ca.pem
```

> **Wichtig — `SSL_CERT_FILE` ersetzt, es erweitert nicht.** Im Gegensatz zum Java-TrustStore (der die JVM-Defaults *ergänzt*), **ersetzt** `SSL_CERT_FILE` das System-CA-Bundle für k6. Verwende die Variable nur, wenn alle Targets deiner Tests von derselben Custom-CA signiert sind, oder hänge mehrere CA-Zertifikate in einer PEM zusammen.

#### 14.1.2 Mitgelieferter Docker-Compose-Workflow

Das ausgelieferte `docker-compose.yml` verdrahtet beide Seiten
bereits. Der relevante Block:

```yaml
volumes:
  - ./certs/custom-ca.pem:/etc/lasttest/custom-ca.pem:ro
environment:
  LASTTEST_TRUSTSTORE_PATH: /etc/lasttest/custom-ca.pem
  LASTTEST_TRUSTSTORE_PASSWORD: ""
  SSL_CERT_FILE: /etc/lasttest/custom-ca.pem
```

Lege die Root-CA deines Unternehmens (PEM-Format, ggf. mit
mehreren `-----BEGIN CERTIFICATE-----`-Blöcken) unter
`certs/custom-ca.pem` auf dem Host ab und starte den Container neu:

```bash
docker compose restart lasttest
```

Der Mount-Pfad im Container ist read-only — das Zertifikat wird
nie versehentlich überschrieben.

#### 14.1.3 Zertifikat verifizieren

Nach dem Neustart erscheint im Backend-Log eine dieser Zeilen:

```
Lade zusätzlichen TrustStore aus /etc/lasttest/custom-ca.pem (Variable LASTTEST_TRUSTSTORE_PATH) …
TrustStore /etc/lasttest/custom-ca.pem erfolgreich geladen.
```

Steht dort stattdessen `TrustStore unter … konnte nicht geladen
werden (…)`, ist die Datei nicht lesbar, fehlerhaft, oder kein
gültiges PEM/PKCS12/JKS — das Backend fällt auf die JVM-Defaults
zurück und der TLS-Fehler tritt bei der nächsten Anfrage erneut
auf.

Bei k6 passiert die Zertifikatsprüfung erst während des Laufs:
k6 loggt `x509: certificate signed by unknown authority` für jede
fehlschlagende Anfrage, und der Report des Laufs zeigt denselben
Fehler im Bereich *Konsole / JSON*. Wenn der Import funktioniert
hat, der Lauf aber scheitert, fehlt `SSL_CERT_FILE` für den
k6-Prozess (oder ist für ihn nicht lesbar).

#### 14.1.4 Lokaler Entwicklungsmodus

Beim Betrieb ohne Docker (`./gradlew bootRun` plus `npm run dev`)
exportierst du die Variablen in derselben Shell, die das Backend
und (separat) das host-eigene k6 startet:

```bash
export LASTTEST_TRUSTSTORE_PATH=$PWD/certs/custom-ca.pem
export LASTTEST_TRUSTSTORE_PASSWORD=
export SSL_CERT_FILE=$PWD/certs/custom-ca.pem

# 1) Backend in derselben Shell starten
./gradlew bootRun

# 2) k6 als Host-Binary (NICHT im Docker-Image) in derselben Shell
#    verfügbar machen, damit es SSL_CERT_FILE erbt — das Backend
#    ruft `k6 run` über den PATH auf.
```

`./gradlew bootRun` liest seine Umgebung aus der startenden Shell —
das `export` muss also für Gradle sichtbar sein. Tools wie `direnv`
oder ein projektlokales `.envrc` halten die Variablen sticky, ohne
die globale Shell zu verschmutzen.

#### 14.1.5 Einschränkungen

- **Nur Server-Zertifikate.** lasttest vertraut *zusätzlichen* Server-Zertifikaten — es gibt keine UI für Client-Zertifikate (mTLS). Verlangt deine Ziel-API ein Client-Cert/-Key, musst du das außerhalb von lasttest lösen (z. B. ein Reverse-Proxy vor k6, der die Client-Cert-Seite terminiert).
- **Eine PEM für k6.** `SSL_CERT_FILE` *ersetzt* das System-Bundle; testest du mehrere Targets, die von unterschiedlichen internen CAs signiert sind, hänge die Zertifikate in einer PEM zusammen (jeder Block einzeln mit `-----BEGIN CERTIFICATE-----`) oder nutze stattdessen die Variable `SSL_CERT_DIR`, die auf ein Verzeichnis mit PEM-Dateien zeigt.
- **Neustart erforderlich.** Der TrustStore wird einmal beim Backend-Start geladen, `SSL_CERT_FILE` einmal pro k6-Prozess. Änderungen erfordern einen Neustart des Backend-Containers / -Prozesses und einen neuen k6-Lauf.

### 14.2 InfluxDB ist nicht erreichbar

Das Backend prüft InfluxDB beim Start via
`LASTTEST_INFLUXDB_URL/health`, und die Logs des lasttest-Containers
zeigen eine Warnung, falls es unerreichbar ist. Häufige Ursachen und
deren Fixes:

| Ursache | Fix |
| --- | --- |
| InfluxDB-Container nicht gestartet | `docker compose up -d influxdb` |
| Falsche URL | Setze `LASTTEST_INFLUXDB_URL=http://influxdb:8086` (muss zum Docker-Netzwerk-Namen passen) |
| Falsche Credentials | Setze `LASTTEST_INFLUXDB_USER` und `LASTTEST_INFLUXDB_PASSWORD` auf die Defaults aus `docker-compose.yml` (`k6-writer` / `lasttest-writer-password`) |
| Du nutzt das schlichte `docker run`, nicht Compose | InfluxDB wird von `docker run` **nicht** gestartet; wechsle entweder zu Compose oder betreibe InfluxDB separat und zeige `LASTTEST_INFLUXDB_URL` darauf |

Wenn InfluxDB unerreichbar ist, funktioniert lasttest trotzdem — du
verlierst nur die Ist-Linie in der Ramp-Grafik.

### 14.3 Ramp-Grafik zeigt nur die Soll-Linie

Zwei Gründe sind häufig:

1. **InfluxDB war unerreichbar** (siehe oben). Das Backend liefert
   ein leeres Zeitreihen-Array zurück; der SVG-Renderer zeichnet nur
   die Soll-Linie und das "Tatsächliche Spitze"-Callout zeigt "–".
2. **Der Lauf war sehr kurz** (< 2 s). k6 hat möglicherweise noch
   nicht genug Per-Sekunden-Samples nach InfluxDB geschrieben. Warte
   auf den nächsten Lauf.

Trifft keines zu, prüfe die Logs des k6-Containers auf
`could not write stats, ...`-Warnungen — sie zeigen, dass der
k6 → InfluxDB-Schreibpfad gebrochen ist.

### 14.4 Rechtsklick-Menü erscheint nicht

Das Run-Badge-Kontextmenü wird mit `onContextMenu` auf dem
Badge-Button geöffnet. Wenn ein Rechtsklick auf ein Badge nichts
tut, gehe diese Checks durch:

1. **Du hast die Detail-Karte geklickt, nicht das Badge.** Das Badge
   lebt im Multi-Run-Dashboard-Grid (über der Detail-Karte).
   Rechtsklick dort.
2. **Das Badge war fokussiert, aber du hast außerhalb davon
   rechtsgeklickt.** Bewege den Cursor über das Badge selbst (den
   farbigen Chip mit Methode, Status und Pfad), bevor du
   rechtsklickst. Das Menü öffnet an der Cursor-Position, also muss
   der Cursor auf dem Badge sein.
3. **Dein Browser hat das Menü überschrieben.** Einige Kiosk- /
   Accessibility-Erweiterungen unterdrücken das Browser-Kontextmenü
   und damit auch lasttests eigenes Menü. Deaktiviere die
   Erweiterung für die lasttest-Origin oder nutze die
   Tastatur-Alternative: Fokussiere das Badge mit `Tab` und drücke
   die Kontextmenü-Taste (`Menu` auf den meisten Tastaturen,
   `Shift + F10` ist der universelle Fallback).
4. **Der Lauf ist in Mid-Transition.** Ein Lauf, der gerade in
   `STOPPING` übergegangen ist, rendert sehr schnell; wenn du
   während dieses Frames rechtsgeklickt hast, hat sich das Menü
   vielleicht gegen den vorherigen Status geöffnet und beim
   Re-Render des Badges selbst geschlossen. Klick einmal auf das
   Badge, um es neu zu fokussieren, dann rechtsklick erneut.

Hilft nichts davon, öffne die Browser-Devtools und prüfe auf
JavaScript-Fehler nach dem Rechtsklick — das Menü-Mount ist in
einen einzelnen Effect gewickelt, der bei Fehler in die Konsole
loggt.

---

## 15. Glossar

| Begriff | Bedeutung in lasttest |
| --- | --- |
| **Operation** | Ein einzelner HTTP-Endpunkt, beschrieben durch einen Pfad und eine Methode in der Spec. |
| **Endpunkt-Karte** | Der einklappbare UI-Block, der eine Operation repräsentiert. |
| **VU (Virtual User)** | Eine gleichzeitige Schleife in k6, die Requests so schnell wie möglich feuert. |
| **Iteration** | Eine vollständige Ausführung des Skripts durch einen VU. |
| **Exekutor** | Die k6-Strategie zum Feuern von Requests. lasttest exponiert vier: `constant-vus`, `shared-iterations`, `ramping-vus`, `constant-arrival-rate`. |
| **Stage** | In einem Ramping-VUs-Profil eine Zeile der Stages-Tabelle. Jede Stage hat eine Ziel-VU-Anzahl und eine Dauer; k6 rampt linear zwischen aufeinanderfolgenden Stages. |
| **Soll / Ist** | "Geplant / Tatsächlich" — die Ramp-Grafik vergleicht das geplante Lastprofil (Soll, deterministisch) mit den gemessenen Per-Sekunden-VU-Counts von k6 (Ist, via InfluxDB gestreamt). |
| **InfluxDB** | Die optionale Time-Series-Datenbank, die lasttest mitliefert. Speichert Per-Sekunden-k6-Metriken, damit die Ramp-Grafik die Ist-Linie zeigen kann. |
| **Grafana** | Das optionale Dashboard-UI auf InfluxDB, enthalten im Compose-File für Ad-hoc-Exploration. |
| **Preset** | One-Click-Lastprofil im Editor: Smoke, Load, Stress, Spike, Soak, Arrival-Rate. |
| **Threshold** | Ein k6-Ausdruck (z. B. `http_req_duration{p95:200}`), den das Skript am Ende auswertet; Pass / Fail wird im Report gezeigt. |
| **Run-ID** | UUID, die jedem Testlauf zugewiesen wird; in Deep-Links und zum Herunterladen des Skripts verwendet. |
| **Spec** | Das OpenAPI- oder Swagger-Dokument, das die Ziel-API beschreibt. |
| **Demo-API** | Der In-Process-Server, den lasttest unter `/demo-api/*` exponiert, damit du die volle Pipeline ohne externe Abhängigkeit üben kannst. |
| **Run-Badge** | Die kompakte Karte im Multi-Run-Dashboard, die einen einzelnen Testlauf repräsentiert. Zeigt Methode, Status und Pfad; Linksklick fokussiert, Rechtsklick öffnet das Aktions-Menü. |
| **Aktions-Menü (Run-Badge)** | Kontextmenü, das per Rechtsklick auf ein Run-Badge öffnet. Items passen sich dem Status des Laufs an (in-flight vs. terminal). Bietet Stop, Force Abort, Erneut ausführen, Kopier-Aktionen, Export. |
| **Payload-Pool** | Geordnete Liste von Datensätzen (Parameterwerte + Request-Body + Bearer-Token) an einem einzelnen Endpunkt. k6 durchläuft den Pool entsprechend der gewählten Strategie (sequenziell oder zufällig). |
| **Payload-Strategie** | Wie der Runner pro Iteration den nächsten Payload aus dem Pool wählt: `sequential` (round-robin, mit Wrap-Around) oder `random` (uniformer Pick). Bei einem Ein-Zeilen-Pool sind beide identisch. |
| **Settings-Schublade** | Slide-in-Modal, geöffnet vom Zahnrad in der oberen Toolbar. Exponiert aktuell den Sprach-Abschnitt zum Wechseln zwischen Englisch und Deutsch. Persistiert die Wahl in `localStorage`. |
| **Doc-Popup** | Zentriertes Markdown-Modal, geöffnet aus der Toolbar (User Guide / README). Zweisprachig, mit Live-Suche (`Ctrl/⌘ + F`), Vor- / Zurück-Treffer-Navigation und Esc zum Schließen. |
| **STOPPING** | Transienter Zustand eines Testlaufs, nachdem der Nutzer *Stop (graceful)* geklickt hat, aber bevor k6 tatsächlich beendet ist. Das Badge wird weiter gepollt, bis es zu `STOPPED` oder `ABORTED` transitiert. |
| **STOPPED** | Terminal-Zustand nach einer graceful `SIGTERM`-Abbruch. Bis zum Stop ausgewertete Thresholds werden weiterhin gemeldet. |
| **ABORTED** | Terminal-Zustand nach einer forcierten `SIGKILL`-Abbruch (oder einer `STOPPING → force`-Eskalation). Nur Teilkennzahlen können vorhanden sein; die Threshold-Bewertung ist nicht aussagekräftig. |
| **Erneut ausführen** | Aktion, die den `CreateTestRunRequest` eines existierenden Terminal-Laufs mit einer frischen Run-ID erneut einreiht. Ausgelöst aus dem Rechtsklick-Menü auf Terminal-Badges. |
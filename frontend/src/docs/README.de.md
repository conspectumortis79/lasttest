# lasttest

`lasttest` importiert Swagger 2.0- und OpenAPI 3-Spezifikationen (YAML oder
JSON), erzeugt pro Operation einen k6-Request und führt ausgewählte
Lasttests asynchron aus. Swagger 2.0-Dokumente werden beim Import
automatisch in das interne OpenAPI 3-Modell konvertiert. Die Anwendung
läuft auf **Linux und macOS**. Für ein reproduzierbares Verhalten auf
beiden Betriebssystemen ist Docker der empfohlene Verteilungsweg.

## Was lasttest tut

Pro importierter Spec lässt lasttest dich:

1. **Eine Operation auswählen** und Parameter, Request-Body und
   Bearer-Token konfigurieren — und (seit dem Payload-Pool-Release)
   einen **Pool aus mehreren Datensätzen** aufbauen, den k6
   sequenziell oder zufällig durchläuft.
2. **Ein Lastprofil wählen**, das auf einen von vier k6-Exekutoren
   gemappt wird — `constant-vus`, `shared-iterations`,
   `ramping-vus` oder `constant-arrival-rate` — inklusive
   One-Click-Presets für Smoke, Load, Stress, Spike, Soak, Burst
   und Arrival-Rate.
3. **Den Test starten** und den Status `QUEUED` → `RUNNING` →
   `COMPLETED` (bzw. `FAILED`, `STOPPED`, `ABORTED`) verfolgen.
   Jeder Lauf erscheint als **Badge** im Multi-Run-Dashboard. **Ein
   Rechtsklick auf das Badge öffnet ein Aktions-Menü**, über das du
   den Test stoppen (graceful), per Force-Abort abbrechen
   (SIGKILL), mit derselben Konfiguration erneut ausführen
   (Rerun), die Run-ID kopieren, den Report-Link kopieren, den
   Report in einem neuen Tab öffnen oder das rohe k6-JSON-Summary
   exportieren kannst.
4. **Den Report** in einem neuen Tab öffnen. Er enthält eine
   druckoptimierte Zusammenfassung, das generierte k6-Skript und —
   sofern InfluxDB läuft — eine **Ramp-Grafik**, die die geplante
   Last (Soll) mit der tatsächlich gemessenen Last (Ist)
   vergleicht.

## Schnellstart mit einem Container

```bash
docker build -t lasttest:latest .
docker run -d --name lasttest -p 8286:8286 --restart unless-stopped lasttest:latest
```

Oder mit Docker Compose:

```bash
docker compose up --build -d
```

Es starten drei Container: `lasttest` (die Anwendung),
`lasttest-influxdb` (Time-Series-Datenbank für die Ramp-Grafik) und
`lasttest-grafana` (optionale Dashboards). Erreichbar unter:

- `http://localhost:8286` — lasttest Web-UI
- `http://localhost:8086` — InfluxDB-UI (Login `admin` /
  `lasttest-admin-password`)
- `http://localhost:3000` — Grafana (Login `admin` / `admin`)

Wenn du lasttest ohne Time-Series-Stack brauchst, starte es allein
mit `docker run`. Die Ramp-Grafik zeigt dann nur die Soll-Linie.

Sobald Spring Boot hochgefahren ist, erscheint im Container-Log eine
deutlich sichtbare Erfolgsmeldung mit Link auf die Web-UI:

```text
============================================================
lasttest wurde erfolgreich gestartet.
Jetzt im Browser öffnen: http://localhost:8286/
============================================================
```

Bei einem anderen Host oder Port kann der angezeigte Link über die
Umgebungsvariable `LASTTEST_PUBLIC_URL` überschrieben werden.

Im Browser öffnen:

- `http://localhost:8286` (vom Docker-Host)
- `http://<IP-des-Docker-Hosts>:8286` (von einer anderen Maschine)

Das finale Runtime-Image enthält Java 25, das kompilierte
Kotlin-/Spring-Backend samt JVM-Bibliotheken, das gebaute
React-Frontend und k6. Gradle, der Kotlin-Compiler und Node.js werden
nur in isolierten Build-Stufen verwendet und sind weder auf dem Host
noch im finalen Image erforderlich.

## Eigene TLS-Zertifikate vertrauen

Wenn die Ziel-API ein TLS-Zertifikat verwendet, das nicht von einer
öffentlichen CA signiert wurde — etwa ein selbstsigniertes Zertifikat
in einer Staging-Umgebung oder ein Zertifikat einer
Firmen-/internen CA — verweigert die JVM den TLS-Handshake und
lasttest meldet `PKIX path building failed: unable to find valid
certification path to requested target`.

Konfiguriere lasttest mit einem zusätzlichen TrustStore, der die
fehlenden Zertifikate bzw. die CA-Chain enthält. Der Java-
System-TrustStore bleibt aktiv, öffentliche CAs funktionieren also
weiterhin — nur die zusätzlichen Zertifikate werden obendrauf gelegt.

| Variable | Pflicht | Beschreibung |
| --- | --- | --- |
| `LASTTEST_TRUSTSTORE_PATH` | ja | Absoluter Pfad zur Zertifikatsdatei. Unterstützte Formate: `PKCS12` (`.p12`, `.pfx`), `JKS` (`.jks`) oder PEM (`.pem`, `.crt`, `.cer` — ein oder mehrere `CERTIFICATE`-Blöcke). |
| `LASTTEST_TRUSTSTORE_PASSWORD` | nur für PKCS12 / JKS | Passwort für den TrustStore. Für PEM-Dateien ist ein leerer String erlaubt. |

Das mitgelieferte `docker-compose.yml` verdrahtet beide Variablen für
das Backend bereits und mountet den Host-Pfad `certs/custom-ca.pem`
read-only in den Container unter `/etc/lasttest/custom-ca.pem`. Lege
die Root-CA deiner Firma an diesem Pfad ab (PEM-Format, ggf. mit
mehreren `-----BEGIN CERTIFICATE-----`-Blöcken) und starte neu:

```bash
docker compose restart lasttest
```

Im Backend-Log erscheint beim Start eine dieser Zeilen:

```text
Lade zusätzlichen TrustStore aus /etc/lasttest/custom-ca.pem (Variable LASTTEST_TRUSTSTORE_PATH) …
TrustStore /etc/lasttest/custom-ca.pem erfolgreich geladen.
```

Schlägt das Laden fehl, loggt das Backend eine Warnung und fällt auf
die JVM-Defaults zurück — der TLS-Fehler taucht beim nächsten Request
erneut auf.

PEM-Datei eines Zielhosts mit OpenSSL erzeugen:

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

> **k6 läuft als eigener Prozess und nutzt Gos TLS-Stack.** Es liest
> den Java-TrustStore **nicht** — daher kann der Spec-Import
> funktionieren, der Lasttest danach aber mit `x509: certificate
> signed by unknown authority` scheitern. k6 liest sein CA-Bundle aus
> der Go-Standardvariable `SSL_CERT_FILE` — zeige sie im Container
> auf dasselbe PEM. Beachte: `SSL_CERT_FILE` **ersetzt** das
> System-Bundle (es wird nicht ergänzt). Verwende es deshalb nur,
> wenn alle Zielsysteme von derselben Custom-CA signiert sind, oder
> hänge mehrere CA-Zertifikate in einer PEM-Datei aneinander. Für ein
> Verzeichnis voller PEM-Dateien nutze stattdessen `SSL_CERT_DIR`.

Auch im Dev-Modus (`./gradlew bootRun` + `npm run dev`) gelten
dieselben Variablen — exportiere sie in der Shell, die das Backend
und das lokale `k6`-Binary startet:

```bash
export LASTTEST_TRUSTSTORE_PATH=$PWD/certs/custom-ca.pem
export LASTTEST_TRUSTSTORE_PASSWORD=
export SSL_CERT_FILE=$PWD/certs/custom-ca.pem
```

Neustart erforderlich: Der TrustStore wird einmal beim Backend-Start
geladen, `SSL_CERT_FILE` einmal pro `k6`-Prozess gelesen. Die
vollständige Ende-zu-Ende-Anleitung (inklusive Einschränkungen zu
mTLS, Multi-CA-PEMs und `direnv`-basierten Dev-Workflows) findest du
im **User Guide** unter *Eigene TLS-Zertifikate vertrauen*.

## UI-Sprache

Das lasttest-Frontend ist **vollständig zweisprachig**. Eine Pille in
der oberen Toolbar zeigt die aktive Sprache (English / Deutsch); ein
Zahnrad-Icon öffnet die **Settings-Schublade**, in der die Sprache
jederzeit umgestellt werden kann.

- Die Auswahl wird in **`localStorage`** unter dem Schlüssel
  `lasttest.language` **gespeichert**, damit der nächste Besuch in
  der zuletzt gewählten Sprache startet.
- Sämtliche Toolbar-Chrome, Settings, Walkthrough, Status-Pills,
  Report-Header und die Markdown-Dokumentations-Popups folgen der
  aktiven Sprache.
- Das gebündelte **User Guide** und **README** (Toolbar → *User
  Guide* / *README*) erscheinen automatisch in der gewählten Sprache
  als durchsuchbare Markdown-Popups (`Ctrl/⌘ + F` zum Suchen,
  `Enter` zum nächsten Treffer, `Shift + Enter` zurück, `Esc`
  schließt).

## Aktions-Menü am Run-Badge (Rechtsklick)

Jeder k6-Lauf erscheint als farbiges Badge im **Multi-Run-Dashboard**
(Schritt 4). Das Badge zeigt HTTP-Methode, Status und Pfad. Ein
Linksklick fokussiert den Lauf; ein **Rechtsklick öffnet das
Aktions-Menü an der Cursor-Position**. Das Menü passt sich dem
aktuellen Status des Laufs an und bietet nur Aktionen an, die
Sinn ergeben:

| Menüpunkt | Sichtbar bei | Wirkung |
| --- | --- | --- |
| **Live-Details anzeigen / Zusammenfassung anzeigen / Aborted-Details anzeigen** | immer | Fokussiert die Detail-Karte des Laufs (Beschriftung wechselt mit dem Status) |
| **Run-ID kopieren** | immer | Kopiert die UUID in die Zwischenablage |
| **Report-Link kopieren** | Terminal-Läufe | Kopiert `http://…/?report=<run-id>` in die Zwischenablage |
| **k6-Webreport öffnen** | immer | Öffnet den druckoptimierten Report in einem neuen Tab |
| **k6-JSON exportieren** | Terminal-Läufe mit vollständigem Summary | Lädt `lasttest-<run-id>-summary.json` für Offline-Analysen herunter |
| **Stop (graceful)** | `QUEUED`, `RUNNING`, `STOPPING` | Sendet `SIGTERM`; k6 läuft sauber aus, der Lauf endet als `STOPPED` |
| **Force abort** | `QUEUED`, `RUNNING`, `STOPPING` | Sendet `SIGKILL`; der Lauf endet sofort als `ABORTED` (Metriken können unvollständig sein) |
| **Erneut ausführen** | Terminal-Läufe (`COMPLETED` / `FAILED` / `STOPPED` / `ABORTED`) | Führt dasselbe Szenario mit der ursprünglichen Base-URL und einer frischen Run-ID erneut aus |
| **Aus Ansicht entfernen** | Terminal-Läufe (`COMPLETED` / `FAILED` / `STOPPED` / `ABORTED`) | Entfernt das Badge aus dem In-Memory-Dashboard. Das Backend hält den Lauf weiterhin, sodass ein Page-Refresh ihn aus `/api/test-runs` wieder einliest |
| **Alle anderen fehlgeschlagenen Läufe entfernen** | Terminal-Läufe, wenn mindestens ein anderes `FAILED`-Badge vorhanden ist | Entfernt alle anderen `FAILED`-Badges aus dem Dashboard in einem Schritt. Deaktiviert (mit Grund), wenn es nichts zu entfernen gibt. STOPPED- und ABORTED-Läufe werden bewusst erhalten |

> 💡 **Beispiel — Rerun per Rechtsklick:** Du hast ein 30 s
> `Smoke`-Profil gegen die Demo gefahren und willst prüfen, ob das
> Ergebnis reproduzierbar ist. Rechtsklicke das grüne `COMPLETED`-
> Badge, wähle **Erneut ausführen**, und lasttest ruft
> `/api/test-runs/{id}/rerun` auf. Das Backend reiht denselben
> `CreateTestRunRequest`, der beim ursprünglichen Start gespeichert
> wurde, erneut ein, k6 startet frisch, und das neue Badge erscheint
> im Dashboard — der Fokus wechselt automatisch auf den neuen Lauf.

Ein Klick außerhalb des Menüs (oder `Esc`) schließt es. Linksklick
bleibt reserviert für das Fokussieren des Laufs.

## Payload-Pool (Parameter-Variabilität)

Jede Endpunkt-Karte in Schritt 2 erlaubt es, einen **Pool aus
mehreren Payloads** (Datensätzen) pro Operation anzulegen — nicht
nur einen. Jede Zeile des Pools ist ein kompletter Datensatz mit
eigenen Parameterwerten, eigenem Request-Body und eigenem
Bearer-Token. k6 durchläuft den Pool entsprechend der in der
Lastprofil-Karte gewählten **Payload-Strategie**:

- **Sequenziell** — der Pool wird von oben nach unten durchlaufen
  und am Ende wiederholt (Round-Robin).
- **Zufällig** — pro Iteration wird ein Payload zufällig gezogen.

Der Pool wird als kompakte Tabelle gerendert, mit
`+ Payload hinzufügen` zum Anfügen und `×` zum Entfernen einer
Zeile (die letzte Zeile bleibt — mindestens ein Payload ist immer
erforderlich). Die Strategie-Auswahl sitzt zusammen mit der
Exekutor-Dropdown in der Lastprofil-Karte.

Der ausführliche Report (`/?report=<id>`) schlüsselt die
Aufrufverteilung **pro Payload** anhand der k6-Per-Payload-Counter
auf, sodass du prüfen kannst, wie oft jede Zeile tatsächlich
gesendet wurde.

Die Demo-Spezifikation liegt unter `demo/openapi-demo.yaml`. Sie
enthält GET-Requests mit editierbaren Query- und Pfadparametern,
POST-Requests mit JSON-Body sowie PUT und DELETE.
`POST /products/search` demonstriert Bearer-Authentifizierung; jedes
nicht-leere Demo-Token wird akzeptiert. Nach dem Import zeigt die UI
pro Endpunkt eine Eingabebox für Parameter, Request-Body und
Bearer-Token.

Die Demo deklariert außerdem vier `servers`-Einträge (lokale Demo,
Staging, Integration, Produktion), damit die **Base-URL-Dropdown** in
der Lastprofil-Karte sofort sichtbar ist. Nur der lokale Eintrag
antwortet tatsächlich; die anderen drei sind Platzhalter, die
zeigen, wie eine Multi-Environment-Spec in der UI aussieht.

Nach einem Testlauf öffnet der Link "Ausführlichen k6-Testbericht in
neuem Tab öffnen" eine druckoptimierte Ergebnis-Ansicht. Sie
enthält Zusammenfassung, Thresholds, Lauf- und API-Konfiguration,
die tatsächlich verwendeten Endpunkt-Parameter, die **Ramp-Grafik**
mit Soll/Ist-Vergleich (wenn InfluxDB läuft), detaillierte
k6-Metriken und Konsolen-/JSON-Rohdaten. Über "Drucken / als PDF
speichern" kannst du diese Ansicht direkt als PDF archivieren.

Unter dem k6-JSON-Export lässt sich "Generiertes k6-Testskript"
ausklappen. Es zeigt das exakte Skript, das lasttest ausgeführt hat,
und bietet einen Download als "k6-Testskript herunterladen (.js)" an.
Der Report zeigt zusätzlich den passenden manuellen Startbefehl, zum
Beispiel:

```bash
k6 run -e BASE_URL="https://example.test" lasttest-<run-id>.js
```

Das Skript ist außerdem über `GET /api/test-runs/{id}/script` mit
`Content-Disposition: attachment` verfügbar. Da das exakte Testskript
konfigurierte Header oder Bearer-Tokens enthalten kann, muss die
exportierte Datei sicher verwahrt werden.

Der Import-Endpunkt akzeptiert rohen YAML- oder JSON-Inhalt mit
`swagger: "2.0"` oder `openapi: 3.x`. Neben dem Einfügen oder
Hochladen eines Dokuments bietet die UI ein **URL-Feld**, das die
Spec von jeder Swagger-UI-Seite oder einer direkten
OpenAPI-Dokument-URL abholt. Das Backend inspiziert das Swagger-UI-
HTML, extrahiert die eingebetteten `url` / `urls`-Einträge, lädt die
Spec herunter und importiert sie transparent. Cross-Origin-Ziele
werden abgelehnt, die Antwort ist auf 5 MB und 10 s Timeout
begrenzt. Eine gebündelte Demo-Swagger-UI liegt unter
`http://localhost:8286/demo-swagger-ui` bereit, sobald lasttest
läuft — so lässt sich der URL-Flow ohne externe Abhängigkeiten
durchspielen.

## Anforderungen für lokale Entwicklung

- Java 25+
- Node.js 22+
- k6

Docker Engine mit Compose ist eine vollständige Alternative auf
Linux und macOS.

## Lokale Entwicklung auf Linux / macOS

```bash
# Terminal 1
cd backend
./gradlew bootRun

# Terminal 2
cd frontend
npm install
npm run dev
```

> **Hinweis**: `./gradlew bootRun` ist ein blockierender Task —
> Gradle bleibt im Vordergrund und zeigt weiter einen
> Fortschrittsbalken (`EXECUTING [Ns]`), bis du `Ctrl+C` drückst,
> obwohl die Spring-Boot-App bereits hochgefahren ist. Sobald im Log
> `Started LasttestApplicationKt in N.N seconds` erscheint, ist die
> API auf `http://localhost:8286/` erreichbar. Öffne die Dev-UI-
> URL unten im Browser, während der Gradle-Prozess weiterläuft.

Dann öffnen: <http://localhost:5173>

Im Dev-Modus bedient der Vite-Dev-Server die React-UI mit
Hot-Reload unter **http://localhost:5173**, Spring Boot läuft mit
der JSON-API unter **http://localhost:8286**. Die Backend-URL
bedient **keine** UI im Dev-Modus (Whitelabel-404, weil
`../frontend/dist/` nicht gebaut ist). Öffne im Browser immer die
Dev-UI-URL:

- Dev-UI (Vite, Hot-Reload): <http://localhost:5173>
- API (Spring Boot, nur JSON): <http://localhost:8286>

Für ein Single-URL-Deployment, bei dem das Backend API und UI auf
Port 8286 bedient, verwende stattdessen `./docker-start.sh` (oder
`docker compose up --build`) — das Dockerfile baut `frontend/dist/`
und die Spring-App serviert es als statische Dateien.

Um die Demo auszuprobieren, importiere `demo/openapi-demo.yaml` über
"Datei öffnen". Die schreibenden Operationen POST, PUT und DELETE
müssen explizit aktiviert werden.

## Dokumentation

- **[`USER_GUIDE.md`](./USER_GUIDE.md)** — umfassendes, durchgehendes
  englisches Benutzerhandbuch, das den Workflow, die Demo-API, die
  Konfiguration jedes Endpunkts, das Ausführen von Lasttests, die
  Report-Ansicht, das Rechtsklick-Menü am Run-Badge, die
  Settings-Schublade zum Sprachwechsel und die Fehlerbehebung
  abdeckt.
- Dieselben Anleitungen stehen **in der laufenden Anwendung** über
  die Toolbar-Links **User Guide** und **README** zur Verfügung. Sie
  öffnen sich als durchsuchbare Markdown-Popups
  (`Ctrl/⌘ + F` zum Suchen, `Enter` zum nächsten Treffer,
  `Shift + Enter` zurück, `Esc` schließt) und folgen der in der
  Settings-Schublade gewählten Sprache.

## Tests und Qualitätssicherung

### Backend: Unit- / Integrationstests mit verpflichtender 100 %-Abdeckung

```bash
cd backend
./gradlew clean check jacocoTestReport
```

`jacocoTestCoverageVerification` schlägt fehl, sobald die getestete
Produktionslogik unter 100 % Instruktionen, Zeilen oder Branches
fällt. Framework-Bootstrap und reine DTO-Datenklassen zählen nicht
zu dieser Business-Coverage-Regel. Der HTML-Report liegt unter
`backend/build/reports/jacoco/test/html/index.html`.

### Frontend: Unit-Tests mit 100 %-Abdeckung

```bash
cd frontend
npm test
```

Die Tests erzwingen 100 % Zeilen, Branches und Funktionen für die
Frontend-Logik. Sie decken den Run-Badge-Kontextmenü-Klassifizierer
(`in-flight` / `terminal` / `terminal-aborted`), die Payload-Pool-
Helfer, die Multi-Run-Dashboard-Fokusauswahl, die
Settings-Schublade / i18n-Dictionary-Parität (jeder Schlüssel
existiert in Englisch und Deutsch) sowie Toolbar, Status-Pills und
Report-Chrome ab.

### Frontend E2E-Tests mit Playwright

```bash
cd frontend
npm run test:e2e:install   # einmal pro Maschine
npm run test:e2e
```

Playwright startet bei Bedarf `docker compose up --build`, nutzt
Chromium und prüft Import-Fehler, Datei-Import, Parameter-/Body-/
Bearer-Konfiguration, Payload-Strategie-Auswahl, Lastprofil-Limits,
erfolgreiche k6-Ausführung, Polling, das Run-Badge-Rechtsklick-Menü
(Rerun, Stop, Kopier-Aktionen), die Fokusübergabe im Multi-Run-
Dashboard, den Report in einem neuen Tab, den Druck-/PDF-Trigger,
den Sprachwechsel in der Settings-Schublade sowie unbekannte
Report-IDs. Der HTML-Report liegt unter
`frontend/playwright-report/index.html`.

Alle Frontend-Tests zusammen:

```bash
cd frontend && npm run test:all
```

Lint und Build:

```bash
cd backend && ./gradlew ktlintCheck
cd frontend && npm run lint && npm run build
```

## Sicherheits-Grenzen des MVP

- Lastprofil-Werte sind pro Exekutor hart gedeckelt (max 30 000 VUs,
  max 3 600 s Dauer, max 1 000 000 Iterationen, max 100 000 req/s, …),
  um außer Kontrolle geratene Tests zu verhindern.
- Schreibende Operationen sind in der UI standardmäßig deaktiviert.
- Nur HTTP(S)-Ziele werden akzeptiert.
- Für ein produktives Multi-Tenant-Deployment muss k6 zusätzlich in
  isolierten Containern mit Ziel-Allowlist, Egress-Regeln,
  Ressourcen-Limits und Secret-Management laufen.
- Testläufe werden derzeit nur im Speicher gehalten.
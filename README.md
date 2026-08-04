# lasttest

`lasttest` importiert Swagger-2.0- und OpenAPI-3-Dokumentationen als YAML oder JSON, erzeugt je Operation k6-Anfragen und führt ausgewählte Lasttests asynchron aus. Swagger 2.0 wird beim Import automatisch in das interne OpenAPI-3-Modell konvertiert. Die Anwendung läuft unter Windows und Linux. Für eine identische Laufzeitumgebung auf beiden Systemen wird Docker empfohlen.

## Schnellstart mit einem einzelnen Container unter Windows und Linux

```bash
docker build -t lasttest:latest .
docker run -d --name lasttest -p 8286:8286 --restart unless-stopped lasttest:latest
```

Oder mit Docker Compose:

```bash
docker compose up --build -d
```

Danach: http://localhost:8286 beziehungsweise von einem anderen Rechner `http://<IP-des-Docker-Hosts>:8286`.

Sobald Spring Boot vollständig gestartet ist, erscheint im Container-Log eine gut sichtbare Erfolgsmeldung mit dem Link zur Weboberfläche:

```text
============================================================
lasttest wurde erfolgreich gestartet.
Jetzt im Browser öffnen: http://localhost:8286/
============================================================
```

Falls ein abweichender öffentlicher Host oder Port verwendet wird, kann der angezeigte Link über `LASTTEST_PUBLIC_URL` gesetzt werden.

Das finale Laufzeit-Image enthält Java 25, das kompilierte Kotlin-/Spring-Backend mit allen JVM-Bibliotheken, das gebaute React-Frontend und k6. Gradle, Kotlin-Compiler und Node.js werden nur in isolierten Build-Stages verwendet und sind für den Betrieb weder im finalen Image noch auf dem Benutzerrechner erforderlich.

Die Demo-Spezifikation liegt unter `demo/openapi-demo.yaml`. Sie enthält GET-Anfragen mit editierbaren Query- und Path-Parametern, POST-Anfragen mit JSON-Body sowie PUT und DELETE. `POST /products/search` demonstriert Bearer-Authentifizierung; hierfür kann ein beliebiger nicht-leerer Demo-Token verwendet werden. Nach dem Import zeigt die Oberfläche für jeden Endpunkt eigene Eingabeboxen für Parameter, Request-Body und Bearer-Token an.

Nach einem Testlauf öffnet der Link „Ausführlichen k6-Testbericht in neuem Tab öffnen“ eine druckoptimierte Ergebnisansicht. Sie enthält Zusammenfassung, Thresholds, Lauf- und API-Konfiguration, die tatsächlich verwendeten Endpunktparameter, detaillierte k6-Metriken sowie Konsolen- und JSON-Rohdaten. Über „Drucken / als PDF speichern“ kann diese Ansicht direkt als PDF archiviert werden.

Unterhalb des k6-JSON-Exports kann außerdem „Generiertes k6-Testskript“ aufgeklappt werden. Dort wird exakt das von lasttest ausgeführte Skript angezeigt und über „k6-Testskript herunterladen (.js)“ exportiert. Der Bericht zeigt auch den passenden manuellen Startbefehl, zum Beispiel:

```bash
k6 run -e BASE_URL="https://example.test" lasttest-<run-id>.js
```

Das Skript steht zusätzlich über `GET /api/test-runs/{id}/script` mit `Content-Disposition: attachment` zur Verfügung. Da das exakte Testskript konfigurierte Header oder Bearer-Tokens enthalten kann, muss die exportierte Datei sicher verwahrt werden.

Der Import akzeptiert den eigentlichen YAML-/JSON-Inhalt mit `swagger: "2.0"` oder `openapi: 3.x`. Eine gerenderte Swagger-UI-HTML-Seite ist keine importierbare API-Dokumentation; aus der Swagger UI muss stattdessen beispielsweise `/swagger.json`, `/swagger.yaml`, `/v3/api-docs` oder `/v3/api-docs.yaml` heruntergeladen werden.

## Voraussetzungen für lokalen Betrieb

- Java 25+
- Node.js 22+
- k6

Alternativ genügt Docker Desktop unter Windows beziehungsweise Docker Engine mit Compose unter Linux.

## Lokale Entwicklung unter Linux/macOS

```bash
# Terminal 1
cd backend
./gradlew bootRun

# Terminal 2
cd frontend
npm install
npm run dev
```

Danach: http://localhost:5173

Alternativ unter Linux/macOS:

```bash
./start-linux.sh
```

Unter Windows:

```bat
start-windows.bat
```

Zum Demotest `demo/openapi-demo.yaml` über „Datei öffnen“ importieren. Die schreibenden Operationen POST/PUT/DELETE müssen bewusst aktiviert werden.

## Tests und Qualitätschecks

### Backend: Unit-/Integrationstests und verpflichtende 100-%-Coverage

```bash
cd backend
./gradlew clean check jacocoTestReport
```

`jacocoTestCoverageVerification` bricht den Build ab, sobald die getestete Produktionslogik bei Instructions, Lines oder Branches unter 100 % fällt. Framework-Bootstrap und reine DTO-Datenklassen sind nicht Teil dieser fachlichen Coverage-Regel. Der HTML-Bericht liegt anschließend unter `backend/build/reports/jacoco/test/html/index.html`.

### Frontend: Unit-Tests mit 100-%-Coverage

```bash
cd frontend
npm test
```

Die Tests erzwingen für die Frontend-Logik jeweils 100 % Lines, Branches und Functions.

### Frontend-E2E-Tests mit Playwright

```bash
cd frontend
npm run test:e2e:install   # einmalig pro Rechner
npm run test:e2e
```

Playwright startet bei Bedarf `docker compose up --build`, verwendet Chromium und prüft Importfehler, Dateiimport, Parameter-, Body- und Bearer-Konfiguration, Lastprofilgrenzen, erfolgreiche k6-Ausführung, Polling, Rohdaten, das Anzeigen und Herunterladen des exakt verwendeten k6-Skripts, den Bericht im neuen Tab, Druck/PDF-Auslösung und unbekannte Report-IDs. Der HTML-Testbericht liegt unter `frontend/playwright-report/index.html`.

Alle Frontend-Tests zusammen:

```bash
cd frontend && npm run test:all
```

Lint und Build:

```bash
cd backend && ./gradlew ktlintCheck
cd frontend && npm run lint && npm run build
```

## Sicherheitsgrenzen des MVP

- Maximal 1000 VUs und 3600 Sekunden pro Lauf.
- Schreibende Operationen sind im UI zunächst deaktiviert.
- Nur HTTP(S)-Ziele werden akzeptiert.
- Für einen produktiven, mandantenfähigen Betrieb muss k6 zusätzlich in isolierten Containern mit einer Ziel-Allowlist, Egress-Regeln, Ressourcenlimits und Secret Management laufen.
- Testläufe werden aktuell nur im Arbeitsspeicher gehalten.

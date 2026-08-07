// Bilingual glossary for the in-app Wiki popup.
//
// Each entry holds the canonical term, a list of search aliases
// (synonyms, k6 field names, German/English spellings) and a
// localised explanation per supported language. The popup renders
// the matched entry in a new browser window via `window.open`,
// so the explanation lives here as plain (HTML-escaped) text rather
// than a markdown source.
//
// Adding a new entry:
//   1. push a new object into WIKI_ENTRIES
//   2. list every spelling the user might type in `aliases`
//      (case-insensitive, normalised — see `normaliseQuery` in
//      `wikiSearch.ts`). Include the k6 field name if it differs
//      from the human label.
//   3. fill `title` and `body` for every SupportedLanguage. The
//      body may contain simple inline markup (the popup escapes
//      every character except for `<strong>` / `<em>` / `<code>`
//      tags, see `WikiPopup.tsx`).
//
// Keeping the glossary here (instead of in a markdown file in
// `src/docs/`) has two reasons: it is queried programmatically by
// name, and the Wiki popup displays exactly one entry at a time
// so there is no benefit to streaming a long document.
//
// Entries are loosely grouped by area: general load-testing
// vocabulary, k6 executor / field names, HTTP terminology, and
// lasttest run-state vocabulary. The grouping is documentation-
// only — `lookupEntry` does not depend on the order.

import type { SupportedLanguage } from './i18n.ts'

export type WikiEntry = {
  /** Canonical English label used as the primary lookup key. */
  term: string
  /** German label shown alongside the English one in the popup. */
  termDe: string
  /**
   * Every spelling a user might type. The lookup is case- and
   * whitespace-insensitive; `lookupEntry` normalises both the
   * query and the alias before comparing. Aliases should not
   * include diacritics — `Virtual User` matches via the
   * normalisation pass without it.
   */
  aliases: ReadonlyArray<string>
  /** Free-form category tag used for grouping in the side list. */
  category: 'concept' | 'executor' | 'field' | 'http' | 'run-state'
  title: Record<SupportedLanguage, string>
  body: Record<SupportedLanguage, string>
}

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

export const WIKI_ENTRIES: ReadonlyArray<WikiEntry> = [
  // --- General load-testing vocabulary -----------------------------------
  {
    term: 'VU (Virtual User)',
    termDe: 'VU (Virtueller Benutzer)',
    aliases: ['vu', 'vus', 'virtual user', 'virtual users', 'virtueller benutzer', 'virtuelle benutzer'],
    category: 'concept',
    title: { en: 'VU — Virtual User', de: 'VU — Virtueller Benutzer' },
    body: {
      en: 'A <strong>Virtual User</strong> is a concurrent loop in k6 that issues requests as fast as the script allows. 50 VUs means 50 scripts run at the same time and fire requests in parallel. More VUs = more load against the target. More is not always better — start with 10–50 VUs before going into the thousands. In lasttest the VU count is set per executor (constant-vus, shared-iterations, ramping-vus, constant-arrival-rate).',
      de: 'Ein <strong>Virtueller Benutzer</strong> (VU) ist eine parallel laufende Schleife in k6, die so schnell Requests feuert, wie das Skript es erlaubt. 50 VUs heißt: 50 Skripte laufen gleichzeitig und feuern parallel Requests. Mehr VUs = mehr Last. Mehr ist nicht immer besser — teste zuerst mit 10–50 VUs, bevor du in die Tausende gehst. In lasttest wird die VU-Anzahl pro Executor eingestellt (constant-vus, shared-iterations, ramping-vus, constant-arrival-rate).',
    },
  },
  {
    term: 'Iteration',
    termDe: 'Iteration',
    aliases: ['iteration', 'eine iteration'],
    category: 'concept',
    title: { en: 'Iteration', de: 'Iteration' },
    body: {
      en: 'One <strong>iteration</strong> is a single full execution of the k6 script by one VU. In a 60 second run with 50 VUs the iteration count is roughly 50 × (script duration). k6 reports the iteration counter at the end of the run; it is also the unit of work the <code>shared-iterations</code> executor limits.',
      de: 'Eine <strong>Iteration</strong> ist ein einzelner kompletter Durchlauf des k6-Skripts durch einen VU. In einem 60-Sekunden-Lauf mit 50 VUs liegt die Iterationsanzahl ungefähr bei 50 × (Skriptdauer). k6 meldet den Iterationszähler am Ende des Laufs; er ist auch die Arbeitseinheit, die der <code>shared-iterations</code>-Executor begrenzt.',
    },
  },
  {
    term: 'Script',
    termDe: 'Skript',
    aliases: ['script', 'skript', 'k6 script', 'k6 skript', 'k6-skript'],
    category: 'concept',
    title: { en: 'k6 Script', de: 'k6-Skript' },
    body: {
      en: 'The <strong>k6 script</strong> is the JavaScript file k6 executes for each iteration. lasttest generates it from your specification, endpoint selection and load profile — the generated script is downloadable from the detailed report. You can edit it offline and run it with the k6 CLI; the in-app run uses the same generator.',
      de: 'Das <strong>k6-Skript</strong> ist die JavaScript-Datei, die k6 pro Iteration ausführt. lasttest generiert es aus deiner Spezifikation, der Endpunkt-Auswahl und dem Lastprofil — das generierte Skript lässt sich aus dem ausführlichen Bericht herunterladen. Du kannst es offline anpassen und mit der k6-CLI laufen lassen; der In-App-Lauf nutzt denselben Generator.',
    },
  },
  {
    term: 'Executor',
    termDe: 'Executor',
    aliases: ['executor', 'executors', 'lastprofil'],
    category: 'executor',
    title: { en: 'Executor', de: 'Executor' },
    body: {
      en: 'The k6 <strong>executor</strong> is the strategy that decides how requests are issued. lasttest exposes four: <code>constant-vus</code> (steady-state load), <code>shared-iterations</code> (a fixed number of total requests), <code>ramping-vus</code> (load that changes over time via stages), and <code>constant-arrival-rate</code> (a fixed request rate, decoupled from response time).',
      de: 'Der k6-<strong>Executor</strong> ist die Strategie, mit der Requests ausgegeben werden. lasttest stellt vier davon bereit: <code>constant-vus</code> (gleichmäßige Last), <code>shared-iterations</code> (feste Anzahl Requests insgesamt), <code>ramping-vus</code> (Last, die sich über Stages verändert) und <code>constant-arrival-rate</code> (feste Request-Rate, entkoppelt von der Antwortzeit).',
    },
  },
  {
    term: 'Open Model vs. Closed Model',
    termDe: 'Open Model vs. Closed Model',
    aliases: ['open model', 'closed model', 'open-model', 'closed-model', 'open model vs closed model'],
    category: 'concept',
    title: { en: 'Open Model vs. Closed Model', de: 'Open Model vs. Closed Model' },
    body: {
      en: 'An <strong>open-model</strong> test fires new requests independently of response time — k6 does not wait for the previous response before sending the next. The <code>constant-arrival-rate</code> executor is open-model. A <strong>closed-model</strong> test only fires the next request after the previous one has returned, modelling a fixed pool of users that all wait for a response before acting again. <code>constant-vus</code> is essentially closed-model.',
      de: 'Ein <strong>Open-Model</strong>-Test feuert neue Requests unabhängig von der Antwortzeit — k6 wartet nicht auf die vorherige Antwort, bevor der nächste Request gesendet wird. Der <code>constant-arrival-rate</code>-Executor ist Open-Model. Ein <strong>Closed-Model</strong>-Test feuert den nächsten Request erst, nachdem der vorherige zurückgekommen ist — das modelliert einen festen Pool von Benutzern, die alle auf eine Antwort warten, bevor sie erneut agieren. <code>constant-vus</code> ist im Wesentlichen Closed-Model.',
    },
  },
  {
    term: 'Threshold',
    termDe: 'Threshold',
    aliases: ['threshold', 'thresholds', 'schwelle', 'schwellenwert', 'schwellenwerte'],
    category: 'concept',
    title: { en: 'Threshold', de: 'Threshold (Schwellenwert)' },
    body: {
      en: 'A k6 <strong>threshold</strong> is a pass/fail expression evaluated at the end of the run. Common examples: <code>http_req_duration: p(95)&lt;500</code> (95% of requests must finish within 500 ms) or <code>http_req_failed: rate&lt;0.01</code> (less than 1% of requests may fail). Thresholds turn a number into a verdict that lasttest highlights green (passed) or red (violated) in the report.',
      de: 'Ein k6-<strong>Threshold</strong> (Schwellenwert) ist ein bestanden/nicht-bestanden-Ausdruck, der am Ende des Laufs ausgewertet wird. Häufige Beispiele: <code>http_req_duration: p(95)&lt;500</code> (95 % der Requests müssen unter 500 ms bleiben) oder <code>http_req_failed: rate&lt;0.01</code> (weniger als 1 % der Requests dürfen fehlschlagen). Thresholds verwandeln eine Zahl in ein Urteil, das lasttest im Bericht grün (bestanden) oder rot (verletzt) hervorhebt.',
    },
  },
  {
    term: 'Check',
    termDe: 'Check',
    aliases: ['check', 'checks', 'pruefung', 'prüfung', 'pruefungen', 'prüfungen'],
    category: 'concept',
    title: { en: 'Check', de: 'Check (Prüfung)' },
    body: {
      en: 'A k6 <strong>check</strong> is a boolean assertion evaluated inside the script for every iteration, e.g. <code>check(res, { "status is 200": r =&gt; r.status === 200 })</code>. Checks do not abort the run when they fail — they only count. The report shows the failed-check rate alongside the threshold verdict.',
      de: 'Ein k6-<strong>Check</strong> ist eine boolesche Prüfung, die innerhalb des Skripts pro Iteration ausgewertet wird, z. B. <code>check(res, { "status ist 200": r =&gt; r.status === 200 })</code>. Checks brechen den Lauf bei einem Fehlschlag nicht ab — sie zählen nur. Der Bericht zeigt die Fehlschlagsrate neben dem Threshold-Urteil.',
    },
  },
  {
    term: 'Tag',
    termDe: 'Tag',
    aliases: ['tag', 'tags', 'tag-gruppe', 'taggruppe', 'tag group'],
    category: 'concept',
    title: { en: 'Tag', de: 'Tag' },
    body: {
      en: 'k6 <strong>tags</strong> are key/value pairs attached to a metric, e.g. <code>{ endpoint: "/users", method: "GET" }</code>. lasttest tags every request with the operation id so the detailed report can break latency, throughput and errors down per endpoint and per HTTP method.',
      de: 'k6-<strong>Tags</strong> sind Schlüssel/Wert-Paare, die an eine Metrik gehängt werden, z. B. <code>{ endpoint: "/users", method: "GET" }</code>. lasttest versieht jeden Request mit der Operation-ID, damit der ausführliche Bericht Latenz, Durchsatz und Fehler pro Endpunkt und HTTP-Methode aufschlüsseln kann.',
    },
  },
  {
    term: 'RPS (Requests Per Second)',
    termDe: 'RPS (Requests pro Sekunde)',
    aliases: ['rps', 'requests per second', 'requests pro sekunde', 'anfragen pro sekunde'],
    category: 'concept',
    title: { en: 'RPS — Requests Per Second', de: 'RPS — Requests pro Sekunde' },
    body: {
      en: '<strong>RPS</strong> measures throughput: how many HTTP requests k6 fires per second. The summary in the report shows the average request rate. Use <code>constant-arrival-rate</code> when you want to hold RPS at a specific value regardless of how slow the server gets; use <code>constant-vus</code> when you want to measure the RPS the server naturally delivers at a fixed concurrency.',
      de: '<strong>RPS</strong> misst den Durchsatz: wie viele HTTP-Requests k6 pro Sekunde feuert. Die Zusammenfassung im Bericht zeigt die durchschnittliche Request-Rate. Nutze <code>constant-arrival-rate</code>, wenn du RPS unabhängig von der Server-Antwortzeit konstant halten willst; nutze <code>constant-vus</code>, wenn du messen willst, welchen RPS der Server bei einer festen Concurrency natürlich liefert.',
    },
  },
  {
    term: 'Latency / Percentiles (p95, p99)',
    termDe: 'Latenz / Perzentile (p95, p99)',
    aliases: ['latency', 'latenz', 'p95', 'p99', 'p50', 'percentile', 'perzentil', 'perzentile'],
    category: 'concept',
    title: { en: 'Latency & Percentiles (p95, p99)', de: 'Latenz & Perzentile (p95, p99)' },
    body: {
      en: '<strong>Latency</strong> is the time a request takes, measured from request send to response received. k6 reports the average and several <strong>percentiles</strong>: <code>p(95)</code> means 95% of requests finished faster than this value, <code>p(99)</code> the same for 99%. Averages hide tail latency — a 200 ms average with a p99 of 4 s means 1% of users wait 4 seconds. lasttest highlights p95 on the report summary card.',
      de: '<strong>Latenz</strong> ist die Dauer eines Requests, gemessen vom Senden bis zum Empfang der Antwort. k6 meldet den Durchschnitt sowie mehrere <strong>Perzentile</strong>: <code>p(95)</code> bedeutet, 95 % der Requests waren schneller als dieser Wert, <code>p(99)</code> dasselbe für 99 %. Mittelwerte verstecken Tail-Latenz — ein 200-ms-Schnitt mit p99 von 4 s heißt, dass 1 % der Benutzer 4 Sekunden warten. lasttest hebt p95 auf der Bericht-Karte hervor.',
    },
  },
  {
    term: 'Throughput',
    termDe: 'Durchsatz',
    aliases: ['throughput', 'durchsatz'],
    category: 'concept',
    title: { en: 'Throughput', de: 'Durchsatz' },
    body: {
      en: '<strong>Throughput</strong> is the rate at which the system completes work. For HTTP APIs it is usually expressed in requests per second (RPS). The ramp-grafik shows throughput over time; the summary card shows the average.',
      de: '<strong>Durchsatz</strong> ist die Rate, mit der das System Arbeit abschließt. Für HTTP-APIs wird sie üblicherweise in Requests pro Sekunde (RPS) angegeben. Die Ramp-Grafik zeigt den Durchsatz über die Zeit; die Zusammenfassungs-Karte zeigt den Durchschnitt.',
    },
  },
  {
    term: 'Payload',
    termDe: 'Payload',
    aliases: ['payload', 'payloads', 'dataset', 'datasets', 'datensatz', 'datensaetze', 'datensätze'],
    category: 'concept',
    title: { en: 'Payload', de: 'Payload' },
    body: {
      en: 'A <strong>payload</strong> is one row in the per-endpoint dataset table: a fixed combination of path parameters, query parameters, headers and request body, plus the Bearer token to send. k6 walks through the payload pool each iteration according to the configured strategy (sequential or random).',
      de: 'Ein <strong>Payload</strong> ist eine Zeile in der Datensatz-Tabelle pro Endpunkt: eine feste Kombination aus Pfad-Parametern, Query-Parametern, Headern und Request-Body sowie das Bearer-Token, das gesendet wird. k6 geht den Payload-Pool pro Iteration entsprechend der konfigurierten Strategie durch (sequenziell oder zufällig).',
    },
  },
  {
    term: 'Smoke Test',
    termDe: 'Smoke-Test',
    aliases: ['smoke test', 'smoke-test', 'smoketest', 'smoke'],
    category: 'concept',
    title: { en: 'Smoke Test', de: 'Smoke-Test' },
    body: {
      en: 'A <strong>smoke test</strong> is a tiny load profile — typically 1 VU for 30 s — that verifies the script runs end to end without errors before you spend time on a heavier run. The Smoke preset in the lasttest editor is the recommended pre-flight gate.',
      de: 'Ein <strong>Smoke-Test</strong> ist ein winziges Lastprofil — typischerweise 1 VU für 30 s —, das prüft, ob das Skript komplett durchläuft, bevor du Zeit in einen schwereren Lauf investierst. Die Smoke-Vorauswahl im lasttest-Editor ist die empfohlene Vorab-Prüfung.',
    },
  },
  {
    term: 'Load Test',
    termDe: 'Lasttest',
    aliases: ['load test', 'lasttest', 'load profile'],
    category: 'concept',
    title: { en: 'Load Test', de: 'Lasttest' },
    body: {
      en: 'A <strong>load test</strong> reproduces a realistic, expected production traffic pattern and verifies the system holds up. The Load preset in lasttest is the textbook k6 example: ramp from 0 to 50 VUs, hold for 5 minutes, ramp back down. Load tests answer the question "can the system handle the traffic we expect?"',
      de: 'Ein <strong>Lasttest</strong> reproduziert ein realistisches, erwartetes Produktions-Traffic-Muster und prüft, ob das System standhält. Die Last-Vorauswahl in lasttest ist das klassische k6-Beispiel: von 0 auf 50 VUs hochfahren, 5 Minuten halten, wieder herunterfahren. Lasttests beantworten die Frage "hält das System den erwarteten Traffic aus?".',
    },
  },
  {
    term: 'Stress Test',
    termDe: 'Stress-Test',
    aliases: ['stress test', 'stress-test', 'stresstest', 'stress'],
    category: 'concept',
    title: { en: 'Stress Test', de: 'Stress-Test' },
    body: {
      en: 'A <strong>stress test</strong> pushes the system past its expected load to find the breaking point. The Stress preset steps the VU count upward (50 → 100 → 200 → 400) and looks at where latency degrades or the error rate spikes. Each step holds for a minute so transient blips do not abort the run prematurely.',
      de: 'Ein <strong>Stress-Test</strong> treibt das System über die erwartete Last hinaus, um den Bruchpunkt zu finden. Die Stress-Vorauswahl steigert die VU-Zahl stufenweise (50 → 100 → 200 → 400) und beobachtet, wo die Latenz kippt oder die Fehlerrate steigt. Jede Stufe hält eine Minute, damit kurze Ausschläger den Lauf nicht vorzeitig beenden.',
    },
  },
  {
    term: 'Spike Test',
    termDe: 'Spike-Test',
    aliases: ['spike test', 'spike-test', 'spiketest', 'spike'],
    category: 'concept',
    title: { en: 'Spike Test', de: 'Spike-Test' },
    body: {
      en: 'A <strong>spike test</strong> throws a sudden, extreme load at the system and observes how it absorbs the burst. The Spike preset ramps from 0 to 800 VUs in 10 s, holds for 30 s, then ramps back down. Common failure modes uncovered: autoscaler kick-in delays, queue saturation, cache stampedes.',
      de: 'Ein <strong>Spike-Test</strong> wirft eine plötzliche, extreme Last auf das System und beobachtet, wie es den Burst aufnimmt. Die Spike-Vorauswahl ramppt in 10 s von 0 auf 800 VUs, hält 30 s und fährt dann wieder herunter. Häufige Fehlerbilder: Verzögerung beim Autoscaler, Queue-Sättigung, Cache-Stampede.',
    },
  },
  {
    term: 'Soak Test',
    termDe: 'Soak-Test',
    aliases: ['soak test', 'soak-test', 'soaktest', 'soak', 'ausdauertest', 'langzeittest'],
    category: 'concept',
    title: { en: 'Soak Test', de: 'Soak-Test' },
    body: {
      en: 'A <strong>soak test</strong> runs a moderate load for a long time (typically an hour or more) to surface slow leaks: memory growth, GC pauses, connection-pool exhaustion, log file fill-up. The Soak preset holds 50 VUs for 3 600 s. JVM/GC warm-up is done by a 5-minute ramp before the measurement window.',
      de: 'Ein <strong>Soak-Test</strong> lässt eine moderate Last lange laufen (typischerweise eine Stunde oder länger), um schleichende Probleme aufzudecken: Speicherwachstum, GC-Pausen, Connection-Pool-Erschöpfung, volllaufende Logdateien. Die Soak-Vorauswahl hält 50 VUs für 3 600 s. JVM/GC-Aufwärmphase ist ein 5-Minuten-Ramp vor dem Messfenster.',
    },
  },

  // --- k6 Executor types ----------------------------------------------------
  {
    term: 'constant-vus',
    termDe: 'Konstante Last',
    aliases: ['constant-vus', 'constant vus', 'konstante last', 'konstante vus'],
    category: 'executor',
    title: { en: 'constant-vus — Constant Load', de: 'constant-vus — Konstante Last' },
    body: {
      en: '<code>constant-vus</code> runs a fixed number of VUs for a fixed duration. All VUs start together and stay running until the duration elapses. Use it for smoke tests, steady-state load and repeatable benchmarks.',
      de: '<code>constant-vus</code> lässt eine feste Anzahl VUs für eine feste Dauer laufen. Alle VUs starten gleichzeitig und laufen weiter, bis die Dauer abgelaufen ist. Geeignet für Smoke-Tests, gleichmäßige Last und wiederholbare Benchmarks.',
    },
  },
  {
    term: 'shared-iterations',
    termDe: 'Geteilte Iterationen',
    aliases: ['shared-iterations', 'shared iterations', 'geteilte iterationen', 'n anfragen so schnell wie moeglich'],
    category: 'executor',
    title: { en: 'shared-iterations — N Requests as Fast as Possible', de: 'shared-iterations — N Anfragen so schnell wie möglich' },
    body: {
      en: '<code>shared-iterations</code> distributes a fixed total number of iterations across the configured VUs; the run ends as soon as the last response comes back. Use it when you need a reproducible request count between releases (compare p95 of v1.2 vs v1.3 at the same N).',
      de: '<code>shared-iterations</code> verteilt eine feste Gesamtanzahl Iterationen auf die konfigurierten VUs; der Lauf endet, sobald die letzte Antwort zurück ist. Nutze ihn, wenn du eine reproduzierbare Request-Anzahl zwischen Releases brauchst (vergleiche p95 von v1.2 gegen v1.3 bei gleichem N).',
    },
  },
  {
    term: 'ramping-vus',
    termDe: 'Ramping-VUs',
    aliases: ['ramping-vus', 'ramping vus', 'rampen-vus', 'ramp'],
    category: 'executor',
    title: { en: 'ramping-vus — Ramping VUs', de: 'ramping-vus — Ramp-VUs' },
    body: {
      en: '<code>ramping-vus</code> runs through a list of <strong>stages</strong>. Each stage has a target VU count and a duration. Between two consecutive stages k6 ramps linearly from the previous target to the next target during that stage\'s duration. Use it for spike, stress and soak tests where load changes over time.',
      de: '<code>ramping-vus</code> durchläuft eine Liste von <strong>Stages</strong>. Jede Stage hat eine Ziel-VU-Anzahl und eine Dauer. Zwischen zwei aufeinanderfolgenden Stages ramppt k6 linear vom vorherigen Ziel zum nächsten Ziel während der Stage-Dauer. Geeignet für Spike-, Stress- und Soak-Tests mit zeitlich veränderlicher Last.',
    },
  },
  {
    term: 'constant-arrival-rate',
    termDe: 'Constant-Arrival-Rate',
    aliases: ['constant-arrival-rate', 'constant arrival rate'],
    category: 'executor',
    title: { en: 'constant-arrival-rate — Constant Request Rate', de: 'constant-arrival-rate — Konstante Ankunftsrate' },
    body: {
      en: '<code>constant-arrival-rate</code> keeps a fixed request rate regardless of how slow the target becomes. k6 starts with <code>preAllocatedVUs</code> and grows the pool up to <code>maxVUs</code> when latency spikes. Use it to find the server\'s true throughput ceiling or to decouple RPS from response time.',
      de: '<code>constant-arrival-rate</code> hält eine feste Request-Rate unabhängig davon, wie langsam das Ziel wird. k6 startet mit <code>preAllocatedVUs</code> und vergrößert den Pool bis <code>maxVUs</code>, wenn die Latenz steigt. Nutze es, um die tatsächliche Durchsatz-Obergrenze des Servers zu finden oder RPS von der Antwortzeit zu entkoppeln.',
    },
  },

  // --- k6 fields ------------------------------------------------------------
  {
    term: 'virtualUsers',
    termDe: 'virtualUsers (Feld)',
    aliases: ['virtualusers', 'virtualusers feld', 'vus feld', 'vus konfiguration'],
    category: 'field',
    title: { en: 'virtualUsers', de: 'virtualUsers (Virtuelle Benutzer)' },
    body: {
      en: 'The <code>virtualUsers</code> field sets the number of concurrent VUs for the <code>constant-vus</code> and <code>shared-iterations</code> executors. lasttest limits this value to integers between 1 and 30 000.',
      de: 'Das Feld <code>virtualUsers</code> setzt die Anzahl gleichzeitiger VUs für die Executors <code>constant-vus</code> und <code>shared-iterations</code>. lasttest begrenzt diesen Wert auf ganze Zahlen zwischen 1 und 30 000.',
    },
  },
  {
    term: 'durationSeconds',
    termDe: 'Dauer (Sekunden)',
    aliases: ['durationseconds', 'duration', 'dauer', 'laufzeit'],
    category: 'field',
    title: { en: 'durationSeconds', de: 'durationSeconds (Dauer in Sekunden)' },
    body: {
      en: 'The <code>durationSeconds</code> field sets the total run time in seconds. It applies to <code>constant-vus</code>, <code>constant-arrival-rate</code>, and each individual stage of a <code>ramping-vus</code> profile. lasttest limits the value to integers between 1 and 3 600 (one hour).',
      de: 'Das Feld <code>durationSeconds</code> legt die Gesamtlaufzeit in Sekunden fest. Es gilt für <code>constant-vus</code>, <code>constant-arrival-rate</code> und jede einzelne Stage eines <code>ramping-vus</code>-Profils. lasttest begrenzt den Wert auf ganze Zahlen zwischen 1 und 3 600 (eine Stunde).',
    },
  },
  {
    term: 'iterations (field)',
    termDe: 'Iterationen (Feld)',
    aliases: ['iterations', 'iterationen', 'iteration count', 'iterations anzahl', 'iterations feld'],
    category: 'field',
    title: { en: 'iterations (field)', de: 'iterations (Iterations-Feld)' },
    body: {
      en: 'For the <code>shared-iterations</code> executor the <code>iterations</code> field is the total number of requests across all VUs. The run ends as soon as the last response comes back. lasttest limits the value to integers between 1 and 1 000 000.',
      de: 'Beim <code>shared-iterations</code>-Executor ist <code>iterations</code> die Gesamtzahl der Requests über alle VUs. Der Lauf endet, sobald die letzte Antwort zurück ist. lasttest begrenzt den Wert auf ganze Zahlen zwischen 1 und 1 000 000.',
    },
  },
  {
    term: 'startVUs',
    termDe: 'Start-VUs',
    aliases: ['startvus', 'start vus', 'start-vus'],
    category: 'field',
    title: { en: 'startVUs', de: 'startVUs (Start-VUs)' },
    body: {
      en: 'For the <code>ramping-vus</code> executor the <code>startVUs</code> field sets the VU count at the very beginning of the run, before any stage has executed. Use it to start at 0 (the typical value) or to skip the warm-up by starting at the first stage target.',
      de: 'Beim <code>ramping-vus</code>-Executor legt <code>startVUs</code> die VU-Anzahl ganz am Anfang des Laufs fest, bevor irgendeine Stage gelaufen ist. Nutze 0 (typischer Wert) oder überspringe die Warmlauf-Phase, indem du direkt auf dem Ziel der ersten Stage startest.',
    },
  },
  {
    term: 'stages',
    termDe: 'Stages',
    aliases: ['stages', 'stage', 'stufe', 'stufen', 'ramp stage', 'ramp stage', 'ramp-stage'],
    category: 'field',
    title: { en: 'stages', de: 'stages (Stages)' },
    body: {
      en: 'A <strong>stage</strong> is one row in the <code>ramping-vus</code> profile. Each stage has a <strong>target</strong> (the VU count to reach by the end of the stage) and a <strong>duration</strong> in seconds. Between two stages k6 ramps linearly. Consecutive stages with the same target are allowed and model a plateau.',
      de: 'Eine <strong>Stage</strong> ist eine Zeile im <code>ramping-vus</code>-Profil. Jede Stage hat ein <strong>target</strong> (die VU-Anzahl, die am Ende der Stage erreicht sein soll) und eine <strong>duration</strong> in Sekunden. Zwischen zwei Stages ramppt k6 linear. Aufeinanderfolgende Stages mit gleichem Target sind erlaubt und bilden ein Plateau.',
    },
  },
  {
    term: 'target (stage target)',
    termDe: 'Ziel-VUs (Stage-Ziel)',
    aliases: ['target', 'target vus', 'target vus', 'ziel-vus', 'ziel vus', 'stage target'],
    category: 'field',
    title: { en: 'target (stage target)', de: 'target (Stage-Zielwert)' },
    body: {
      en: 'The <code>target</code> field of a stage is the VU count k6 should reach by the end of that stage\'s duration. Combined with the duration it determines the ramp slope. lasttest limits the value to integers between 0 and 30 000.',
      de: 'Das Feld <code>target</code> einer Stage ist die VU-Anzahl, die k6 am Ende der Stage-Dauer erreichen soll. Zusammen mit der Dauer bestimmt es die Ramp-Steigung. lasttest begrenzt den Wert auf ganze Zahlen zwischen 0 und 30 000.',
    },
  },
  {
    term: 'rate (arrival-rate)',
    termDe: 'Rate (Anfragen pro Zeiteinheit)',
    aliases: ['rate', 'arrival rate', 'ankunftsrate', 'anfragenrate'],
    category: 'field',
    title: { en: 'rate (constant-arrival-rate)', de: 'rate (constant-arrival-rate)' },
    body: {
      en: 'For the <code>constant-arrival-rate</code> executor the <code>rate</code> field is the number of requests k6 fires per <code>timeUnit</code> seconds. lasttest limits this value to integers between 1 and 100 000.',
      de: 'Beim <code>constant-arrival-rate</code>-Executor ist <code>rate</code> die Anzahl der Requests, die k6 pro <code>timeUnit</code>-Sekunden feuert. lasttest begrenzt diesen Wert auf ganze Zahlen zwischen 1 und 100 000.',
    },
  },
  {
    term: 'timeUnit',
    termDe: 'Zeiteinheit',
    aliases: ['timeunit', 'time unit', 'zeiteinheit', 'time unit seconds', 'timeunitseconds'],
    category: 'field',
    title: { en: 'timeUnit', de: 'timeUnit (Zeiteinheit)' },
    body: {
      en: 'For the <code>constant-arrival-rate</code> executor the <code>timeUnit</code> field is the period in seconds over which k6 distributes the <code>rate</code> requests. With <code>timeUnit=1</code> and <code>rate=50</code> k6 fires 50 requests per second. lasttest limits the value to integers between 1 and 60.',
      de: 'Beim <code>constant-arrival-rate</code>-Executor ist <code>timeUnit</code> der Zeitraum in Sekunden, über den k6 die <code>rate</code>-Requests verteilt. Mit <code>timeUnit=1</code> und <code>rate=50</code> feuert k6 50 Requests pro Sekunde. lasttest begrenzt den Wert auf ganze Zahlen zwischen 1 und 60.',
    },
  },
  {
    term: 'preAllocatedVUs',
    termDe: 'Vorab zugewiesene VUs',
    aliases: ['preallocatedvus', 'preallocated vus', 'pre allocated vus', 'pre-allocated vus', 'preallocated', 'vorab zugewiesene vus', 'preallocatedvus feld'],
    category: 'field',
    title: { en: 'preAllocatedVUs', de: 'preAllocatedVUs (vorab zugewiesene VUs)' },
    body: {
      en: 'For the <code>constant-arrival-rate</code> executor the <code>preAllocatedVUs</code> field is the size of the initial VU pool. k6 allocates this many VUs at the start of the run so that the first burst of requests does not pay the VU startup cost. When response time spikes and the pool cannot keep up, k6 grows it up to <code>maxVUs</code>.',
      de: 'Beim <code>constant-arrival-rate</code>-Executor ist <code>preAllocatedVUs</code> die Größe des anfänglichen VU-Pools. k6 allokiert diese VUs zu Laufbeginn, damit die erste Request-Welle nicht unter dem VU-Startup leidet. Steigt die Antwortzeit und reicht der Pool nicht, vergrößert k6 ihn bis <code>maxVUs</code>.',
    },
  },
  {
    term: 'maxVUs',
    termDe: 'Maximale VUs',
    aliases: ['maxvus', 'max vus', 'max vus', 'maximale vus'],
    category: 'field',
    title: { en: 'maxVUs', de: 'maxVUs (Maximale VUs)' },
    body: {
      en: 'For the <code>constant-arrival-rate</code> executor the <code>maxVUs</code> field is the upper bound k6 may grow the VU pool to when latency spikes. lasttest requires <code>maxVUs ≥ preAllocatedVUs</code> and caps it at 30 000.',
      de: 'Beim <code>constant-arrival-rate</code>-Executor ist <code>maxVUs</code> die Obergrenze, bis zu der k6 den VU-Pool bei Latenz-Spitzen vergrößern darf. lasttest verlangt <code>maxVUs ≥ preAllocatedVUs</code> und begrenzt den Wert auf 30 000.',
    },
  },
  {
    term: 'payloadStrategy',
    termDe: 'Payload-Strategie',
    aliases: ['payloadstrategy', 'payload strategy', 'payload-strategie', 'sequential', 'random', 'sequenziell', 'zufaellig', 'zufällig'],
    category: 'field',
    title: { en: 'payloadStrategy', de: 'payloadStrategy (Payload-Strategie)' },
    body: {
      en: 'The <code>payloadStrategy</code> field controls how the runner picks the next payload from the pool each iteration. <code>sequential</code> walks the pool top to bottom and wraps around; <code>random</code> picks one at random per iteration. With only one payload both modes are identical. Optional on the wire — omitting it defaults to <code>sequential</code>.',
      de: 'Das Feld <code>payloadStrategy</code> steuert, wie der Runner pro Iteration den nächsten Payload aus dem Pool wählt. <code>sequential</code> (sequenziell) geht den Pool von oben nach unten durch und beginnt am Ende wieder von vorn; <code>random</code> wählt pro Iteration einen zufällig. Bei nur einem Payload sind beide Modi identisch. Optional auf der Leitung — ohne Angabe wird <code>sequential</code> angenommen.',
    },
  },

  // --- HTTP -----------------------------------------------------------------
  {
    term: 'Endpoint',
    termDe: 'Endpunkt',
    aliases: ['endpoint', 'endpunkt', 'operation', 'operationen'],
    category: 'http',
    title: { en: 'Endpoint', de: 'Endpunkt' },
    body: {
      en: 'An <strong>endpoint</strong> is a single HTTP method + path pair described in the OpenAPI spec (e.g. <code>GET /users</code>). lasttest shows one card per endpoint in step 2; only checked endpoints are driven by the load test.',
      de: 'Ein <strong>Endpunkt</strong> ist ein einzelnes HTTP-Methoden-+-Pfad-Paar aus der OpenAPI-Spezifikation (z. B. <code>GET /users</code>). lasttest zeigt pro Endpunkt in Schritt 2 eine Karte; nur angehakte Endpunkte werden vom Lasttest angesteuert.',
    },
  },
  {
    term: 'HTTP Status Codes',
    termDe: 'HTTP-Status-Codes',
    aliases: ['http status', 'status code', 'status codes', 'statuscodes', 'statuscode', 'http-status', 'http-statuscode'],
    category: 'http',
    title: { en: 'HTTP Status Codes', de: 'HTTP-Status-Codes' },
    body: {
      en: 'The HTTP status code is the response code returned by the server. The lasttest report groups them by family: <code>2xx</code> success, <code>3xx</code> redirect, <code>4xx</code> client error (e.g. <code>429</code> rate-limited), <code>5xx</code> server error, and <code>err</code> (status 0 — network errors like connection drop, DNS failure or TLS handshake failure).',
      de: 'Der HTTP-Status-Code ist der Antwort-Code des Servers. Der lasttest-Bericht gruppiert nach Familien: <code>2xx</code> Erfolg, <code>3xx</code> Redirect, <code>4xx</code> Client-Fehler (z. B. <code>429</code> rate-limited), <code>5xx</code> Server-Fehler und <code>err</code> (Status 0 — Netzwerkfehler wie Verbindungsabbruch, DNS-Fehler oder TLS-Handshake-Fehlschlag).',
    },
  },
  {
    term: 'HTTP Method (GET, POST, PUT, DELETE, PATCH)',
    termDe: 'HTTP-Methode (GET, POST, PUT, DELETE, PATCH)',
    aliases: ['http method', 'method', 'http-methode', 'methode', 'get', 'post', 'put', 'delete', 'patch'],
    category: 'http',
    title: { en: 'HTTP Method (GET / POST / PUT / DELETE / PATCH)', de: 'HTTP-Methode (GET / POST / PUT / DELETE / PATCH)' },
    body: {
      en: 'The HTTP method tells the server what to do with the resource. <code>GET</code> reads, <code>POST</code> creates, <code>PUT</code> replaces, <code>PATCH</code> partially updates, <code>DELETE</code> removes. lasttest colours the method badge: green for GET, brown for POST, blue for PUT/PATCH, red for DELETE.',
      de: 'Die HTTP-Methode sagt dem Server, was mit der Ressource passieren soll. <code>GET</code> liest, <code>POST</code> erstellt, <code>PUT</code> ersetzt, <code>PATCH</code> aktualisiert teilweise, <code>DELETE</code> entfernt. lasttest färbt das Methoden-Badge: grün für GET, braun für POST, blau für PUT/PATCH, rot für DELETE.',
    },
  },
  {
    term: 'Base URL',
    termDe: 'Base-URL',
    aliases: ['baseurl', 'base url', 'base-url', 'server url'],
    category: 'http',
    title: { en: 'Base URL', de: 'Base-URL' },
    body: {
      en: 'The <strong>base URL</strong> is the host (and optional path prefix) the load test fires against. In lasttest step 2 you can either pick a server from the OpenAPI spec or enter a custom base URL. Important when the spec exposes multiple stages (dev / staging / prod).',
      de: 'Die <strong>Base-URL</strong> ist der Host (und optionale Pfad-Präfix), gegen den der Lasttest feuert. In lasttest Schritt 2 kannst du entweder einen Server aus der OpenAPI-Spec wählen oder eine eigene Base-URL eintragen. Wichtig, wenn die Spec mehrere Stages anbietet (dev / staging / prod).',
    },
  },
  {
    term: 'OpenAPI / Swagger',
    termDe: 'OpenAPI / Swagger',
    aliases: ['openapi', 'swagger', 'spec', 'spezifikation', 'specification'],
    category: 'http',
    title: { en: 'OpenAPI / Swagger', de: 'OpenAPI / Swagger' },
    body: {
      en: '<strong>OpenAPI</strong> (formerly <strong>Swagger</strong>) is a machine-readable description of an HTTP API: endpoints, methods, parameters, request bodies, response shapes and authentication. lasttest accepts both formats and converts Swagger 2.0 to OpenAPI 3 automatically. Import in step 1 by URL, by file upload, or by pasting the raw text.',
      de: '<strong>OpenAPI</strong> (vormals <strong>Swagger</strong>) ist eine maschinenlesbare Beschreibung einer HTTP-API: Endpunkte, Methoden, Parameter, Request-Bodies, Antwort-Schemata und Authentifizierung. lasttest akzeptiert beide Formate und konvertiert Swagger 2.0 automatisch nach OpenAPI 3. Import in Schritt 1 per URL, per Datei-Upload oder durch Einfügen des Rohtexts.',
    },
  },
  {
    term: 'Bearer Token',
    termDe: 'Bearer-Token',
    aliases: ['bearer', 'bearer token', 'token', 'auth token', 'access token', 'authtoken', 'zugriffstoken'],
    category: 'http',
    title: { en: 'Bearer Token', de: 'Bearer-Token' },
    body: {
      en: 'A <strong>bearer token</strong> is an opaque string sent in the <code>Authorization: Bearer &lt;token&gt;</code> header to authenticate the request. In lasttest you can set a bearer token per payload so different iterations can authenticate as different users.',
      de: 'Ein <strong>Bearer-Token</strong> ist ein opaker String, der im Header <code>Authorization: Bearer &lt;token&gt;</code> gesendet wird, um den Request zu authentifizieren. In lasttest kannst du pro Payload ein eigenes Bearer-Token setzen, sodass verschiedene Iterationen sich als verschiedene Benutzer ausweisen.',
    },
  },

  // --- Run state ------------------------------------------------------------
  {
    term: 'Run ID',
    termDe: 'Run-ID',
    aliases: ['run id', 'runid', 'run-id', 'test run id'],
    category: 'run-state',
    title: { en: 'Run ID', de: 'Run-ID' },
    body: {
      en: 'Every test run gets a <strong>run id</strong> — a UUID that identifies the run end to end. lasttest shows it on the badge, the detailed report and every API call. The right-click menu offers "Copy run id" and "Copy report link" so you can bookmark or share the result.',
      de: 'Jeder Testlauf bekommt eine <strong>Run-ID</strong> — eine UUID, die den Lauf eindeutig identifiziert. lasttest zeigt sie auf dem Badge, im ausführlichen Bericht und in jedem API-Call. Das Rechtsklick-Menü bietet "Run-ID kopieren" und "Report-Link kopieren", damit du das Ergebnis bookmarken oder teilen kannst.',
    },
  },
  {
    term: 'QUEUED',
    termDe: 'QUEUED (Eingereiht)',
    aliases: ['queued', 'queue', 'warteschlange', 'eingereiht'],
    category: 'run-state',
    title: { en: 'QUEUED', de: 'QUEUED (Eingereiht)' },
    body: {
      en: '<strong>QUEUED</strong> is the transient state between clicking "Start load test" and k6 actually starting. lasttest shows the run in the dashboard but the badge has not yet turned orange (RUNNING). Polling picks up the transition quickly.',
      de: '<strong>QUEUED</strong> ist der Übergangszustand zwischen dem Klick auf "Lasttest starten" und dem tatsächlichen Start von k6. lasttest zeigt den Lauf im Dashboard, aber das Badge ist noch nicht orange (RUNNING). Das Polling nimmt den Übergang schnell auf.',
    },
  },
  {
    term: 'RUNNING',
    termDe: 'RUNNING (Läuft)',
    aliases: ['running', 'in flight', 'in-flight', 'in flight', 'live', 'live-lauf', 'inprogress', 'in progress'],
    category: 'run-state',
    title: { en: 'RUNNING', de: 'RUNNING (Läuft)' },
    body: {
      en: '<strong>RUNNING</strong> means k6 has started and the script is firing requests. The badge has an orange left edge and the run is polled every second. The in-flight action menu offers Stop (SIGTERM) and Force abort (SIGKILL).',
      de: '<strong>RUNNING</strong> heißt, k6 ist gestartet und das Skript feuert Requests. Das Badge hat eine orange linke Kante und der Lauf wird jede Sekunde gepollt. Das Aktions-Menü für laufende Läufe bietet Stop (SIGTERM) und Force abort (SIGKILL).',
    },
  },
  {
    term: 'STOPPING',
    termDe: 'STOPPING (Stoppt gerade)',
    aliases: ['stopping', 'stoppend', 'wind-down', 'winddown'],
    category: 'run-state',
    title: { en: 'STOPPING', de: 'STOPPING (Stoppt gerade)' },
    body: {
      en: '<strong>STOPPING</strong> is the transient state after clicking "Stop (graceful)" but before k6 has actually exited. The badge stays in this state until k6 winds down cleanly, then transitions to <code>STOPPED</code>. Polling keeps refreshing the badge.',
      de: '<strong>STOPPING</strong> ist der Übergangszustand nach dem Klick auf "Stop (graceful)", aber bevor k6 tatsächlich beendet ist. Das Badge bleibt in diesem Zustand, bis k6 sauber ausläuft, und wechselt dann nach <code>STOPPED</code>. Das Polling aktualisiert das Badge weiterhin.',
    },
  },
  {
    term: 'STOPPED',
    termDe: 'STOPPED (Gestoppt)',
    aliases: ['stopped', 'gestoppt', 'abgebrochen (graceful)'],
    category: 'run-state',
    title: { en: 'STOPPED', de: 'STOPPED (Gestoppt)' },
    body: {
      en: '<strong>STOPPED</strong> is the terminal state after a graceful SIGTERM cancellation. Thresholds evaluated up to the stop are still reported; the planned duration was not reached and the badge carries a purple STOPPED notice. The action menu offers Rerun, Copy report link, Export k6 JSON, and Remove from view.',
      de: '<strong>STOPPED</strong> ist der Endzustand nach einem sauberen SIGTERM-Abbruch. Bis zum Stopp ausgewertete Thresholds werden weiterhin berichtet; die geplante Laufzeit wurde nicht erreicht und das Badge trägt einen lila STOPPED-Hinweis. Das Aktions-Menü bietet Erneut ausführen, Report-Link kopieren, k6-JSON exportieren und Aus Ansicht entfernen.',
    },
  },
  {
    term: 'COMPLETED',
    termDe: 'COMPLETED (Abgeschlossen)',
    aliases: ['completed', 'finished', 'done', 'abgeschlossen', 'erfolgreich'],
    category: 'run-state',
    title: { en: 'COMPLETED', de: 'COMPLETED (Abgeschlossen)' },
    body: {
      en: '<strong>COMPLETED</strong> is the terminal state for a run that finished its planned duration without an error. The full threshold report is available. The badge has a green left edge; the action menu offers Rerun, Copy report link, Export k6 JSON, and Remove from view.',
      de: '<strong>COMPLETED</strong> ist der Endzustand für einen Lauf, der seine geplante Dauer ohne Fehler beendet hat. Der vollständige Threshold-Bericht ist verfügbar. Das Badge hat eine grüne linke Kante; das Aktions-Menü bietet Erneut ausführen, Report-Link kopieren, k6-JSON exportieren und Aus Ansicht entfernen.',
    },
  },
  {
    term: 'FAILED',
    termDe: 'FAILED (Fehlgeschlagen)',
    aliases: ['failed', 'fehlgeschlagen', 'failure', 'fehler'],
    category: 'run-state',
    title: { en: 'FAILED', de: 'FAILED (Fehlgeschlagen)' },
    body: {
      en: '<strong>FAILED</strong> is the terminal state when k6 exited with a non-zero exit code (e.g. a threshold was violated, or the script threw). The report shows which threshold failed or which error the script raised. The badge has a red left edge.',
      de: '<strong>FAILED</strong> ist der Endzustand, wenn k6 mit einem Exit-Code ungleich 0 beendet wurde (z. B. weil ein Threshold verletzt wurde oder das Skript einen Fehler geworfen hat). Der Bericht zeigt, welcher Threshold fehlgeschlagen ist oder welchen Fehler das Skript gemeldet hat. Das Badge hat eine rote linke Kante.',
    },
  },
  {
    term: 'ABORTED',
    termDe: 'ABORTED (Abgebrochen)',
    aliases: ['aborted', 'abgebrochen', 'abgebrochen (sigkill)', 'abgebrochen (hart)', 'hart abgebrochen'],
    category: 'run-state',
    title: { en: 'ABORTED', de: 'ABORTED (Abgebrochen)' },
    body: {
      en: '<strong>ABORTED</strong> is the terminal state after a forced SIGKILL cancellation (or a STOPPING → force escalation). Only partial counters are present and the threshold evaluation is not meaningful. The badge has a dark-red left edge. Use Force abort only when a run hangs — it always produces ABORTED.',
      de: '<strong>ABORTED</strong> ist der Endzustand nach einem erzwungenen SIGKILL-Abbruch (oder einer STOPPING → Force-Eskalation). Nur Teil-Counter sind vorhanden und die Threshold-Auswertung ist nicht aussagekräftig. Das Badge hat eine dunkelrote linke Kante. Nutze Force abort nur, wenn ein Lauf hängt — er produziert immer ABORTED.',
    },
  },
  {
    term: 'SIGTERM / SIGKILL',
    termDe: 'SIGTERM / SIGKILL',
    aliases: ['sigterm', 'sigkill', 'signal', 'signals', 'graceful stop', 'force abort'],
    category: 'run-state',
    title: { en: 'SIGTERM / SIGKILL', de: 'SIGTERM / SIGKILL' },
    body: {
      en: '<strong>SIGTERM</strong> is the polite shutdown signal: k6 catches it, finishes the in-flight iteration, writes the summary and exits cleanly — the run ends as <code>STOPPED</code>. <strong>SIGKILL</strong> is the unconditional kill: k6 cannot react, partial counters may be missing and the run ends as <code>ABORTED</code>. lasttest maps "Stop (graceful)" to SIGTERM and "Force abort" to SIGKILL.',
      de: '<strong>SIGTERM</strong> ist das höfliche Stop-Signal: k6 fängt es ab, beendet die laufende Iteration, schreibt die Zusammenfassung und beendet sauber — der Lauf endet als <code>STOPPED</code>. <strong>SIGKILL</strong> ist das bedingungslose Kill: k6 kann nicht reagieren, Counter können unvollständig sein und der Lauf endet als <code>ABORTED</code>. lasttest mappt "Stop (graceful)" auf SIGTERM und "Force abort" auf SIGKILL.',
    },
  },
  {
    term: 'Rerun',
    termDe: 'Erneut ausführen',
    aliases: ['rerun', 're-run', 'replay', 'nochmal', 'erneut ausfuehren', 'erneut ausführen'],
    category: 'run-state',
    title: { en: 'Rerun', de: 'Erneut ausführen (Rerun)' },
    body: {
      en: '<strong>Rerun</strong> replays the same scenario (specification, endpoint selection, load profile) with a fresh run id. Triggered from the right-click menu on terminal badges. Useful for A/B comparisons between two releases at identical load.',
      de: '<strong>Rerun</strong> (erneut ausführen) spielt dasselbe Szenario (Spezifikation, Endpunkt-Auswahl, Lastprofil) mit einer frischen Run-ID erneut ab. Ausgelöst über das Rechtsklick-Menü auf Endzustand-Badges. Nützlich für A/B-Vergleiche zwischen zwei Releases bei identischer Last.',
    },
  },
]

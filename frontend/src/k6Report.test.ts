import { deepEqual, equal, ok } from 'node:assert/strict'
import { test } from 'node:test'
import {
  activeStatusCodes,
  checkSuccessRate,
  completedRequestCount,
  copyTextToClipboard,
  extractErrorLine,
  formatBytes,
  formatDurationHuman,
  formatDurationSeconds,
  formatInteger,
  formatNumber,
  formatTimestamp,
  FALLBACK_CODES,
  k6ScriptDownloadName,
  k6ScriptUrl,
  manualK6Command,
  metric,
  operationDisplayPath,
  parseK6Summary,
  runElapsedSeconds,
  runRemainingSeconds,
  statusDistribution,
  summariseFailure,
  TRACKED_STATUS_CODES,
  type ReportOperation,
  type TestRun,
} from './k6Report.ts'

const run: TestRun = {
  id: 'run-1',
  status: 'COMPLETED',
  createdAt: '2026-08-04T16:51:22Z',
  summary: {
    raw: JSON.stringify({
      metrics: {
        checks: { passes: 10, fails: 0, value: 1 },
        http_reqs: { count: 20, rate: 2 },
      },
    }),
  },
}

test('parses the k6 summary metrics', () => {
  const summary = parseK6Summary(run)

  deepEqual(summary?.metrics.checks, { passes: 10, fails: 0, value: 1 })
  deepEqual(summary?.metrics.http_reqs, { count: 20, rate: 2 })
})

test('calculates completed requests and check success rates', () => {
  const summary = parseK6Summary(run)!

  equal(completedRequestCount(summary), 20)
  equal(checkSuccessRate(summary), 100)
  equal(checkSuccessRate({ metrics: { checks: { passes: 3, fails: 1 } } }), 75)
  equal(checkSuccessRate({ metrics: { checks: { passes: 1 } } }), 100)
  equal(checkSuccessRate({ metrics: { checks: { fails: 1 } } }), 0)
  equal(completedRequestCount({ metrics: { http_reqs: { count: Number.NaN } } }), undefined)
  equal(completedRequestCount({ metrics: {} }), undefined)
  equal(checkSuccessRate({ metrics: { checks: { passes: 0, fails: 0 } } }), undefined)
  equal(checkSuccessRate({ metrics: {} }), undefined)
})

test('rejects a malformed or incomplete k6 summary', () => {
  equal(parseK6Summary({ ...run, summary: { raw: '{invalid}' } }), undefined)
  equal(parseK6Summary({ ...run, summary: { raw: '' } }), undefined)
  equal(parseK6Summary({ ...run, summary: { raw: 'null' } }), undefined)
  equal(parseK6Summary({ ...run, summary: { raw: '[]' } }), undefined)
  equal(parseK6Summary({ ...run, summary: { raw: '{"metrics":[]}' } }), undefined)
  equal(parseK6Summary({ ...run, summary: { raw: '{"root_group":{}}' } }), undefined)
  equal(parseK6Summary({ ...run, summary: undefined }), undefined)
})

test('formats report numbers and byte values', () => {
  equal(formatNumber(161.2623), '161,26')
  equal(formatNumber(12, 0), '12')
  equal(formatNumber(Number.POSITIVE_INFINITY), '–')
  equal(formatInteger(1142), '1.142')
  equal(formatInteger(undefined), '–')
  equal(formatBytes(512), '512,00 B')
  equal(formatBytes(1024), '1,00 KiB')
  equal(formatBytes(3_064_565), '2,92 MiB')
  equal(formatBytes(1024 ** 3), '1,00 GiB')
  equal(formatBytes(Number.NaN), '–')
  equal(formatNumber(undefined), '–')
})

test('formats report timestamps and looks up optional metrics', () => {
  equal(formatTimestamp('2026-08-04T16:51:22Z'), '04.08.2026, 18:51:22')
  equal(formatTimestamp('invalid'), '–')
  equal(formatTimestamp(undefined), '–')
  equal(metric(parseK6Summary(run)!, 'missing').count, undefined)
})

test('builds safe script download metadata and manual k6 commands', () => {
  equal(k6ScriptUrl('run/id with space'), '/api/test-runs/run%2Fid%20with%20space/script')
  equal(k6ScriptDownloadName('run-1'), 'lasttest-run-1.js')
  equal(manualK6Command(undefined, 'run-1'), 'k6 run -e BASE_URL="https://target.example" lasttest-run-1.js')
  equal(
    manualK6Command({ apiTitle: 'API', apiVersion: '1', baseUrl: 'https://example.test/path', loadProfile: { type: 'constant-vus', virtualUsers: 1, durationSeconds: 1 }, operations: [] }, 'run-2'),
    'k6 run -e BASE_URL="https://example.test/path" lasttest-run-2.js',
  )
})

test('builds the displayed endpoint from path and query values', () => {
  const operation: ReportOperation = {
    operationId: 'getPet',
    method: 'GET',
    path: '/pets/{id}',
    summary: 'Get pet',
    parameterValues: [
      { name: 'id', location: 'path', value: '42' },
      { name: 'expand', location: 'query', value: 'owner' },
      { name: 'unused', location: 'query', value: '' },
    ],
    bearerTokenConfigured: false,
  }

  equal(operationDisplayPath(operation), '/pets/42?expand=owner')
})

test('keeps unresolved paths and omits empty queries', () => {
  const operation: ReportOperation = {
    operationId: 'getPet',
    method: 'GET',
    path: '/pets/{id}',
    summary: '',
    parameterValues: [
      { name: 'id', location: 'path', value: '' },
      { name: 'expand', location: 'query', value: ' ' },
      { name: 'X-Tenant', location: 'header', value: 'demo' },
    ],
    bearerTokenConfigured: false,
  }

  equal(operationDisplayPath(operation), '/pets/{id}')
})

test('copyTextToClipboard returns true when navigator.clipboard.writeText resolves', async () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard: { writeText: async () => undefined } },
    configurable: true,
    writable: true,
  })
  try {
    equal(await copyTextToClipboard('hello world'), true)
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, 'navigator', originalDescriptor)
    } else {
      delete (globalThis as { navigator?: unknown }).navigator
    }
  }
})

test('copyTextToClipboard returns false when navigator.clipboard.writeText rejects', async () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard: { writeText: async () => { throw new Error('denied') } } },
    configurable: true,
    writable: true,
  })
  try {
    equal(await copyTextToClipboard('hello world'), false)
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, 'navigator', originalDescriptor)
    } else {
      delete (globalThis as { navigator?: unknown }).navigator
    }
  }
})

test('copyTextToClipboard returns false when navigator is not defined', async () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  delete (globalThis as { navigator?: unknown }).navigator
  try {
    equal(await copyTextToClipboard('hello world'), false)
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, 'navigator', originalDescriptor)
    }
  }
})

test('copyTextToClipboard returns false when navigator.clipboard is unavailable', async () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard: undefined },
    configurable: true,
    writable: true,
  })
  try {
    equal(await copyTextToClipboard('hello world'), false)
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, 'navigator', originalDescriptor)
    } else {
      delete (globalThis as { navigator?: unknown }).navigator
    }
  }
})

test('statusDistribution extracts per-operation exact status code counts and totals them', () => {
  const summary = {
    metrics: {
      lt_status_200_getThing: { count: 192 },
      lt_status_503_getThing: { count: 8 },
      lt_status_200_otherOp: { count: 50 },
      lt_status_401_otherOp: { count: 12 },
      lt_status_err_otherOp: { count: 7 },
      lt_status_other_weirdOp: { count: 3 },
    } as Record<string, { count: number }>,
  }

  const rows = statusDistribution(summary, ['getThing', 'otherOp', 'weirdOp', 'neverSelected'])

  // Every tracked code plus the fallback codes must be present on each
  // row, defaulting to 0, so the table layout is predictable.
  equal(rows[0].operationId, 'getThing')
  equal(rows[0].counts['200'], 192)
  equal(rows[0].counts['503'], 8)
  equal(rows[0].counts['401'], 0)
  equal(rows[0].total, 200)
  equal(rows[1].counts['200'], 50)
  equal(rows[1].counts['401'], 12)
  equal(rows[1].counts['err'], 7)
  equal(rows[1].total, 69)
  equal(rows[2].counts['other'], 3)
  // Operations without any counter still get a fully-zeroed row so the
  // table stays aligned with the run configuration.
  equal(rows[3].operationId, 'neverSelected')
  equal(rows[3].total, 0)
  for (const code of [...TRACKED_STATUS_CODES, ...FALLBACK_CODES]) {
    equal(rows[3].counts[String(code)], 0)
  }
})

test('statusDistribution ignores malformed count values', () => {
  const summary = {
    metrics: {
      lt_status_200_op: { count: Number.NaN },
      lt_status_429_op: { count: Number.POSITIVE_INFINITY },
    } as Record<string, { count: number }>,
  }

  const [row] = statusDistribution(summary, ['op'])
  equal(row.counts['200'], 0)
  equal(row.counts['429'], 0)
  equal(row.total, 0)
})

test('activeStatusCodes keeps the tracked order, omits codes that never fired, and always shows fallback columns', () => {
  const rows = [
    { operationId: 'a', counts: { '200': 5, '401': 0, '429': 3 }, total: 8 },
    { operationId: 'b', counts: { '200': 0, '401': 1, '429': 0 }, total: 1 },
  ]

  const codes = activeStatusCodes(rows)

  // 200, 401, 429 are all in TRACKED_STATUS_CODES, so they appear in
  // canonical order. The two fallback codes are always appended.
  deepEqual(codes, [200, 401, 429, 'err', 'other'])
})

test('activeStatusCodes returns only the fallback columns when nothing fired', () => {
  const rows = [{ operationId: 'a', counts: { '200': 0 }, total: 0 }]

  deepEqual(activeStatusCodes(rows), ['err', 'other'])
})

// ---- formatDurationSeconds / formatDurationHuman ----

test('formatDurationSeconds formats MM:SS for values under one hour', () => {
  equal(formatDurationSeconds(0), '00:00')
  equal(formatDurationSeconds(7), '00:07')
  equal(formatDurationSeconds(59), '00:59')
  equal(formatDurationSeconds(60), '01:00')
  equal(formatDurationSeconds(83), '01:23')
  equal(formatDurationSeconds(3599), '59:59')
})

test('formatDurationSeconds uses H:MM:SS for values >= one hour', () => {
  equal(formatDurationSeconds(3600), '1:00:00')
  equal(formatDurationSeconds(3661), '1:01:01')
  equal(formatDurationSeconds(7_320), '2:02:00')
})

test('formatDurationSeconds returns the placeholder for invalid or missing values', () => {
  equal(formatDurationSeconds(undefined), '–')
  equal(formatDurationSeconds(Number.NaN), '–')
  equal(formatDurationSeconds(Number.POSITIVE_INFINITY), '–')
  equal(formatDurationSeconds(-5), '–')
})

test('formatDurationSeconds floors fractional seconds', () => {
  equal(formatDurationSeconds(12.9), '00:12')
})

test('formatDurationHuman formats sub-minute values as seconds only', () => {
  equal(formatDurationHuman(0), '0 s')
  equal(formatDurationHuman(7), '7 s')
  equal(formatDurationHuman(59), '59 s')
})

test('formatDurationHuman formats minute values and trims trailing seconds when zero', () => {
  equal(formatDurationHuman(60), '1 min')
  equal(formatDurationHuman(83), '1 min 23 s')
  equal(formatDurationHuman(125), '2 min 5 s')
  equal(formatDurationHuman(3_599), '59 min 59 s')
})

test('formatDurationHuman collapses the output to the coarsest non-zero segment', () => {
  equal(formatDurationHuman(3_600), '1 h')
  equal(formatDurationHuman(3_661), '1 h 1 min 1 s')
  equal(formatDurationHuman(7_200), '2 h')
  equal(formatDurationHuman(7_320), '2 h 2 min')
  equal(formatDurationHuman(0), '0 s')
})

test('formatDurationHuman returns the placeholder for invalid or missing values', () => {
  equal(formatDurationHuman(undefined), '–')
  equal(formatDurationHuman(Number.NaN), '–')
  equal(formatDurationHuman(Number.POSITIVE_INFINITY), '–')
  equal(formatDurationHuman(-5), '–')
})

// ---- runElapsedSeconds ----

test('runElapsedSeconds returns undefined when the run has not started yet', () => {
  equal(runElapsedSeconds({ id: 'r', status: 'QUEUED', createdAt: '2026-01-01T00:00:00Z' }, 1_700_000_000_000), undefined)
})

test('runElapsedSeconds returns the seconds between startedAt and now', () => {
  const started = '2026-01-01T00:00:00Z'
  const now = new Date(started).getTime() + 12_500
  equal(runElapsedSeconds({ id: 'r', status: 'RUNNING', createdAt: started, startedAt: started }, now), 12.5)
})

test('runElapsedSeconds caps at finishedAt when the run already ended', () => {
  const started = '2026-01-01T00:00:00Z'
  const finished = '2026-01-01T00:00:10Z'
  const now = new Date(started).getTime() + 60_000
  equal(runElapsedSeconds({ id: 'r', status: 'COMPLETED', createdAt: started, startedAt: started, finishedAt: finished }, now), 10)
})

test('runElapsedSeconds treats invalid timestamps as undefined', () => {
  equal(runElapsedSeconds({ id: 'r', status: 'RUNNING', createdAt: '2026-01-01T00:00:00Z', startedAt: 'not-a-date' }, 1_700_000_000_000), undefined)
})

test('runElapsedSeconds clamps negative deltas to zero', () => {
  // Server clock skew can make finishedAt < startedAt; wir wollen
  // keine negative oder NaN-Anzeige.
  const started = '2026-01-01T00:00:10Z'
  const finished = '2026-01-01T00:00:05Z'
  equal(runElapsedSeconds({ id: 'r', status: 'COMPLETED', createdAt: started, startedAt: started, finishedAt: finished }, new Date(started).getTime() + 1_000), 0)
})

// ---- runRemainingSeconds ----

test('runRemainingSeconds returns undefined without a configuration', () => {
  const started = '2026-01-01T00:00:00Z'
  const now = new Date(started).getTime() + 5_000
  equal(runRemainingSeconds({ id: 'r', status: 'RUNNING', createdAt: started, startedAt: started }, now), undefined)
})

test('runRemainingSeconds returns undefined when the run has not started yet', () => {
  // Konfiguration ist da, aber startedAt fehlt (z. B. QUEUED).
  // profileTotalSeconds liefert einen Wert, aber runElapsedSeconds
  // liefert undefined, daher müssen wir auch hier undefined liefern.
  const now = 1_700_000_000_000
  const run: TestRun = {
    id: 'r',
    status: 'QUEUED',
    createdAt: '2026-01-01T00:00:00Z',
    configuration: { apiTitle: 'A', apiVersion: '1', baseUrl: 'http://x', loadProfile: { type: 'constant-vus', virtualUsers: 1, durationSeconds: 60 }, operations: [] },
  }
  equal(runRemainingSeconds(run, now), undefined)
})

test('runRemainingSeconds returns undefined for shared-iterations profiles', () => {
  const started = '2026-01-01T00:00:00Z'
  const now = new Date(started).getTime() + 5_000
  equal(
    runRemainingSeconds(
      { id: 'r', status: 'RUNNING', createdAt: started, startedAt: started, configuration: { apiTitle: 'A', apiVersion: '1', baseUrl: 'http://x', loadProfile: { type: 'shared-iterations', virtualUsers: 1, iterations: 1 }, operations: [] } },
      now,
    ),
    undefined,
  )
})

test('runRemainingSeconds subtracts elapsed from the planned total', () => {
  const started = '2026-01-01T00:00:00Z'
  const now = new Date(started).getTime() + 10_000
  const run: TestRun = {
    id: 'r',
    status: 'RUNNING',
    createdAt: started,
    startedAt: started,
    configuration: { apiTitle: 'A', apiVersion: '1', baseUrl: 'http://x', loadProfile: { type: 'constant-vus', virtualUsers: 1, durationSeconds: 60 }, operations: [] },
  }
  equal(runRemainingSeconds(run, now), 50)
})

test('runRemainingSeconds clamps to zero once the run has exceeded the plan', () => {
  const started = '2026-01-01T00:00:00Z'
  const now = new Date(started).getTime() + 120_000
  const run: TestRun = {
    id: 'r',
    status: 'COMPLETED',
    createdAt: started,
    startedAt: started,
    finishedAt: '2026-01-01T00:02:00Z',
    configuration: { apiTitle: 'A', apiVersion: '1', baseUrl: 'http://x', loadProfile: { type: 'constant-vus', virtualUsers: 1, durationSeconds: 30 }, operations: [] },
  }
  equal(runRemainingSeconds(run, now), 0)
})

// ---- summariseFailure ----

test('summariseFailure returns undefined for empty, null, or whitespace-only errors', () => {
  equal(summariseFailure(undefined), undefined)
  equal(summariseFailure(null), undefined)
  equal(summariseFailure(''), undefined)
  equal(summariseFailure('   \n  \n'), undefined)
})

test('summariseFailure detects DNS resolution failures', () => {
  const reason = summariseFailure('ERRO[0000] GoError: Get "https://api.example.com/": dial tcp: lookup api.example.com: no such host')
  ok(reason)
  equal(reason!.kind, 'dns')
  ok(reason!.summary.includes('api.example.com'))
  ok(reason!.summary.includes('DNS-Auflösung'))
  equal(reason!.hint != null, true)
})

test('summariseFailure detects DNS failures with a "Temporary failure in name resolution" message', () => {
  const reason = summariseFailure('dial tcp: lookup broken.test: Temporary failure in name resolution')
  ok(reason)
  equal(reason!.kind, 'dns')
  ok(reason!.detail.includes('Temporary failure in name resolution'))
})

test('summariseFailure detects DNS failures with a port-prefixed dial tcp string', () => {
  // Das Fragezeichen-Optional in `(?::\d+)?` des DNS-Patterns wird
  // genutzt, wenn k6 einen Port in den Lookup-Pfad einbettet.
  const reason = summariseFailure('dial tcp:443: lookup api.example.com: no such host')
  ok(reason)
  equal(reason!.kind, 'dns')
  ok(reason!.summary.includes('api.example.com'))
})

test('summariseFailure detects connection-refused errors with host and port', () => {
  const reason = summariseFailure('dial tcp 127.0.0.1:1: connect: connection refused')
  ok(reason)
  equal(reason!.kind, 'connection-refused')
  ok(reason!.summary.includes('127.0.0.1'))
  ok(reason!.summary.includes('1'))
})

test('summariseFailure detects connection-refused errors with IPv6 hosts', () => {
  const reason = summariseFailure('dial tcp [::1]:8080: connect: connection refused')
  ok(reason)
  equal(reason!.kind, 'connection-refused')
  ok(reason!.summary.includes('::1'))
  ok(reason!.summary.includes('8080'))
})

test('summariseFailure detects connection-timeout errors', () => {
  const reason = summariseFailure('dial tcp 10.0.0.99:8080: i/o timeout')
  ok(reason)
  equal(reason!.kind, 'connection-timeout')
  ok(reason!.summary.includes('10.0.0.99'))
  ok(reason!.summary.includes('8080'))
})

test('summariseFailure detects context-deadline-exceeded as a timeout', () => {
  const reason = summariseFailure('dial tcp api.example.com:443: context deadline exceeded')
  ok(reason)
  equal(reason!.kind, 'connection-timeout')
})

test('summariseFailure detects x509 TLS errors and keeps the original message', () => {
  const reason = summariseFailure('Get "https://expired.badssl.com/": x509: certificate has expired or is not yet valid')
  ok(reason)
  equal(reason!.kind, 'tls')
  ok(reason!.summary.includes('TLS-Handshake'))
  ok(reason!.detail.includes('certificate has expired'))
})

test('summariseFailure detects HTTP status code errors', () => {
  const reason = summariseFailure('http response error: status code 500')
  ok(reason)
  equal(reason!.kind, 'http')
  ok(reason!.summary.includes('500'))
})

test('summariseFailure detects GoError script errors with file and line', () => {
  const reason = summariseFailure('GoError: file:///app/test.js:25:5   ReferenceError: foo is not defined')
  ok(reason)
  equal(reason!.kind, 'script')
  ok(reason!.summary.includes('test.js'))
  ok(reason!.summary.includes('25'))
  ok(reason!.summary.includes('ReferenceError'))
})

test('summariseFailure detects missing k6 process errors', () => {
  const reason = summariseFailure('Cannot run program "k6" (in directory "/tmp"): error=2, No such file or directory')
  ok(reason)
  equal(reason!.kind, 'process')
  ok(reason!.summary.includes('k6'))
  ok(reason!.hint != null)
})

test('summariseFailure detects k6 as a missing command in a shell error', () => {
  // Deckt den `k6: command not found`-Pfad und die Variante ohne
  // umschließende Anführungszeichen ab.
  const reason = summariseFailure('/bin/sh: k6: command not found')
  ok(reason)
  equal(reason!.kind, 'process')
})

test('summariseFailure detects a "no such file or directory" error from the OS', () => {
  // Plain OS-Fehler ohne explizite Nennung von k6 — der Fallback im
  // process-Pattern schlägt trotzdem an, weil `no such file or
  // directory` Teil der Fehlermeldung ist.
  const reason = summariseFailure('fork/exec /usr/local/bin/k6: no such file or directory')
  ok(reason)
  equal(reason!.kind, 'process')
})

test('summariseFailure detects connection-refused against a hostname without explicit IP', () => {
  // Das dritte Alternativ-Pattern `[^:]+` greift, wenn weder eine IPv4
  // noch eine IPv6-Adresse, sondern ein Hostname ohne Doppelpunkt
  // angegeben ist (z. B. wenn k6 die Verbindung gegen einen
  // DNS-Namen aufbaut, der aber über /etc/hosts auf einen Port zeigt).
  const reason = summariseFailure('dial tcp myservice:8080: connect: connection refused')
  ok(reason)
  equal(reason!.kind, 'connection-refused')
  ok(reason!.summary.includes('myservice'))
})

test('summariseFailure returns an unknown reason for unmatched k6 output', () => {
  const reason = summariseFailure('first noise line\nSomething completely unexpected\nhappened on the line below')
  ok(reason)
  equal(reason!.kind, 'unknown')
  // Wir scannen vom Ende her, daher landen die letzten Zeilen im
  // Detail — die ersten Zeilen sind oft Time-Series-Output-Fehler,
  // die nicht die eigentliche Fehlerursache sind.
  ok(reason!.detail.includes('happened on the line below'))
})

test('summariseFailure strips the ERRO[] prefix in the unknown fallback', () => {
  const reason = summariseFailure('ERRO[0002] Something completely unexpected\nERRO[0003] actual last error')
  ok(reason)
  equal(reason!.kind, 'unknown')
  // Die letzte Zeile gewinnt: ERRO[0003] wird abgeschnitten, damit
  // die UI den eigentlichen Text ohne k6-Logging-Rauschen anzeigt.
  equal(reason!.detail, 'actual last error')
})

test('summariseFailure prefers the first matching pattern and ignores ERRO[] prefixes', () => {
  const reason = summariseFailure('ERRO[0001] GoError: dial tcp example.com:80: i/o timeout\nERRO[0001] http response error: status code 503')
  ok(reason)
  // Beide Muster würden matchen, aber time-out steht im Pattern-Array
  // vor http — also wird der time-out-Label gewinnen.
  equal(reason!.kind, 'connection-timeout')
})

// ---- extractErrorLine (interne Helper, exportiert für Tests) ----

test('extractErrorLine returns the last non-empty line and strips the ERRO[] prefix', () => {
  // Wir scannen vom Ende her, damit der finale Fehler (nicht ein
  // zwischengeschobener Time-Series-Output) für die UI gewinnt.
  equal(extractErrorLine('ERRO[0001] dial tcp: lookup x: no such host'), 'dial tcp: lookup x: no such host')
})

test('extractErrorLine prefers the meaningful line at the end of the buffer', () => {
  // Wenn am Anfang InfluxDB-Output-Fehler stehen und am Ende der
  // eigentliche Test-Request-Fehler, muss letzterer extrahiert werden.
  equal(
    extractErrorLine('ERRO[0000] lookup influxdb: no such host\ntime="…" level=warning msg="Request Failed" error="Get \\"http://127.0.0.1:1/\\": dial tcp 127.0.0.1:1: connect: connection refused"'),
    'time="…" level=warning msg="Request Failed" error="Get \\"http://127.0.0.1:1/\\": dial tcp 127.0.0.1:1: connect: connection refused"',
  )
})

test('extractErrorLine falls back to the trimmed text when every line is just an ERRO[] marker', () => {
  // Defensive Pfad: jeder Strip liefert eine leere Zeile. Wir nehmen
  // dann die letzte Zeile, die noch Inhalt hat.
  equal(extractErrorLine('ERRO[0000]\nERRO[0001]\n   '), 'ERRO[0000]\nERRO[0001]')
})


import { deepEqual, equal, ok } from 'node:assert/strict'
import { test } from 'node:test'
import {
  activeStatusCodes,
  buildMetricRow,
  checkSuccessRate,
  completedRequestCount,
  copyTextToClipboard,
  extractErrorLine,
  extractPayloadUsage,
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
  progressHint,
  renderPayloadStrategyHelp,
  renderPayloadStrategyLabel,
  runElapsedSeconds,
  runRemainingSeconds,
  statusDistribution,
  statusCodeTotals,
  totalRequestCount,
  summarizeFailure,
  summariseFailure,
  summariseThresholds,
  TRACKED_STATUS_CODES,
  type K6Summary,
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
    payloads: [],
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
    payloads: [],
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

test('statusCodeTotals sums per-operation counts into a run-wide list in activeStatusCodes order', () => {
  // Mini-Balken-Grid der Übersicht: pro Code ein Balken über
  // den GESAMTEN Lauf (alle Endpunkte summiert). Die
  // Reihenfolge folgt [activeStatusCodes] (also tracked
  // zuerst, dann err, other), damit die UI stabil bleibt
  // wenn ein neuer Code hinzukommt.
  //
  // Im Gegensatz zum Detail-Report blendet die Übersicht
  // leere Fallback-Spalten (err, other) aus: ein sauberer
  // 200-only-Lauf darf nicht trotzdem zwei graue "err" /
  // "other"-Kacheln rendern, die nur 0 anzeigen.
  const rows = [
    { operationId: 'a', counts: { '200': 192, '503': 8, '401': 0 } as Record<string, number>, total: 200 },
    { operationId: 'b', counts: { '200': 50, '401': 12, 'err': 7 } as Record<string, number>, total: 69 },
  ]

  const totals = statusCodeTotals(rows)

  // 200 wurde in beiden Operationen gefeuert → 192 + 50 = 242
  // 401 nur in b → 12
  // 503 nur in a → 8
  // err nur in b → 7
  // other wurde nirgends gefeuert → fällt raus, weil der
  // Übersicht-Helper nur gefeuerte Codes zurückgibt.
  deepEqual(totals, [
    { code: '200', count: 242 },
    { code: '401', count: 12 },
    { code: '503', count: 8 },
    { code: 'err', count: 7 },
  ])
})

test('statusCodeTotals omits fallback columns when they never fired', () => {
  // Regression: ein sauberer 200-only-Lauf darf im
  // Mini-Balken-Grid nur die 200-Kachel zeigen — keine
  // leeren err/other-Kacheln. Vor der Umstellung hat der
  // Helper die Fallback-Codes bedingungslos eingeblendet,
  // weil [activeStatusCodes] das im Detail-Report so macht.
  // Hier erzwingen wir explizit das abweichende
  // Übersicht-Verhalten.
  const rows = [
    { operationId: 'a', counts: { '200': 100 } as Record<string, number>, total: 100 },
  ]

  const totals = statusCodeTotals(rows)

  deepEqual(totals, [{ code: '200', count: 100 }])
})

test('statusCodeTotals keeps the err column when only err fired and no tracked code did', () => {
  // Regression: ein Lauf, der nur Netzwerkfehler produziert
  // (k6 schlug bei jeder Iteration fehl), muss trotzdem die
  // err-Spalte anzeigen — sonst sieht der Nutzer eine leere
  // Karte und fragt sich, wo die Fehler hin sind. `other`
  // bleibt in diesem Fall weg, weil es nicht gefeuert hat.
  const rows = [
    { operationId: 'a', counts: { '200': 0, 'err': 4 } as Record<string, number>, total: 4 },
  ]

  const totals = statusCodeTotals(rows)

  deepEqual(totals, [{ code: 'err', count: 4 }])
})

test('statusCodeTotals returns an empty list when there are no operations at all', () => {
  // Edge case: ein Run ohne Operationen (z. B. ein
  // Synthetic-Fixture). Die Komponente filtert diesen Fall
  // schon im Voraus, der Helper selbst bleibt trotzdem
  // defensiv — ohne Rows gefeuert zu haben, gibt es nichts
  // anzuzeigen.
  const totals = statusCodeTotals([])

  deepEqual(totals, [])
})

test('totalRequestCount sums the per-row totals across every operation', () => {
  // Der "Gesamt: N Requests"-Header in der Mini-Grid-Karte
  // nutzt diesen Helper statt selbst zu summieren, damit
  // die Anzeige konsistent mit [statusCodeTotals] ist
  // (gleiche Datenquelle, gleiche Summen-Definition).
  const rows = [
    { operationId: 'a', counts: {} as Record<string, number>, total: 200 },
    { operationId: 'b', counts: {} as Record<string, number>, total: 69 },
    { operationId: 'c', counts: {} as Record<string, number>, total: 0 },
  ]

  equal(totalRequestCount(rows), 269)
})

test('totalRequestCount returns 0 for an empty row set', () => {
  equal(totalRequestCount([]), 0)
})


// ---- Merge of the conflict pages -------------------------------------------
//
// HEAD (Feature) and ffe00f7ec (Main) are both retained:
//   HEAD       - formatDuration* / runElapsedSeconds / runRemainingSeconds /
//                summariseFailure (s) / extractErrorLine
//   ffe00f7ec  - summarizeFailure (z) / buildMetricRow
//
// summariseFailure (z) is called in App.tsx:380,
// buildMetricRow in App.tsx:382. Both need tests, otherwise the
// 100% coverage requirement in package.json:scripts.test:coverage fails.

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
  // Server clock skew can make finishedAt < startedAt; we want
  // no negative or NaN display.
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
  // Configuration is present but startedAt is missing (e.g. QUEUED).
  // profileTotalSeconds returns a value, but runElapsedSeconds returns
  // undefined, so we must also return undefined here.
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
  // The question-mark optional in `(?::\d+)?` of the DNS pattern is
  // used when k6 embeds a port into the lookup path.
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
  // Covers the `k6: command not found` path and the variant without
  // surrounding quotes.
  const reason = summariseFailure('/bin/sh: k6: command not found')
  ok(reason)
  equal(reason!.kind, 'process')
})

test('summariseFailure detects a "no such file or directory" error from the OS', () => {
  // Plain OS error without explicitly mentioning k6 — the fallback in
  // the process pattern still hits because `no such file or
  // directory` is part of the error message.
  const reason = summariseFailure('fork/exec /usr/local/bin/k6: no such file or directory')
  ok(reason)
  equal(reason!.kind, 'process')
})

test('summariseFailure detects connection-refused against a hostname without explicit IP', () => {
  // The third alternative pattern `[^:]+` matches when neither an
  // IPv4 nor an IPv6 address is given, but a hostname without a colon
  // (e.g. when k6 dials a DNS name that points to a port via
  // /etc/hosts).
  const reason = summariseFailure('dial tcp myservice:8080: connect: connection refused')
  ok(reason)
  equal(reason!.kind, 'connection-refused')
  ok(reason!.summary.includes('myservice'))
})

test('summariseFailure returns an unknown reason for unmatched k6 output', () => {
  const reason = summariseFailure('first noise line\nSomething completely unexpected\nhappened on the line below')
  ok(reason)
  equal(reason!.kind, 'unknown')
  // We scan from the end, so the last lines end up in the
  // detail — the first lines are often time-series output errors,
  // which are not the actual cause of the failure.
  ok(reason!.detail.includes('happened on the line below'))
})

test('summariseFailure strips the ERRO[] prefix in the unknown fallback', () => {
  const reason = summariseFailure('ERRO[0002] Something completely unexpected\nERRO[0003] actual last error')
  ok(reason)
  equal(reason!.kind, 'unknown')
  // The last line wins: ERRO[0003] is truncated so the UI shows
  // the actual text without k6 logging noise.
  equal(reason!.detail, 'actual last error')
})

test('summariseFailure prefers the first matching pattern and ignores ERRO[] prefixes', () => {
  const reason = summariseFailure('ERRO[0001] GoError: dial tcp example.com:80: i/o timeout\nERRO[0001] http response error: status code 503')
  ok(reason)
  // Both patterns would match, but time-out comes before http in
  // the pattern array — so the time-out label wins.
  equal(reason!.kind, 'connection-timeout')
})

// ---- extractErrorLine (internal helper, exported for tests) ----

test('extractErrorLine returns the last non-empty line and strips the ERRO[] prefix', () => {
  // We scan from the end so the final error (not an interleaved
  // time-series output) wins for the UI.
  equal(extractErrorLine('ERRO[0001] dial tcp: lookup x: no such host'), 'dial tcp: lookup x: no such host')
})

test('extractErrorLine prefers the meaningful line at the end of the buffer', () => {
  // When InfluxDB output errors appear at the beginning and the
  // actual test-request error at the end, the latter must be extracted.
  equal(
    extractErrorLine('ERRO[0000] lookup influxdb: no such host\ntime="…" level=warning msg="Request Failed" error="Get \\"http://127.0.0.1:1/\\": dial tcp 127.0.0.1:1: connect: connection refused"'),
    'time="…" level=warning msg="Request Failed" error="Get \\"http://127.0.0.1:1/\\": dial tcp 127.0.0.1:1: connect: connection refused"',
  )
})

test('extractErrorLine falls back to the trimmed text when every line is just an ERRO[] marker', () => {
  // Defensive path: each strip yields an empty line. We then take
  // the last line that still has content.
  equal(extractErrorLine('ERRO[0000]\nERRO[0001]\n   '), 'ERRO[0000]\nERRO[0001]')
})

function runWithError(error: string | undefined, summaryRaw?: string): TestRun {
  return {
    id: 'run-1',
    status: 'FAILED',
    createdAt: '2026-08-05T16:00:00Z',
    configuration: {
      apiTitle: 'API',
      apiVersion: '1',
      baseUrl: 'http://127.0.0.1:1',
      loadProfile: { type: 'constant-vus', virtualUsers: 1, durationSeconds: 10 },
      operations: [],
    },
    summary: summaryRaw ? { raw: summaryRaw } : undefined,
    error,
  }
}

function summaryRawWith(metrics: Record<string, Record<string, number>>): string {
  return JSON.stringify({ metrics })
}

test('summarizeFailure detects the k6 binary missing case', () => {
  const run = runWithError(
    'java.io.IOException: Cannot run program "k6": error=2, No such file or directory',
  )
  const failure = summarizeFailure(run)
  equal(failure.category, 'k6-missing')
  equal(failure.diagnosis, 'k6 konnte nicht gestartet werden')
  equal(failure.detail, 'Cannot run program „k6“ — Binary fehlt im Container')
  equal(failure.reasons.length, 3)
})

test('summarizeFailure detects a TLS handshake failure and mentions the TrustStore hint', () => {
  const run = runWithError(
    'ERRO[0001] GoError: net::ERR_CERT_AUTHORITY_INVALID at github.com/grafana/k6/net.(*DialerHolder).Dial (net.go:152)',
  )
  const failure = summarizeFailure(run)
  equal(failure.category, 'tls')
  equal(failure.diagnosis, 'TLS-Handshake fehlgeschlagen')
  equal(failure.detail, 'Zertifikat wird nicht vertraut (self-signed oder interne CA)')
  equal(failure.reasons.some(r => r.includes('LASTTEST_TRUSTSTORE_PATH')), true)
})

test('summarizeFailure extracts the hostname for the DNS failure category', () => {
  const run = runWithError('ERRO[0001] GoError: Getaddrinfo ENOTFOUND api.typo.example.com at net.go:152')
  const failure = summarizeFailure(run)
  equal(failure.category, 'dns')
  equal(failure.detail, 'api.typo.example.com nicht gefunden (ENOTFOUND)')
  equal(failure.reasons[0].includes('api.typo.example.com'), true)
})

test('summarizeFailure falls back to the configured baseUrl when the error omits the hostname', () => {
  const run = runWithError('ERRO[0001] GoError: Getaddrinfo ENOTFOUND')
  const failure = summarizeFailure(run)
  equal(failure.category, 'dns')
  equal(failure.detail, '127.0.0.1 nicht gefunden (ENOTFOUND)')
})

test('summarizeFailure reports an unreachable target with the configured baseUrl', () => {
  const run = runWithError('ERRO[0001] GoError: net::ERR_CONNECTION_REFUSED at net.go:152')
  const failure = summarizeFailure(run)
  equal(failure.category, 'unreachable')
  equal(failure.diagnosis, 'Ziel nicht erreichbar')
  equal(failure.detail, 'Connection refused auf http://127.0.0.1:1')
  equal(failure.reasons[0].includes('http://127.0.0.1:1'), true)
  equal(failure.reasons[0].includes('Connection refused'), true)
})

test('summarizeFailure without baseUrl still produces a useful detail', () => {
  const run: TestRun = {
    id: 'run-1',
    status: 'FAILED',
    createdAt: '2026-08-05T16:00:00Z',
    error: 'ERR_CONNECTION_REFUSED',
  }
  const failure = summarizeFailure(run)
  equal(failure.category, 'unreachable')
  equal(failure.detail, 'Connection refused')
})

test('summarizeFailure classifies a timeout and references the latency threshold', () => {
  const summary = summaryRawWith({
    http_reqs: { count: 600 },
    http_req_failed: { value: 0.032 },
    http_req_duration: { 'p(95)': 1840 },
    lt_status_504_listProducts: { count: 19 },
    lt_status_200_listProducts: { count: 581 },
  })
  const run = runWithError('Post "https://slow.test/": context deadline exceeded (Client.Timeout)', summary)
  const failure = summarizeFailure(run)
  equal(failure.category, 'timeout')
  equal(failure.diagnosis, 'Antwortzeit zu hoch')
  equal(failure.detail.includes('1.840 ms'), true)
  equal(failure.detail.includes('1,0 s'), true)
  equal(failure.reasons.some(r => r.includes('19 von 600')), true)
  equal(failure.reasons.some(r => r.includes('3,2 %')), true)
})

test('summarizeFailure classifies a timeout without any 5xx as a pure latency issue', () => {
  const summary = summaryRawWith({
    http_reqs: { count: 600 },
    http_req_failed: { value: 0.01 },
    http_req_duration: { 'p(95)': 2200 },
    lt_status_200_listProducts: { count: 594 },
    lt_status_504_listProducts: { count: 0 },
  })
  const run = runWithError('context deadline exceeded', summary)
  const failure = summarizeFailure(run)
  equal(failure.category, 'timeout')
  equal(failure.reasons.some(r => r.includes('gerissen')), true)
})

test('summarizeFailure classifies a run dominated by 5xx as a server-error run', () => {
  const summary = summaryRawWith({
    http_reqs: { count: 600 },
    http_req_failed: { value: 0.52 },
    lt_status_502_getProduct: { count: 250 },
    lt_status_502_listProducts: { count: 62 },
    lt_status_200_getProduct: { count: 50 },
    lt_status_200_listProducts: { count: 188 },
  })
  const run = runWithError(undefined, summary)
  const failure = summarizeFailure(run)
  equal(failure.category, 'server5xx')
  equal(failure.diagnosis, 'Viele Server-Fehler (5xx)')
  equal(failure.detail.includes('502'), true)
  equal(failure.reasons.some(r => r.includes('getProduct')), true)
  equal(failure.reasons.some(r => r.includes('listProducts')), true)
})

test('summarizeFailure classifies a run dominated by 4xx as a client-error run', () => {
  const summary = summaryRawWith({
    http_reqs: { count: 600 },
    http_req_failed: { value: 0.8 },
    lt_status_401_searchProducts: { count: 480 },
    lt_status_200_searchProducts: { count: 120 },
  })
  const run = runWithError(undefined, summary)
  const failure = summarizeFailure(run)
  equal(failure.category, 'threshold-failure-rate')
  equal(failure.diagnosis, 'Hohe Client-Fehlerrate (4xx)')
  equal(failure.detail.includes('401'), true)
  equal(failure.reasons.some(r => r.includes('Bearer-Token')), true)
})

test('summarizeFailure classifies a run dominated by 403 as a client-error run', () => {
  const summary = summaryRawWith({
    http_reqs: { count: 600 },
    http_req_failed: { value: 0.4 },
    lt_status_403_searchProducts: { count: 240 },
    lt_status_200_searchProducts: { count: 360 },
  })
  const run = runWithError(undefined, summary)
  const failure = summarizeFailure(run)
  equal(failure.category, 'threshold-failure-rate')
  equal(failure.reasons.some(r => r.includes('Berechtigung')), true)
})

test('summarizeFailure classifies a high-latency run with mixed 4xx as latency-only', () => {
  const summary = summaryRawWith({
    http_reqs: { count: 600 },
    http_req_failed: { value: 0.04 },
    http_req_duration: { 'p(95)': 1840 },
    lt_status_200_searchProducts: { count: 580 },
    lt_status_401_searchProducts: { count: 24 },
  })
  const run = runWithError(undefined, summary)
  const failure = summarizeFailure(run)
  equal(failure.category, 'threshold-latency')
  equal(failure.diagnosis, 'Antwortzeit zu hoch')
  equal(failure.detail.includes('1.840 ms'), true)
  equal(failure.reasons.some(r => r.includes('4,0 %')), true)
})

test('summarizeFailure classifies a k6 script error and extracts the file:line reference', () => {
  const run = runWithError(
    [
      'ERRO[0001] ReferenceError: bearerToken is not defined',
      '    at file:///tmp/lasttest-7f2e9d8a/test.js:42:3(43)',
      '  hint: script exception',
    ].join('\n'),
  )
  const failure = summarizeFailure(run)
  equal(failure.category, 'script')
  equal(failure.diagnosis, 'k6-Skriptfehler')
  equal(failure.detail.includes('ReferenceError: bearerToken is not defined'), true)
  equal(failure.detail.includes('test.js:42'), true)
})

test('summarizeFailure falls back to the unknown category when no signal matches', () => {
  const run = runWithError('level=info msg="some unrelated log line"')
  const failure = summarizeFailure(run)
  equal(failure.category, 'unknown')
  equal(failure.diagnosis, 'k6-Lauf fehlgeschlagen')
  equal(failure.detail, 'level=info msg="some unrelated log line"')
  equal(failure.reasons[0].includes('Erste Fehlerzeile'), true)
})

test('summarizeFailure falls back to unknown when both error and summary are missing', () => {
  const run = runWithError(undefined, undefined)
  const failure = summarizeFailure(run)
  equal(failure.category, 'unknown')
  equal(failure.diagnosis, 'Unbekannter Fehler')
  equal(failure.reasons[0].includes('steht nicht in run.error'), true)
})

test('summarizeFailure prefers an explicit error text over a threshold breach', () => {
  const summary = summaryRawWith({
    http_reqs: { count: 600 },
    http_req_failed: { value: 0.5 },
    http_req_duration: { 'p(95)': 1840 },
  })
  const run = runWithError('ERR_CONNECTION_REFUSED', summary)
  const failure = summarizeFailure(run)
  equal(failure.category, 'unreachable')
})

test('summarizeFailure returns reasons for the unreachable case even with no summary', () => {
  const run = runWithError('ERR_CONNECTION_REFUSED')
  const failure = summarizeFailure(run)
  equal(failure.reasons.some(r => r.includes('Connection refused')), true)
})

test('buildMetricRow omits the metric row entirely for RUNNING and QUEUED runs', () => {
  const failure = summarizeFailure(runWithError(undefined))
  for (const status of ['RUNNING', 'QUEUED']) {
    const run: TestRun = { id: 'run', status, createdAt: '2026-08-05T16:00:00Z' }
    deepEqual(buildMetricRow(run, undefined, failure), [])
  }
})

test('buildMetricRow reports request count, failure rate and throughput for a healthy run', () => {
  const summary = parseK6Summary({
    id: 'run', status: 'COMPLETED', createdAt: '2026-08-05T16:00:00Z',
    summary: {
      raw: summaryRawWith({
        http_reqs: { count: 600, rate: 58.3 },
        http_req_failed: { value: 0 },
        http_req_duration: { 'p(95)': 184 },
        data_received: { count: 1258291 },
      }),
    },
  })
  const failure = summarizeFailure({ id: 'run', status: 'COMPLETED', createdAt: '2026-08-05T16:00:00Z', summary: { raw: summaryRawWith({}) } })
  const items = buildMetricRow({ id: 'run', status: 'COMPLETED', createdAt: '2026-08-05T16:00:00Z', summary: { raw: summaryRawWith({}) } }, summary, failure)
  const labels = items.map(item => item.label)
  deepEqual(labels, ['Requests', 'p(95)', 'Fehlerquote', 'Durchsatz', 'Daten empfangen'])
  equal(items[0].value, '600')
  equal(items[1].value, '184 ms')
  equal(items[2].severity, 'normal')
  equal(items[2].value, '0 %')
})

test('buildMetricRow highlights a failing request rate and shows network error count', () => {
  const run = runWithError('ERR_CONNECTION_REFUSED')
  const summary = parseK6Summary({
    ...run,
    summary: {
      raw: summaryRawWith({
        http_reqs: { count: 60 },
        http_req_failed: { value: 1 },
        lt_status_err_getProduct: { count: 20 },
        lt_status_err_listProducts: { count: 20 },
        lt_status_err_createProduct: { count: 20 },
      }),
    },
  })
  const failure = summarizeFailure(run)
  const items = buildMetricRow(run, summary, failure)
  const labels = items.map(item => item.label)
  deepEqual(labels, ['Requests', 'p(95)', 'Fehlerquote', 'Status 0 (Netzwerkfehler)'])
  equal(items[0].value, '60')
  equal(items[1].value, '–')
  equal(items[2].severity, 'error')
  equal(items[2].value, '100 %')
  equal(items[3].value, '60×')
  equal(items[3].severity, 'error')
})

test('buildMetricRow reports both 5xx and 2xx counts for the server5xx category', () => {
  const summaryRaw = summaryRawWith({
    http_reqs: { count: 600 },
    http_req_failed: { value: 0.52 },
    http_req_duration: { 'p(95)': 184 },
    lt_status_502_getProduct: { count: 250 },
    lt_status_502_listProducts: { count: 62 },
    lt_status_200_getProduct: { count: 50 },
    lt_status_200_listProducts: { count: 188 },
  })
  const summary = parseK6Summary({ id: 'run', status: 'FAILED', createdAt: '2026-08-05T16:00:00Z', summary: { raw: summaryRaw } })
  const run = runWithError(undefined, summaryRaw)
  const failure = summarizeFailure(run)
  const items = buildMetricRow(run, summary, failure)
  const labels = items.map(item => item.label)
  deepEqual(labels, ['Requests', 'p(95)', 'Fehlerquote', '5xx', '2xx'])
  equal(items[3].value, '312×')
  equal(items[4].value, '238×')
})

test('buildMetricRow reports 4xx counts for the threshold-failure-rate category', () => {
  const summaryRaw = summaryRawWith({
    http_reqs: { count: 600 },
    http_req_failed: { value: 0.8 },
    lt_status_401_searchProducts: { count: 480 },
    lt_status_200_searchProducts: { count: 120 },
  })
  const summary = parseK6Summary({ id: 'run', status: 'FAILED', createdAt: '2026-08-05T16:00:00Z', summary: { raw: summaryRaw } })
  const run = runWithError(undefined, summaryRaw)
  const failure = summarizeFailure(run)
  const items = buildMetricRow(run, summary, failure)
  const labels = items.map(item => item.label)
  deepEqual(labels, ['Requests', 'p(95)', 'Fehlerquote', '4xx'])
  equal(items[3].value, '480×')
  equal(items[3].severity, 'error')
})

test('buildMetricRow highlights a latency that exceeds the threshold', () => {
  const summaryRaw = summaryRawWith({
    http_reqs: { count: 600, rate: 58.3 },
    http_req_failed: { value: 0 },
    http_req_duration: { 'p(95)': 1840 },
  })
  const summary = parseK6Summary({ id: 'run', status: 'COMPLETED', createdAt: '2026-08-05T16:00:00Z', summary: { raw: summaryRaw } })
  const run: TestRun = { id: 'run', status: 'COMPLETED', createdAt: '2026-08-05T16:00:00Z', summary: { raw: summaryRaw } }
  const failure = summarizeFailure(run)
  const items = buildMetricRow(run, summary, failure)
  const p95Item = items.find(item => item.label === 'p(95)')!
  equal(p95Item.value, '1.840 ms')
  equal(p95Item.severity, 'error')
})

test('buildMetricRow shows a placeholder hint when the run failed before any iteration ran', () => {
  const summary = parseK6Summary({
    id: 'run', status: 'FAILED', createdAt: '2026-08-05T16:00:00Z',
    summary: { raw: summaryRawWith({ http_reqs: { count: 0 } }) },
  })
  const run = runWithError('ReferenceError: bearerToken is not defined at file:///tmp/test.js:42', summaryRawWith({}))
  const failure = summarizeFailure(run)
  const items = buildMetricRow(run, summary, failure)
  const labels = items.map(item => item.label)
  deepEqual(labels, ['Requests', 'p(95)', 'Fehlerquote', 'Hinweis'])
  equal(items[3].value, 'Skript brach vor dem ersten Request ab')
})

test('buildMetricRow gracefully degrades when the summary cannot be parsed', () => {
  const run = runWithError(undefined, undefined)
  const failure = summarizeFailure(run)
  const items = buildMetricRow(run, undefined, failure)
  const labels = items.map(item => item.label)
  deepEqual(labels, ['Requests', 'p(95)', 'Fehlerquote'])
  equal(items[0].value, '–')
  equal(items[1].value, '–')
  equal(items[2].value, '–')
})

test('buildMetricRow keeps the failure rate clean (no decimal) when it is an integer percent', () => {
  const summary = parseK6Summary({
    id: 'run', status: 'COMPLETED', createdAt: '2026-08-05T16:00:00Z',
    summary: {
      raw: summaryRawWith({
        http_reqs: { count: 100, rate: 10 },
        http_req_failed: { value: 1 },
        http_req_duration: { 'p(95)': 200 },
      }),
    },
  })
  const run: TestRun = { id: 'run', status: 'COMPLETED', createdAt: '2026-08-05T16:00:00Z', summary: { raw: summaryRawWith({}) } }
  const failure = summarizeFailure(run)
  const items = buildMetricRow(run, summary, failure)
  const fehlerquote = items.find(item => item.label === 'Fehlerquote')!
  equal(fehlerquote.value, '100 %')
})

test('progressHint reports the elapsed and remaining duration while the run is RUNNING', () => {
  const now = Date.now()
  const startedAt = new Date(now - 4_000).toISOString()
  const run: TestRun = {
    id: 'run',
    status: 'RUNNING',
    createdAt: startedAt,
    startedAt,
    configuration: {
      apiTitle: 'API', apiVersion: '1', baseUrl: 'https://x', loadProfile: { type: 'constant-vus', virtualUsers: 1, durationSeconds: 10 }, operations: [],
    },
  }
  equal(progressHint(run), 'läuft seit 4 s · voraussichtlich noch 6 s')
})

test('progressHint returns a generic hint while the run is RUNNING but the start time is unknown', () => {
  const run: TestRun = { id: 'run', status: 'RUNNING', createdAt: '2026-08-05T16:00:00Z' }
  equal(progressHint(run), 'läuft')
})

test('progressHint explains the QUEUED state', () => {
  const run: TestRun = { id: 'run', status: 'QUEUED', createdAt: '2026-08-05T16:00:00Z' }
  equal(progressHint(run), 'wartet auf Executor (Pool-Größe: 2)')
})

test('progressHint returns undefined for terminal states', () => {
  for (const status of ['COMPLETED', 'FAILED']) {
    equal(progressHint({ id: 'run', status, createdAt: '2026-08-05T16:00:00Z' }), undefined)
  }
})

test('summarizeFailure preserves a hostname from the error text when baseUrl is missing', () => {
  const run: TestRun = {
    id: 'run',
    status: 'FAILED',
    createdAt: '2026-08-05T16:00:00Z',
    error: 'ERRO[0001] GoError: Getaddrinfo ENOTFOUND api.typo.example.com',
  }
  const failure = summarizeFailure(run)
  equal(failure.detail, 'api.typo.example.com nicht gefunden (ENOTFOUND)')
})

test('summarizeFailure falls back to "Zielhost" when neither the error text nor the baseUrl reveal a hostname', () => {
  const run: TestRun = {
    id: 'run',
    status: 'FAILED',
    createdAt: '2026-08-05T16:00:00Z',
    error: 'ERRO[0001] GoError: Getaddrinfo ENOTFOUND',
  }
  const failure = summarizeFailure(run)
  equal(failure.detail.startsWith('Zielhost'), true)
})

test('summarizeFailure falls back to "Zielhost" when baseUrl is malformed', () => {
  const run: TestRun = {
    id: 'run',
    status: 'FAILED',
    createdAt: '2026-08-05T16:00:00Z',
    configuration: {
      apiTitle: 'API',
      apiVersion: '1',
      baseUrl: 'not a valid url',
      loadProfile: { type: 'constant-vus', virtualUsers: 1, durationSeconds: 10 },
      operations: [],
    },
    error: 'ERRO[0001] GoError: Getaddrinfo ENOTFOUND',
  }
  const failure = summarizeFailure(run)
  equal(failure.detail.startsWith('Zielhost'), true)
})

test('summarizeFailure truncates an extremely long error excerpt in the script category', () => {
  const longLine = 'ReferenceError: ' + 'x'.repeat(500)
  const run = runWithError(`${longLine}\n    at file:///tmp/lasttest/test.js:1:1`)
  const failure = summarizeFailure(run)
  // The detail embeds the excerpt but trims it to ~160 chars before use.
  equal(failure.detail.includes('…'), true)
  equal(failure.detail.length < longLine.length, true)
})

test('summarizeFailure classifies a threshold-failure-rate run with a non-401 4xx code', () => {
  const summary = summaryRawWith({
    http_reqs: { count: 600 },
    http_req_failed: { value: 0.6 },
    lt_status_429_searchProducts: { count: 360 },
    lt_status_200_searchProducts: { count: 240 },
  })
  const run = runWithError(undefined, summary)
  const failure = summarizeFailure(run)
  equal(failure.category, 'threshold-failure-rate')
  // Generic 4xx path is taken when neither 401 nor 403 dominates.
  equal(failure.reasons.some(r => r.includes('429')), true)
})

test('buildMetricRow adds a Status 504 item when the timeout category has 5xx responses', () => {
  const summaryRaw = summaryRawWith({
    http_reqs: { count: 600 },
    http_req_failed: { value: 0.032 },
    http_req_duration: { 'p(95)': 1840 },
    lt_status_504_listProducts: { count: 19 },
    lt_status_200_listProducts: { count: 581 },
  })
  const summary = parseK6Summary({ id: 'run', status: 'FAILED', createdAt: '2026-08-05T16:00:00Z', summary: { raw: summaryRaw } })
  const run = runWithError('context deadline exceeded', summaryRaw)
  const failure = summarizeFailure(run)
  const items = buildMetricRow(run, summary, failure)
  const status504 = items.find(item => item.label === 'Status 504')
  equal(status504?.value, '19×')
  equal(status504?.severity, 'error')
})

test('buildMetricRow reports the k6-missing hint without showing p(95) or failure rate', () => {
  const run = runWithError('Cannot run program "k6": error=2, No such file or directory')
  const failure = summarizeFailure(run)
  const items = buildMetricRow(run, undefined, failure)
  const labels = items.map(item => item.label)
  deepEqual(labels, ['Requests', 'p(95)', 'Fehlerquote', 'Hinweis'])
  equal(items[3].value, 'Skript-Ausführung nicht möglich')
})

test('buildMetricRow omits throughput and data size when the run is in the unreachable category', () => {
  const run = runWithError('ERR_CONNECTION_REFUSED')
  const summary = parseK6Summary({
    ...run,
    summary: {
      raw: summaryRawWith({
        http_reqs: { count: 60, rate: 5.9 },
        http_req_failed: { value: 1 },
        data_received: { count: 1258291 },
        lt_status_err_listProducts: { count: 60 },
      }),
    },
  })
  const failure = summarizeFailure(run)
  const items = buildMetricRow(run, summary, failure)
  equal(items.some(item => item.label === 'Durchsatz'), false)
  equal(items.some(item => item.label === 'Daten empfangen'), false)
})

test('buildMetricRow omits throughput and data size when the run is in the k6-missing category', () => {
  const run = runWithError('Cannot run program "k6"')
  const failure = summarizeFailure(run)
  const items = buildMetricRow(run, undefined, failure)
  equal(items.some(item => item.label === 'Durchsatz'), false)
  equal(items.some(item => item.label === 'Daten empfangen'), false)
})

test('buildMetricRow omits throughput and data size when their values are zero', () => {
  const summaryRaw = summaryRawWith({
    http_reqs: { count: 600, rate: 0 },
    http_req_failed: { value: 0 },
    http_req_duration: { 'p(95)': 184 },
    data_received: { count: 0 },
  })
  const summary = parseK6Summary({ id: 'run', status: 'COMPLETED', createdAt: '2026-08-05T16:00:00Z', summary: { raw: summaryRaw } })
  const run: TestRun = { id: 'run', status: 'COMPLETED', createdAt: '2026-08-05T16:00:00Z', summary: { raw: summaryRaw } }
  const failure = summarizeFailure(run)
  const items = buildMetricRow(run, summary, failure)
  equal(items.some(item => item.label === 'Durchsatz'), false)
  equal(items.some(item => item.label === 'Daten empfangen'), false)
})

test('summarizeFailure includes the network-error bullet when the unreachable run captured status-0 responses', () => {
  const summaryRaw = summaryRawWith({
    http_reqs: { count: 60 },
    http_req_failed: { value: 1 },
    lt_status_err_listProducts: { count: 60 },
  })
  const run = runWithError('ERR_CONNECTION_REFUSED', summaryRaw)
  const failure = summarizeFailure(run)
  equal(failure.reasons.some(r => r.includes('60')), true)
  equal(failure.reasons.some(r => r.includes('Status 0')), true)
})

test('summarizeFailure includes all 5xx endpoints in the server-error reasons, not only the dominant one', () => {
  const summaryRaw = summaryRawWith({
    http_reqs: { count: 600 },
    http_req_failed: { value: 0.5 },
    lt_status_502_endpointA: { count: 250 },
    lt_status_502_endpointB: { count: 60 },
    lt_status_503_endpointC: { count: 50 },
    lt_status_500_endpointD: { count: 10 },
    lt_status_200_endpointA: { count: 50 },
    lt_status_200_endpointB: { count: 100 },
    lt_status_200_endpointC: { count: 50 },
    lt_status_200_endpointD: { count: 30 },
  })
  const run = runWithError(undefined, summaryRaw)
  const failure = summarizeFailure(run)
  // Cap at 3 most frequent 5xx endpoints to keep the list readable.
  equal(failure.reasons.some(r => r.includes('endpointA') && r.includes('502')), true)
  equal(failure.reasons.some(r => r.includes('endpointB') && r.includes('502')), true)
  equal(failure.reasons.some(r => r.includes('endpointC') && r.includes('503')), true)
  equal(failure.reasons.some(r => r.includes('endpointD') && r.includes('500')), false)
})

test('summarizeFailure classifies the script category without a file reference', () => {
  const run = runWithError('ERRO[0001] ReferenceError: bearerToken is not defined\n  hint: script exception')
  const failure = summarizeFailure(run)
  equal(failure.category, 'script')
  equal(failure.detail.includes('ReferenceError: bearerToken is not defined'), true)
  equal(failure.detail.includes('test.js'), false)
})

test('summarizeFailure uses 0 % as failure rate when the summary has no http_req_failed metric', () => {
  const summaryRaw = summaryRawWith({
    http_reqs: { count: 600 },
    http_req_duration: { 'p(95)': 1840 },
    lt_status_200_searchProducts: { count: 600 },
  })
  const run = runWithError(undefined, summaryRaw)
  const failure = summarizeFailure(run)
  equal(failure.category, 'threshold-latency')
  equal(failure.reasons.some(r => r.includes('0,0 %')), true)
})

test('summarizeFailure reports unknown when the run has neither error text nor summary', () => {
  const run = runWithError(undefined)
  const failure = summarizeFailure(run)
  equal(failure.category, 'unknown')
  equal(failure.reasons[0].includes('steht nicht in run.error'), true)
})

test('buildMetricRow handles a successful run with no throughput and no data received metrics', () => {
  const summaryRaw = summaryRawWith({
    http_reqs: { count: 1 },
    http_req_failed: { value: 0 },
    http_req_duration: { 'p(95)': 50 },
  })
  const summary = parseK6Summary({ id: 'run', status: 'COMPLETED', createdAt: '2026-08-05T16:00:00Z', summary: { raw: summaryRaw } })
  const run: TestRun = { id: 'run', status: 'COMPLETED', createdAt: '2026-08-05T16:00:00Z', summary: { raw: summaryRaw } }
  const failure = summarizeFailure(run)
  const items = buildMetricRow(run, summary, failure)
  equal(items.some(item => item.label === 'Durchsatz'), false)
  equal(items.some(item => item.label === 'Daten empfangen'), false)
})

test('buildMetricRow does not show Status 0 for an unreachable run that has no per-operation err counters', () => {
  const summaryRaw = summaryRawWith({
    http_reqs: { count: 60 },
    http_req_failed: { value: 1 },
  })
  const summary = parseK6Summary({ id: 'run', status: 'FAILED', createdAt: '2026-08-05T16:00:00Z', summary: { raw: summaryRaw } })
  const run = runWithError('ERR_CONNECTION_REFUSED', summaryRaw)
  const failure = summarizeFailure(run)
  const items = buildMetricRow(run, summary, failure)
  equal(items.some(item => item.label.startsWith('Status 0')), false)
})

test('buildMetricRow falls back to a muted p(95) for a k6-missing run without a summary', () => {
  const run = runWithError('Cannot run program "k6"')
  const failure = summarizeFailure(run)
  const items = buildMetricRow(run, undefined, failure)
  const p95 = items.find(item => item.label === 'p(95)')!
  equal(p95.value, '–')
  equal(p95.severity, 'muted')
})

test('buildMetricRow does not show the throughput/data row for script failures without a summary', () => {
  const run = runWithError('ReferenceError: x is not defined at file:///tmp/test.js:1')
  const failure = summarizeFailure(run)
  const items = buildMetricRow(run, undefined, failure)
  const labels = items.map(item => item.label)
  equal(labels.includes('Durchsatz'), false)
  equal(labels.includes('Daten empfangen'), false)
})

test('aggregateStatusCodes skips metrics whose name does not match the lt_status_ prefix', () => {
  // Direct test of the private helper via the public surface: summarizeFailure
  // must only consider lt_status_* keys when computing the failure shape.
  const summary = {
    metrics: {
      http_reqs: { count: 100 },
      http_req_failed: { value: 0.4 },
      http_req_duration: { 'p(95)': 200 },
      lt_status_429_a: { count: 40 },
      not_a_status_key: { count: 99 },
    },
  } as unknown as K6Summary
  const failure = summarizeFailure({ id: 'run', status: 'FAILED', createdAt: '2026-08-05T16:00:00Z', summary: { raw: JSON.stringify(summary) } })
  // The single usable bucket (lt_status_429_a) drives the dominant code;
  // plain non-prefixed keys are ignored by the aggregator.
  equal(failure.category, 'threshold-failure-rate')
  equal(failure.detail.includes('429'), true)
})

test('aggregateStatusCodes ignores lt_status metrics with null, non-finite, or zero counts', () => {
  // Drives the `value == null || !Number.isFinite(value) || value <= 0` short-circuit
  // in aggregateStatusCodes. The bucket list should only contain the count: 1 entry.
  const summary = {
    metrics: {
      http_reqs: { count: 10 },
      http_req_failed: { value: 0.4 },
      http_req_duration: { 'p(95)': 200 },
      lt_status_200_a: { count: 0 },
      lt_status_429_a: { count: Number.NaN },
      lt_status_500_a: { count: Number.POSITIVE_INFINITY },
      lt_status_502_b: { count: null },
      lt_status_503_c: { count: 1 },
    },
  } as unknown as K6Summary
  const failure = summarizeFailure({ id: 'run', status: 'FAILED', createdAt: '2026-08-05T16:00:00Z', summary: { raw: JSON.stringify(summary) } })
  // The single usable bucket (lt_status_503_c) drives the dominant code.
  equal(failure.detail.includes('503'), true)
})

test('summarizeFailure adds the network-error bullet to the dns category when the summary has err counters', () => {
  const summaryRaw = summaryRawWith({
    http_reqs: { count: 30 },
    http_req_failed: { value: 1 },
    lt_status_err_listProducts: { count: 30 },
  })
  const run = runWithError('Getaddrinfo ENOTFOUND api.typo.example.com', summaryRaw)
  const failure = summarizeFailure(run)
  equal(failure.category, 'dns')
  equal(failure.reasons.some(r => r.includes('Status 0')), true)
})

test('summarizeFailure falls back to the network-error count when http_reqs is missing in an unreachable run', () => {
  // http_reqs.count === 0 forces the right operand of `totalRequests ||
  // networkErrors` to be used, even though the run never recorded total
  // requests. The bullet must still report the network error count.
  const summaryRaw = summaryRawWith({
    http_req_failed: { value: 1 },
    lt_status_err_listProducts: { count: 12 },
  })
  const run = runWithError('ERR_CONNECTION_REFUSED', summaryRaw)
  const failure = summarizeFailure(run)
  equal(failure.category, 'unreachable')
  equal(failure.reasons.some(r => r.includes('12')), true)
})

test('summarizeFailure falls back to the network-error count when http_reqs is missing in a dns run', () => {
  const summaryRaw = summaryRawWith({
    http_req_failed: { value: 1 },
    lt_status_err_listProducts: { count: 8 },
  })
  const run = runWithError('Getaddrinfo ENOTFOUND api.typo.example.com', summaryRaw)
  const failure = summarizeFailure(run)
  equal(failure.category, 'dns')
  equal(failure.reasons.some(r => r.includes('8')), true)
})

test('summarizeFailure uses the configured baseUrl in the tls detail when it is provided', () => {
  // The TLS detail template includes the baseUrl (no fallback) when it is set.
  const run = runWithError('net::ERR_CERT_AUTHORITY_INVALID')
  const failure = summarizeFailure(run)
  equal(failure.category, 'tls')
  equal(failure.reasons.some(r => r.includes('http://127.0.0.1:1')), true)
})

test('summarizeFailure falls back to "Ziel" in the tls reason when no baseUrl is configured', () => {
  // The TLS reason line always names a target. When the run lost its
  // baseUrl configuration, the placeholder "Ziel" stands in.
  const run: TestRun = {
    id: 'run',
    status: 'FAILED',
    createdAt: '2026-08-05T16:00:00Z',
    error: 'net::ERR_CERT_AUTHORITY_INVALID',
  }
  const failure = summarizeFailure(run)
  equal(failure.category, 'tls')
  equal(failure.reasons.some(r => r.startsWith('Ziel liefert')), true)
})

test('summarizeFailure omits the latency footnote in the server5xx category when p95 is missing', () => {
  const summaryRaw = summaryRawWith({
    http_reqs: { count: 600 },
    http_req_failed: { value: 0.5 },
    lt_status_502_endpointA: { count: 300 },
    lt_status_200_endpointA: { count: 300 },
  })
  const run = runWithError(undefined, summaryRaw)
  const failure = summarizeFailure(run)
  equal(failure.category, 'server5xx')
  equal(failure.reasons.some(r => r.includes('Latenz unauff')), false)
})

test('summarizeFailure threshold-failure-rate shows the generic 4xx bullet when neither 401 nor 403 dominates', () => {
  const summaryRaw = summaryRawWith({
    http_reqs: { count: 600 },
    http_req_failed: { value: 0.4 },
    lt_status_500_endpointA: { count: 240 },
    lt_status_200_endpointA: { count: 360 },
  })
  const run = runWithError(undefined, summaryRaw)
  const failure = summarizeFailure(run)
  // 240/600 = 40 % 5xx; < 50 % server5xx threshold but > 5 % failure rate.
  // Since dominant is 5xx, the 4xx fallback bullet is NOT pushed.
  equal(failure.category, 'server5xx')
  equal(failure.reasons.some(r => r.includes('Berechtigung')), false)
})

test('summarizeFailure classifies a threshold-failure-rate run with dominant 5xx as server5xx instead', () => {
  const summaryRaw = summaryRawWith({
    http_reqs: { count: 1000 },
    http_req_failed: { value: 0.3 },
    lt_status_500_endpointA: { count: 300 },
    lt_status_200_endpointA: { count: 700 },
  })
  const run = runWithError(undefined, summaryRaw)
  const failure = summarizeFailure(run)
  // 300/1000 = 30 % 5xx share, above 5 % threshold → server5xx.
  equal(failure.category, 'server5xx')
})

test('summarizeFailure classifies a threshold-failure-rate run with a dominant 5xx but low 5xx share as client-error', () => {
  const summaryRaw = summaryRawWith({
    http_reqs: { count: 1000 },
    http_req_failed: { value: 0.06 },
    lt_status_500_endpointA: { count: 49 },
    lt_status_429_endpointB: { count: 11 },
    lt_status_200_endpointA: { count: 940 },
  })
  const run = runWithError(undefined, summaryRaw)
  const failure = summarizeFailure(run)
  // 49/1000 = 4.9 % 5xx share < 5 % → falls through to failure-rate threshold.
  equal(failure.category, 'threshold-failure-rate')
})

test('buildMetricRow omits the 2xx count when the server5xx run returned no 2xx responses', () => {
  const summaryRaw = summaryRawWith({
    http_reqs: { count: 600 },
    http_req_failed: { value: 0.5 },
    lt_status_502_endpointA: { count: 300 },
  })
  const summary = parseK6Summary({ id: 'run', status: 'FAILED', createdAt: '2026-08-05T16:00:00Z', summary: { raw: summaryRaw } })
  const run = runWithError(undefined, summaryRaw)
  const failure = summarizeFailure(run)
  const items = buildMetricRow(run, summary, failure)
  equal(items.some(item => item.label === '2xx'), false)
})

test('buildMetricRow omits the Status 504 item when the timeout run has no 5xx responses', () => {
  const summaryRaw = summaryRawWith({
    http_reqs: { count: 600 },
    http_req_failed: { value: 0.04 },
    http_req_duration: { 'p(95)': 2200 },
    lt_status_200_endpointA: { count: 596 },
  })
  const summary = parseK6Summary({ id: 'run', status: 'FAILED', createdAt: '2026-08-05T16:00:00Z', summary: { raw: summaryRaw } })
  const run = runWithError('context deadline exceeded', summaryRaw)
  const failure = summarizeFailure(run)
  const items = buildMetricRow(run, summary, failure)
  equal(items.some(item => item.label === 'Status 504'), false)
  // Throughput is shown when available.
  equal(items.some(item => item.label === 'Durchsatz'), false)
})

test('summarizeFailure falls back to unknown when summary has no breached thresholds', () => {
  // Summary-driven path: the run has no error text but its metrics do not
  // cross any threshold (low 5xx share, low p95, low failure rate).
  const summaryRaw = summaryRawWith({
    http_reqs: { count: 600, rate: 58.3 },
    http_req_failed: { value: 0.005 },
    http_req_duration: { 'p(95)': 100 },
    data_received: { count: 1258291 },
    lt_status_200_endpointA: { count: 597 },
    lt_status_201_endpointB: { count: 3 },
  })
  const run = runWithError(undefined, summaryRaw)
  const failure = summarizeFailure(run)
  equal(failure.category, 'unknown')
  equal(failure.diagnosis, 'Unbekannter Fehler')
})

test('summarizeFailure includes the latency footnote in the server5xx category when p95 is known', () => {
  const summaryRaw = summaryRawWith({
    http_reqs: { count: 600 },
    http_req_failed: { value: 0.5 },
    http_req_duration: { 'p(95)': 184 },
    lt_status_502_endpointA: { count: 300 },
    lt_status_200_endpointA: { count: 300 },
  })
  const run = runWithError(undefined, summaryRaw)
  const failure = summarizeFailure(run)
  equal(failure.category, 'server5xx')
  equal(failure.reasons.some(r => r.includes('Latenz unauff')), true)
})

test('summarizeFailure adds the rate-vs-threshold bullet for a timeout run that has zero 5xx responses', () => {
  const summaryRaw = summaryRawWith({
    http_reqs: { count: 600 },
    http_req_failed: { value: 0.01 },
    http_req_duration: { 'p(95)': 2200 },
    lt_status_200_endpointA: { count: 594 },
  })
  const run = runWithError('context deadline exceeded', summaryRaw)
  const failure = summarizeFailure(run)
  equal(failure.category, 'timeout')
  // The bullet must say 'gerissen' when 5xx count is 0.
  equal(failure.reasons.some(r => r.includes('gerissen')), true)

})

// ---- summariseThresholds ----------------------------------------------------
//
// Drives the "Alle N Thresholds eingehalten / N Thresholds verletzt" banner
// above the result cards. The helper must be deterministic, must only look
// at the two metrics the project actually configures, and must not flash a
// green "passed" banner before k6 has settled the run.

test('summariseThresholds returns passed=true when both metrics are within limits', () => {
  const summary = summaryRawWith({
    http_req_failed: { value: 0.004 },
    http_req_duration: { 'p(95)': 842 },
  })
  const run = { ...runWithError(undefined, summary), status: 'COMPLETED' as const }
  const result = summariseThresholds(run)
  equal(result.passed, true)
  deepEqual(result.failedMetrics, [])
})

test('summariseThresholds reports http_req_duration when p(95) exceeds 1000 ms', () => {
  const summary = summaryRawWith({
    http_req_failed: { value: 0.01 },
    http_req_duration: { 'p(95)': 2579 },
  })
  const run = { ...runWithError(undefined, summary), status: 'COMPLETED' as const }
  const result = summariseThresholds(run)
  equal(result.passed, false)
  deepEqual(result.failedMetrics, ['http_req_duration'])
})

test('summariseThresholds reports http_req_failed when the rate exceeds 5 %', () => {
  const summary = summaryRawWith({
    http_req_failed: { value: 0.179 },
    http_req_duration: { 'p(95)': 300 },
  })
  const run = { ...runWithError(undefined, summary), status: 'FAILED' as const }
  const result = summariseThresholds(run)
  equal(result.passed, false)
  deepEqual(result.failedMetrics, ['http_req_failed'])
})

test('summariseThresholds reports both metrics when both thresholds are crossed', () => {
  const summary = summaryRawWith({
    http_req_failed: { value: 0.179 },
    http_req_duration: { 'p(95)': 2579 },
  })
  const run = { ...runWithError(undefined, summary), status: 'FAILED' as const }
  const result = summariseThresholds(run)
  equal(result.passed, false)
  // The order must match the order in the k6 summary: failure rate, then latency.
  deepEqual(result.failedMetrics, ['http_req_failed', 'http_req_duration'])
})

test('summariseThresholds treats a missing or non-finite metric as not-crossed', () => {
  const summary = summaryRawWith({
    http_req_failed: {},
    http_req_duration: { 'p(95)': 500 },
  })
  const run = { ...runWithError(undefined, summary), status: 'COMPLETED' as const }
  const result = summariseThresholds(run)
  equal(result.passed, true)
  deepEqual(result.failedMetrics, [])
})

test('summariseThresholds does not flash a pass banner while the run is still going', () => {
  const summary = summaryRawWith({
    http_req_failed: { value: 0.0 },
    http_req_duration: { 'p(95)': 100 },
  })
  const run = { ...runWithError(undefined, summary), status: 'RUNNING' as const }
  const result = summariseThresholds(run)
  // We deliberately report "not passed" with no failures, so the UI
  // can show a neutral state instead of a green banner.
  equal(result.passed, false)
  deepEqual(result.failedMetrics, [])
})

test('summariseThresholds returns no failures when the run has no k6 summary at all', () => {
  const run = { ...runWithError('k6 brach vor dem ersten Request ab'), status: 'FAILED' as const }
  const result = summariseThresholds(run)
  equal(result.passed, false)
  deepEqual(result.failedMetrics, [])
})

// ---- renderPayloadStrategyLabel / renderPayloadStrategyHelp ------------

test('renderPayloadStrategyLabel maps every wire value to a user-facing string', () => {
  equal(renderPayloadStrategyLabel('random'), 'Zufällig')
  equal(renderPayloadStrategyLabel('sequential'), 'Sequenziell')
  // Legacy runs that pre-date the pool feature arrive without a
  // strategy field; the label must still be a sensible default.
  equal(renderPayloadStrategyLabel(null), 'Sequenziell')
  equal(renderPayloadStrategyLabel(undefined), 'Sequenziell')
  // Unknown values fall through to the raw string so the user can
  // still spot a typo or a future enum member.
  equal(renderPayloadStrategyLabel('fancy'), 'fancy')
})

test('renderPayloadStrategyHelp describes what the strategy did during the run', () => {
  equal(renderPayloadStrategyHelp('random'), 'Pro Iteration ein zufälliger Payload aus dem Pool des Endpunkts.')
  equal(renderPayloadStrategyHelp('sequential'), '1, 2, …, letzter, dann wieder 1 — Round-Robin mit Wrap-Around.')
  equal(renderPayloadStrategyHelp(null), 'Standard-Verhalten: jeder Endpunkt mit einem einzigen Datensatz.')
  equal(renderPayloadStrategyHelp(undefined), 'Standard-Verhalten: jeder Endpunkt mit einem einzigen Datensatz.')
  equal(renderPayloadStrategyHelp('fancy'), '')
})

// ---- extractPayloadUsage -------------------------------------------------

test('extractPayloadUsage reads the per-payload counters and returns them sorted by index', () => {
  const run = {
    summary: {
      raw: JSON.stringify({
        metrics: {
          'lt_payload_0_listProducts': { count: 7 },
          'lt_payload_1_listProducts': { count: 3 },
          'lt_payload_2_listProducts': { count: 0 },
          // Other counters that should be ignored: status codes,
          // network-error bucket, and a counter for a different
          // operation that we must not attribute to listProducts.
          'lt_status_200_listProducts': { count: 10 },
          'lt_status_err_listProducts': { count: 0 },
          'lt_payload_0_otherOp': { count: 99 },
          'http_reqs': { count: 10 },
        },
      }),
    },
  } as unknown as TestRun
  const usage = extractPayloadUsage(run, 'listProducts')
  equal(usage.length, 3)
  equal(usage[0].index, 0)
  equal(usage[0].count, 7)
  equal(usage[1].index, 1)
  equal(usage[1].count, 3)
  equal(usage[2].index, 2)
  equal(usage[2].count, 0)
})

test('extractPayloadUsage returns an empty array when the summary is missing or malformed', () => {
  equal(extractPayloadUsage({} as TestRun, 'listProducts').length, 0)
  equal(extractPayloadUsage({ summary: { raw: 'not-json' } } as unknown as TestRun, 'listProducts').length, 0)
  equal(extractPayloadUsage({ summary: { raw: '' } } as unknown as TestRun, 'listProducts').length, 0)
  // Summary that parses but carries no `metrics` key — the ?? {}
  // fallback path is the one exercised here.
  equal(extractPayloadUsage({ summary: { raw: '{"foo": 1}' } } as unknown as TestRun, 'listProducts').length, 0)
})

test('extractPayloadUsage ignores counters that do not match the lt_payload_<i>_<op> pattern', () => {
  const run = {
    summary: {
      raw: JSON.stringify({
        metrics: {
          'lt_payload_-1_listProducts': { count: 99 }, // negative index → ignored
          'lt_payload_abc_listProducts': { count: 99 }, // not an integer → ignored
          // Same suffix but a non-integer middle part so the parseInt
          // branch (returning NaN) is exercised end-to-end.
          'lt_payload_NaN_listProducts': { count: 99 },
          'lt_status_200_listProducts': { count: 5 },
        },
      }),
    },
  } as unknown as TestRun
  const usage = extractPayloadUsage(run, 'listProducts')
  equal(usage.length, 0)
})

test('extractPayloadUsage treats a missing or non-numeric count as zero', () => {
  const run = {
    summary: {
      raw: JSON.stringify({
        metrics: {
          'lt_payload_0_listProducts': {},                  // count missing → 0
          'lt_payload_1_listProducts': { count: 'oops' },   // count not a number → 0
          'lt_payload_2_listProducts': { count: null },    // count null → 0
          'lt_payload_3_listProducts': { count: 5 },         // count a number → 5
          // NaN passes the typeof number check but is a degenerate
          // value — it should fall through to the default branch.
          'lt_payload_4_listProducts': { count: Number.NaN },
        },
      }),
    },
  } as unknown as TestRun
  const usage = extractPayloadUsage(run, 'listProducts')
  equal(usage.length, 5)
  equal(usage[0].count, 0)
  equal(usage[1].count, 0)
  equal(usage[2].count, 0)
  equal(usage[3].count, 5)
  equal(usage[4].count, 0)
})


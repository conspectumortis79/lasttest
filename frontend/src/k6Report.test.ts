import { deepEqual, equal } from 'node:assert/strict'
import { test } from 'node:test'
import {
  activeStatusCodes,
  checkSuccessRate,
  completedRequestCount,
  copyTextToClipboard,
  formatBytes,
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
  statusDistribution,
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
    manualK6Command({ apiTitle: 'API', apiVersion: '1', baseUrl: 'https://example.test/path', virtualUsers: 1, durationSeconds: 1, useIterations: false, operations: [] }, 'run-2'),
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


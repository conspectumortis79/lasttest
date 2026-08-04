import { deepEqual, equal } from 'node:assert/strict'
import { test } from 'node:test'
import {
  formatBytes,
  formatInteger,
  formatNumber,
  formatTimestamp,
  k6ScriptDownloadName,
  k6ScriptUrl,
  manualK6Command,
  metric,
  operationDisplayPath,
  parseK6Summary,
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
    manualK6Command({ apiTitle: 'API', apiVersion: '1', baseUrl: 'https://example.test/path', virtualUsers: 1, durationSeconds: 1, operations: [] }, 'run-2'),
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


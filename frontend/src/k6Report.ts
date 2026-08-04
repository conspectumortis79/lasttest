export type ReportParameterValue = {
  name: string
  location: string
  value: string
}

export type ReportOperation = {
  operationId: string
  method: string
  path: string
  summary: string
  parameterValues: ReportParameterValue[]
  requestBodyJson?: string
  bearerTokenConfigured: boolean
}

export type TestRunConfiguration = {
  apiTitle: string
  apiVersion: string
  baseUrl: string
  virtualUsers: number
  durationSeconds: number
  operations: ReportOperation[]
}

export type TestRun = {
  id: string
  status: string
  createdAt: string
  startedAt?: string
  finishedAt?: string
  exitCode?: number
  configuration?: TestRunConfiguration
  summary?: { raw: string }
  error?: string
}

export type K6Metric = {
  avg?: number
  min?: number
  med?: number
  max?: number
  'p(90)'?: number
  'p(95)'?: number
  count?: number
  rate?: number
  value?: number
  passes?: number
  fails?: number
  thresholds?: Record<string, boolean>
}

export type K6Summary = {
  metrics: Record<string, K6Metric>
  root_group?: {
    checks?: Record<string, { name: string, passes: number, fails: number }>
  }
}

export function parseK6Summary(run: TestRun): K6Summary | undefined {
  if (!run.summary?.raw) return undefined
  try {
    const parsed: unknown = JSON.parse(run.summary.raw)
    if (!isRecord(parsed) || !isRecord(parsed.metrics)) return undefined
    return parsed as K6Summary
  } catch {
    return undefined
  }
}

export function metric(summary: K6Summary, name: string): K6Metric {
  return summary.metrics[name] ?? {}
}

export function formatNumber(value: number | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return '–'
  return new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value)
}

export function formatInteger(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return '–'
  return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(value)
}

export function formatBytes(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return '–'
  const units = ['B', 'KiB', 'MiB', 'GiB']
  let amount = value
  let unit = units[0]
  for (const candidate of units) {
    unit = candidate
    if (amount < 1024 || candidate === units.at(-1)) break
    amount /= 1024
  }
  return `${formatNumber(amount)} ${unit}`
}

export function formatTimestamp(value: string | undefined): string {
  if (!value) return '–'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '–'
  return new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'Europe/Berlin',
  }).format(date)
}

export function k6ScriptUrl(runId: string): string {
  return `/api/test-runs/${encodeURIComponent(runId)}/script`
}

export function k6ScriptDownloadName(runId: string): string {
  return `lasttest-${runId}.js`
}

export function manualK6Command(configuration: TestRunConfiguration | undefined, runId: string): string {
  const baseUrl = configuration?.baseUrl ?? 'https://target.example'
  return `k6 run -e BASE_URL=${JSON.stringify(baseUrl)} ${k6ScriptDownloadName(runId)}`
}

export function operationDisplayPath(operation: ReportOperation): string {
  let path = operation.path
  for (const parameter of operation.parameterValues.filter(value => value.location === 'path')) {
    path = path.replace(`{${parameter.name}}`, parameter.value || `{${parameter.name}}`)
  }
  const query = operation.parameterValues
    .filter(value => value.location === 'query' && value.value.trim() !== '')
    .map(value => `${value.name}=${value.value}`)
    .join('&')
  return path + (query ? `?${query}` : '')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

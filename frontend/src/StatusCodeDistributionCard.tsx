// Mini-Balken-Grid für die HTTP-Status-Code-Verteilung eines
// Testlaufs. Wird unterhalb des Auslastungsgraphen auf der
// Übersicht-Tab eines Runs eingeblendet, sobald der Lauf ein
// k6-Summary geliefert hat.
//
// Datenquelle: [k6Report.statusCodeTotals] aggregiert die
// Per-Code-Counts über alle Operationen des Laufs (im
// Gegensatz zur detaillierten Tabelle im Bericht, die pro
// Endpunkt aufschlüsselt). Die Mini-Grid-Variante fasst
// bewusst zusammen: der Nutzer soll auf der Übersicht mit
// einem Blick die dominante Erfolgsklasse, 4xx-Ausreißer
// und 5xx-Spitzen sehen, ohne durch eine breite Tabelle
// scrollen zu müssen.

import { useLanguage } from './languageStorage.ts'
import { translate, type SupportedLanguage } from './i18n.ts'
import type { TestRun } from './k6Report.ts'
import {
  FALLBACK_CODES,
  parseK6Summary,
  statusCodeTotals,
  statusDistribution,
  totalRequestCount,
  type StatusCodeTotal,
} from './k6Report.ts'

export type StatusCodeDistributionCardProps = {
  run: TestRun
}

/**
 * Renders the mini bar grid under the live ramp chart on the
 * Übersicht tab. Returns `null` when the run has no finished
 * k6 summary yet (the card would otherwise show a header
 * with "Gesamt: 0 Requests" and an empty grid, which is
 * more confusing than informative).
 */
export function StatusCodeDistributionCard({ run }: StatusCodeDistributionCardProps) {
  const { language } = useLanguage()
  const summary = parseK6Summary(run)
  if (!summary) return null
  const operationIds = run.configuration?.operations.map(operation => operation.operationId) ?? []
  if (operationIds.length === 0) return null
  const rows = statusDistribution(summary, operationIds)
  const totals = statusCodeTotals(rows)
  if (totals.length === 0) return null
  const grandTotal = totalRequestCount(rows)
  // A run with a parseable summary but no requests at all
  // (k6 produced a 0-iteration summary because every check
  // failed before the executor could start) is still worth
  // hiding — the empty-state copy in the Übersicht already
  // covers the case.
  if (grandTotal <= 0) return null
  return (
    <section className="status-dist" aria-label={translate(language, 'overview.statusCode.aria')}>
      <header className="status-dist-head">
        <div className="status-dist-title">{translate(language, 'overview.statusCode.title')}</div>
        <div className="status-dist-total">
          {translate(language, 'overview.statusCode.total', { count: formatInt(grandTotal, language) })}
        </div>
      </header>
      <div className="status-grid">
        {(() => {
          // Shared `maxCount` so the log-scaled bar widths are
          // comparable across cells. Without this every cell
          // would compute its own `log10(1+count)/log10(1+count) =
          // 1` and render at 100% — the dominant cell would
          // visually swallow the smaller ones. We compute the
          // maximum once at the parent and pass it down so the
          // log scale actually has a reference point.
          const maxCount = totals.reduce((acc, t) => Math.max(acc, t.count), 0)
          return totals.map(bucket => (
            <StatusCodeCell key={bucket.code} bucket={bucket} grandTotal={grandTotal} maxCount={maxCount} language={language} />
          ))
        })()}
      </div>
      <footer className="status-legend" aria-label={translate(language, 'overview.statusCode.legendAria')}>
        <span className="lg-item"><span className="lg-dot lg-2xx" />{translate(language, 'overview.statusCode.legend.2xx')}</span>
        <span className="lg-item"><span className="lg-dot lg-3xx" />{translate(language, 'overview.statusCode.legend.3xx')}</span>
        <span className="lg-item"><span className="lg-dot lg-4xx" />{translate(language, 'overview.statusCode.legend.4xx')}</span>
        <span className="lg-item"><span className="lg-dot lg-5xx" />{translate(language, 'overview.statusCode.legend.5xx')}</span>
        <span className="lg-item"><span className="lg-dot lg-err" />{translate(language, 'overview.statusCode.legend.err')}</span>
      </footer>
    </section>
  )
}

type StatusCodeCellProps = {
  bucket: StatusCodeTotal
  grandTotal: number
  /**
   * Largest count across the visible cells. The bar width
   * is log-scaled against this value so the dominant code
   * does not visually swallow the smaller ones; the parent
   * computes it once and passes it down so every cell
   * shares the same reference point.
   */
  maxCount: number
  language: SupportedLanguage
}

/**
 * One cell in the mini bar grid. Encapsulates the percentage
 * formatting, the per-family CSS class and the bar width so
 * the parent component stays focused on layout.
 */
function StatusCodeCell({ bucket, grandTotal, maxCount, language }: StatusCodeCellProps) {
  const pct = grandTotal > 0 ? (bucket.count / grandTotal) * 100 : 0
  // Log-scaled bar width so a single 200 with 12 450 requests
  // does not visually swallow every other cell. The mapping
  // here is the same "log10(1 + count) / log10(1 + max)" the
  // existing report card uses; pin the constant in one place
  // (this file) so the two views cannot drift apart.
  const safeMax = Math.max(1, maxCount)
  const barPercent = bucket.count <= 0 ? 0 : clampPct((Math.log10(1 + bucket.count) / Math.log10(1 + safeMax)) * 100)
  const familyClass = familyClassForCode(bucket.code)
  return (
    <div
      className={`status-cell ${familyClass}`}
      title={translate(language, 'overview.statusCode.cellTitle', {
        code: bucket.code,
        count: formatInt(bucket.count, language),
        pct: formatPct(pct, language),
      })}
    >
      <div className="status-cell-top">
        <span className="status-cell-code">{bucket.code}</span>
        <span className="status-cell-pct">{formatPct(pct, language)}</span>
      </div>
      <div className="status-cell-count">
        <strong>{formatInt(bucket.count, language)}</strong> {translate(language, 'overview.statusCode.requests')}
      </div>
      <div className="status-cell-bar">
        <div className="status-cell-bar-fill" style={{ width: `${barPercent}%` }} />
      </div>
    </div>
  )
}

/**
 * Maps a status code (or fallback bucket) to the CSS class
 * that determines the cell's accent colour. The same mapping
 * the detailed report uses so a 429 looks identical in both
 * places. `err` and `other` get their own class because the
 * mockup uses a brown for network errors and the legend has
 * to match.
 */
function familyClassForCode(code: string): string {
  if (FALLBACK_CODES.includes(code as typeof FALLBACK_CODES[number])) {
    return code === 'err' ? 'cell-err' : 'cell-other'
  }
  const firstDigit = code[0]
  if (firstDigit === '4') return 'cell-4xx'
  if (firstDigit === '5') return 'cell-5xx'
  if (firstDigit === '3') return 'cell-3xx'
  if (firstDigit === '2') return 'cell-2xx'
  return ''
}

function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > 100) return 100
  return value
}

function formatInt(value: number, language: SupportedLanguage): string {
  return new Intl.NumberFormat(language === 'de' ? 'de-DE' : 'en-US', {
    maximumFractionDigits: 0,
  }).format(value)
}

function formatPct(value: number, language: SupportedLanguage): string {
  return new Intl.NumberFormat(language === 'de' ? 'de-DE' : 'en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value) + ' %'
}

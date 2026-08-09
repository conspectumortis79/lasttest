// Interactive walkthrough popup. Shows four tabbed steps, each
// with a schematic SVG of the corresponding front-end card and a
// list of numbered annotations on the right. The illustrations
// are deliberately schematic: the goal is to map UI zones to
// explanations, not to reproduce a pixel-perfect screenshot.
//
// The data (steps, annotations, colour palette) lives in
// `walkthroughData.ts` so it can be unit-tested without pulling
// in the SVG bodies. This file only renders.
import { useState, type ReactNode } from 'react'
import { translate, type SupportedLanguage } from './i18n.ts'
import { STEPS, ZONE_COLOR, annotationText, type WalkthroughStepId } from './walkthroughData.ts'

/**
 * Selection of the four annotations whose emphasis on the
 * illustration differs. The colour palette is fixed so the same
 * "input zone" reads the same across all four steps.
 */

type UserGuideWalkthroughProps = {
  language: SupportedLanguage
  strings: {
    stepNavAria: string
    prevStep: string
    nextStep: string
  }
}

const VIEW_W = 560
const VIEW_H = 280

function AnnotationBadge({ n, x, y, color }: { n: number; x: number; y: number; color: string }) {
  return <g>
    <circle cx={x} cy={y} r={11} fill={color} stroke="#0b1018" strokeWidth="1.5" />
    <text x={x} y={y + 4} textAnchor="middle" fontSize="13" fontWeight="700" fill="#0b1018">{n}</text>
  </g>
}

function CalloutLine({ x1, y1, x2, y2, color }: { x1: number; y1: number; x2: number; y2: number; color: string }) {
  return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth="1.5" strokeDasharray="3 3" />
}

function Step1Svg() {
  return <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="walk-svg" role="img" aria-label="Step 1 schematic">
    <rect x="6" y="6" width={VIEW_W - 12} height={VIEW_H - 12} rx="8" fill="#121a27d9" stroke="#263348" strokeWidth="1" />
    <circle cx={28} cy={28} r="14" fill="#22304a" />
    <text x={28} y={33} textAnchor="middle" fontSize="14" fontWeight="800" fill="#79e6c8">1</text>
    <text x={56} y={29} fontSize="13" fontWeight="700" fill="#e8edf5">Swagger / OpenAPI Specification</text>
    <text x={56} y={45} fontSize="10" fill="#93a2b8">URL or paste raw YAML/JSON</text>
    <rect x="14" y="60" width="430" height="22" rx="5" fill="#080d14" stroke="#33425b" strokeWidth="1" />
    <text x="22" y="74" fontSize="10" fill="#dbe5f3">https://api.example.com/swagger-ui</text>
    <rect x="14" y="100" width="100" height="22" rx="5" fill="#1a2638" stroke="#233049" strokeWidth="1" />
    <text x="64" y="115" textAnchor="middle" fontSize="10" fill="#dbe5f3">📂 Datei öffnen</text>
    <rect x="124" y="100" width="160" height="22" rx="5" fill="transparent" stroke="#3a2f6e" strokeWidth="1" />
    <text x="204" y="115" textAnchor="middle" fontSize="10" fill="#7d63ff">Validieren & importieren</text>
    <rect x="14" y="135" width={VIEW_W - 28} height="100" rx="5" fill="#080d14" stroke="#33425b" strokeWidth="1" />
    <text x="22" y="152" fontSize="9" fill="#93a2b8" fontFamily="monospace">openapi: 3.0.3</text>
    <text x="22" y="166" fontSize="9" fill="#93a2b8" fontFamily="monospace">info:</text>
    <text x="22" y="180" fontSize="9" fill="#93a2b8" fontFamily="monospace">  title: lasttest demo</text>
    <text x="22" y="194" fontSize="9" fill="#93a2b8" fontFamily="monospace">paths:</text>
    <CalloutLine x1={120} y1={71} x2={180} y2={40} color={ZONE_COLOR.input} />
    <AnnotationBadge n={1} x={180} y={40} color={ZONE_COLOR.input} />
    <CalloutLine x1={204} y1={111} x2={300} y2={65} color={ZONE_COLOR.action} />
    <AnnotationBadge n={2} x={300} y={65} color={ZONE_COLOR.action} />
    <CalloutLine x1={300} y1={150} x2={420} y2={170} color={ZONE_COLOR.output} />
    <AnnotationBadge n={3} x={420} y={170} color={ZONE_COLOR.output} />
    <CalloutLine x1={64} y1={111} x2={140} y2={245} color={ZONE_COLOR.status} />
    <AnnotationBadge n={4} x={140} y={245} color={ZONE_COLOR.status} />
  </svg>
}

function Step2Svg() {
  return <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="walk-svg" role="img" aria-label="Step 2 schematic">
    <rect x="6" y="6" width={VIEW_W - 12} height={VIEW_H - 12} rx="8" fill="#121a27d9" stroke="#263348" strokeWidth="1" />
    <circle cx={28} cy={28} r="14" fill="#22304a" />
    <text x={28} y={33} textAnchor="middle" fontSize="14" fontWeight="800" fill="#79e6c8">2</text>
    <text x={56} y={29} fontSize="13" fontWeight="700" fill="#e8edf5">Endpoints</text>
    <text x={56} y={45} fontSize="10" fill="#93a2b8">Pick the endpoints to drive k6 with</text>
    <rect x="14" y="60" width="160" height="16" rx="4" fill="#080d14" stroke="#33425b" strokeWidth="1" />
    <text x="22" y="71" fontSize="9" fill="#dbe5f3">Server: https://test.k6.io</text>
    <rect x="180" y="60" width="160" height="16" rx="4" fill="#080d14" stroke="#33425b" strokeWidth="1" />
    <text x="188" y="71" fontSize="9" fill="#dbe5f3">Base URL: https://test.k6.io</text>
    <rect x="14" y="84" width="180" height="92" rx="6" fill="#0d1322" stroke="#233049" strokeWidth="1" />
    <rect x="14" y="84" width="3" height="92" fill="#7d63ff" />
    <text x="22" y="98" fontSize="9" fontWeight="800" fill="#7d63ff">⚙ PAYLOAD-STRATEGIE</text>
    <circle cx="22" cy="113" r="3" fill="#7d63ff" />
    <text x="30" y="116" fontSize="9" fill="#fff">Sequential</text>
    <text x="30" y="126" fontSize="8" fill="#93a2b8">Round-robin</text>
    <circle cx="22" cy="143" r="3" fill="none" stroke="#7d63ff" strokeWidth="1" />
    <text x="30" y="146" fontSize="9" fill="#dbe5f3">Random</text>
    <text x="30" y="156" fontSize="8" fill="#93a2b8">Pro Iteration einer aus dem Pool</text>
    <text x="22" y="170" fontSize="8" fill="#93a2b8">Bei nur 1 Payload sind beide Modi identisch.</text>
    <rect x="208" y="84" width={VIEW_W - 222} height="92" rx="4" fill="#0d1322" stroke="#233049" strokeWidth="1" />
    <rect x="216" y="92" width="14" height="14" rx="2" fill="#266a59" />
    <text x="234" y="103" fontSize="9" fontWeight="800" fill="#fff">GET</text>
    <text x="276" y="103" fontSize="9" fontFamily="monospace" fill="#dbe5f3">/</text>
    <rect x="216" y="118" width="14" height="14" rx="2" fill="#765924" />
    <text x="234" y="129" fontSize="9" fontWeight="800" fill="#fff">POST</text>
    <text x="276" y="129" fontSize="9" fontFamily="monospace" fill="#dbe5f3">/api/v1/crocodiles</text>
    <rect x="216" y="144" width="14" height="14" rx="2" fill="#315a83" />
    <text x="234" y="155" fontSize="9" fontWeight="800" fill="#fff">PUT</text>
    <text x="276" y="155" fontSize="9" fontFamily="monospace" fill="#dbe5f3">{`/api/v1/crocodiles/{'{'}{'id}'{'}'}`}</text>
    <CalloutLine x1={94} y1={68} x2={300} y2={40} color={ZONE_COLOR.input} />
    <AnnotationBadge n={1} x={300} y={40} color={ZONE_COLOR.input} />
    <CalloutLine x1={104} y1={130} x2={460} y2={170} color={ZONE_COLOR.action} />
    <AnnotationBadge n={2} x={500} y={200} color={ZONE_COLOR.action} />
    <CalloutLine x1={465} y1={108} x2={500} y2={108} color={ZONE_COLOR.output} />
    <AnnotationBadge n={3} x={500} y={108} color={ZONE_COLOR.output} />
    <CalloutLine x1={250} y1={120} x2={310} y2={245} color={ZONE_COLOR.status} />
    <AnnotationBadge n={4} x={310} y={245} color={ZONE_COLOR.status} />
  </svg>
}

function Step3Svg() {
  return <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="walk-svg" role="img" aria-label="Step 3 schematic">
    <rect x="6" y="6" width={VIEW_W - 12} height={VIEW_H - 12} rx="8" fill="#121a27d9" stroke="#263348" strokeWidth="1" />
    <circle cx={28} cy={28} r="14" fill="#22304a" />
    <text x={28} y={33} textAnchor="middle" fontSize="14" fontWeight="800" fill="#79e6c8">3</text>
    <text x={56} y={29} fontSize="13" fontWeight="700" fill="#e8edf5">Load Profile</text>
    <text x={56} y={45} fontSize="10" fill="#93a2b8">How many virtual users, how long, how fast</text>
    <rect x="14" y="60" width="160" height="100" rx="6" fill="#0d1322" stroke="#233049" strokeWidth="1" />
    <text x="22" y="78" fontSize="9" fill="#93a2b8">Virtual users (VUs)</text>
    <text x="22" y="100" fontSize="22" fontWeight="700" fill="#79e6c8">50</text>
    <text x="22" y="118" fontSize="8" fill="#93a2b8">Concurrent users driving k6</text>
    <rect x="22" y="130" width="40" height="14" rx="3" fill="#233049" />
    <text x="42" y="140" textAnchor="middle" fontSize="8" fill="#dbe5f3">−</text>
    <rect x="68" y="130" width="40" height="14" rx="3" fill="#233049" />
    <text x="88" y="140" textAnchor="middle" fontSize="8" fill="#dbe5f3">+</text>
    <rect x="180" y="60" width="160" height="100" rx="6" fill="#0d1322" stroke="#233049" strokeWidth="1" />
    <text x="188" y="78" fontSize="9" fill="#93a2b8">Duration</text>
    <text x="188" y="100" fontSize="22" fontWeight="700" fill="#79e6c8">2m</text>
    <text x="188" y="118" fontSize="8" fill="#93a2b8">Total run time</text>
    <rect x="346" y="60" width="180" height="100" rx="6" fill="#0d1322" stroke="#233049" strokeWidth="1" />
    <text x="354" y="78" fontSize="9" fill="#93a2b8">Target RPS</text>
    <text x="354" y="100" fontSize="22" fontWeight="700" fill="#79e6c8">200</text>
    <text x="354" y="118" fontSize="8" fill="#93a2b8">Requests per second</text>
    <rect x="14" y="170" width={VIEW_W - 28} height="80" rx="5" fill="#080d14" stroke="#233049" strokeWidth="1" />
    <text x="22" y="184" fontSize="9" fill="#93a2b8">LOAD CURVE</text>
    <path d="M 22 245 L 80 245 L 100 220 L 180 220 L 200 200 L 360 200 L 380 180 L 540 180" stroke="#7d63ff" strokeWidth="2" fill="none" />
    <text x="22" y="200" fontSize="8" fill="#93a2b8">0s</text>
    <text x="540" y="200" textAnchor="end" fontSize="8" fill="#93a2b8">120s</text>
    <CalloutLine x1={94} y1={100} x2={180} y2={220} color={ZONE_COLOR.input} />
    <AnnotationBadge n={1} x={94} y={220} color={ZONE_COLOR.input} />
    <CalloutLine x1={260} y1={100} x2={260} y2={40} color={ZONE_COLOR.action} />
    <AnnotationBadge n={2} x={260} y={40} color={ZONE_COLOR.action} />
    <CalloutLine x1={436} y1={100} x2={460} y2={240} color={ZONE_COLOR.status} />
    <AnnotationBadge n={3} x={460} y={240} color={ZONE_COLOR.status} />
  </svg>
}

function Step4Svg() {
  return <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="walk-svg" role="img" aria-label="Step 4 schematic">
    <rect x="6" y="6" width={VIEW_W - 12} height={VIEW_H - 12} rx="8" fill="#121a27d9" stroke="#263348" strokeWidth="1" />
    <circle cx={28} cy={28} r="14" fill="#22304a" />
    <text x={28} y={33} textAnchor="middle" fontSize="14" fontWeight="800" fill="#79e6c8">4</text>
    <text x={56} y={29} fontSize="13" fontWeight="700" fill="#e8edf5">Test Runs</text>
    <text x="56" y={45} fontSize="10" fill="#93a2b8">Live, terminal and failed runs in one place</text>
    <rect x="14" y="60" width="260" height="40" rx="6" fill="#0d1322" stroke="#233049" strokeWidth="1" />
    <rect x="14" y="60" width="3" height="40" fill="#d4a72c" />
    <rect x="22" y="68" width="28" height="20" rx="3" fill="#266a59" />
    <text x="36" y="82" textAnchor="middle" fontSize="9" fontWeight="800" fill="#fff">GET</text>
    <text x="58" y="80" fontSize="9" fontWeight="800" fill="#d4a72c">RUNNING</text>
    <text x="58" y="92" fontSize="8" fontFamily="monospace" fill="#dbe5f3">/api/v1/crocodiles</text>
    <rect x="14" y="108" width="260" height="40" rx="6" fill="#0d1322" stroke="#233049" strokeWidth="1" />
    <rect x="14" y="108" width="3" height="40" fill="#5a4293" />
    <rect x="22" y="116" width="28" height="20" rx="3" fill="#266a59" />
    <text x="36" y="130" textAnchor="middle" fontSize="9" fontWeight="800" fill="#fff">GET</text>
    <text x="58" y="128" fontSize="9" fontWeight="800" fill="#c5b8ff">STOPPED</text>
    <text x="58" y="140" fontSize="8" fontFamily="monospace" fill="#dbe5f3">/health</text>
    <rect x="284" y="60" width={VIEW_W - 298} height="160" rx="6" fill="#0d1322" stroke="#233049" strokeWidth="1" />
    <text x="292" y="78" fontSize="9" fontWeight="800" fill="#c5b8ff">STOPPED</text>
    <text x="292" y="92" fontSize="8" fill="#93a2b8">Exit-Code 0 · Stopped (SIGTERM) um 14:23</text>
    <rect x="292" y="100" width="220" height="22" rx="3" fill="#1a1d3a" stroke="#5a4293" strokeWidth="1" />
    <text x="302" y="115" fontSize="9" fill="#c5b8ff">Vom Benutzer gestoppt — die geplante Laufzeit wurde nicht erreicht.</text>
    <text x="302" y="140" fontSize="8" fontWeight="800" fill="#93a2b8">METRIKEN</text>
    <text x="302" y="155" fontSize="9" fill="#dbe5f3">Requests 12,841 · p95 182 ms · Fehlerquote 0,5 %</text>
    <text x="302" y="170" fontSize="9" fill="#dbe5f3">Durchsatz 11,83 /s · Daten empfangen 7,27 KiB</text>
    <rect x="292" y="180" width="100" height="20" rx="3" fill="#2a2660" stroke="#7d63ff" strokeWidth="1" />
    <text x="342" y="194" textAnchor="middle" fontSize="9" fontWeight="600" fill="#fff">⛔ Force Abort</text>
    <rect x="402" y="180" width="100" height="20" rx="3" fill="#1a2638" stroke="#233049" strokeWidth="1" />
    <text x="452" y="194" textAnchor="middle" fontSize="9" fill="#dbe5f3">⏹ Stop</text>
    <CalloutLine x1={144} y1={80} x2={300} y2={40} color={ZONE_COLOR.status} />
    <AnnotationBadge n={1} x={300} y={40} color={ZONE_COLOR.status} />
    <CalloutLine x1={450} y1={86} x2={510} y2={130} color={ZONE_COLOR.output} />
    <AnnotationBadge n={2} x={510} y={130} color={ZONE_COLOR.output} />
    <CalloutLine x1={290} y1={200} x2={140} y2={245} color={ZONE_COLOR.action} />
    <AnnotationBadge n={3} x={140} y={245} color={ZONE_COLOR.action} />
    <CalloutLine x1={442} y1={200} x2={420} y2={245} color={ZONE_COLOR.input} />
    <AnnotationBadge n={4} x={420} y={245} color={ZONE_COLOR.input} />
  </svg>
}

// Step 5 — Detailed k6 report (the printable page that opens
// in a new tab). Shows the report header, summary cards,
// thresholds list, the ramp-grafik and the top of the status
// code table. The bottom of the report (script, console, raw
// JSON) is cut off in the schematic — the annotations point
// the user to the User Guide for the full layout.
function Step5Svg() {
  return <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="walk-svg" role="img" aria-label="Step 5 schematic">
    <rect x="6" y="6" width={VIEW_W - 12} height={VIEW_H - 12} rx="8" fill="#121a27d9" stroke="#263348" strokeWidth="1" />
    {/* step badge */}
    <circle cx={28} cy={28} r="14" fill="#22304a" />
    <text x={28} y={33} textAnchor="middle" fontSize="14" fontWeight="800" fill="#79e6c8">5</text>
    <text x={56} y={29} fontSize="13" fontWeight="700" fill="#e8edf5">k6 Test Report</text>
    <text x={56} y={45} fontSize="10" fill="#93a2b8">Printable, opens in a new tab</text>
    {/* status pill in header */}
    <rect x={VIEW_W - 110} y="14" width="92" height="18" rx="9" fill="#1c3a2c" stroke="#2d6a4f" strokeWidth="1" />
    <text x={VIEW_W - 64} y={27} textAnchor="middle" fontSize="9" fontWeight="800" fill="#5fcb95">PASSED</text>
    {/* report card frame */}
    <rect x="14" y="58" width={VIEW_W - 28} height={VIEW_H - 70} rx="5" fill="#080d14" stroke="#33425b" strokeWidth="1" />
    {/* summary cards row */}
    <rect x="22" y="66" width="120" height="34" rx="4" fill="#0d1322" stroke="#233049" strokeWidth="1" />
    <text x="30" y="80" fontSize="8" fill="#93a2b8">DURATION</text>
    <text x="30" y="94" fontSize="13" fontWeight="700" fill="#79e6c8">30 s</text>
    <rect x="148" y="66" width="120" height="34" rx="4" fill="#0d1322" stroke="#233049" strokeWidth="1" />
    <text x="156" y="80" fontSize="8" fill="#93a2b8">REQUESTS</text>
    <text x="156" y="94" fontSize="13" fontWeight="700" fill="#79e6c8">12 345</text>
    <rect x="274" y="66" width="120" height="34" rx="4" fill="#0d1322" stroke="#233049" strokeWidth="1" />
    <text x="282" y="80" fontSize="8" fill="#93a2b8">RATE / s</text>
    <text x="282" y="94" fontSize="13" fontWeight="700" fill="#79e6c8">411</text>
    <rect x="400" y="66" width="140" height="34" rx="4" fill="#0d1322" stroke="#233049" strokeWidth="1" />
    <text x="408" y="80" fontSize="8" fill="#93a2b8">p(95) LATENCY</text>
    <text x="408" y="94" fontSize="13" fontWeight="700" fill="#79e6c8">182 ms</text>
    {/* thresholds block */}
    <text x="22" y="118" fontSize="9" fontWeight="800" fill="#93a2b8">THRESHOLDS</text>
    <rect x="22" y="122" width={VIEW_W - 44} height="26" rx="3" fill="#0d1322" stroke="#233049" strokeWidth="1" />
    <circle cx="34" cy="135" r="3" fill="#5fcb95" />
    <text x="44" y="132" fontSize="9" fill="#dbe5f3">http_req_duration[p(95)&lt;500]</text>
    <text x="44" y="143" fontSize="8" fill="#93a2b8">measured 182 ms</text>
    <circle cx="300" cy="135" r="3" fill="#5fcb95" />
    <text x="310" y="132" fontSize="9" fill="#dbe5f3">checks</text>
    <text x="310" y="143" fontSize="8" fill="#93a2b8">100 % passed</text>
    {/* ramp-grafik block */}
    <text x="22" y="166" fontSize="9" fontWeight="800" fill="#93a2b8">RAMP-GRAFIK (Soll / Ist)</text>
    <rect x="22" y="170" width={VIEW_W - 44} height="44" rx="3" fill="#0d1322" stroke="#233049" strokeWidth="1" />
    {/* Soll line (purple) */}
    <path d="M 30 210 L 100 210 L 130 196 L 250 196 L 280 188 L 380 188 L 410 180 L 540 180" stroke="#7d63ff" strokeWidth="1.6" fill="none" />
    {/* Ist line (orange dashed) */}
    <path d="M 30 210 L 100 210 L 130 196 L 250 196 L 280 188 L 380 188 L 410 180 L 540 180" stroke="#f59e0b" strokeWidth="1.6" fill="none" strokeDasharray="3 3" />
    <text x="30" y="208" fontSize="7" fill="#7d63ff">Soll</text>
    <text x="62" y="208" fontSize="7" fill="#f59e0b">Ist</text>
    {/* status code distribution (peek) */}
    <text x="22" y="230" fontSize="9" fontWeight="800" fill="#93a2b8">STATUS CODE DISTRIBUTION</text>
    <rect x="22" y="234" width={VIEW_W - 44} height="20" rx="3" fill="#0d1322" stroke="#233049" strokeWidth="1" />
    <text x="30" y="247" fontSize="8" fontFamily="monospace" fill="#dbe5f3">GET /api/v1/products</text>
    <text x="180" y="247" fontSize="8" fontFamily="monospace" fill="#5fcb95">200: 12 200</text>
    <text x="270" y="247" fontSize="8" fontFamily="monospace" fill="#fbbf24">429: 30</text>
    <text x="320" y="247" fontSize="8" fontFamily="monospace" fill="#f87171">5xx: 4</text>
    <text x="370" y="247" fontSize="8" fontFamily="monospace" fill="#93a2b8">err: 0</text>
    {/* Annotations */}
    <CalloutLine x1={200} y1={83} x2={300} y2={32} color={ZONE_COLOR.output} />
    <AnnotationBadge n={1} x={300} y={32} color={ZONE_COLOR.output} />
    <CalloutLine x1={300} y1={135} x2={450} y2={48} color={ZONE_COLOR.status} />
    <AnnotationBadge n={2} x={450} y={48} color={ZONE_COLOR.status} />
    <CalloutLine x1={300} y1={192} x2={460} y2={260} color={ZONE_COLOR.action} />
    <AnnotationBadge n={3} x={460} y={260} color={ZONE_COLOR.action} />
    <CalloutLine x1={300} y1={244} x2={530} y2={270} color={ZONE_COLOR.input} />
    <AnnotationBadge n={4} x={530} y={270} color={ZONE_COLOR.input} />
  </svg>
}

const SVG_RENDERERS: Record<WalkthroughStepId, () => ReactNode> = {
  step1: Step1Svg,
  step2: Step2Svg,
  step3: Step3Svg,
  step4: Step4Svg,
  step5: Step5Svg,
}

export function UserGuideWalkthrough({ language, strings }: UserGuideWalkthroughProps) {
  const [activeId, setActiveId] = useState<WalkthroughStepId>('step1')
  const active = STEPS.find(s => s.id === activeId) ?? STEPS[0]!
  const Renderer = SVG_RENDERERS[activeId]
  const idx = STEPS.findIndex(s => s.id === activeId)
  const prevId = idx > 0 ? STEPS[idx - 1]!.id : null
  const nextId = idx < STEPS.length - 1 ? STEPS[idx + 1]!.id : null
  const prevTitle = prevId ? STEPS.find(s => s.id === prevId)?.titleKey : null
  const nextTitle = nextId ? STEPS.find(s => s.id === nextId)?.titleKey : null

  return <div className="walkthrough">
    <nav className="walkthrough-tabs" role="tablist" aria-label={strings.stepNavAria}>
      {STEPS.map(step => (
        <button
          key={step.id}
          type="button"
          role="tab"
          aria-selected={step.id === activeId}
          className={`walkthrough-tab ${step.id === activeId ? 'is-active' : ''}`}
          onClick={() => setActiveId(step.id)}
        >
          <span className="walkthrough-tab-num">{step.id.replace('step', '')}</span>
          <span className="walkthrough-tab-label">{translate(language, step.titleKey)}</span>
        </button>
      ))}
    </nav>

    <div className="walkthrough-stage" role="tabpanel">
      <h3 className="walkthrough-title">{translate(language, active.titleKey)}</h3>
      <p className="walkthrough-intro">{translate(language, active.introKey)}</p>
      <div className="walkthrough-grid">
        <div className="walkthrough-illustration">{Renderer()}</div>
        <ol className="walkthrough-annotations">
          {active.annotations.map(ann => {
            const { title, body } = annotationText(language, ann)
            return <li key={ann.n} className="walkthrough-ann">
              <span className="walkthrough-ann-n">{ann.n}</span>
              <div className="walkthrough-ann-body">
                <strong>{title}</strong>
                <span>{body}</span>
              </div>
            </li>
          })}
        </ol>
      </div>
      <div className="walkthrough-nav">
        <button
          type="button"
          className="walkthrough-nav-btn"
          disabled={prevId === null}
          onClick={() => prevId && setActiveId(prevId)}
        >
          ← {prevTitle ? translate(language, prevTitle) : ''}
        </button>
        <button
          type="button"
          className="walkthrough-nav-btn is-primary"
          disabled={nextId === null}
          onClick={() => nextId && setActiveId(nextId)}
        >
          {nextTitle ? translate(language, nextTitle) : ''} →
        </button>
      </div>
    </div>
  </div>
}

export type WalkthroughStrings = UserGuideWalkthroughProps['strings']

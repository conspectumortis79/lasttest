// Interactive walkthrough popup. Shows tabbed steps, each
// with one or two schematic SVGs of the corresponding front-end
// card and a list of numbered annotations on the right. The
// illustrations are deliberately schematic: the goal is to map
// UI zones to explanations, not to reproduce a pixel-perfect
// screenshot.
//
// Step 4 ("Test Runs") is the only step that carries two
// stacked SVGs (the Letzte Läufe row list and the run detail
// tab strip). The data driven approach is `step.secondarySvg`
// in [walkthroughData.ts]; the renderer looks the secondary
// SVG up in [SECONDARY_SVG_RENDERERS] and stacks it below the
// primary one. The illustration column is capped at "max 2
// SVGs per step" by the design constraint documented in
// `walkthroughData.ts`.
//
// All steps are rendered into the DOM at all times (with the
// inactive ones hidden via the `hidden` attribute) so the
// DocPopup search can scan every step's text content and
// switch to the step that contains the match. Each step
// container carries a `data-step` attribute that the search
// uses to map a highlighted `<mark>` back to its owning step.
import { useEffect, useState, type ReactNode } from 'react'
import { translate, type SupportedLanguage } from './i18n.ts'
import { STEPS, ZONE_COLOR, annotationText, type WalkthroughStepId } from './walkthroughData.ts'

type UserGuideWalkthroughProps = {
  language: SupportedLanguage
  // Localised strings used by the modal chrome itself.
  strings: {
    stepNavAria: string
    prevStep: string
    nextStep: string
  }
  // When set to a step id, the walkthrough switches its active
  // step to that id. Used by the DocPopup search to reveal a
  // step that contains a match. The prop is one-way: the
  // walkthrough reacts to changes via a useEffect, then keeps
  // managing its own state when the user clicks tabs.
  focusStepId?: WalkthroughStepId | null
  // Fires whenever the active step changes — either because the
  // user clicked a tab, hit the prev/next button, or because
  // `focusStepId` triggered a switch. The DocPopup uses this to
  // know which step is currently visible so it can skip the
  // step-switch round-trip when the match is already in the
  // active step.
  onActiveStepChange?: (id: WalkthroughStepId) => void
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

// Step 1 — Swagger / OpenAPI card
function Step1Svg() {
  return <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="walk-svg" role="img" aria-label="Step 1 schematic">
    {/* card frame */}
    <rect x="6" y="6" width={VIEW_W - 12} height={VIEW_H - 12} rx="8" fill="#121a27d9" stroke="#263348" strokeWidth="1" />
    {/* step badge */}
    <circle cx={28} cy={28} r="14" fill="#22304a" />
    <text x={28} y={33} textAnchor="middle" fontSize="14" fontWeight="800" fill="#79e6c8">1</text>
    <text x={56} y={29} fontSize="13" fontWeight="700" fill="#e8edf5">Swagger / OpenAPI Specification</text>
    <text x={56} y={45} fontSize="10" fill="#93a2b8">URL or paste raw YAML/JSON</text>
    {/* URL input */}
    <rect x="14" y="60" width="430" height="22" rx="5" fill="#080d14" stroke="#33425b" strokeWidth="1" />
    <text x="22" y="74" fontSize="10" fill="#dbe5f3">https://api.example.com/swagger-ui</text>
    {/* Action buttons */}
    <rect x="14" y="100" width="100" height="22" rx="5" fill="#1a2638" stroke="#233049" strokeWidth="1" />
    <text x="64" y="115" textAnchor="middle" fontSize="10" fill="#dbe5f3">📂 Datei öffnen</text>
    <rect x="124" y="100" width="160" height="22" rx="5" fill="transparent" stroke="#3a2f6e" strokeWidth="1" />
    <text x="204" y="115" textAnchor="middle" fontSize="10" fill="#7d63ff">Validieren & importieren</text>
    {/* Textarea */}
    <rect x="14" y="135" width={VIEW_W - 28} height="100" rx="5" fill="#080d14" stroke="#33425b" strokeWidth="1" />
    <text x="22" y="152" fontSize="9" fill="#93a2b8" fontFamily="monospace">openapi: 3.0.3</text>
    <text x="22" y="166" fontSize="9" fill="#93a2b8" fontFamily="monospace">info:</text>
    <text x="22" y="180" fontSize="9" fill="#93a2b8" fontFamily="monospace">  title: lasttest demo</text>
    <text x="22" y="194" fontSize="9" fill="#93a2b8" fontFamily="monospace">paths:</text>
    {/* Annotations */}
    <CalloutLine x1={120} y1={71} x2={180} y2={40} color={ZONE_COLOR.input} />
    <AnnotationBadge n={1} x={180} y={40} color={ZONE_COLOR.input} />
    <CalloutLine x1={204} y1={111} x2={300} y2={65} color={ZONE_COLOR.action} />
    <AnnotationBadge n={2} x={300} y={65} color={ZONE_COLOR.action} />
    <CalloutLine x1={300} y1={150} x2={420} y2={170} color={ZONE_COLOR.output} />
    <AnnotationBadge n={3} x={420} y={170} color={ZONE_COLOR.output} />
    <CalloutLine x1={64} y1={111} x2={140} y2={245} color={ZONE_COLOR.status} />
    <AnnotationBadge n={4} x={140} y={245} color={ZONE_COLOR.status} />
    {/* Annotation 5 — custom TLS certificate. Points at the URL
        input (the first place a TLS handshake fails when the
        target uses an internal / self-signed CA) and lands at
        the bottom-right of the card where the other badges are
        not. */}
    <CalloutLine x1={440} y1={71} x2={495} y2={245} color={ZONE_COLOR.status} />
    <AnnotationBadge n={5} x={495} y={245} color={ZONE_COLOR.status} />
  </svg>
}

// Step 2 — Endpoints card
function Step2Svg() {
  return <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="walk-svg" role="img" aria-label="Step 2 schematic">
    <rect x="6" y="6" width={VIEW_W - 12} height={VIEW_H - 12} rx="8" fill="#121a27d9" stroke="#263348" strokeWidth="1" />
    <circle cx={28} cy={28} r="14" fill="#22304a" />
    <text x={28} y={33} textAnchor="middle" fontSize="14" fontWeight="800" fill="#79e6c8">2</text>
    <text x={56} y={29} fontSize="13" fontWeight="700" fill="#e8edf5">Endpoints</text>
    <text x={56} y={45} fontSize="10" fill="#93a2b8">Pick the endpoints to drive k6 with</text>
    {/* server selector */}
    <rect x="14" y="60" width="160" height="16" rx="4" fill="#080d14" stroke="#33425b" strokeWidth="1" />
    <text x="22" y="71" fontSize="9" fill="#dbe5f3">Server: https://test.k6.io</text>
    <rect x="180" y="60" width="160" height="16" rx="4" fill="#080d14" stroke="#33425b" strokeWidth="1" />
    <text x="188" y="71" fontSize="9" fill="#dbe5f3">Base URL: https://test.k6.io</text>
    {/* Strategy box */}
    <rect x="14" y="84" width="180" height="92" rx="6" fill="#0d1322" stroke="#233049" strokeWidth="1" strokeDasharray="0" />
    <rect x="14" y="84" width="3" height="92" fill="#7d63ff" />
    <text x="22" y="98" fontSize="9" fontWeight="800" fill="#7d63ff">⚙ PAYLOAD-STRATEGIE</text>
    <circle cx="22" cy="113" r="3" fill="#7d63ff" />
    <text x="30" y="116" fontSize="9" fill="#fff">Sequential</text>
    <text x="30" y="126" fontSize="8" fill="#93a2b8">Round-robin</text>
    <circle cx="22" cy="143" r="3" fill="none" stroke="#7d63ff" strokeWidth="1" />
    <text x="30" y="146" fontSize="9" fill="#dbe5f3">Random</text>
    <text x="30" y="156" fontSize="8" fill="#93a2b8">Pro Iteration einer aus dem Pool</text>
    <text x="22" y="170" fontSize="8" fill="#93a2b8">Bei nur 1 Payload sind beide Modi identisch.</text>
    {/* Operation list */}
    <rect x="208" y="84" width={VIEW_W - 222} height="92" rx="4" fill="#0d1322" stroke="#233049" strokeWidth="1" />
    <rect x="216" y="92" width="14" height="14" rx="2" fill="#266a59" />
    <text x="234" y="103" fontSize="9" fontWeight="800" fill="#fff">GET</text>
    <text x="276" y="103" fontSize="9" fontFamily="monospace" fill="#dbe5f3">/</text>
    <rect x="216" y="118" width="14" height="14" rx="2" fill="#765924" />
    <text x="234" y="129" fontSize="9" fontWeight="800" fill="#fff">POST</text>
    <text x="276" y="129" fontSize="9" fontFamily="monospace" fill="#dbe5f3">/api/v1/crocodiles</text>
    <rect x="216" y="144" width="14" height="14" rx="2" fill="#315a83" />
    <text x="234" y="155" fontSize="9" fontWeight="800" fill="#fff">PUT</text>
    <text x="276" y="155" fontSize="9" fontFamily="monospace" fill="#dbe5f3">/api/v1/crocodiles/{'{id}'}</text>
    {/* Annotations */}
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

// Step 3 — Load profile card
function Step3Svg() {
  return <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="walk-svg" role="img" aria-label="Step 3 schematic">
    <rect x="6" y="6" width={VIEW_W - 12} height={VIEW_H - 12} rx="8" fill="#121a27d9" stroke="#263348" strokeWidth="1" />
    <circle cx={28} cy={28} r="14" fill="#22304a" />
    <text x={28} y={33} textAnchor="middle" fontSize="14" fontWeight="800" fill="#79e6c8">3</text>
    <text x={56} y={29} fontSize="13" fontWeight="700" fill="#e8edf5">Load Profile</text>
    <text x={56} y={45} fontSize="10" fill="#93a2b8">Pick a preset or tune VUs, duration & RPS</text>
    {/* Preset row */}
    <rect x="14" y="60" width={VIEW_W - 28} height="22" rx="5" fill="#0d1322" stroke="#233049" strokeWidth="1" />
    <text x="22" y="74" fontSize="9" fontWeight="800" fill="#93a2b8">PRESET</text>
    <rect x="80" y="65" width="44" height="13" rx="6" fill="#2a2660" stroke="#7d63ff" strokeWidth="0.8" />
    <text x="102" y="74" textAnchor="middle" fontSize="8" fontWeight="700" fill="#fff">Smoke</text>
    <rect x="128" y="65" width="44" height="13" rx="6" fill="transparent" stroke="#233049" strokeWidth="0.8" />
    <text x="150" y="74" textAnchor="middle" fontSize="8" fill="#dbe5f3">Load</text>
    <rect x="176" y="65" width="44" height="13" rx="6" fill="transparent" stroke="#233049" strokeWidth="0.8" />
    <text x="198" y="74" textAnchor="middle" fontSize="8" fill="#dbe5f3">Stress</text>
    <rect x="224" y="65" width="44" height="13" rx="6" fill="transparent" stroke="#233049" strokeWidth="0.8" />
    <text x="246" y="74" textAnchor="middle" fontSize="8" fill="#dbe5f3">Spike</text>
    <rect x="272" y="65" width="44" height="13" rx="6" fill="transparent" stroke="#233049" strokeWidth="0.8" />
    <text x="294" y="74" textAnchor="middle" fontSize="8" fill="#dbe5f3">Soak</text>
    <rect x="320" y="65" width="44" height="13" rx="6" fill="transparent" stroke="#233049" strokeWidth="0.8" />
    <text x="342" y="74" textAnchor="middle" fontSize="8" fill="#dbe5f3">Burst</text>
    <rect x="368" y="65" width="62" height="13" rx="6" fill="transparent" stroke="#233049" strokeWidth="0.8" />
    <text x="399" y="74" textAnchor="middle" fontSize="8" fill="#dbe5f3">Arrival-Rate</text>
    {/* Type pill */}
    <rect x="438" y="65" width="104" height="13" rx="6" fill="transparent" stroke="#7d63ff" strokeWidth="0.8" />
    <text x="490" y="74" textAnchor="middle" fontSize="8" fill="#7d63ff">constant-vus</text>
    {/* Three knobs */}
    <rect x="14" y="90" width="160" height="74" rx="6" fill="#0d1322" stroke="#233049" strokeWidth="1" />
    <text x="22" y="106" fontSize="9" fill="#93a2b8">Virtual users (VUs)</text>
    <text x="22" y="126" fontSize="20" fontWeight="700" fill="#79e6c8">50</text>
    <text x="22" y="142" fontSize="8" fill="#93a2b8">Parallel users hammering k6</text>
    <rect x="22" y="150" width="32" height="11" rx="3" fill="#233049" />
    <text x="38" y="158" textAnchor="middle" fontSize="8" fill="#dbe5f3">−</text>
    <rect x="58" y="150" width="32" height="11" rx="3" fill="#233049" />
    <text x="74" y="158" textAnchor="middle" fontSize="8" fill="#dbe5f3">+</text>
    <rect x="180" y="90" width="160" height="74" rx="6" fill="#0d1322" stroke="#233049" strokeWidth="1" />
    <text x="188" y="106" fontSize="9" fill="#93a2b8">Duration</text>
    <text x="188" y="126" fontSize="20" fontWeight="700" fill="#79e6c8">2m</text>
    <text x="188" y="142" fontSize="8" fill="#93a2b8">Total run time</text>
    <rect x="346" y="90" width="180" height="74" rx="6" fill="#0d1322" stroke="#233049" strokeWidth="1" />
    <text x="354" y="106" fontSize="9" fill="#93a2b8">Target RPS</text>
    <text x="354" y="126" fontSize="20" fontWeight="700" fill="#79e6c8">200</text>
    <text x="354" y="142" fontSize="8" fill="#93a2b8">Requests per second (0 = open)</text>
    {/* Ramp chart */}
    <rect x="14" y="172" width={VIEW_W - 28} height="68" rx="5" fill="#080d14" stroke="#233049" strokeWidth="1" />
    <text x="22" y="186" fontSize="9" fill="#93a2b8">LOAD CURVE</text>
    <path d="M 22 234 L 80 234 L 100 216 L 180 216 L 200 200 L 360 200 L 380 184 L 540 184" stroke="#7d63ff" strokeWidth="2" fill="none" />
    <text x="22" y="200" fontSize="8" fill="#93a2b8">0s</text>
    <text x="540" y="200" textAnchor="end" fontSize="8" fill="#93a2b8">120s</text>
    <text x="22" y="222" fontSize="8" fill="#93a2b8">Stages / Arrival-Rate wechseln das Schema</text>
    {/* Annotations */}
    <CalloutLine x1={94} y1={126} x2={260} y2={20} color={ZONE_COLOR.input} />
    <AnnotationBadge n={1} x={160} y={20} color={ZONE_COLOR.input} />
    <CalloutLine x1={260} y1={126} x2={300} y2={20} color={ZONE_COLOR.action} />
    <AnnotationBadge n={2} x={300} y={20} color={ZONE_COLOR.action} />
    <CalloutLine x1={436} y1={126} x2={460} y2={258} color={ZONE_COLOR.status} />
    <AnnotationBadge n={3} x={460} y={258} color={ZONE_COLOR.status} />
  </svg>
}

// Step 4 primary — the Letzte Läufe row list. Replaces the
// old badge grid that the project shipped before the
// LastRunsPanel release. The row shows the status stripe, the
// method + path, the × N test counter, the meta line, the
// elapsed/planned duration and the relative "when" stamp.
// Annotations 1–4 in [walkthroughData.ts] point at this SVG.
function Step4Svg() {
  return <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="walk-svg" role="img" aria-label="Step 4 schematic — Letzte Läufe row list">
    <rect x="6" y="6" width={VIEW_W - 12} height={VIEW_H - 12} rx="8" fill="#121a27d9" stroke="#263348" strokeWidth="1" />
    <circle cx={28} cy={28} r="14" fill="#22304a" />
    <text x={28} y={33} textAnchor="middle" fontSize="14" fontWeight="800" fill="#79e6c8">4</text>
    <text x={56} y={29} fontSize="13" fontWeight="700" fill="#e8edf5">Letzte Läufe</text>
    <text x={56} y={45} fontSize="10" fill="#93a2b8">Every run of this session, newest first</text>
    {/* Header line */}
    <text x="20" y="64" fontSize="9" fontWeight="800" fill="#93a2b8">RECENT RUNS</text>
    <rect x={VIEW_W - 94} y="56" width="80" height="14" rx="3" fill="#111b29" stroke="#2c3a52" strokeWidth="1" />
    <text x={VIEW_W - 54} y="66" textAnchor="middle" fontSize="9" fill="#93a2b8">Filter</text>
    <line x1="20" y1="74" x2={VIEW_W - 20} y2="74" stroke="#2c3a52" strokeWidth="1" />
    {/* Row 1 — COMPLETED (active row) */}
    <rect x="20" y="80" width={VIEW_W - 40} height="42" rx="4" fill="#15233a" stroke="#2c3a52" strokeWidth="1" />
    <rect x="20" y="80" width="3" height="42" fill="#22c55e" />
    <circle cx="36" cy="101" r="4" fill="#22c55e" />
    <rect x="48" y="92" width="32" height="14" rx="3" fill="#0b3a25" stroke="#22c55e" strokeWidth="0.8" />
    <text x="64" y="102" textAnchor="middle" fontSize="8" fontWeight="800" fill="#8fe8c1">GET</text>
    <rect x="86" y="92" width="76" height="14" rx="8" fill="#0d3320" />
    <text x="124" y="102" textAnchor="middle" fontSize="8" fontWeight="800" fill="#8fe8c1">COMPLETED</text>
    <text x="170" y="102" fontSize="9" fontFamily="monospace" fill="#dbe5f3">/products/me</text>
    <rect x="284" y="92" width="32" height="14" rx="3" fill="#1f2a3d" />
    <text x="300" y="102" textAnchor="middle" fontSize="9" fill="#93a2b8">× 4</text>
    <text x="170" y="115" fontSize="9" fill="#93a2b8">10 VUs · 30 s · <tspan fill="#fb923c">right-click</tspan> for actions</text>
    <text x="460" y="100" textAnchor="end" fontSize="9" fontFamily="monospace" fill="#dbe5f3">00:32 / ~00:30</text>
    <text x="528" y="100" textAnchor="end" fontSize="9" fill="#93a2b8">just now</text>
    {/* Row 2 — RUNNING */}
    <rect x="20" y="128" width={VIEW_W - 40} height="42" rx="4" fill="#0d1322" stroke="#2c3a52" strokeWidth="1" />
    <rect x="20" y="128" width="3" height="42" fill="#fb923c" />
    <circle cx="36" cy="149" r="4" fill="#fb923c" />
    <rect x="48" y="140" width="36" height="14" rx="3" fill="#3a2a0b" stroke="#fb923c" strokeWidth="0.8" />
    <text x="66" y="150" textAnchor="middle" fontSize="8" fontWeight="800" fill="#fb923c">POST</text>
    <rect x="90" y="140" width="60" height="14" rx="8" fill="#3a2a0b" />
    <text x="120" y="150" textAnchor="middle" fontSize="8" fontWeight="800" fill="#fb923c">RUNNING …</text>
    <text x="158" y="150" fontSize="9" fontFamily="monospace" fill="#dbe5f3">/products/search</text>
    <rect x="284" y="140" width="32" height="14" rx="3" fill="#1f2a3d" />
    <text x="300" y="150" textAnchor="middle" fontSize="9" fill="#93a2b8">× 7</text>
    <text x="158" y="163" fontSize="9" fill="#93a2b8">20 VUs · 60 s · <tspan fill="#fb923c">right-click</tspan> for actions</text>
    <text x="460" y="148" textAnchor="end" fontSize="9" fontFamily="monospace" fill="#dbe5f3">00:18 / ~01:00</text>
    <text x="528" y="148" textAnchor="end" fontSize="9" fill="#93a2b8">2 min ago</text>
    {/* Row 3 — FAILED */}
    <rect x="20" y="176" width={VIEW_W - 40} height="42" rx="4" fill="#0d1322" stroke="#2c3a52" strokeWidth="1" />
    <rect x="20" y="176" width="3" height="42" fill="#ef4444" />
    <circle cx="36" cy="197" r="4" fill="#ef4444" />
    <rect x="48" y="188" width="32" height="14" rx="3" fill="#3a0b0b" stroke="#ef4444" strokeWidth="0.8" />
    <text x="64" y="198" textAnchor="middle" fontSize="8" fontWeight="800" fill="#ffb5c3">GET</text>
    <rect x="86" y="188" width="60" height="14" rx="8" fill="#3a0b0b" />
    <text x="116" y="198" textAnchor="middle" fontSize="8" fontWeight="800" fill="#ffb5c3">FAILED</text>
    <text x="154" y="198" fontSize="9" fontFamily="monospace" fill="#dbe5f3">/products/admin/stats</text>
    <rect x="334" y="188" width="32" height="14" rx="3" fill="#1f2a3d" />
    <text x="350" y="198" textAnchor="middle" fontSize="9" fill="#93a2b8">× 2</text>
    <text x="154" y="211" fontSize="9" fill="#93a2b8">10 VUs · 30 s · <tspan fill="#fb923c">right-click</tspan> for actions</text>
    <text x="460" y="196" textAnchor="end" fontSize="9" fontFamily="monospace" fill="#dbe5f3">exit 1</text>
    <text x="528" y="196" textAnchor="end" fontSize="9" fill="#93a2b8">5 min ago</text>
    {/* Footer hint */}
    <text x="20" y="238" fontSize="9" fill="#93a2b8">Click = focus · Right-click = actions menu</text>
    <text x={VIEW_W - 20} y="238" textAnchor="end" fontSize="9" fill="#7d63ff">Items adapt to status</text>
    {/* Annotations 1–4 */}
    <CalloutLine x1={70} y1={101} x2={50} y2={40} color={ZONE_COLOR.status} />
    <AnnotationBadge n={1} x={50} y={40} color={ZONE_COLOR.status} />
    <CalloutLine x1={300} y1={102} x2={420} y2={40} color={ZONE_COLOR.output} />
    <AnnotationBadge n={2} x={420} y={40} color={ZONE_COLOR.output} />
    <CalloutLine x1={460} y1={100} x2={500} y2={265} color={ZONE_COLOR.input} />
    <AnnotationBadge n={3} x={500} y={265} color={ZONE_COLOR.input} />
    <CalloutLine x1={460} y1={128} x2={100} y2={265} color={ZONE_COLOR.action} />
    <AnnotationBadge n={4} x={100} y={265} color={ZONE_COLOR.action} />
  </svg>
}

// Step 4 secondary — the run detail tab strip plus a peek at
// the Übersicht tab body. The card and the tab strip are the
// new addition since the LastRunsPanel rewrite: the run
// detail is now a tab strip with 9 entries (8 tabs + the
// external "k6-Bericht öffnen" open-in-new-tab affordance).
// The body under the strip shows the Übersicht tab summary so
// the user sees where the live ramp chart lives. Annotations
// 5–8 in [walkthroughData.ts] point at this SVG.
function Step4DetailSvg() {
  return <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="walk-svg" role="img" aria-label="Step 4 schematic — run detail tab strip">
    <rect x="6" y="6" width={VIEW_W - 12} height={VIEW_H - 12} rx="8" fill="#121a27d9" stroke="#263348" strokeWidth="1" />
    <circle cx={28} cy={28} r="14" fill="#22304a" />
    <text x={28} y={33} textAnchor="middle" fontSize="14" fontWeight="800" fill="#79e6c8">4b</text>
    <text x={56} y={29} fontSize="13" fontWeight="700" fill="#e8edf5">Run-Detail: Tab strip</text>
    <text x={56} y={45} fontSize="10" fill="#93a2b8">8 tabs + ext. k6 report — Overview is default</text>
    {/* Tab strip */}
    <rect x="14" y="58" width={VIEW_W - 28} height="22" rx="4" fill="#0d1322" stroke="#233049" strokeWidth="1" />
    {/* Active tab: Overview */}
    <rect x="20" y="62" width="60" height="14" rx="2" fill="#2a2660" stroke="#7d63ff" strokeWidth="1" />
    <text x="50" y="72" textAnchor="middle" fontSize="9" fontWeight="700" fill="#fff">Overview</text>
    {/* Other tabs (from the RunDetail tab list in App.tsx) */}
    <text x="88" y="72" textAnchor="middle" fontSize="9" fill="#93a2b8">Timeline</text>
    <text x="138" y="72" textAnchor="middle" fontSize="9" fill="#93a2b8">Actions</text>
    <text x="187" y="72" textAnchor="middle" fontSize="9" fill="#93a2b8">k6 console</text>
    <text x="247" y="72" textAnchor="middle" fontSize="9" fill="#93a2b8">Thresholds</text>
    <text x="298" y="72" textAnchor="middle" fontSize="9" fill="#93a2b8">Config</text>
    <text x="335" y="72" textAnchor="middle" fontSize="9" fill="#f87171">Failure</text>
    <text x="382" y="72" textAnchor="middle" fontSize="9" fill="#93a2b8">k6 script</text>
    <text x="442" y="72" textAnchor="middle" fontSize="9" fill="#7d63ff">↗ k6 report</text>
    {/* Tab body — Overview preview */}
    <rect x="14" y="86" width={VIEW_W - 28} height={VIEW_H - 100} rx="4" fill="#080d14" stroke="#33425b" strokeWidth="1" />
    {/* Summary row */}
    <rect x="20" y="92" width="120" height="28" rx="3" fill="#0d1322" stroke="#233049" strokeWidth="1" />
    <text x="28" y="103" fontSize="8" fill="#93a2b8">DURATION</text>
    <text x="28" y="115" fontSize="11" fontWeight="700" fill="#79e6c8">00:32 / 00:30</text>
    <rect x="146" y="92" width="120" height="28" rx="3" fill="#0d1322" stroke="#233049" strokeWidth="1" />
    <text x="154" y="103" fontSize="8" fill="#93a2b8">EXIT CODE</text>
    <text x="154" y="115" fontSize="11" fontWeight="700" fill="#8fe8c1">0</text>
    <rect x="272" y="92" width="120" height="28" rx="3" fill="#0d1322" stroke="#233049" strokeWidth="1" />
    <text x="280" y="103" fontSize="8" fill="#93a2b8">STATUS</text>
    <text x="280" y="115" fontSize="11" fontWeight="700" fill="#8fe8c1">COMPLETED</text>
    <rect x="398" y="92" width="142" height="28" rx="3" fill="#0d1322" stroke="#233049" strokeWidth="1" />
    <text x="406" y="103" fontSize="8" fill="#93a2b8">ENDPOINTS</text>
    <text x="406" y="115" fontSize="11" fontWeight="700" fill="#79e6c8">3 · 12 841 req</text>
    {/* Ramp chart */}
    <text x="20" y="136" fontSize="9" fontWeight="800" fill="#93a2b8">LOAD (target / actual)</text>
    <rect x="20" y="140" width={VIEW_W - 40} height="48" rx="3" fill="#0d1322" stroke="#233049" strokeWidth="1" />
    <path d="M 28 184 L 100 184 L 130 170 L 250 170 L 280 162 L 400 162 L 430 154 L 540 154" stroke="#7d63ff" strokeWidth="1.6" fill="none" />
    <path d="M 28 184 L 100 184 L 130 170 L 250 170 L 280 162 L 400 162 L 430 154 L 540 154" stroke="#f59e0b" strokeWidth="1.6" fill="none" strokeDasharray="3 3" />
    <text x="32" y="155" fontSize="7" fill="#7d63ff">target</text>
    <text x="60" y="155" fontSize="7" fill="#f59e0b">actual</text>
    <text x="530" y="186" textAnchor="end" fontSize="7" fill="#93a2b8">120 s</text>
    {/* Hint under chart */}
    <text x="20" y="206" fontSize="9" fill="#93a2b8">Live polls /time-series only while RUNNING — finished runs are silent on the wire.</text>
    {/* Annotations 5–8 */}
    <CalloutLine x1={50} y1={69} x2={50} y2={30} color={ZONE_COLOR.input} />
    <AnnotationBadge n={5} x={50} y={30} color={ZONE_COLOR.input} />
    <CalloutLine x1={300} y1={106} x2={420} y2={30} color={ZONE_COLOR.output} />
    <AnnotationBadge n={6} x={420} y={30} color={ZONE_COLOR.output} />
    <CalloutLine x1={200} y1={72} x2={300} y2={265} color={ZONE_COLOR.action} />
    <AnnotationBadge n={7} x={300} y={265} color={ZONE_COLOR.action} />
    <CalloutLine x1={442} y1={72} x2={140} y2={265} color={ZONE_COLOR.status} />
    <AnnotationBadge n={8} x={140} y={265} color={ZONE_COLOR.status} />
    {/* Annotation 9 — free-floating callout that documents the
        timeline encryption-at-rest policy. Lands in the only
        empty corner of the secondary SVG (the gap between
        badges 6 and 7 on the right side); the callout line
        points at the bottom-right of the run-detail tab strip
        body so the user reads it as "everything below this line
        is encrypted on disk". */}
    <CalloutLine x1={470} y1={220} x2={510} y2={248} color={ZONE_COLOR.status} />
    <AnnotationBadge n={9} x={510} y={248} color={ZONE_COLOR.status} />
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

// Secondary SVG renderers keyed by the value of
// [WalkthroughStep.secondarySvg]. A step is only listed here
// when its [walkthroughData.ts] entry sets `secondarySvg`. The
// lookup uses a literal "step4-detail" key today so adding a
// new secondary illustration is a one-line edit in two files.
const SECONDARY_SVG_RENDERERS: Record<'step4-detail', () => ReactNode> = {
  'step4-detail': Step4DetailSvg,
}

export function UserGuideWalkthrough({ language, strings, focusStepId, onActiveStepChange }: UserGuideWalkthroughProps) {
  const [activeId, setActiveId] = useState<WalkthroughStepId>('step1')

  // React to an external focus request (from the DocPopup search)
  // by switching the active step. The effect runs only when
  // `focusStepId` changes, so a no-op (same value) does not cause
  // an extra re-render of the walkthrough body.
  useEffect(() => {
    if (focusStepId && focusStepId !== activeId) {
      setActiveId(focusStepId)
    }
  }, [focusStepId, activeId])

  // Notify the parent of every active-step change, including the
  // one triggered by the focus effect above. The parent uses this
  // to avoid a redundant step-switch round-trip on subsequent
  // search hits.
  useEffect(() => {
    onActiveStepChange?.(activeId)
  }, [activeId, onActiveStepChange])

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

    {/*
      Every step is rendered into the DOM so the DocPopup search
      can scan every tab's text at once. The inactive ones carry
      the `hidden` attribute (which maps to `display: none` in
      user-agent stylesheets) so they take no space and the
      search's scrollIntoView lands on the visible step's match
      after the focus effect flips the active id.

      A step that sets `secondarySvg` gets a second SVG stacked
      below its primary one. Both SVGs share the same
      aspect-ratio / max-height rules in
      `.walkthrough-illustration` so the visual cap stays
      consistent across the five steps.

      A step that sets `securityNoteKey` gets a second
      paragraph rendered right under the intro — the
      "important additional information" callout. The note is
      opt-in per step so the other steps keep their current
      shape and the security callout does not leak into UI
      surfaces that do not need it.
    */}
    {STEPS.map(step => {
      const Renderer = SVG_RENDERERS[step.id]
      const SecondaryRenderer = step.secondarySvg ? SECONDARY_SVG_RENDERERS[step.secondarySvg] : null
      const isActive = step.id === activeId
      return <div
        key={step.id}
        data-step={step.id}
        className="walkthrough-stage"
        role="tabpanel"
        hidden={!isActive}
        aria-hidden={isActive ? 'false' : 'true'}
      >
        <h3 className="walkthrough-title">{translate(language, step.titleKey)}</h3>
        <p className="walkthrough-intro">{translate(language, step.introKey)}</p>
        {/* The security callout carries a dedicated CSS class
            so it can be styled as a prominent, attention-grabbing
            block (border, background tint) without affecting the
            plain `.walkthrough-intro` paragraph that every step
            uses for its primary copy. */}
        {step.securityNoteKey && (
          <p className="walkthrough-security-note">
            {translate(language, step.securityNoteKey)}
          </p>
        )}
        <div className="walkthrough-grid">
          <div className="walkthrough-illustration">
            <div className="walkthrough-illustration-stack">
              {Renderer()}
              {SecondaryRenderer && <SecondaryRenderer />}
            </div>
          </div>
          <ol className="walkthrough-annotations">
            {step.annotations.map(ann => {
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
        {/* The prev/next controls live only on the active step
            so the user never sees four pairs of buttons stacked
            on top of each other. */}
        {isActive && <div className="walkthrough-nav">
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
        </div>}
      </div>
    })}
  </div>
}

export type WalkthroughStrings = UserGuideWalkthroughProps['strings']

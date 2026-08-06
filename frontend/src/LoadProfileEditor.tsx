// MOCK: LoadProfileEditor
//
// This component is a UI-only mock built to mirror the architecture of the
// existing `OperationEditor` in `App.tsx`. It owns the *display* of the
// load profile but not its persistence: parent state stays in `App.tsx`,
// exactly like `operationSettings` does today. The parent passes in the
// current `LoadProfile` and an `onChange` callback; the editor switches
// its inputs on the profile type and emits a new profile on every edit.
//
// Presets (smoke, load, stress, spike, soak, arrival-rate) are pure
// functions in `./loadProfile.ts` so the same shape can be re-used by
// future features (e.g. "duplicate as new test run") without touching
// the editor.
//
// Style notes — kept consistent with the rest of the app:
//   - dark cards (.parameter-box, .field-heading, .type-hint)
//   - inline error boxes (parameter-error)
//   - the `.grid` layout for short forms, a dedicated .stages-table
//     for the multi-row editor
//   - numbers are clamped to their [min, max] on blur so the user can
//     type freely while editing without losing their input

import { useId, useState } from 'react'
import {
  arrivalRatePreset,
  requestsPreset,
  defaultLoadProfile,
  loadPreset,
  loadProfileLabel,
  MAX_DURATION_SECONDS,
  MAX_ITERATIONS,
  MAX_PRE_ALLOCATED_VUS,
  MAX_RATE,
  MAX_VIRTUAL_USERS,
  smokePreset,
  soakPreset,
  spikePreset,
  stressPreset,
  validateLoadProfile,
  type LoadProfile,
  type LoadStage,
} from './loadProfile.ts'

type LoadProfileEditorProps = {
  profile: LoadProfile
  onChange: (next: LoadProfile) => void
  disabled?: boolean
}

type PresetEntry = {
  label: string
  description: string
  apply: () => LoadProfile
}

const PRESETS: PresetEntry[] = [
  { label: 'Smoke', description: '1 VU für 30 s — idealer CI-Pre-Flight-Check', apply: smokePreset },
  { label: 'Load', description: 'Schrittweise auf 50 VUs, 5 min Plateau', apply: loadPreset },
  { label: 'Stress', description: 'Stufenweise bis 400 VUs, findet den Knick', apply: stressPreset },
  { label: 'Spike', description: 'Plötzlicher Sprung auf 800 VUs, 30 s Plateau', apply: spikePreset },
  { label: 'Soak', description: '50 VUs über eine Stunde, deckt Leaks auf', apply: soakPreset },
  { label: 'Burst', description: '1 000 Anfragen so schnell wie möglich — vergleicht Releases mit fester Request-Anzahl', apply: requestsPreset },
  { label: 'Arrival-Rate', description: '50 Anfragen/s unabhängig von der Antwortzeit', apply: arrivalRatePreset },
]

export function LoadProfileEditor({ profile, onChange, disabled = false }: LoadProfileEditorProps) {
  const error = validateLoadProfile(profile)
  const errorId = useId()
  const presetHelpId = useId()
  const [presetHovered, setPresetHovered] = useState<string | undefined>()
  // Die zuletzt geklickte Schnellauswahl bleibt markiert, bis eine
  // andere gewählt wird. So sieht der User jederzeit, welches Preset
  // aktuell aktiv ist — auch nachdem die Maus den Button verlassen hat.
  const [presetSelected, setPresetSelected] = useState<string | undefined>()

  function emit(next: LoadProfile) {
    onChange(next)
  }

  return (
    <div className="load-profile-editor" data-testid="load-profile-editor">
      <PresetRow
        disabled={disabled}
        hovered={presetHovered}
        selected={presetSelected}
        onHover={setPresetHovered}
        onPick={entry => {
          setPresetSelected(entry.label)
          emit(entry.apply())
        }}
        helpId={presetHelpId}
      />

      <fieldset className="profile-fields" disabled={disabled}>
        <legend className="sr-only">Lastprofil-Felder</legend>

        <label className="parameter-box">
          <span className="field-heading">
            <strong>Lastprofil</strong>
            <code>executor</code>
            <span className="type-hint">{profile.type}</span>
          </span>
          <select
            className="profile-type-select"
            value={profile.type}
            onChange={event => {
              // Wenn der User den Lastprofil-Typ manuell wechselt, passt
              // die zuvor gewählte Schnellauswahl nicht mehr — wir
              // räumen die Markierung auf, damit klar ist, dass kein
              // Preset mehr aktiv ist.
              setPresetSelected(undefined)
              emit(changeProfileType(profile, event.target.value as LoadProfile['type']))
            }}
            aria-label="Lastprofil-Typ"
          >
            <option value="constant-vus">Konstante Last (constant-vus)</option>
            <option value="shared-iterations">N Anfragen, so schnell wie möglich (shared-iterations)</option>
            <option value="ramping-vus">Ramping-VUs (Stages)</option>
            <option value="constant-arrival-rate">Constant-Arrival-Rate (RPS)</option>
          </select>
          <small className="profile-summary">{loadProfileLabel(profile)}</small>
        </label>

        {profile.type === 'constant-vus' && <ConstantVUsFields profile={profile} onChange={emit} />}
        {profile.type === 'shared-iterations' && <SharedIterationsFields profile={profile} onChange={emit} />}
        {profile.type === 'ramping-vus' && <RampingVUsFields profile={profile} onChange={emit} />}
        {profile.type === 'constant-arrival-rate' && <ArrivalRateFields profile={profile} onChange={emit} />}
      </fieldset>

      {error && (
        <div className="parameter-error" role="alert" id={errorId}>
          {error}
        </div>
      )}
      {!error && profile.type === 'ramping-vus' && <StagesHint stages={profile.stages} />}
    </div>
  )
}

// ---- Presets ----------------------------------------------------------------

function PresetRow({
  disabled,
  hovered,
  selected,
  onHover,
  onPick,
  helpId,
}: {
  disabled: boolean
  hovered: string | undefined
  selected: string | undefined
  onHover: (label: string | undefined) => void
  onPick: (entry: PresetEntry) => void
  helpId: string
}) {
  // Beim Verlassen der Maus / des Fokus fällt der Hilfe-Text auf die
  // Beschreibung der zuletzt gewählten Schnellauswahl zurück, damit
  // der User weiterhin sieht, was das aktive Preset macht.
  const focusLabel = hovered ?? selected
  return (
    <div className="preset-row" aria-describedby={helpId}>
      <span className="preset-label">Schnellauswahl</span>
      <div className="preset-buttons">
        {PRESETS.map(entry => {
          const isHovered = hovered === entry.label
          const isSelected = !isHovered && selected === entry.label
          return (
            <button
              type="button"
              key={entry.label}
              className={`preset-button ${isHovered ? 'hovered' : ''} ${isSelected ? 'selected' : ''}`}
              disabled={disabled}
              onClick={() => onPick(entry)}
              onMouseEnter={() => onHover(entry.label)}
              onMouseLeave={() => onHover(undefined)}
              onFocus={() => onHover(entry.label)}
              onBlur={() => onHover(undefined)}
              aria-describedby={helpId}
              aria-pressed={selected === entry.label}
            >
              {entry.label}
            </button>
          )
        })}
      </div>
      <small id={helpId} className="preset-help">
        {focusLabel
          ? PRESETS.find(entry => entry.label === focusLabel)?.description
          : 'Preset überfahren für eine Beschreibung.'}
      </small>
    </div>
  )
}

// ---- Profile fields ---------------------------------------------------------

function ConstantVUsFields({ profile, onChange }: { profile: Extract<LoadProfile, { type: 'constant-vus' }>, onChange: (next: LoadProfile) => void }) {
  return (
    <div className="profile-fields-grid">
      <NumberField
        label="Virtual Users"
        hint={`1 bis ${MAX_VIRTUAL_USERS}`}
        min={1}
        max={MAX_VIRTUAL_USERS}
        value={profile.virtualUsers}
        onChange={virtualUsers => onChange({ ...profile, virtualUsers })}
      />
      <NumberField
        label="Dauer (Sekunden)"
        hint={`1 bis ${MAX_DURATION_SECONDS}`}
        min={1}
        max={MAX_DURATION_SECONDS}
        value={profile.durationSeconds}
        onChange={durationSeconds => onChange({ ...profile, durationSeconds })}
      />
    </div>
  )
}

function SharedIterationsFields({ profile, onChange }: { profile: Extract<LoadProfile, { type: 'shared-iterations' }>, onChange: (next: LoadProfile) => void }) {
  return (
    <div className="profile-fields-grid">
      <NumberField
        label="Virtual Users"
        hint={`1 bis ${MAX_VIRTUAL_USERS}`}
        min={1}
        max={MAX_VIRTUAL_USERS}
        value={profile.virtualUsers}
        onChange={virtualUsers => onChange({ ...profile, virtualUsers })}
      />
      <NumberField
        label="Iterationen"
        hint={`1 bis ${MAX_ITERATIONS}`}
        min={1}
        max={MAX_ITERATIONS}
        value={profile.iterations}
        onChange={iterations => onChange({ ...profile, iterations })}
      />
    </div>
  )
}

function RampingVUsFields({ profile, onChange }: { profile: Extract<LoadProfile, { type: 'ramping-vus' }>, onChange: (next: LoadProfile) => void }) {
  return (
    <div className="ramping-fields">
      <div className="profile-fields-grid">
        <NumberField
          label="Start-VUs"
          hint={`0 bis ${MAX_VIRTUAL_USERS}`}
          min={0}
          max={MAX_VIRTUAL_USERS}
          value={profile.startVUs}
          onChange={startVUs => onChange({ ...profile, startVUs })}
        />
        <div className="stage-totals">
          <span>Stages</span>
          <strong>{profile.stages.length}</strong>
          <small>
            Gesamtdauer {profile.stages.reduce((sum, stage) => sum + stage.durationSeconds, 0)} s · Spitze {Math.max(profile.startVUs, ...profile.stages.map(stage => stage.target))} VUs
          </small>
        </div>
      </div>
      <StagesTable stages={profile.stages} onChange={stages => onChange({ ...profile, stages })} />
    </div>
  )
}

function ArrivalRateFields({ profile, onChange }: { profile: Extract<LoadProfile, { type: 'constant-arrival-rate' }>, onChange: (next: LoadProfile) => void }) {
  return (
    <div className="profile-fields-grid">
      <NumberField
        label="Rate (Anfragen)"
        hint={`1 bis ${MAX_RATE}`}
        min={1}
        max={MAX_RATE}
        value={profile.rate}
        onChange={rate => onChange({ ...profile, rate })}
      />
      <NumberField
        label="pro Sekunden"
        hint="1 bis 60"
        min={1}
        max={60}
        value={profile.timeUnitSeconds}
        onChange={timeUnitSeconds => onChange({ ...profile, timeUnitSeconds })}
      />
      <NumberField
        label="Dauer (Sekunden)"
        hint={`1 bis ${MAX_DURATION_SECONDS}`}
        min={1}
        max={MAX_DURATION_SECONDS}
        value={profile.durationSeconds}
        onChange={durationSeconds => onChange({ ...profile, durationSeconds })}
      />
      <NumberField
        label="preAllocatedVUs"
        hint={`1 bis ${MAX_PRE_ALLOCATED_VUS}`}
        min={1}
        max={MAX_PRE_ALLOCATED_VUS}
        value={profile.preAllocatedVUs}
        onChange={preAllocatedVUs => onChange({ ...profile, preAllocatedVUs })}
      />
      <NumberField
        label="maxVUs"
        hint={`≥ preAllocatedVUs, ≤ ${MAX_PRE_ALLOCATED_VUS}`}
        min={profile.preAllocatedVUs}
        max={MAX_PRE_ALLOCATED_VUS}
        value={profile.maxVUs}
        onChange={maxVUs => onChange({ ...profile, maxVUs })}
      />
    </div>
  )
}

// ---- Stages table -----------------------------------------------------------

function StagesTable({ stages, onChange }: { stages: LoadStage[], onChange: (next: LoadStage[]) => void }) {
  function update(index: number, patch: Partial<LoadStage>) {
    onChange(stages.map((stage, i) => (i === index ? { ...stage, ...patch } : stage)))
  }
  function remove(index: number) {
    onChange(stages.filter((_, i) => i !== index))
  }
  function append() {
    const lastTarget = stages.at(-1)?.target ?? 0
    onChange([...stages, { target: lastTarget, durationSeconds: 30 }])
  }
  return (
    <div className="stages-table-wrap">
      <table className="stages-table" aria-label="Ramping-VUs-Stages">
        <thead>
          <tr>
            <th>#</th>
            <th>Ziel-VUs</th>
            <th>Dauer (s)</th>
            <th aria-label="Aktionen" />
          </tr>
        </thead>
        <tbody>
          {stages.map((stage, index) => (
            <tr key={index}>
              <th scope="row">{index + 1}</th>
              <td>
                <input
                  type="number"
                  min={0}
                  max={MAX_VIRTUAL_USERS}
                  step={1}
                  value={stage.target}
                  aria-label={`Stage ${index + 1}: Ziel-VUs`}
                  onChange={event => update(index, { target: Number(event.target.value) })}
                />
              </td>
              <td>
                <input
                  type="number"
                  min={1}
                  max={MAX_DURATION_SECONDS}
                  step={1}
                  value={stage.durationSeconds}
                  aria-label={`Stage ${index + 1}: Dauer`}
                  onChange={event => update(index, { durationSeconds: Number(event.target.value) })}
                />
              </td>
              <td>
                <button type="button" className="stage-remove" onClick={() => remove(index)} aria-label={`Stage ${index + 1} entfernen`}>
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="stage-add" onClick={append}>
        + Stage hinzufügen
      </button>
    </div>
  )
}

function StagesHint(_props: { stages: LoadStage[] }) {
  return (
    <p className="stages-hint">
      Stages werden der Reihe nach ausgeführt. Eine Rampe von 0 auf N innerhalb der Stage-Dauer. Für Spike-Tests: kurze Dauer + hoher Zielwert. Für Soak-Tests: langes Plateau auf konstantem Zielwert. Eine Pause zwischen Lastphasen ist eine Stage mit Ziel 0.
    </p>
  )
}

// ---- Number input -----------------------------------------------------------

function NumberField({
  label,
  hint,
  min,
  max,
  value,
  onChange,
}: {
  label: string
  hint: string
  min: number
  max: number
  value: number
  onChange: (next: number) => void
}) {
  return (
    <label className="parameter-box">
      <span className="field-heading">
        <strong>{label}</strong>
        <span className="type-hint">{min}–{max}</span>
      </span>
      <input
        type="number"
        min={min}
        max={max}
        step={1}
        value={Number.isFinite(value) ? value : ''}
        onChange={event => onChange(Number(event.target.value))}
        aria-label={label}
      />
      <small>{hint}</small>
    </label>
  )
}

// ---- Profile type switcher --------------------------------------------------

function changeProfileType(current: LoadProfile, nextType: LoadProfile['type']): LoadProfile {
  if (current.type === nextType) return current
  switch (nextType) {
    case 'constant-vus':
      return current.type === 'shared-iterations'
        ? { type: 'constant-vus', virtualUsers: current.virtualUsers, durationSeconds: 30 }
        : { type: 'constant-vus', virtualUsers: 10, durationSeconds: 30 }
    case 'shared-iterations':
      return { type: 'shared-iterations', virtualUsers: current.type === 'constant-vus' ? current.virtualUsers : 10, iterations: 100 }
    case 'ramping-vus':
      return defaultLoadProfile().type === 'ramping-vus'
        ? defaultLoadProfile()
        : loadPreset()
    case 'constant-arrival-rate':
      return arrivalRatePreset()
  }
}

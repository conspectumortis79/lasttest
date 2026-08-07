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
  withStrategy,
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
import { translate, type SupportedLanguage } from './i18n.ts'

type LoadProfileEditorProps = {
  profile: LoadProfile
  language: SupportedLanguage
  onChange: (next: LoadProfile) => void
  disabled?: boolean
}

type PresetId = 'smoke' | 'load' | 'stress' | 'spike' | 'soak' | 'burst' | 'arrivalRate'

type PresetEntry = {
  id: PresetId
  // i18n key suffix under `profile.preset.<id>.<label|description>`.
  // The visible label/description are resolved at render time via
  // translate() so the preset names speak the user's language
  // without hardcoded strings leaking into the React tree.
  apply: () => LoadProfile
}

const PRESETS: PresetEntry[] = [
  { id: 'smoke', apply: smokePreset },
  { id: 'load', apply: loadPreset },
  { id: 'stress', apply: stressPreset },
  { id: 'spike', apply: spikePreset },
  { id: 'soak', apply: soakPreset },
  { id: 'burst', apply: requestsPreset },
  { id: 'arrivalRate', apply: arrivalRatePreset },
]

export function LoadProfileEditor({ profile, language, onChange, disabled = false }: LoadProfileEditorProps) {
  const error = validateLoadProfile(profile)
  const errorId = useId()
  const presetHelpId = useId()
  const [presetHovered, setPresetHovered] = useState<PresetId | undefined>()
  // The last clicked preset stays highlighted until a different one is
  // chosen. This way the user always sees which preset is currently
  // active — even after the mouse has left the button.
  const [presetSelected, setPresetSelected] = useState<PresetId | undefined>()

  function emit(next: LoadProfile) {
    onChange(next)
  }

  return (
    <div className="load-profile-editor" data-testid="load-profile-editor">
      <PresetRow
        disabled={disabled}
        hovered={presetHovered}
        selected={presetSelected}
        language={language}
        onHover={setPresetHovered}
        onPick={entry => {
          setPresetSelected(entry.id)
          // Carry the user's manually chosen payload strategy over
          // the preset application. Presets are pure templates
          // (no payloadStrategy of their own); without this wrap
          // the strategy would be reset to undefined (i.e. backend
          // default sequential) every time the user clicks Smoke,
          // Load, Stress, … — see [withStrategy] for the contract.
          emit(withStrategy(entry.apply(), profile))
        }}
        helpId={presetHelpId}
      />

      <fieldset className="profile-fields" disabled={disabled}>
        <legend className="sr-only">{translate(language, 'profile.editor.legend')}</legend>

        <label className="parameter-box">
          <span className="field-heading">
            <strong>{translate(language, 'profile.card.title')}</strong>
            <code>executor</code>
            <span className="type-hint">{profile.type}</span>
          </span>
          <select
            className="profile-type-select"
            value={profile.type}
            onChange={event => {
              // When the user manually switches the load profile type,
              // the previously chosen preset no longer fits — we clear
              // the highlight so it's clear that no preset is active.
              setPresetSelected(undefined)
              // Carry the user's manually chosen payload strategy over
              // the executor type change. [changeProfileType] builds a
              // fresh profile of the requested type without a
              // payloadStrategy; without this wrap the strategy
              // would be reset to undefined (i.e. backend default
              // sequential) every time the user switches the executor
              // dropdown — see [withStrategy] for the contract.
              emit(withStrategy(changeProfileType(profile, event.target.value as LoadProfile['type']), profile))
            }}
            aria-label={translate(language, 'profile.editor.type')}
          >
            <option value="constant-vus">{translate(language, 'profile.editor.type.constant-vus')}</option>
            <option value="shared-iterations">{translate(language, 'profile.editor.type.shared-iterations')}</option>
            <option value="ramping-vus">{translate(language, 'profile.editor.type.ramping-vus')}</option>
            <option value="constant-arrival-rate">{translate(language, 'profile.editor.type.constant-arrival-rate')}</option>
          </select>
          <small className="profile-summary">{loadProfileLabel(profile)}</small>
        </label>

        {profile.type === 'constant-vus' && <ConstantVUsFields profile={profile} language={language} onChange={emit} />}
        {profile.type === 'shared-iterations' && <SharedIterationsFields profile={profile} language={language} onChange={emit} />}
        {profile.type === 'ramping-vus' && <RampingVUsFields profile={profile} language={language} onChange={emit} />}
        {profile.type === 'constant-arrival-rate' && <ArrivalRateFields profile={profile} language={language} onChange={emit} />}
      </fieldset>

      {error && (
        <div className="parameter-error" role="alert" id={errorId}>
          {error}
        </div>
      )}
      {!error && profile.type === 'ramping-vus' && <StagesHint language={language} stages={profile.stages} />}
    </div>
  )
}

// ---- Presets ----------------------------------------------------------------

function PresetRow({
  disabled,
  hovered,
  selected,
  language,
  onHover,
  onPick,
  helpId,
}: {
  disabled: boolean
  hovered: PresetId | undefined
  selected: PresetId | undefined
  language: SupportedLanguage
  onHover: (id: PresetId | undefined) => void
  onPick: (entry: PresetEntry) => void
  helpId: string
}) {
  // When the mouse / focus leaves, the help text falls back to the
  // description of the last selected preset, so the user keeps seeing
  // what the active preset does.
  const focusId = hovered ?? selected
  return (
    <div className="preset-row" aria-describedby={helpId}>
      <span className="preset-label">{translate(language, 'profile.preset.label')}</span>
      <div className="preset-buttons">
        {PRESETS.map(entry => {
          const isHovered = hovered === entry.id
          // `hovered` and `selected` are orthogonal — both classes can
          // be active at the same time (mouse over an already-selected
          // preset). Previously they were coupled together
          // (`!isHovered && selected === …`), which swallowed the
          // `selected` class on click as long as the mouse had not
          // been moved away from the button.
          const isSelected = selected === entry.id
          const label = translate(language, `profile.preset.${entry.id}.label`)
          return (
            <button
              type="button"
              key={entry.id}
              className={`preset-button ${isHovered ? 'hovered' : ''} ${isSelected ? 'selected' : ''}`}
              disabled={disabled}
              onClick={() => onPick(entry)}
              onMouseEnter={() => onHover(entry.id)}
              onMouseLeave={() => onHover(undefined)}
              onFocus={() => onHover(entry.id)}
              onBlur={() => onHover(undefined)}
              aria-describedby={helpId}
              aria-pressed={selected === entry.id}
            >
              {label}
            </button>
          )
        })}
      </div>
      <small id={helpId} className="preset-help">
        {focusId
          ? translate(language, `profile.preset.${focusId}.description`)
          : translate(language, 'profile.preset.help')}
      </small>
    </div>
  )
}

// ---- Profile fields ---------------------------------------------------------

function ConstantVUsFields({ profile, language, onChange }: { profile: Extract<LoadProfile, { type: 'constant-vus' }>, language: SupportedLanguage, onChange: (next: LoadProfile) => void }) {
  return (
    <div className="profile-fields-grid">
      <NumberField
        label={translate(language, 'profile.virtualUsers')}
        hint={translate(language, 'profile.memory.minmax', { min: 1, max: MAX_VIRTUAL_USERS })}
        min={1}
        max={MAX_VIRTUAL_USERS}
        value={profile.virtualUsers}
        onChange={virtualUsers => onChange({ ...profile, virtualUsers })}
      />
      <NumberField
        label={translate(language, 'profile.durationSeconds')}
        hint={translate(language, 'profile.memory.minmax', { min: 1, max: MAX_DURATION_SECONDS })}
        min={1}
        max={MAX_DURATION_SECONDS}
        value={profile.durationSeconds}
        onChange={durationSeconds => onChange({ ...profile, durationSeconds })}
      />
    </div>
  )
}

function SharedIterationsFields({ profile, language, onChange }: { profile: Extract<LoadProfile, { type: 'shared-iterations' }>, language: SupportedLanguage, onChange: (next: LoadProfile) => void }) {
  return (
    <div className="profile-fields-grid">
      <NumberField
        label={translate(language, 'profile.virtualUsers')}
        hint={translate(language, 'profile.memory.minmax', { min: 1, max: MAX_VIRTUAL_USERS })}
        min={1}
        max={MAX_VIRTUAL_USERS}
        value={profile.virtualUsers}
        onChange={virtualUsers => onChange({ ...profile, virtualUsers })}
      />
      <NumberField
        label={translate(language, 'profile.iterations.label')}
        hint={translate(language, 'profile.memory.minmax', { min: 1, max: MAX_ITERATIONS })}
        min={1}
        max={MAX_ITERATIONS}
        value={profile.iterations}
        onChange={iterations => onChange({ ...profile, iterations })}
      />
    </div>
  )
}

function RampingVUsFields({ profile, language, onChange }: { profile: Extract<LoadProfile, { type: 'ramping-vus' }>, language: SupportedLanguage, onChange: (next: LoadProfile) => void }) {
  const peak = Math.max(profile.startVUs, ...profile.stages.map(stage => stage.target))
  const totalSeconds = profile.stages.reduce((sum, stage) => sum + stage.durationSeconds, 0)
  return (
    <div className="ramping-fields">
      <div className="profile-fields-grid">
        <NumberField
          label={translate(language, 'profile.virtualUsers')}
          hint={translate(language, 'profile.memory.minmax', { min: 0, max: MAX_VIRTUAL_USERS })}
          min={0}
          max={MAX_VIRTUAL_USERS}
          value={profile.startVUs}
          onChange={startVUs => onChange({ ...profile, startVUs })}
        />
        <div className="stage-totals">
          <span>{translate(language, 'profile.stages.title')}</span>
          <strong>{profile.stages.length}</strong>
          <small>
            {translate(language, 'profile.stages.total', { seconds: totalSeconds, peak })}
          </small>
        </div>
      </div>
      <StagesTable stages={profile.stages} language={language} onChange={stages => onChange({ ...profile, stages })} />
    </div>
  )
}

function ArrivalRateFields({ profile, language, onChange }: { profile: Extract<LoadProfile, { type: 'constant-arrival-rate' }>, language: SupportedLanguage, onChange: (next: LoadProfile) => void }) {
  return (
    <div className="profile-fields-grid">
      <NumberField
        label={translate(language, 'profile.rate')}
        hint={translate(language, 'profile.memory.minmax', { min: 1, max: MAX_RATE })}
        min={1}
        max={MAX_RATE}
        value={profile.rate}
        onChange={rate => onChange({ ...profile, rate })}
      />
      <NumberField
        label={translate(language, 'profile.timeUnitSeconds')}
        hint={translate(language, 'profile.memory.minmax', { min: 1, max: 60 })}
        min={1}
        max={60}
        value={profile.timeUnitSeconds}
        onChange={timeUnitSeconds => onChange({ ...profile, timeUnitSeconds })}
      />
      <NumberField
        label={translate(language, 'profile.durationSeconds')}
        hint={translate(language, 'profile.memory.minmax', { min: 1, max: MAX_DURATION_SECONDS })}
        min={1}
        max={MAX_DURATION_SECONDS}
        value={profile.durationSeconds}
        onChange={durationSeconds => onChange({ ...profile, durationSeconds })}
      />
      <NumberField
        label={translate(language, 'profile.preAllocatedVUs')}
        hint={translate(language, 'profile.memory.minmax', { min: 1, max: MAX_PRE_ALLOCATED_VUS })}
        min={1}
        max={MAX_PRE_ALLOCATED_VUS}
        value={profile.preAllocatedVUs}
        onChange={preAllocatedVUs => onChange({ ...profile, preAllocatedVUs })}
      />
      <NumberField
        label={translate(language, 'profile.maxVUs')}
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

function StagesTable({ stages, language, onChange }: { stages: LoadStage[], language: SupportedLanguage, onChange: (next: LoadStage[]) => void }) {
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
      <table className="stages-table" aria-label={translate(language, 'profile.editor.type.ramping-vus')}>
        <thead>
          <tr>
            <th>#</th>
            <th>{translate(language, 'profile.stages.target')}</th>
            <th>{translate(language, 'profile.stages.duration')}</th>
            <th aria-label={translate(language, 'profile.stages.action') as string} />
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
                  aria-label={translate(language, 'profile.stages.targetAria', { n: index + 1 })}
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
                  aria-label={translate(language, 'profile.stages.durationAria', { n: index + 1 })}
                  onChange={event => update(index, { durationSeconds: Number(event.target.value) })}
                />
              </td>
              <td>
                <button type="button" className="stage-remove" onClick={() => remove(index)} aria-label={translate(language, 'profile.stages.removeAria', { n: index + 1 })}>
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="stage-add" onClick={append}>
        {translate(language, 'profile.stages.add')}
      </button>
    </div>
  )
}

function StagesHint({ language }: { language: SupportedLanguage, stages: LoadStage[] }) {
  return (
    <p className="stages-hint">
      {translate(language, 'profile.stages.hint')}
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

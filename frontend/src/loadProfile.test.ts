import { deepEqual, equal, ok } from 'node:assert/strict'
import { test } from 'node:test'
import {
  arrivalRatePreset,
  defaultLoadProfile,
  withStrategy,
  isPayloadStrategy,
  loadPreset,
  loadProfileLabel,
  MAX_DURATION_SECONDS,
  MAX_ITERATIONS,
  MAX_RATE,
  MAX_VIRTUAL_USERS,
  PAYLOAD_STRATEGIES,
  requestsPreset,
  serialiseLoadProfile,
  smokePreset,
  soakPreset,
  spikePreset,
  stressPreset,
  validateLoadProfile,
  type LoadProfile,
  type LoadStage,
  type PayloadStrategy,
} from './loadProfile.ts'

test('defaultLoadProfile returns a valid constant-vus profile', () => {
  const profile = defaultLoadProfile()
  equal(profile.type, 'constant-vus')
  equal(validateLoadProfile(profile), undefined)
})

test('accepts the virtual user and duration boundaries for constant-vus', () => {
  equal(validateLoadProfile({ type: 'constant-vus', virtualUsers: 1, durationSeconds: 1 }), undefined)
  equal(validateLoadProfile({ type: 'constant-vus', virtualUsers: MAX_VIRTUAL_USERS, durationSeconds: MAX_DURATION_SECONDS }), undefined)
})

test('rejects constant-vus profiles outside the supported range', () => {
  equal(validateLoadProfile({ type: 'constant-vus', virtualUsers: 0, durationSeconds: 10 }), `Virtual Users müssen zwischen 1 und ${MAX_VIRTUAL_USERS} liegen.`)
  equal(validateLoadProfile({ type: 'constant-vus', virtualUsers: MAX_VIRTUAL_USERS + 1, durationSeconds: 10 }), `Virtual Users müssen zwischen 1 und ${MAX_VIRTUAL_USERS} liegen.`)
  equal(validateLoadProfile({ type: 'constant-vus', virtualUsers: 1, durationSeconds: 0 }), `Die Dauer muss zwischen 1 und ${MAX_DURATION_SECONDS} Sekunden liegen.`)
})

test('rejects non-integer virtual users and durations', () => {
  equal(validateLoadProfile({ type: 'constant-vus', virtualUsers: 1.5, durationSeconds: 10 }), `Virtual Users müssen zwischen 1 und ${MAX_VIRTUAL_USERS} liegen.`)
  equal(validateLoadProfile({ type: 'constant-vus', virtualUsers: 10, durationSeconds: 2.5 }), `Die Dauer muss zwischen 1 und ${MAX_DURATION_SECONDS} Sekunden liegen.`)
})

test('validates shared-iterations boundaries', () => {
  equal(validateLoadProfile({ type: 'shared-iterations', virtualUsers: 5, iterations: 1 }), undefined)
  equal(validateLoadProfile({ type: 'shared-iterations', virtualUsers: 0, iterations: 100 }), `Virtual Users müssen zwischen 1 und ${MAX_VIRTUAL_USERS} liegen.`)
  equal(validateLoadProfile({ type: 'shared-iterations', virtualUsers: 5, iterations: 0 }), `Iterationen müssen zwischen 1 und ${MAX_ITERATIONS} liegen.`)
  equal(validateLoadProfile({ type: 'shared-iterations', virtualUsers: 5, iterations: MAX_ITERATIONS + 1 }), `Iterationen müssen zwischen 1 und ${MAX_ITERATIONS} liegen.`)
})

test('accepts valid ramping-vus profiles with startVUs=0', () => {
  const profile: LoadProfile = {
    type: 'ramping-vus',
    startVUs: 0,
    stages: [
      { target: 10, durationSeconds: 30 },
      { target: 100, durationSeconds: 60 },
      { target: 200, durationSeconds: 120 },
    ],
  }
  equal(validateLoadProfile(profile), undefined)
})

test('rejects ramping-vus with empty stages', () => {
  const profile: LoadProfile = { type: 'ramping-vus', startVUs: 0, stages: [] }
  equal(validateLoadProfile(profile), 'Ramping-VUs benötigen mindestens eine Stage.')
})

test('accepts a plateau as consecutive stages with the same target', () => {
  // Plateaus (e.g. holding 50 VUs for 5 min) are a classic load-
  // test pattern and must be allowed.
  const profile: LoadProfile = {
    type: 'ramping-vus',
    startVUs: 0,
    stages: [
      { target: 50, durationSeconds: 30 },
      { target: 50, durationSeconds: 300 },
      { target: 0, durationSeconds: 30 },
    ],
  }
  equal(validateLoadProfile(profile), undefined)
})

test('accepts a first stage that matches startVUs (Anlauf ohne Anstieg)', () => {
  const profile: LoadProfile = {
    type: 'ramping-vus',
    startVUs: 10,
    stages: [{ target: 10, durationSeconds: 30 }],
  }
  equal(validateLoadProfile(profile), undefined)
})

test('rejects ramping-vus with out-of-range target or duration in any stage', () => {
  const tooHigh: LoadProfile = {
    type: 'ramping-vus',
    startVUs: 0,
    stages: [{ target: MAX_VIRTUAL_USERS + 1, durationSeconds: 30 }],
  }
  equal(validateLoadProfile(tooHigh), `Stage 1: Ziel-VUs müssen zwischen 0 und ${MAX_VIRTUAL_USERS} liegen.`)

  const tooLong: LoadProfile = {
    type: 'ramping-vus',
    startVUs: 0,
    stages: [{ target: 10, durationSeconds: MAX_DURATION_SECONDS + 1 }],
  }
  equal(validateLoadProfile(tooLong), `Stage 1: Dauer muss zwischen 1 und ${MAX_DURATION_SECONDS} Sekunden liegen.`)

  const negative: LoadProfile = {
    type: 'ramping-vus',
    startVUs: 0,
    stages: [{ target: -5, durationSeconds: 30 }],
  }
  equal(validateLoadProfile(negative), `Stage 1: Ziel-VUs müssen zwischen 0 und ${MAX_VIRTUAL_USERS} liegen.`)
})

test('accepts a valid constant-arrival-rate profile', () => {
  const profile: LoadProfile = {
    type: 'constant-arrival-rate',
    rate: 50,
    timeUnitSeconds: 1,
    durationSeconds: 60,
    preAllocatedVUs: 10,
    maxVUs: 100,
  }
  equal(validateLoadProfile(profile), undefined)
})

test('rejects constant-arrival-rate with invalid time unit', () => {
  const profile: LoadProfile = {
    type: 'constant-arrival-rate',
    rate: 50,
    timeUnitSeconds: 61,
    durationSeconds: 60,
    preAllocatedVUs: 10,
    maxVUs: 100,
  }
  equal(validateLoadProfile(profile), 'Zeiteinheit muss eine Sekundenzahl zwischen 1 und 60 sein.')
})

test('rejects constant-arrival-rate with maxVUs below preAllocatedVUs', () => {
  const profile: LoadProfile = {
    type: 'constant-arrival-rate',
    rate: 50,
    timeUnitSeconds: 1,
    durationSeconds: 60,
    preAllocatedVUs: 100,
    maxVUs: 50,
  }
  equal(validateLoadProfile(profile), `maxVUs muss ≥ preAllocatedVUs und ≤ ${MAX_VIRTUAL_USERS} sein.`)
})

test('rejects constant-arrival-rate with rate outside the supported range', () => {
  const profile: LoadProfile = {
    type: 'constant-arrival-rate',
    rate: MAX_RATE + 1,
    timeUnitSeconds: 1,
    durationSeconds: 60,
    preAllocatedVUs: 10,
    maxVUs: 100,
  }
  equal(validateLoadProfile(profile), `Rate müssen zwischen 1 und ${MAX_RATE} liegen.`)
})

test('presets are all valid', () => {
  for (const preset of [smokePreset(), loadPreset(), stressPreset(), spikePreset(), soakPreset(), requestsPreset(), arrivalRatePreset()]) {
    equal(validateLoadProfile(preset), undefined, `preset ${preset.type} should be valid`)
  }
})

test('rejects ramping-vus with stage target above maximum', () => {
  const profile: LoadProfile = {
    type: 'ramping-vus',
    startVUs: 0,
    stages: [{ target: 30_001, durationSeconds: 30 }],
  }
  const error = validateLoadProfile(profile)
  ok(error?.includes('Ziel-VUs'))
})

test('rejects ramping-vus with stage duration above maximum', () => {
  const profile: LoadProfile = {
    type: 'ramping-vus',
    startVUs: 0,
    stages: [{ target: 10, durationSeconds: 3601 }],
  }
  const error = validateLoadProfile(profile)
  ok(error?.includes('Dauer'))
})

test('rejects constant-arrival-rate with invalid timeUnit', () => {
  const profile: LoadProfile = {
    type: 'constant-arrival-rate',
    rate: 50, timeUnitSeconds: 61, durationSeconds: 60, preAllocatedVUs: 10, maxVUs: 100,
  }
  const error = validateLoadProfile(profile)
  ok(error?.includes('Zeiteinheit'))
})

test('rejects constant-arrival-rate with maxVUs below preAllocatedVUs', () => {
  const profile: LoadProfile = {
    type: 'constant-arrival-rate',
    rate: 50, timeUnitSeconds: 1, durationSeconds: 60, preAllocatedVUs: 100, maxVUs: 50,
  }
  const error = validateLoadProfile(profile)
  ok(error?.includes('maxVUs'))
})

test('rejects constant-arrival-rate with maxVUs above maximum', () => {
  // preAllocatedVUs is valid (<= MAX), but maxVUs exceeds
  // MAX_PRE_ALLOCATED_VUS. This reaches the final or-branch in
  // `validateLoadProfile`.
  const profile: LoadProfile = {
    type: 'constant-arrival-rate',
    rate: 50, timeUnitSeconds: 1, durationSeconds: 60, preAllocatedVUs: 10, maxVUs: 30_001,
  }
  const error = validateLoadProfile(profile)
  ok(error?.includes('maxVUs'))
})

test('rejects constant-arrival-rate with invalid duration (caught after rate and timeUnit)', () => {
  // This path is only reachable when rate and timeUnit are valid.
  // The `if (durationError) return durationError` branch is only
  // hit when the caller sends a profile with invalid duration but
  // valid rate and valid time unit.
  const profile: LoadProfile = {
    type: 'constant-arrival-rate',
    rate: 50, timeUnitSeconds: 1, durationSeconds: 0, preAllocatedVUs: 10, maxVUs: 100,
  }
  const error = validateLoadProfile(profile)
  ok(error?.includes('Dauer'))
})

test('rejects constant-arrival-rate with invalid preAllocatedVUs (caught after duration)', () => {
  // Analogously: keep preAllocatedVUs invalid, everything before it valid.
  const profile: LoadProfile = {
    type: 'constant-arrival-rate',
    rate: 50, timeUnitSeconds: 1, durationSeconds: 60, preAllocatedVUs: 0, maxVUs: 100,
  }
  const error = validateLoadProfile(profile)
  ok(error?.includes('preAllocatedVUs'))
})

test('rejects constant-arrival-rate with non-integer maxVUs', () => {
  // Defensive: `!Number.isInteger(maxVUs)` as the first or-branch.
  const profile: LoadProfile = {
    type: 'constant-arrival-rate',
    rate: 50, timeUnitSeconds: 1, durationSeconds: 60, preAllocatedVUs: 10, maxVUs: 100.5,
  }
  const error = validateLoadProfile(profile)
  ok(error?.includes('maxVUs'))
})

test('rejects ramping-vus with non-integer stage target', () => {
  const profile: LoadProfile = {
    type: 'ramping-vus',
    startVUs: 0,
    stages: [{ target: 1.5, durationSeconds: 30 }],
  }
  const error = validateLoadProfile(profile)
  ok(error?.includes('Ziel-VUs'))
})

test('rejects ramping-vus with stage duration below one', () => {
  const profile: LoadProfile = {
    type: 'ramping-vus',
    startVUs: 0,
    stages: [{ target: 10, durationSeconds: 0 }],
  }
  const error = validateLoadProfile(profile)
  ok(error?.includes('Dauer'))
})

test('rejects ramping-vus with non-integer stage duration', () => {
  const profile: LoadProfile = {
    type: 'ramping-vus',
    startVUs: 0,
    stages: [{ target: 10, durationSeconds: 1.5 }],
  }
  const error = validateLoadProfile(profile)
  ok(error?.includes('Dauer'))
})

test('rejects ramping-vus with startVUs below zero', () => {
  const profile: LoadProfile = {
    type: 'ramping-vus',
    startVUs: -1,
    stages: [{ target: 10, durationSeconds: 30 }],
  }
  const error = validateLoadProfile(profile)
  ok(error?.includes('Start-VUs'))
})

test('rejects ramping-vus with startVUs above maximum', () => {
  // Second branch of the `||` chain: `startVUs > MAX` without
  // hitting the `< 0` path.
  const profile: LoadProfile = {
    type: 'ramping-vus',
    startVUs: MAX_VIRTUAL_USERS + 1,
    stages: [{ target: 10, durationSeconds: 30 }],
  }
  const error = validateLoadProfile(profile)
  ok(error?.includes('Start-VUs'))
})

test('presets carry the expected executor type', () => {
  equal(smokePreset().type, 'constant-vus')
  equal(loadPreset().type, 'ramping-vus')
  equal(stressPreset().type, 'ramping-vus')
  equal(spikePreset().type, 'ramping-vus')
  equal(soakPreset().type, 'ramping-vus')
  equal(arrivalRatePreset().type, 'constant-arrival-rate')
  equal(requestsPreset().type, 'shared-iterations')
})

test('requestsPreset uses shared-iterations with a fixed iteration count', () => {
  // Verifies that the new "Requests" preset (mouseover: "1 000 requests
  // as fast as possible") is correctly typed and has the defaults
  // documented in the preset hover description.
  const profile = requestsPreset()
  equal(profile.type, 'shared-iterations')
  if (profile.type === 'shared-iterations') {
    equal(profile.iterations, 1000)
    equal(profile.virtualUsers, 10)
  }
  // Should be valid out of the box.
  equal(validateLoadProfile(profile), undefined)
})

test('serialiseLoadProfile maps the union onto the wire shape', () => {
  const constantVUs: LoadProfile = { type: 'constant-vus', virtualUsers: 25, durationSeconds: 90 }
  deepEqual(serialiseLoadProfile(constantVUs), { type: 'constant-vus', virtualUsers: 25, durationSeconds: 90 })

  const sharedIterations: LoadProfile = { type: 'shared-iterations', virtualUsers: 10, iterations: 200 }
  deepEqual(serialiseLoadProfile(sharedIterations), { type: 'shared-iterations', virtualUsers: 10, iterations: 200, useIterations: true })

  const stages: LoadStage[] = [
    { target: 0, durationSeconds: 10 },
    { target: 50, durationSeconds: 60 },
  ]
  const rampingVUs: LoadProfile = { type: 'ramping-vus', startVUs: 0, stages }
  deepEqual(serialiseLoadProfile(rampingVUs), { type: 'ramping-vus', startVUs: 0, stages: [...stages] })

  const arrivalRate: LoadProfile = { type: 'constant-arrival-rate', rate: 50, timeUnitSeconds: 1, durationSeconds: 60, preAllocatedVUs: 10, maxVUs: 100 }
  deepEqual(serialiseLoadProfile(arrivalRate), { type: 'constant-arrival-rate', rate: 50, timeUnit: 1, durationSeconds: 60, preAllocatedVUs: 10, maxVUs: 100 })
})

test('loadProfileLabel produces a human-readable summary per profile type', () => {
  ok(loadProfileLabel(defaultLoadProfile()).includes('Konstante Last'))
  ok(loadProfileLabel({ type: 'shared-iterations', virtualUsers: 5, iterations: 100 }).includes('100 parallele Anfragen'))
  ok(loadProfileLabel(loadPreset()).includes('Ramping-VUs'))
  ok(loadProfileLabel(arrivalRatePreset()).includes('Constant-Arrival-Rate'))
  ok(loadProfileLabel(arrivalRatePreset()).includes('Anfragen/1s'))
})

test('loadProfileLabel for ramping-vus handles empty stages defensively', () => {
  // Covers the case where `Math.max(...[])` is called.
  // V8 records the empty-spread path as a branch.
  const label = loadProfileLabel({ type: 'ramping-vus', startVUs: 0, stages: [] })
  ok(label.includes('0 Stages'))
})

// ---- PayloadStrategy --------------------------------------------------------

test('PAYLOAD_STRATEGIES lists the two supported strategies in the documented order', () => {
  deepEqual([...PAYLOAD_STRATEGIES], ['sequential', 'random'])
})

test('isPayloadStrategy accepts both strategy values and rejects anything else', () => {
  equal(isPayloadStrategy('sequential'), true)
  equal(isPayloadStrategy('random'), true)
  equal(isPayloadStrategy('RANDOM'), false)        // case-sensitive on purpose
  equal(isPayloadStrategy(''), false)
  equal(isPayloadStrategy(undefined), false)
  equal(isPayloadStrategy(null), false)
  equal(isPayloadStrategy(42), false)
  equal(isPayloadStrategy({}), false)
})

test('validateLoadProfile accepts every profile type with a payloadStrategy', () => {
  const strategies: PayloadStrategy[] = ['sequential', 'random']
  for (const strategy of strategies) {
    equal(validateLoadProfile({ type: 'constant-vus', virtualUsers: 1, durationSeconds: 1, payloadStrategy: strategy }), undefined)
    equal(validateLoadProfile({ type: 'shared-iterations', virtualUsers: 1, iterations: 1, payloadStrategy: strategy }), undefined)
    equal(validateLoadProfile({ type: 'ramping-vus', startVUs: 0, stages: [{ target: 0, durationSeconds: 1 }], payloadStrategy: strategy }), undefined)
    equal(validateLoadProfile({ type: 'constant-arrival-rate', rate: 1, timeUnitSeconds: 1, durationSeconds: 1, preAllocatedVUs: 1, maxVUs: 1, payloadStrategy: strategy }), undefined)
  }
})

test('validateLoadProfile accepts every profile type with payloadStrategy omitted (default)', () => {
  equal(validateLoadProfile({ type: 'constant-vus', virtualUsers: 1, durationSeconds: 1 }), undefined)
  equal(validateLoadProfile({ type: 'shared-iterations', virtualUsers: 1, iterations: 1 }), undefined)
  equal(validateLoadProfile({ type: 'ramping-vus', startVUs: 0, stages: [{ target: 0, durationSeconds: 1 }] }), undefined)
  equal(validateLoadProfile({ type: 'constant-arrival-rate', rate: 1, timeUnitSeconds: 1, durationSeconds: 1, preAllocatedVUs: 1, maxVUs: 1 }), undefined)
})

test('validateLoadProfile rejects an unknown payloadStrategy before type-specific errors', () => {
  // The strategy check must run first so a typo like "sequntial" is the
  // error the user sees, not a confusing downstream executor error.
  const error = validateLoadProfile({ type: 'constant-vus', virtualUsers: 1, durationSeconds: 1, payloadStrategy: 'sequntial' as unknown as PayloadStrategy })
  ok(error?.includes('Payload-Strategie'))
})

test('validateLoadProfile rejects non-string payloadStrategy values', () => {
  equal(validateLoadProfile({ type: 'constant-vus', virtualUsers: 1, durationSeconds: 1, payloadStrategy: 42 as unknown as PayloadStrategy }), 'Payload-Strategie muss "sequential" oder "random" sein.')
  equal(validateLoadProfile({ type: 'constant-vus', virtualUsers: 1, durationSeconds: 1, payloadStrategy: null as unknown as PayloadStrategy }), 'Payload-Strategie muss "sequential" oder "random" sein.')
  equal(validateLoadProfile({ type: 'constant-vus', virtualUsers: 1, durationSeconds: 1, payloadStrategy: {} as unknown as PayloadStrategy }), 'Payload-Strategie muss "sequential" oder "random" sein.')
})

test('serialiseLoadProfile forwards payloadStrategy on every profile type', () => {
  const strategies: PayloadStrategy[] = ['sequential', 'random']
  for (const strategy of strategies) {
    equal(serialiseLoadProfile({ type: 'constant-vus', virtualUsers: 1, durationSeconds: 1, payloadStrategy: strategy }).payloadStrategy, strategy)
    equal(serialiseLoadProfile({ type: 'shared-iterations', virtualUsers: 1, iterations: 1, payloadStrategy: strategy }).payloadStrategy, strategy)
    equal(serialiseLoadProfile({ type: 'ramping-vus', startVUs: 0, stages: [{ target: 0, durationSeconds: 1 }], payloadStrategy: strategy }).payloadStrategy, strategy)
    equal(serialiseLoadProfile({ type: 'constant-arrival-rate', rate: 1, timeUnitSeconds: 1, durationSeconds: 1, preAllocatedVUs: 1, maxVUs: 1, payloadStrategy: strategy }).payloadStrategy, strategy)
  }
})

test('serialiseLoadProfile omits payloadStrategy when not set', () => {
  equal(serialiseLoadProfile({ type: 'constant-vus', virtualUsers: 1, durationSeconds: 1 }).payloadStrategy, undefined)
  equal(serialiseLoadProfile({ type: 'shared-iterations', virtualUsers: 1, iterations: 1 }).payloadStrategy, undefined)
  equal(serialiseLoadProfile({ type: 'ramping-vus', startVUs: 0, stages: [{ target: 0, durationSeconds: 1 }] }).payloadStrategy, undefined)
  equal(serialiseLoadProfile({ type: 'constant-arrival-rate', rate: 1, timeUnitSeconds: 1, durationSeconds: 1, preAllocatedVUs: 1, maxVUs: 1 }).payloadStrategy, undefined)
})

test('withStrategy copies the payloadStrategy from the previous profile onto a fresh profile', () => {
  // The user picked `random` on a constant-vus profile, then
  // switched the executor type to ramping-vus. The strategy
  // must survive the type change so the user does not have to
  // re-pick it on every executor swap. Same flow happens when
  // the user clicks a preset (Smoke, Load, …) — the preset
  // template is a fresh profile, the strategy must be carried
  // over by the editor, not by the preset itself.
  const previous = {
    type: 'constant-vus' as const,
    virtualUsers: 10,
    durationSeconds: 30,
    payloadStrategy: 'random' as const,
  }
  const fresh = loadPreset() // ramping-vus, no payloadStrategy

  const merged = withStrategy(fresh, previous)

  equal(merged.type, 'ramping-vus')
  equal(merged.payloadStrategy, 'random')
})

test('withStrategy preserves the field types — every other field on the fresh profile is untouched', () => {
  // Regression guard: the helper must NOT overwrite the fresh
  // profile's load-shape fields with the previous profile's
  // values. Otherwise switching the executor type would
  // silently leak the previous executor's VU count / stages
  // / arrival rate into the new profile.
  const previous = {
    type: 'constant-vus' as const,
    virtualUsers: 999,
    durationSeconds: 999,
    payloadStrategy: 'random' as const,
  }
  const fresh = {
    type: 'ramping-vus' as const,
    startVUs: 5,
    stages: [{ target: 50, durationSeconds: 60 }],
  }

  const merged = withStrategy(fresh, previous)

  deepEqual(merged, {
    type: 'ramping-vus',
    startVUs: 5,
    stages: [{ target: 50, durationSeconds: 60 }],
    payloadStrategy: 'random',
  })
})

test('withStrategy returns the fresh profile unchanged when the previous one had no payloadStrategy', () => {
  // Default app state: load profile is the default constant-vus,
  // payloadStrategy is undefined. Switching to a preset or
  // another executor must NOT add a payloadStrategy out of
  // thin air — the user has not picked one yet.
  const previous = defaultLoadProfile()
  const fresh = arrivalRatePreset()

  const merged = withStrategy(fresh, previous)

  equal(merged.payloadStrategy, undefined)
  // The fresh profile is otherwise returned verbatim so the
  // editor can drop it in without any further mutation.
  deepEqual(merged, fresh)
})

test('withStrategy works across every executor type', () => {
  // The editor's onChange handler must work for every
  // permutation of `(fresh, previous)` types. We exhaustively
  // walk the four executor types on each side so a future
  // addition cannot break the cross-type strategy preservation.
  const types = ['constant-vus', 'shared-iterations', 'ramping-vus', 'constant-arrival-rate'] as const
  const previous = { type: types[0], virtualUsers: 1, durationSeconds: 1, payloadStrategy: 'random' as const }

  for (const newType of types) {
    const fresh: LoadProfile =
      newType === 'constant-vus'
        ? { type: 'constant-vus', virtualUsers: 1, durationSeconds: 1 }
        : newType === 'shared-iterations'
          ? { type: 'shared-iterations', virtualUsers: 1, iterations: 1 }
          : newType === 'ramping-vus'
            ? { type: 'ramping-vus', startVUs: 0, stages: [{ target: 1, durationSeconds: 1 }] }
            : { type: 'constant-arrival-rate', rate: 1, timeUnitSeconds: 1, durationSeconds: 1, preAllocatedVUs: 1, maxVUs: 1 }

    const merged = withStrategy(fresh, previous)

    equal(merged.type, newType)
    equal(merged.payloadStrategy, 'random')
  }
})


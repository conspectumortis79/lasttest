import { deepEqual, equal, ok } from 'node:assert/strict'
import { test } from 'node:test'
import {
  arrivalRatePreset,
  defaultLoadProfile,
  loadPreset,
  loadProfileLabel,
  MAX_DURATION_SECONDS,
  MAX_ITERATIONS,
  MAX_RATE,
  MAX_VIRTUAL_USERS,
  requestsPreset,
  serialiseLoadProfile,
  smokePreset,
  soakPreset,
  spikePreset,
  stressPreset,
  validateLoadProfile,
  type LoadProfile,
  type LoadStage,
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
  // Plateaus (z. B. 50 VUs für 5 min halten) sind ein klassisches
  // Lasttest-Muster und müssen erlaubt sein.
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
  // preAllocatedVUs ist gültig (<= MAX), aber maxVUs überschreitet
  // MAX_PRE_ALLOCATED_VUS. Dadurch erreichen wir die letzte Oder-
  // Verzweigung in `validateLoadProfile`.
  const profile: LoadProfile = {
    type: 'constant-arrival-rate',
    rate: 50, timeUnitSeconds: 1, durationSeconds: 60, preAllocatedVUs: 10, maxVUs: 30_001,
  }
  const error = validateLoadProfile(profile)
  ok(error?.includes('maxVUs'))
})

test('rejects constant-arrival-rate with invalid duration (caught after rate and timeUnit)', () => {
  // Dieser Pfad ist nur erreichbar, wenn rate und timeUnit gültig sind.
  // Die `if (durationError) return durationError`-Verzweigung wird
  // nur getroffen, wenn der Aufrufer ein Profil mit ungültiger Dauer
  // aber gültiger Rate und gültiger Zeiteinheit schickt.
  const profile: LoadProfile = {
    type: 'constant-arrival-rate',
    rate: 50, timeUnitSeconds: 1, durationSeconds: 0, preAllocatedVUs: 10, maxVUs: 100,
  }
  const error = validateLoadProfile(profile)
  ok(error?.includes('Dauer'))
})

test('rejects constant-arrival-rate with invalid preAllocatedVUs (caught after duration)', () => {
  // Analog: preAllocatedVUs ungültig lassen, alles davor gültig.
  const profile: LoadProfile = {
    type: 'constant-arrival-rate',
    rate: 50, timeUnitSeconds: 1, durationSeconds: 60, preAllocatedVUs: 0, maxVUs: 100,
  }
  const error = validateLoadProfile(profile)
  ok(error?.includes('preAllocatedVUs'))
})

test('rejects constant-arrival-rate with non-integer maxVUs', () => {
  // Defensive: `!Number.isInteger(maxVUs)` als erste Oder-Verzweigung.
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
  // Zweite Verzweigung der `||`-Verkettung: `startVUs > MAX` ohne
  // den `< 0`-Pfad zu treffen.
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
  // Verifies that the new "Anfragen" preset (Mouseover: "1 000 Anfragen
  // so schnell wie möglich") is correctly typed and has the defaults
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
  // Deckt den Fall ab, dass `Math.max(...[])` aufgerufen wird.
  // V8 erfasst den leeren-Spread-Pfad als Branch.
  const label = loadProfileLabel({ type: 'ramping-vus', startVUs: 0, stages: [] })
  ok(label.includes('0 Stages'))
})

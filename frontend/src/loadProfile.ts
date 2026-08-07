// Frontend mirror of the backend LoadProfile sealed shape. The discriminator
// is `type` so the JSON the frontend POSTs to /api/test-runs matches what the
// backend deserialises. The order of the union members also drives the order
// of the profile selector in the editor, so the most common profiles (constant
// load, then iterations) come first.

export const MAX_VIRTUAL_USERS = 30000
export const MAX_DURATION_SECONDS = 3600
export const MAX_ITERATIONS = 1_000_000
export const MAX_RATE = 100_000
export const MAX_PRE_ALLOCATED_VUS = 30_000

// The k6 arrival-rate executor accepts a timeUnit suffix of any positive
// integer number of seconds (k6 itself supports up to '60s'). We mirror that
// range so the validator cannot silently let through '5m' which the executor
// would reject at runtime.
export const ALLOWED_TIME_UNITS_SECONDS: readonly number[] = Array.from({ length: 60 }, (_, index) => index + 1)

export type LoadProfileType = 'constant-vus' | 'shared-iterations' | 'ramping-vus' | 'constant-arrival-rate'

/**
 * How the generator picks the next payload from a per-endpoint pool
 * each time k6 runs an iteration. `sequential` walks the pool top to
 * bottom and wraps around; `random` picks one at random. The strategy
 * is optional on the wire — when omitted the backend defaults to
 * `sequential` (which is also the only behaviour that makes sense for
 * a single-payload pool, i.e. the legacy single-dataset layout).
 */
export type PayloadStrategy = 'sequential' | 'random'

export const PAYLOAD_STRATEGIES: readonly PayloadStrategy[] = ['sequential', 'random'] as const

export function isPayloadStrategy(value: unknown): value is PayloadStrategy {
  return value === 'sequential' || value === 'random'
}

export type LoadStage = {
  target: number
  durationSeconds: number
}

export type LoadProfile =
  | { type: 'constant-vus', virtualUsers: number, durationSeconds: number, payloadStrategy?: PayloadStrategy }
  | { type: 'shared-iterations', virtualUsers: number, iterations: number, payloadStrategy?: PayloadStrategy }
  | { type: 'ramping-vus', startVUs: number, stages: LoadStage[], payloadStrategy?: PayloadStrategy }
  | { type: 'constant-arrival-rate', rate: number, timeUnitSeconds: number, durationSeconds: number, preAllocatedVUs: number, maxVUs: number, payloadStrategy?: PayloadStrategy }

export type LoadProfileValidation =
  | { valid: true }
  | { valid: false, message: string }

// ---- Factory & presets ------------------------------------------------------
//
// A preset returns a fully-validated profile the user can edit. The presets
// exist to give the editor a one-click "smoke test" / "spike" / "soak"
// affordance; the resulting profile is still a normal LoadProfile and the
// user is free to change every field afterwards. Keeping the presets as
// pure functions makes them trivially testable and free of UI concerns.

export function defaultLoadProfile(): LoadProfile {
  return { type: 'constant-vus', virtualUsers: 10, durationSeconds: 30 }
}

export function smokePreset(): LoadProfile {
  // 1 VU for 30 s — used as a CI pre-flight gate.
  return { type: 'constant-vus', virtualUsers: 1, durationSeconds: 30 }
}

export function loadPreset(): LoadProfile {
  // Classic "step up to N, hold, step down" shape — the textbook k6 example.
  return {
    type: 'ramping-vus',
    startVUs: 0,
    stages: [
      { target: 0, durationSeconds: 30 },
      { target: 50, durationSeconds: 60 },
      { target: 50, durationSeconds: 300 },
      { target: 0, durationSeconds: 30 },
    ],
  }
}

export function stressPreset(): LoadProfile {
  // Stepwise increase to find the breaking point. Each step holds 1 minute
  // so a transient blip does not abort the run prematurely.
  return {
    type: 'ramping-vus',
    startVUs: 0,
    stages: [
      { target: 0, durationSeconds: 30 },
      { target: 50, durationSeconds: 60 },
      { target: 100, durationSeconds: 60 },
      { target: 200, durationSeconds: 60 },
      { target: 400, durationSeconds: 60 },
      { target: 0, durationSeconds: 30 },
    ],
  }
}

export function spikePreset(): LoadProfile {
  // Sharp jump to a high target, brief plateau, sharp drop. The ramp from
  // 0 to 800 in 10s is the spike; the 30s plateau is what k6 actually
  // needs to observe the failure mode (autoscaling kick-in, queue
  // saturation, cache stampede).
  return {
    type: 'ramping-vus',
    startVUs: 0,
    stages: [
      { target: 0, durationSeconds: 10 },
      { target: 800, durationSeconds: 10 },
      { target: 800, durationSeconds: 30 },
      { target: 0, durationSeconds: 30 },
    ],
  }
}

export function soakPreset(): LoadProfile {
  // Constant 50 VUs for an hour. The 5-minute ramp lets JVM/GC warm up
  // and connection pools settle so the actual measurement window is
  // representative.
  return {
    type: 'ramping-vus',
    startVUs: 0,
    stages: [
      { target: 0, durationSeconds: 60 },
      { target: 50, durationSeconds: 300 },
      { target: 50, durationSeconds: 3300 },
      { target: 0, durationSeconds: 60 },
    ],
  }
}

export function arrivalRatePreset(): LoadProfile {
  // 50 req/s for 2 minutes, with a small VU pool that k6 can grow on
  // demand. Good baseline for measuring true server throughput, decoupled
  // from VU counts.
  return { type: 'constant-arrival-rate', rate: 50, timeUnitSeconds: 1, durationSeconds: 120, preAllocatedVUs: 10, maxVUs: 200 }
}

export function requestsPreset(): LoadProfile {
  // 1,000 requests as fast as possible, with 10 parallel VUs.
  // Ideal for smoke tests that measure response times without
  // prescribing a fixed runtime.
  return { type: 'shared-iterations', virtualUsers: 10, iterations: 1000 }
}

// ---- Validation -------------------------------------------------------------

/**
 * Returns the first validation problem for the profile, or undefined when
 * the profile is valid. The frontend calls this before POSTing the test
 * run so the user sees a localised error instead of a 400 from the
 * backend. The backend re-validates the same shape independently.
 */
export function validateLoadProfile(profile: LoadProfile): string | undefined {
  // Payload strategy is optional on the wire: omitting it means
  // "sequential" on the backend. The check lives in front of the
  // type-specific switch so we surface the wrong-enum error before
  // unrelated field problems.
  const strategyError = validatePayloadStrategy(profile.payloadStrategy)
  if (strategyError) return strategyError
  switch (profile.type) {
    case 'constant-vus':
      return validateIntegerInRange('Virtual Users', profile.virtualUsers, 1, MAX_VIRTUAL_USERS)
        ?? validateIntegerInRange('Dauer', profile.durationSeconds, 1, MAX_DURATION_SECONDS, 'Sekunden', { prefix: 'Die ', verb: 'muss' })
    case 'shared-iterations':
      return validateIntegerInRange('Virtual Users', profile.virtualUsers, 1, MAX_VIRTUAL_USERS)
        ?? validateIntegerInRange('Iterationen', profile.iterations, 1, MAX_ITERATIONS)
    case 'ramping-vus': {
      const startError = profile.startVUs < 0 || profile.startVUs > MAX_VIRTUAL_USERS
        ? `Start-VUs müssen zwischen 0 und ${MAX_VIRTUAL_USERS} liegen.`
        : undefined
      if (startError) return startError
      if (profile.stages.length === 0) return 'Ramping-VUs benötigen mindestens eine Stage.'
      for (let index = 0; index < profile.stages.length; index++) {
        const stage = profile.stages[index]
        const stageNumber = index + 1
        if (!Number.isInteger(stage.target) || stage.target < 0 || stage.target > MAX_VIRTUAL_USERS) {
          return `Stage ${stageNumber}: Ziel-VUs müssen zwischen 0 und ${MAX_VIRTUAL_USERS} liegen.`
        }
        if (!Number.isInteger(stage.durationSeconds) || stage.durationSeconds < 1 || stage.durationSeconds > MAX_DURATION_SECONDS) {
          return `Stage ${stageNumber}: Dauer muss zwischen 1 und ${MAX_DURATION_SECONDS} Sekunden liegen.`
        }
        // Consecutive stages with the same target are allowed:
        // they model a plateau (e.g. holding 50 VUs for 5 min),
        // which is a classic load-test pattern. Only stages with
        // target == 0 AND duration == 0 would be redundant — but
        // duration is already validated against [1, MAX_DURATION_SECONDS]
        // above.
      }
      return undefined
    }
    case 'constant-arrival-rate': {
      const rateError = validateIntegerInRange('Rate', profile.rate, 1, MAX_RATE)
      if (rateError) return rateError
      if (!ALLOWED_TIME_UNITS_SECONDS.includes(profile.timeUnitSeconds)) {
        return 'Zeiteinheit muss eine Sekundenzahl zwischen 1 und 60 sein.'
      }
      const durationError = validateIntegerInRange('Dauer', profile.durationSeconds, 1, MAX_DURATION_SECONDS, 'Sekunden', { prefix: 'Die ', verb: 'muss' })
      if (durationError) return durationError
      const preAllocatedError = validateIntegerInRange('preAllocatedVUs', profile.preAllocatedVUs, 1, MAX_PRE_ALLOCATED_VUS)
      if (preAllocatedError) return preAllocatedError
      if (!Number.isInteger(profile.maxVUs) || profile.maxVUs < profile.preAllocatedVUs || profile.maxVUs > MAX_PRE_ALLOCATED_VUS) {
        return `maxVUs muss ≥ preAllocatedVUs und ≤ ${MAX_PRE_ALLOCATED_VUS} sein.`
      }
      return undefined
    }
  }
}

function validatePayloadStrategy(strategy: unknown): string | undefined {
  if (strategy === undefined) return undefined
  if (isPayloadStrategy(strategy)) return undefined
  return 'Payload-Strategie muss "sequential" oder "random" sein.'
}

function validateIntegerInRange(
  label: string,
  value: number,
  min: number,
  max: number,
  unit = '',
  options: { prefix?: string, verb?: 'müssen' | 'muss' } = {},
): string | undefined {
  if (!Number.isInteger(value) || value < min || value > max) {
    const prefix = options.prefix ?? ''
    const verb = options.verb ?? 'müssen'
    const display = `${prefix}${label}`
    return unit
      ? `${display} ${verb} zwischen ${min} und ${max} ${unit} liegen.`
      : `${display} ${verb} zwischen ${min} und ${max} liegen.`
  }
  return undefined
}

// ---- Serialisation ----------------------------------------------------------
//
// The backend speaks seconds for every timeUnit and duration, so the
// frontend keeps the same unit internally. The serialiser is the single
// place where we *could* convert to milliseconds; we deliberately do not
// because the k6 generated script reads the value as-is.

export type SerialisedLoadProfile = {
  type: LoadProfileType
  virtualUsers?: number
  durationSeconds?: number
  iterations?: number
  useIterations?: boolean
  startVUs?: number
  stages?: LoadStage[]
  rate?: number
  timeUnit?: number
  preAllocatedVUs?: number
  maxVUs?: number
  payloadStrategy?: PayloadStrategy
}

export function serialiseLoadProfile(profile: LoadProfile): SerialisedLoadProfile {
  const strategy = profile.payloadStrategy
  switch (profile.type) {
    case 'constant-vus':
      return strategy === undefined
        ? { type: profile.type, virtualUsers: profile.virtualUsers, durationSeconds: profile.durationSeconds }
        : { type: profile.type, virtualUsers: profile.virtualUsers, durationSeconds: profile.durationSeconds, payloadStrategy: strategy }
    case 'shared-iterations':
      return strategy === undefined
        ? { type: profile.type, virtualUsers: profile.virtualUsers, iterations: profile.iterations, useIterations: true }
        : { type: profile.type, virtualUsers: profile.virtualUsers, iterations: profile.iterations, useIterations: true, payloadStrategy: strategy }
    case 'ramping-vus':
      return strategy === undefined
        ? { type: profile.type, startVUs: profile.startVUs, stages: profile.stages.map(stage => ({ ...stage })) }
        : { type: profile.type, startVUs: profile.startVUs, stages: profile.stages.map(stage => ({ ...stage })), payloadStrategy: strategy }
    case 'constant-arrival-rate':
      return strategy === undefined
        ? {
            type: profile.type,
            rate: profile.rate,
            timeUnit: profile.timeUnitSeconds,
            durationSeconds: profile.durationSeconds,
            preAllocatedVUs: profile.preAllocatedVUs,
            maxVUs: profile.maxVUs,
          }
        : {
            type: profile.type,
            rate: profile.rate,
            timeUnit: profile.timeUnitSeconds,
            durationSeconds: profile.durationSeconds,
            preAllocatedVUs: profile.preAllocatedVUs,
            maxVUs: profile.maxVUs,
            payloadStrategy: strategy,
          }
  }
}

// ---- Display helpers --------------------------------------------------------
//
// Used by both the editor (preview) and the report (which profile did the
// run actually use). Kept here so the strings live next to the data shape.

export function loadProfileLabel(profile: LoadProfile): string {
  switch (profile.type) {
    case 'constant-vus':
      return `Konstante Last · ${profile.virtualUsers} VUs für ${profile.durationSeconds} s`
    case 'shared-iterations':
      return `${profile.iterations} parallele Anfragen, so schnell wie möglich`
    case 'ramping-vus':
      return `Ramping-VUs · ${profile.stages.length} Stages, Spitze ${Math.max(...profile.stages.map(stage => stage.target))} VUs`
    case 'constant-arrival-rate':
      return `Constant-Arrival-Rate · ${profile.rate} Anfragen/${profile.timeUnitSeconds}s für ${profile.durationSeconds} s`
  }
}

export type ApiParameter = {
  name: string
  location: string
  required: boolean
  example: unknown
  schema?: ParameterSchema
}

export type ParameterSchemaType = 'string' | 'integer' | 'number' | 'boolean'

export type ParameterSchema = {
  type: ParameterSchemaType
  format?: string
  enum?: string[]
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  pattern?: string
}

export type ParameterValidation =
  | { valid: true }
  | { valid: false, message: string }

export type RequestBodySchema = {
  type: string
  properties: Record<string, ParameterSchema>
  required: string[]
}

export type OperationValidation = {
  parameterErrors: Record<string, string>
  bodyError?: string
}

export function isOperationValid(validation: OperationValidation): boolean {
  return Object.keys(validation.parameterErrors).length === 0 && validation.bodyError === undefined
}

export type Operation = {
  operationId: string
  method: string
  path: string
  summary: string
  destructive: boolean
  parameters: ApiParameter[]
  requestBodyExample: unknown
  requestBodySchema?: RequestBodySchema
  hasRequestBody: boolean
  requestBodyRequired: boolean
  bearerAuth: boolean
}

export type ApiServer = {
  url: string
  description: string | null
}

export type ImportedSpecification = {
  title: string
  version: string
  baseUrl: string
  operations: Operation[]
  servers: ApiServer[]
}

export function hasMultipleServers(servers: ApiServer[] | undefined): boolean {
  return (servers?.length ?? 0) > 1
}

export type OperationSettings = {
  /**
   * Pool of complete request datasets. At least one payload is required.
   * This is the new source of truth — the legacy `parameterValues`,
   * `requestBodyJson`, `bearerToken` fields below are derived from
   * `payloads[0]` once the settings have been migrated.
   */
  payloads: OperationPayload[]
  /**
   * @deprecated Derived from `payloads[0]`. Retained for legacy code paths
   * (e.g. settings stored before the pool migration ran) and removed in a
   * later commit once all callers are migrated.
   */
  parameterValues: Record<string, string>
  /** @deprecated Derived from `payloads[0]`. See `parameterValues`. */
  requestBodyJson: string
  /** @deprecated Derived from `payloads[0]`. See `parameterValues`. */
  bearerToken: string
}

/**
 * One complete request dataset. Holds every value that the k6 generator
 * needs to issue a single HTTP call: path/query/header/cookie parameters,
 * the JSON request body, and an optional bearer token. Multiple
 * `OperationPayload`s in an `OperationSettings.payloads` list represent
 * the different datasets a user wants to cycle or pick at random.
 */
export type OperationPayload = {
  parameterValues: Record<string, string>
  requestBodyJson: string
  bearerToken: string
}

export type OperationConfiguration = {
  operationId: string
  /**
   * Pool of complete request datasets. The k6 generator uses this
   * list to pick the next payload on every iteration according to
   * the load profile's `payloadStrategy`. The legacy flat fields
   * below are kept in sync with `payloads[0]` so backend clients
   * that have not migrated yet still receive the right values.
   */
  payloads: Array<{
    parameterValues: Array<{ name: string, location: string, value: string }>
    requestBodyJson?: string
    bearerToken?: string
  }>
  /** @deprecated Derived from `payloads[0]`. */
  parameterValues: Array<{ name: string, location: string, value: string }>
  /** @deprecated Derived from `payloads[0]`. */
  requestBodyJson?: string
  /** @deprecated Derived from `payloads[0]`. */
  bearerToken?: string
}

export function parameterKey(parameter: Pick<ApiParameter, 'location' | 'name'>): string {
  return `${parameter.location}:${parameter.name}`
}

export function createOperationSettings(operations: Operation[]): Record<string, OperationSettings> {
  return Object.fromEntries(
    operations.map(operation => {
      const seedParameterValues = Object.fromEntries(
        operation.parameters.map(parameter => [parameterKey(parameter), formatExample(parameter.example)]),
      )
      const seedRequestBodyJson = operation.requestBodyExample == null ? '' : JSON.stringify(operation.requestBodyExample, null, 2)
      const seedBearerToken = ''
      // The pool is the single source of truth: `buildOperationConfigurations`
      // and `validateOperationSettings` both read from `payloads[0]`. The
      // legacy flat fields are seeded with the same values for
      // backward compatibility (existing callers can still read them),
      // but the pool is what the rest of the pipeline uses.
      const seed: OperationPayload = {
        parameterValues: { ...seedParameterValues },
        requestBodyJson: seedRequestBodyJson,
        bearerToken: seedBearerToken,
      }
      const settings: OperationSettings = {
        payloads: [seed],
        parameterValues: { ...seedParameterValues },
        requestBodyJson: seedRequestBodyJson,
        bearerToken: seedBearerToken,
      }
      return [operation.operationId, settings]
    }),
  )
}

/**
 * Idempotent migration from the legacy flat field layout
 * (`parameterValues` + `requestBodyJson` + `bearerToken`) to the new pool
 * shape (`payloads[]`). If `payloads` already contains at least one entry
 * the settings are returned untouched; otherwise a single payload is
 * synthesised from the deprecated fields. The legacy fields are kept in
 * sync so any code path that still reads them continues to work.
 */
export function migrateOperationSettings(settings: OperationSettings): OperationSettings {
  if (settings.payloads.length > 0) {
    return settings
  }
  const seed: OperationPayload = {
    parameterValues: { ...settings.parameterValues },
    requestBodyJson: settings.requestBodyJson,
    bearerToken: settings.bearerToken,
  }
  return {
    payloads: [seed],
    parameterValues: { ...settings.parameterValues },
    requestBodyJson: settings.requestBodyJson,
    bearerToken: settings.bearerToken,
  }
}

export function buildOperationConfigurations(
  operations: Operation[],
  selected: Set<string>,
  settingsByOperationId: Record<string, OperationSettings>,
): OperationConfiguration[] {
  return operations.filter(operation => selected.has(operation.operationId)).map(operation => {
    const rawSettings = settingsByOperationId[operation.operationId]
    if (!rawSettings) throw new Error(`Konfiguration für ${operation.operationId} fehlt.`)
    // Pull the latest settings through the migration so code that still
    // hands us a pre-pool layout (legacy fields only, empty `payloads`)
    // gets a synthetic single payload to work with. The migrated
    // settings always have at least one payload to serialise.
    const settings = migrateOperationSettings(rawSettings)

    // Helper: convert one OperationPayload to the wire shape the
    // backend expects. Validates required parameters and JSON
    // bodies for *every* payload in the pool — a malformed entry
    // must not silently ship to k6.
    const serialisePayload = (payload: OperationPayload) => {
      const wireParameterValues = operation.parameters.map(parameter => {
        const value = payload.parameterValues[parameterKey(parameter)] ?? ''
        if (parameter.required && value.trim() === '') {
          throw new Error(`Pflichtparameter „${parameter.name}“ für ${operation.operationId} darf nicht leer sein.`)
        }
        return { name: parameter.name, location: parameter.location, value }
      })
      const wireRequestBodyJson = operation.hasRequestBody ? payload.requestBodyJson : undefined
      if (operation.requestBodyRequired && wireRequestBodyJson?.trim() === '') {
        throw new Error(`Pflicht-Request-Body für ${operation.operationId} darf nicht leer sein.`)
      }
      if (wireRequestBodyJson?.trim()) {
        try {
          JSON.parse(wireRequestBodyJson)
        } catch {
          throw new Error(`Request-Body für ${operation.operationId} ist kein gültiges JSON.`)
        }
      }
      return {
        parameterValues: wireParameterValues,
        requestBodyJson: wireRequestBodyJson,
        bearerToken: payload.bearerToken.trim() || undefined,
      }
    }

    // Serialise the full pool so the backend can hand every entry to
    // the k6 generator (which then picks the next one per iteration
    // according to the load profile's payloadStrategy). The legacy
    // flat fields stay in sync with payloads[0] so old clients keep
    // receiving the same data.
    const payloads = settings.payloads.map(serialisePayload)

    return {
      operationId: operation.operationId,
      payloads,
      parameterValues: payloads[0].parameterValues,
      requestBodyJson: payloads[0].requestBodyJson,
      bearerToken: payloads[0].bearerToken,
    }
  })
}

function formatExample(example: unknown): string {
  if (example == null) return ''
  if (typeof example === 'object') return JSON.stringify(example)
  return String(example)
}

const INT32_MIN = -2147483648
const INT32_MAX = 2147483647
const INT64_MIN = Number.MIN_SAFE_INTEGER
const INT64_MAX = Number.MAX_SAFE_INTEGER
const FLOAT_MAX = 3.4028234663852886e38

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateParameterValue(value: string, schema: ParameterSchema | undefined): ParameterValidation {
  if (schema === undefined) return { valid: true }
  if (value === '') return { valid: true }
  switch (schema.type) {
    case 'string':
      return validateString(value, schema)
    case 'integer':
      return validateInteger(value, schema)
    case 'number':
      return validateNumber(value, schema)
    case 'boolean':
      return validateBoolean(value)
    default:
      return { valid: true }
  }
}

export function validateJsonValue(value: unknown, schema: ParameterSchema): ParameterValidation {
  switch (schema.type) {
    case 'string':
      return typeof value === 'string' ? validateString(value, schema) : { valid: false, message: 'Ungültig: erwartet einen Textwert.' }
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) return { valid: false, message: integerRangeMessage(schema) }
      return integerBoundariesMessage(String(value), schema)
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return { valid: false, message: numberRangeMessage(schema) }
      if (schema.format === 'float' && Math.abs(value) > FLOAT_MAX) return { valid: false, message: 'Ungültig: Wert überschreitet den Float-Bereich.' }
      return numberBoundariesMessage(value, schema)
    case 'boolean':
      return typeof value === 'boolean' ? { valid: true } : { valid: false, message: 'Ungültig: erwartet einen Wahrheitswert (true/false).' }
    default:
      return { valid: true }
  }
}

export function validateRequestBody(bodyJson: string, schema: RequestBodySchema | undefined | null, required = false): ParameterValidation {
  if (schema == null) return { valid: true }
  const trimmed = bodyJson.trim()
  if (trimmed === '') {
    return required
      ? { valid: false, message: 'Ungültig: Pflicht-Request-Body ist leer.' }
      : { valid: true }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return { valid: false, message: 'Ungültig: kein gültiges JSON.' }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { valid: false, message: 'Ungültig: JSON-Body muss ein Objekt sein.' }
  }
  const record = parsed as Record<string, unknown>
  for (const name of schema.required ?? []) {
    if (!(name in record)) {
      return { valid: false, message: `Ungültig: Pflichtfeld „${name}“ fehlt.` }
    }
  }
  for (const [name, propertySchema] of Object.entries(schema.properties ?? {})) {
    if (!(name in record)) continue
    const value = record[name]
    const result = validateJsonValue(value, propertySchema)
    if (!result.valid) {
      return { valid: false, message: `Ungültig: Feld „${name}“ – ${result.message.replace(/^Ungültig: /, '')}` }
    }
  }
  return { valid: true }
}

export function validateOperationSettings(operation: Operation, settings: OperationSettings | undefined): OperationValidation {
  const parameterErrors: Record<string, string> = {}
  if (settings !== undefined) {
    // Run the migration so settings handed in without `payloads` (legacy
    // field-only layout) are still validated against the synthetic first
    // payload — same behaviour the user sees after the pool is in place.
    const active = migrateOperationSettings(settings).payloads[0]
    for (const parameter of operation.parameters) {
      const key = parameterKey(parameter)
      const value = active.parameterValues[key] ?? ''
      const result = validateParameterValue(value, parameter.schema)
      if (!result.valid) parameterErrors[key] = result.message
    }
    if (operation.hasRequestBody) {
      const bodyResult = validateRequestBody(active.requestBodyJson, operation.requestBodySchema, operation.requestBodyRequired)
      if (!bodyResult.valid) {
        return { parameterErrors, bodyError: bodyResult.message }
      }
    }
  }
  return { parameterErrors }
}

function validateString(value: string, schema: ParameterSchema): ParameterValidation {
  if (schema.enum != null && !schema.enum.includes(value)) {
    return { valid: false, message: `Ungültig: erwartet einen Wert aus ${formatEnum(schema.enum)}.` }
  }
  if (schema.minLength !== undefined && value.length < schema.minLength) {
    return { valid: false, message: `Ungültig: mindestens ${schema.minLength} Zeichen erforderlich.` }
  }
  if (schema.maxLength !== undefined && value.length > schema.maxLength) {
    return { valid: false, message: `Ungültig: höchstens ${schema.maxLength} Zeichen erlaubt.` }
  }
  if (schema.pattern !== undefined && !stringMatchesPattern(value, schema.pattern)) {
    return { valid: false, message: `Ungültig: Wert entspricht nicht dem erwarteten Muster.` }
  }
  if (schema.format !== undefined) {
    return validateStringFormat(value, schema.format)
  }
  return { valid: true }
}

function validateStringFormat(value: string, format: string): ParameterValidation {
  switch (format) {
    case 'uuid':
      return UUID_PATTERN.test(value)
        ? { valid: true }
        : { valid: false, message: 'Ungültig: erwartet eine UUID.' }
    case 'date':
      return DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(value))
        ? { valid: true }
        : { valid: false, message: 'Ungültig: erwartet ein Datum im Format JJJJ-MM-TT.' }
    case 'date-time':
      return DATETIME_PATTERN.test(value) && !Number.isNaN(Date.parse(value))
        ? { valid: true }
        : { valid: false, message: 'Ungültig: erwartet einen Zeitstempel im ISO-8601-Format.' }
    case 'email':
      return EMAIL_PATTERN.test(value)
        ? { valid: true }
        : { valid: false, message: 'Ungültig: erwartet eine E-Mail-Adresse.' }
    default:
      return { valid: true }
  }
}

function validateInteger(value: string, schema: ParameterSchema): ParameterValidation {
  if (!/^-?\d+$/.test(value)) {
    return { valid: false, message: integerRangeMessage(schema) }
  }
  const parsed = Number(value)
  const bounds = integerBounds(schema.format)
  if (parsed < bounds.min || parsed > bounds.max) {
    return { valid: false, message: integerRangeMessage(schema) }
  }
  return integerBoundariesMessage(value, schema)
}

function validateNumber(value: string, schema: ParameterSchema): ParameterValidation {
  const trimmed = value.trim()
  if (!/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(trimmed) && !/^-?\.\d+([eE][+-]?\d+)?$/.test(trimmed)) {
    return { valid: false, message: numberRangeMessage(schema) }
  }
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) {
    return { valid: false, message: numberRangeMessage(schema) }
  }
  if (schema.format === 'float' && Math.abs(parsed) > FLOAT_MAX) {
    return { valid: false, message: 'Ungültig: Wert überschreitet den Float-Bereich.' }
  }
  return numberBoundariesMessage(parsed, schema)
}

function validateBoolean(value: string): ParameterValidation {
  if (value === 'true' || value === 'false' || value === '1' || value === '0') {
    return { valid: true }
  }
  return { valid: false, message: 'Ungültig: erwartet true oder false.' }
}

function integerBounds(format: string | undefined): { min: number, max: number } {
  if (format === 'int32') return { min: INT32_MIN, max: INT32_MAX }
  return { min: INT64_MIN, max: INT64_MAX }
}

function integerRangeMessage(schema: ParameterSchema): string {
  const expected = schema.format === 'int32' ? 'int32' : 'long'
  return `Ungültig: erwartet eine Ganzzahl (${expected}).`
}

function integerBoundariesMessage(value: string, schema: ParameterSchema): ParameterValidation {
  const parsed = Number(value)
  if (schema.minimum !== undefined && parsed < schema.minimum) {
    return { valid: false, message: `Ungültig: Wert muss ≥ ${schema.minimum} sein.` }
  }
  if (schema.maximum !== undefined && parsed > schema.maximum) {
    return { valid: false, message: `Ungültig: Wert muss ≤ ${schema.maximum} sein.` }
  }
  return { valid: true }
}

function numberRangeMessage(schema: ParameterSchema): string {
  const expected = schema.format === 'float' ? 'float' : 'double'
  return `Ungültig: erwartet eine Zahl (${expected}).`
}

function numberBoundariesMessage(parsed: number, schema: ParameterSchema): ParameterValidation {
  if (schema.minimum !== undefined && parsed < schema.minimum) {
    return { valid: false, message: `Ungültig: Wert muss ≥ ${schema.minimum} sein.` }
  }
  if (schema.maximum !== undefined && parsed > schema.maximum) {
    return { valid: false, message: `Ungültig: Wert muss ≤ ${schema.maximum} sein.` }
  }
  return { valid: true }
}

function stringMatchesPattern(value: string, pattern: string): boolean {
  try {
    return new RegExp(`^(?:${pattern})$`).test(value)
  } catch {
    return true
  }
}

function formatEnum(values: string[]): string {
  if (values.length === 1) return `„${values[0]}“`
  if (values.length === 2) return `„${values[0]}“ oder „${values[1]}“`
  return `„${values.slice(0, -1).join('“, „')}“ oder „${values.at(-1)!}“`
}

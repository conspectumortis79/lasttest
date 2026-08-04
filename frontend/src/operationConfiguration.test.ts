import { deepEqual, equal, ok, throws } from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildOperationConfigurations,
  createOperationSettings,
  hasMultipleServers,
  isOperationValid,
  parameterKey,
  validateJsonValue,
  validateOperationSettings,
  validateParameterValue,
  validateRequestBody,
  type ApiServer,
  type Operation,
  type OperationSettings,
  type ParameterSchema,
  type RequestBodySchema,
} from './operationConfiguration.ts'

const getOperation: Operation = {
  operationId: 'getPet',
  method: 'GET',
  path: '/pets/{id}',
  summary: 'Get pet',
  destructive: false,
  parameters: [
    { name: 'id', location: 'path', required: true, example: 7 },
    { name: 'expand', location: 'query', required: false, example: 'owner' },
  ],
  requestBodyExample: null,
  hasRequestBody: false,
  requestBodyRequired: false,
  bearerAuth: true,
}

const postOperation: Operation = {
  operationId: 'createPet',
  method: 'POST',
  path: '/pets',
  summary: 'Create pet',
  destructive: true,
  parameters: [],
  requestBodyExample: { name: 'Fido' },
  hasRequestBody: true,
  requestBodyRequired: true,
  bearerAuth: false,
}

test('creates editable settings from OpenAPI examples', () => {
  const settings = createOperationSettings([getOperation, postOperation])

  equal(settings.getPet.parameterValues[parameterKey(getOperation.parameters[0])], '7')
  equal(settings.getPet.parameterValues[parameterKey(getOperation.parameters[1])], 'owner')
  equal(settings.createPet.requestBodyJson, '{\n  "name": "Fido"\n}')
})

test('builds endpoint-specific parameter, body, and bearer overrides', () => {
  const settings = createOperationSettings([getOperation, postOperation])
  settings.getPet.parameterValues['path:id'] = '42'
  settings.getPet.bearerToken = 'secret-token'
  settings.createPet.requestBodyJson = '{"name":"Luna"}'

  const configurations = buildOperationConfigurations([getOperation, postOperation], new Set(['getPet', 'createPet']), settings)

  deepEqual(configurations[0], {
    operationId: 'getPet',
    parameterValues: [
      { name: 'id', location: 'path', value: '42' },
      { name: 'expand', location: 'query', value: 'owner' },
    ],
    requestBodyJson: undefined,
    bearerToken: 'secret-token',
  })
  equal(configurations[1].requestBodyJson, '{"name":"Luna"}')
})

test('rejects an empty required parameter and malformed JSON', () => {
  const settings = createOperationSettings([getOperation, postOperation])
  settings.getPet.parameterValues['path:id'] = ''

  throws(
    () => buildOperationConfigurations([getOperation], new Set(['getPet']), settings),
    /Pflichtparameter/,
  )

  settings.createPet.requestBodyJson = '{invalid}'
  throws(
    () => buildOperationConfigurations([postOperation], new Set(['createPet']), settings),
    /kein gültiges JSON/,
  )
})

test('formats null, object, and primitive parameter examples', () => {
  const operation: Operation = {
    ...getOperation,
    operationId: 'examples',
    parameters: [
      { name: 'empty', location: 'query', required: false, example: null },
      { name: 'filter', location: 'query', required: false, example: { active: true } },
      { name: 'enabled', location: 'query', required: false, example: false },
    ],
  }

  const settings = createOperationSettings([operation]).examples

  equal(settings.parameterValues['query:empty'], '')
  equal(settings.parameterValues['query:filter'], '{"active":true}')
  equal(settings.parameterValues['query:enabled'], 'false')
})

test('rejects missing settings and an empty required body', () => {
  throws(
    () => buildOperationConfigurations([getOperation], new Set(['getPet']), {}),
    /Konfiguration für getPet fehlt/,
  )

  const settings = createOperationSettings([postOperation])
  settings.createPet.requestBodyJson = ''
  throws(
    () => buildOperationConfigurations([postOperation], new Set(['createPet']), settings),
    /Pflicht-Request-Body/,
  )
})

test('returns no configuration when no operation is selected', () => {
  const settings = createOperationSettings([getOperation])

  deepEqual(buildOperationConfigurations([getOperation], new Set(), settings), [])
})

test('defaults a missing optional setting to an empty value', () => {
  const settings = createOperationSettings([getOperation])
  delete settings.getPet.parameterValues['query:expand']

  const configuration = buildOperationConfigurations([getOperation], new Set(['getPet']), settings)[0]

  equal(configuration.parameterValues[1].value, '')
})

test('allows an optional request body to be empty', () => {
  const optionalBody = { ...postOperation, operationId: 'optionalBody', requestBodyRequired: false, requestBodyExample: null }
  const settings = createOperationSettings([optionalBody])

  const configuration = buildOperationConfigurations([optionalBody], new Set(['optionalBody']), settings)[0]

  equal(configuration.requestBodyJson, '')
})

test('allows an optional parameter to be cleared', () => {
  const settings = createOperationSettings([getOperation])
  settings.getPet.parameterValues['query:expand'] = ''

  const configurations = buildOperationConfigurations([getOperation], new Set(['getPet']), settings)

  equal(configurations[0].parameterValues[1].value, '')
})

test('hasMultipleServers shows the selector only when the spec declares more than one server', () => {
  equal(hasMultipleServers(undefined), false)
  equal(hasMultipleServers([]), false)
  equal(hasMultipleServers([{ url: 'https://api.example.com', description: 'Production' }]), false)
  equal(
    hasMultipleServers([
      { url: 'https://api.example.com', description: 'Production' },
      { url: 'https://staging.example.com', description: 'Staging' },
    ]),
    true,
  )
})

test('hasMultipleServers treats null description as a valid server', () => {
  const servers: ApiServer[] = [
    { url: 'https://a.example.com', description: null },
    { url: 'https://b.example.com', description: null },
  ]

  equal(hasMultipleServers(servers), true)
})

test('validateParameterValue returns valid when no schema is provided', () => {
  deepEqual(validateParameterValue('anything', undefined), { valid: true })
})

test('validateParameterValue skips validation for empty values', () => {
  const schema: ParameterSchema = { type: 'integer', format: 'int64' }
  deepEqual(validateParameterValue('', schema), { valid: true })
})

test('validateParameterValue validates strings against enums and reports one two or more values', () => {
  deepEqual(validateParameterValue('a', { type: 'string', enum: ['a'] }), { valid: true })
  deepEqual(validateParameterValue('x', { type: 'string', enum: ['a'] }), { valid: false, message: 'Ungültig: erwartet einen Wert aus „a“.' })
  deepEqual(validateParameterValue('x', { type: 'string', enum: ['a', 'b'] }), { valid: false, message: 'Ungültig: erwartet einen Wert aus „a“ oder „b“.' })
  deepEqual(validateParameterValue('x', { type: 'string', enum: ['a', 'b', 'c'] }), { valid: false, message: 'Ungültig: erwartet einen Wert aus „a“, „b“ oder „c“.' })
})

test('validateParameterValue enforces string length boundaries', () => {
  deepEqual(validateParameterValue('a', { type: 'string', minLength: 2 }), { valid: false, message: 'Ungültig: mindestens 2 Zeichen erforderlich.' })
  deepEqual(validateParameterValue('abcd', { type: 'string', maxLength: 3 }), { valid: false, message: 'Ungültig: höchstens 3 Zeichen erlaubt.' })
  deepEqual(validateParameterValue('abc', { type: 'string', minLength: 1, maxLength: 3 }), { valid: true })
})

test('validateParameterValue validates strings against regex patterns and tolerates invalid regex', () => {
  deepEqual(validateParameterValue('abc', { type: 'string', pattern: '^[a-z]+$' }), { valid: true })
  deepEqual(validateParameterValue('123', { type: 'string', pattern: '^[a-z]+$' }), { valid: false, message: 'Ungültig: Wert entspricht nicht dem erwarteten Muster.' })
  deepEqual(validateParameterValue('anything', { type: 'string', pattern: '[invalid(' }), { valid: true })
})

test('validateParameterValue validates uuid date date-time and email formats', () => {
  deepEqual(validateParameterValue('00000000-0000-4000-8000-000000000001', { type: 'string', format: 'uuid' }), { valid: true })
  deepEqual(validateParameterValue('not-a-uuid', { type: 'string', format: 'uuid' }), { valid: false, message: 'Ungültig: erwartet eine UUID.' })

  deepEqual(validateParameterValue('2026-01-01', { type: 'string', format: 'date' }), { valid: true })
  deepEqual(validateParameterValue('2026-13-99', { type: 'string', format: 'date' }), { valid: false, message: 'Ungültig: erwartet ein Datum im Format JJJJ-MM-TT.' })

  deepEqual(validateParameterValue('2026-01-01T12:30:45Z', { type: 'string', format: 'date-time' }), { valid: true })
  deepEqual(validateParameterValue('not-a-date-time', { type: 'string', format: 'date-time' }), { valid: false, message: 'Ungültig: erwartet einen Zeitstempel im ISO-8601-Format.' })

  deepEqual(validateParameterValue('user@example.com', { type: 'string', format: 'email' }), { valid: true })
  deepEqual(validateParameterValue('not-an-email', { type: 'string', format: 'email' }), { valid: false, message: 'Ungültig: erwartet eine E-Mail-Adresse.' })
})

test('validateParameterValue treats unknown string formats as free text', () => {
  deepEqual(validateParameterValue('whatever', { type: 'string', format: 'byte' }), { valid: true })
})

test('validateParameterValue validates integers as long by default and as int32 when format is set', () => {
  deepEqual(validateParameterValue('not-a-number', { type: 'integer' }), { valid: false, message: 'Ungültig: erwartet eine Ganzzahl (long).' })
  deepEqual(validateParameterValue('not-a-number', { type: 'integer', format: 'int32' }), { valid: false, message: 'Ungültig: erwartet eine Ganzzahl (int32).' })
  deepEqual(validateParameterValue('1e10', { type: 'integer' }), { valid: false, message: 'Ungültig: erwartet eine Ganzzahl (long).' })
})

test('validateParameterValue enforces integer minimum and maximum bounds', () => {
  deepEqual(validateParameterValue('-1', { type: 'integer', minimum: 0 }), { valid: false, message: 'Ungültig: Wert muss ≥ 0 sein.' })
  deepEqual(validateParameterValue('101', { type: 'integer', maximum: 100 }), { valid: false, message: 'Ungültig: Wert muss ≤ 100 sein.' })
  deepEqual(validateParameterValue('50', { type: 'integer', minimum: 0, maximum: 100 }), { valid: true })
})

test('validateParameterValue enforces int32 and int64 range boundaries', () => {
  deepEqual(validateParameterValue('2147483648', { type: 'integer', format: 'int32' }), { valid: false, message: 'Ungültig: erwartet eine Ganzzahl (int32).' })
  deepEqual(validateParameterValue('9007199254740993', { type: 'integer' }), { valid: false, message: 'Ungültig: erwartet eine Ganzzahl (long).' })
  deepEqual(validateParameterValue('9007199254740991', { type: 'integer' }), { valid: true })
  deepEqual(validateParameterValue('-2147483648', { type: 'integer', format: 'int32' }), { valid: true })
})

test('validateParameterValue validates numbers including exponents and leading dots', () => {
  deepEqual(validateParameterValue('not-a-number', { type: 'number' }), { valid: false, message: 'Ungültig: erwartet eine Zahl (double).' })
  deepEqual(validateParameterValue('not-a-number', { type: 'number', format: 'float' }), { valid: false, message: 'Ungültig: erwartet eine Zahl (float).' })
  deepEqual(validateParameterValue('1e1000', { type: 'number' }), { valid: false, message: 'Ungültig: erwartet eine Zahl (double).' })
  deepEqual(validateParameterValue('1.5e3', { type: 'number' }), { valid: true })
  deepEqual(validateParameterValue('.5', { type: 'number' }), { valid: true })
  deepEqual(validateParameterValue('-1.5e-2', { type: 'number' }), { valid: true })
  deepEqual(validateParameterValue('  3.14  ', { type: 'number' }), { valid: true })
})

test('validateParameterValue enforces float range and number minimum and maximum bounds', () => {
  deepEqual(validateParameterValue('1e40', { type: 'number', format: 'float' }), { valid: false, message: 'Ungültig: Wert überschreitet den Float-Bereich.' })
  deepEqual(validateParameterValue('1.5', { type: 'number', format: 'float', maximum: 1 }), { valid: false, message: 'Ungültig: Wert muss ≤ 1 sein.' })
  deepEqual(validateParameterValue('0.5', { type: 'number', minimum: 1 }), { valid: false, message: 'Ungültig: Wert muss ≥ 1 sein.' })
  deepEqual(validateParameterValue('1.5', { type: 'number', minimum: 1, maximum: 2 }), { valid: true })
})

test('validateParameterValue accepts true false 1 and 0 and rejects other boolean values', () => {
  deepEqual(validateParameterValue('true', { type: 'boolean' }), { valid: true })
  deepEqual(validateParameterValue('false', { type: 'boolean' }), { valid: true })
  deepEqual(validateParameterValue('1', { type: 'boolean' }), { valid: true })
  deepEqual(validateParameterValue('0', { type: 'boolean' }), { valid: true })
  deepEqual(validateParameterValue('yes', { type: 'boolean' }), { valid: false, message: 'Ungültig: erwartet true oder false.' })
  deepEqual(validateParameterValue('TRUE', { type: 'boolean' }), { valid: false, message: 'Ungültig: erwartet true oder false.' })
})

test('validateParameterValue returns valid for unknown schema types', () => {
  const schema = { type: 'array' } as unknown as ParameterSchema
  deepEqual(validateParameterValue('anything', schema), { valid: true })
})

test('createOperationSettings seeds examples for parameters that include schema metadata', () => {
  const operation: Operation = {
    operationId: 'op',
    method: 'GET',
    path: '/x',
    summary: '',
    destructive: false,
    parameters: [
      { name: 'count', location: 'query', required: false, example: 5, schema: { type: 'integer', format: 'int64' } },
      { name: 'color', location: 'query', required: false, example: 'red', schema: { type: 'string', enum: ['red', 'green'] } },
    ],
    requestBodyExample: null,
    hasRequestBody: false,
    requestBodyRequired: false,
    bearerAuth: false,
  }

  const settings = createOperationSettings([operation])
  const op = settings.op
  ok(op)
  equal(op.parameterValues['query:count'], '5')
  equal(op.parameterValues['query:color'], 'red')
})

test('validateJsonValue accepts and rejects strings numbers integers and booleans against their schemas', () => {
  deepEqual(validateJsonValue('hello', { type: 'string' }), { valid: true })
  deepEqual(validateJsonValue(42, { type: 'string' }), { valid: false, message: 'Ungültig: erwartet einen Textwert.' })
  deepEqual(validateJsonValue('x', { type: 'string', enum: ['a', 'b'] }), { valid: false, message: 'Ungültig: erwartet einen Wert aus „a“ oder „b“.' })
  deepEqual(validateJsonValue('a@example.com', { type: 'string', format: 'email' }), { valid: true })
  deepEqual(validateJsonValue('not-an-email', { type: 'string', format: 'email' }), { valid: false, message: 'Ungültig: erwartet eine E-Mail-Adresse.' })

  deepEqual(validateJsonValue(7, { type: 'integer' }), { valid: true })
  deepEqual(validateJsonValue(7.5, { type: 'integer' }), { valid: false, message: 'Ungültig: erwartet eine Ganzzahl (long).' })
  deepEqual(validateJsonValue('7', { type: 'integer' }), { valid: false, message: 'Ungültig: erwartet eine Ganzzahl (long).' })
  deepEqual(validateJsonValue(5, { type: 'integer', minimum: 10 }), { valid: false, message: 'Ungültig: Wert muss ≥ 10 sein.' })
  deepEqual(validateJsonValue(50, { type: 'integer', maximum: 10 }), { valid: false, message: 'Ungültig: Wert muss ≤ 10 sein.' })

  deepEqual(validateJsonValue(1.5, { type: 'number' }), { valid: true })
  deepEqual(validateJsonValue('1.5', { type: 'number' }), { valid: false, message: 'Ungültig: erwartet eine Zahl (double).' })
  deepEqual(validateJsonValue(Number.NaN, { type: 'number' }), { valid: false, message: 'Ungültig: erwartet eine Zahl (double).' })
  deepEqual(validateJsonValue(2, { type: 'number', minimum: 5 }), { valid: false, message: 'Ungültig: Wert muss ≥ 5 sein.' })
  deepEqual(validateJsonValue(20, { type: 'number', maximum: 10 }), { valid: false, message: 'Ungültig: Wert muss ≤ 10 sein.' })
  deepEqual(validateJsonValue(Number.MAX_VALUE, { type: 'number', format: 'float' }), { valid: false, message: 'Ungültig: Wert überschreitet den Float-Bereich.' })

  deepEqual(validateJsonValue(true, { type: 'boolean' }), { valid: true })
  deepEqual(validateJsonValue(false, { type: 'boolean' }), { valid: true })
  deepEqual(validateJsonValue('true', { type: 'boolean' }), { valid: false, message: 'Ungültig: erwartet einen Wahrheitswert (true/false).' })
  deepEqual(validateJsonValue(1, { type: 'boolean' }), { valid: false, message: 'Ungültig: erwartet einen Wahrheitswert (true/false).' })
})

test('validateJsonValue treats unknown schema types as free values', () => {
  const unknownSchema = { type: 'array' } as unknown as ParameterSchema
  deepEqual(validateJsonValue(['a', 'b'], unknownSchema), { valid: true })
})

test('validateRequestBody skips validation when no schema is provided or body is empty', () => {
  deepEqual(validateRequestBody('{}', undefined), { valid: true })
  deepEqual(validateRequestBody('   ', { type: 'object', properties: {}, required: [] }), { valid: true })
})

test('validateRequestBody rejects malformed JSON, non-objects and missing required fields', () => {
  const schema: RequestBodySchema = { type: 'object', properties: {}, required: ['name'] }
  deepEqual(validateRequestBody('not-json', schema), { valid: false, message: 'Ungültig: kein gültiges JSON.' })
  deepEqual(validateRequestBody('[1,2]', schema), { valid: false, message: 'Ungültig: JSON-Body muss ein Objekt sein.' })
  deepEqual(validateRequestBody('null', schema), { valid: false, message: 'Ungültig: JSON-Body muss ein Objekt sein.' })
  deepEqual(validateRequestBody('"hello"', schema), { valid: false, message: 'Ungültig: JSON-Body muss ein Objekt sein.' })
  deepEqual(validateRequestBody('{}', schema), { valid: false, message: 'Ungültig: Pflichtfeld „name“ fehlt.' })
})

test('validateRequestBody tolerates missing required and properties fields in the schema', () => {
  const schema = { type: 'object' } as unknown as RequestBodySchema
  deepEqual(validateRequestBody('{"name":"Luna"}', schema), { valid: true })
})

test('validateRequestBody validates each present property and reports the first mismatch', () => {
  const schema: RequestBodySchema = {
    type: 'object',
    required: [],
    properties: {
      name: { type: 'string', minLength: 2 },
      count: { type: 'integer', minimum: 1, maximum: 10 },
      price: { type: 'number', minimum: 0 },
      active: { type: 'boolean' },
      email: { type: 'string', format: 'email' },
    },
  }
  deepEqual(validateRequestBody('{"name":"Luna","count":3,"price":1.5,"active":true,"email":"a@b.com"}', schema), { valid: true })
  deepEqual(validateRequestBody('{"name":"Luna","count":0,"price":1.5,"active":true,"email":"a@b.com"}', schema), { valid: false, message: 'Ungültig: Feld „count“ – Wert muss ≥ 1 sein.' })
  deepEqual(validateRequestBody('{"name":"Luna","count":3,"price":-1,"active":true,"email":"a@b.com"}', schema), { valid: false, message: 'Ungültig: Feld „price“ – Wert muss ≥ 0 sein.' })
  deepEqual(validateRequestBody('{"name":"Luna","count":3,"price":1.5,"active":"yes","email":"a@b.com"}', schema), { valid: false, message: 'Ungültig: Feld „active“ – erwartet einen Wahrheitswert (true/false).' })
  deepEqual(validateRequestBody('{"name":"Luna","count":3,"price":1.5,"active":true,"email":"nope"}', schema), { valid: false, message: 'Ungültig: Feld „email“ – erwartet eine E-Mail-Adresse.' })
})

test('validateRequestBody skips optional properties that are missing from the body', () => {
  const schema: RequestBodySchema = {
    type: 'object',
    required: [],
    properties: {
      name: { type: 'string', minLength: 1 },
      description: { type: 'string', minLength: 5 },
    },
  }
  deepEqual(validateRequestBody('{"name":"Luna"}', schema), { valid: true })
})

test('validateOperationSettings aggregates parameter and request body errors', () => {
  const operation: Operation = {
    operationId: 'createItem',
    method: 'POST',
    path: '/items',
    summary: '',
    destructive: true,
    parameters: [
      { name: 'tag', location: 'query', required: false, example: null, schema: { type: 'integer', format: 'int64' } },
    ],
    requestBodyExample: null,
    requestBodySchema: { type: 'object', required: ['name'], properties: { name: { type: 'string', minLength: 1 } } },
    hasRequestBody: true,
    requestBodyRequired: true,
    bearerAuth: false,
  }
  const settings = createOperationSettings([operation])
  settings.createItem.parameterValues['query:tag'] = 'abc'
  settings.createItem.requestBodyJson = '{"name":""}'

  const validation = validateOperationSettings(operation, settings.createItem)
  equal(validation.parameterErrors['query:tag'], 'Ungültig: erwartet eine Ganzzahl (long).')
  equal(validation.bodyError, 'Ungültig: Feld „name“ – mindestens 1 Zeichen erforderlich.')
  equal(isOperationValid(validation), false)

  settings.createItem.parameterValues['query:tag'] = '5'
  settings.createItem.requestBodyJson = '{"name":"Luna"}'
  equal(isOperationValid(validateOperationSettings(operation, settings.createItem)), true)
})

test('validateOperationSettings returns no errors when the operation has no schema and the settings are missing', () => {
  const operation: Operation = {
    operationId: 'plain',
    method: 'POST',
    path: '/notes',
    summary: '',
    destructive: true,
    parameters: [],
    requestBodyExample: null,
    hasRequestBody: false,
    requestBodyRequired: false,
    bearerAuth: false,
  }

  deepEqual(validateOperationSettings(operation, undefined), { parameterErrors: {} })
  deepEqual(validateOperationSettings(operation, { parameterValues: {}, requestBodyJson: '', bearerToken: '' }), { parameterErrors: {} })
})

test('validateOperationSettings treats missing parameter values as empty strings and skips valid results', () => {
  const operation: Operation = {
    operationId: 'op',
    method: 'GET',
    path: '/x',
    summary: '',
    destructive: false,
    parameters: [
      { name: 'flag', location: 'query', required: false, example: null, schema: { type: 'boolean' } },
    ],
    requestBodyExample: null,
    hasRequestBody: false,
    requestBodyRequired: false,
    bearerAuth: false,
  }
  const settings: OperationSettings = { parameterValues: {}, requestBodyJson: '', bearerToken: '' }

  deepEqual(validateOperationSettings(operation, settings), { parameterErrors: {} })
})

test('validateOperationSettings flags an empty required request body as an error', () => {
  const operation: Operation = {
    operationId: 'createItem',
    method: 'POST',
    path: '/items',
    summary: '',
    destructive: true,
    parameters: [],
    requestBodyExample: null,
    requestBodySchema: { type: 'object', required: ['name'], properties: { name: { type: 'string', minLength: 1 } } },
    hasRequestBody: true,
    requestBodyRequired: true,
    bearerAuth: false,
  }
  const settings: OperationSettings = { parameterValues: {}, requestBodyJson: '   ', bearerToken: '' }

  deepEqual(validateOperationSettings(operation, settings), {
    parameterErrors: {},
    bodyError: 'Ungültig: Pflicht-Request-Body ist leer.',
  })
})

test('validateOperationSettings allows an empty optional request body', () => {
  const operation: Operation = {
    operationId: 'noteOptional',
    method: 'POST',
    path: '/notes',
    summary: '',
    destructive: true,
    parameters: [],
    requestBodyExample: null,
    requestBodySchema: { type: 'object', required: [], properties: { body: { type: 'string' } } },
    hasRequestBody: true,
    requestBodyRequired: false,
    bearerAuth: false,
  }
  const settings: OperationSettings = { parameterValues: {}, requestBodyJson: '', bearerToken: '' }

  deepEqual(validateOperationSettings(operation, settings), { parameterErrors: {} })
})

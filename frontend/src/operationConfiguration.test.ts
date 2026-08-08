import { deepEqual, equal, ok, throws } from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildOperationConfigurations,
  createOperationSettings,
  hasApiKeyAuth,
  hasBasicAuth,
  hasBearerAuth,
  hasMultipleServers,
  hasOAuth2Auth,
  hasOpenIdConnectAuth,
  isOperationValid,
  migrateOperationSettings,
  parameterInputKind,
  parameterKey,
  parameterSelectOptions,
  validateJsonValue,
  validateOperationSettings,
  validateParameterValue,
  validateRequestBody,
  type ApiParameter,
  type ApiServer,
  type Operation,
  type OperationPayload,
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
  settings.getPet.payloads[0].parameterValues['path:id'] = '42'
  settings.getPet.payloads[0].bearerToken = 'secret-token'
  settings.createPet.payloads[0].requestBodyJson = '{"name":"Luna"}'

  const configurations = buildOperationConfigurations([getOperation, postOperation], new Set(['getPet', 'createPet']), settings)

  deepEqual(configurations[0], {
    operationId: 'getPet',
    payloads: [
      {
        parameterValues: [
          { name: 'id', location: 'path', value: '42' },
          { name: 'expand', location: 'query', value: 'owner' },
        ],
        requestBodyJson: undefined,
        bearerToken: 'secret-token',
        basicAuthUsername: undefined,
        basicAuthPassword: undefined,
        apiKey: undefined,
        oauth2Token: undefined,
        oidcIdToken: undefined,
      },
    ],
    parameterValues: [
      { name: 'id', location: 'path', value: '42' },
      { name: 'expand', location: 'query', value: 'owner' },
    ],
    requestBodyJson: undefined,
    bearerToken: 'secret-token',
    basicAuthUsername: undefined,
    basicAuthPassword: undefined,
    apiKey: undefined,
    oauth2Token: undefined,
    oidcIdToken: undefined,
  })
  equal(configurations[1].requestBodyJson, '{"name":"Luna"}')
  equal(configurations[1].payloads.length, 1)
  equal(configurations[1].payloads[0].requestBodyJson, '{"name":"Luna"}')
})

test('rejects an empty required parameter and malformed JSON', () => {
  const settings = createOperationSettings([getOperation, postOperation])
  settings.getPet.payloads[0].parameterValues['path:id'] = ''

  throws(
    () => buildOperationConfigurations([getOperation], new Set(['getPet']), settings),
    /Pflichtparameter/,
  )

  settings.createPet.payloads[0].requestBodyJson = '{invalid}'
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
  settings.createPet.payloads[0].requestBodyJson = ''
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
  delete settings.getPet.payloads[0].parameterValues['query:expand']

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
  settings.getPet.payloads[0].parameterValues['query:expand'] = ''

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

test('hasBasicAuth returns true only when a Basic authRequirement is declared', () => {
  const basicOnly: Operation = {
    ...getOperation,
    authRequirements: [{ kind: 'basic', schemeName: 'basicAuth' }],
  }
  const bearerOnly: Operation = {
    ...getOperation,
    authRequirements: [{ kind: 'bearer', schemeName: 'bearerAuth' }],
  }
  const dual: Operation = {
    ...getOperation,
    authRequirements: [
      { kind: 'basic', schemeName: 'basicAuth' },
      { kind: 'bearer', schemeName: 'bearerAuth' },
    ],
  }
  const unsupported: Operation = {
    ...getOperation,
    authRequirements: [{ kind: 'unsupported', schemeName: 'oauth2', reason: 'type=oauth2' }],
  }
  const legacyNoField: Operation = { ...getOperation } // no authRequirements at all

  equal(hasBasicAuth(basicOnly), true)
  equal(hasBasicAuth(bearerOnly), false)
  equal(hasBasicAuth(dual), true)
  equal(hasBasicAuth(unsupported), false)
  equal(hasBasicAuth(legacyNoField), false)
})

test('hasBearerAuth returns true only when a Bearer authRequirement is declared', () => {
  const basicOnly: Operation = {
    ...getOperation,
    authRequirements: [{ kind: 'basic', schemeName: 'basicAuth' }],
  }
  const bearerOnly: Operation = {
    ...getOperation,
    authRequirements: [{ kind: 'bearer', schemeName: 'bearerAuth' }],
  }
  const dual: Operation = {
    ...getOperation,
    authRequirements: [
      { kind: 'basic', schemeName: 'basicAuth' },
      { kind: 'bearer', schemeName: 'bearerAuth' },
    ],
  }
  const unsupported: Operation = {
    ...getOperation,
    authRequirements: [{ kind: 'unsupported', schemeName: 'oauth2', reason: 'type=oauth2' }],
  }
  const legacyNoField: Operation = { ...getOperation }

  equal(hasBearerAuth(basicOnly), false)
  equal(hasBearerAuth(bearerOnly), true)
  equal(hasBearerAuth(dual), true)
  equal(hasBearerAuth(unsupported), false)
  // Legacy / pre-feature imports have no authRequirements; the
  // dedicated bearer column is hidden in that case so the UI does
  // not show a credential input the user cannot meaningfully
  // populate. The fallback "optional bearer" cell is rendered
  // separately based on the older bearerAuth boolean flag.
  equal(hasBearerAuth(legacyNoField), false)
})

test('hasApiKeyAuth returns true only when an apiKey authRequirement is declared', () => {
  const apiKeyOnly: Operation = {
    ...getOperation,
    authRequirements: [{ kind: 'apiKey', schemeName: 'apiKeyAuth', headerName: 'X-API-Key' }],
  }
  const bearerOnly: Operation = {
    ...getOperation,
    authRequirements: [{ kind: 'bearer', schemeName: 'bearerAuth' }],
  }
  const dual: Operation = {
    ...getOperation,
    authRequirements: [
      { kind: 'apiKey', schemeName: 'apiKeyAuth', headerName: 'X-API-Key' },
      { kind: 'bearer', schemeName: 'bearerAuth' },
    ],
  }
  const legacyNoField: Operation = { ...getOperation }

  equal(hasApiKeyAuth(apiKeyOnly), true)
  equal(hasApiKeyAuth(bearerOnly), false)
  equal(hasApiKeyAuth(dual), true)
  // Same fallback as Bearer: without an authRequirements field
  // the dedicated apiKey column is hidden.
  equal(hasApiKeyAuth(legacyNoField), false)
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
  // A value that does not match the date pattern at all — the
  // `&&` short-circuits to false before Date.parse is consulted.
  deepEqual(validateParameterValue('not-a-date', { type: 'string', format: 'date' }), { valid: false, message: 'Ungültig: erwartet ein Datum im Format JJJJ-MM-TT.' })

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
  settings.createItem.payloads[0].parameterValues['query:tag'] = 'abc'
  settings.createItem.payloads[0].requestBodyJson = '{"name":""}'

  const validation = validateOperationSettings(operation, settings.createItem)
  equal(validation.parameterErrors['query:tag'], 'Ungültig: erwartet eine Ganzzahl (long).')
  equal(validation.bodyError, 'Ungültig: Feld „name“ – mindestens 1 Zeichen erforderlich.')
  equal(isOperationValid(validation), false)

  settings.createItem.payloads[0].parameterValues['query:tag'] = '5'
  settings.createItem.payloads[0].requestBodyJson = '{"name":"Luna"}'
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
  deepEqual(validateOperationSettings(operation, { payloads: [], parameterValues: {}, requestBodyJson: '', bearerToken: '', basicAuthUsername: '', basicAuthPassword: '', apiKey: '', oauth2Token: '', oidcIdToken: '' }), { parameterErrors: {} })
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
  const settings: OperationSettings = { payloads: [], parameterValues: {}, requestBodyJson: '', bearerToken: '', basicAuthUsername: '', basicAuthPassword: '', apiKey: '', oauth2Token: '', oidcIdToken: '' }

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
  const settings: OperationSettings = { payloads: [], parameterValues: {}, requestBodyJson: '   ', bearerToken: '', basicAuthUsername: '', basicAuthPassword: '', apiKey: '', oauth2Token: '', oidcIdToken: '' }

  deepEqual(validateOperationSettings(operation, settings), {
    parameterErrors: {},
    bodyError: 'Ungültig: Pflicht-Request-Body ist leer.',
  })
  // isOperationValid short-circuits on the first operand when
  // parameterErrors is empty but bodyError is set — this
  // pins the `bodyError === undefined` false branch.
  equal(isOperationValid(validateOperationSettings(operation, settings)), false)
})

// ---- OperationPayload / migrateOperationSettings ----------------------------

test('createOperationSettings seeds a single payload whose fields mirror the legacy values', () => {
  const settings = createOperationSettings([getOperation, postOperation])

  equal(settings.getPet.payloads.length, 1)
  equal(settings.createPet.payloads.length, 1)

  const getPetPayload = settings.getPet.payloads[0]
  equal(getPetPayload.parameterValues[parameterKey(getOperation.parameters[0])], '7')
  equal(getPetPayload.parameterValues[parameterKey(getOperation.parameters[1])], 'owner')
  equal(getPetPayload.requestBodyJson, '')
  equal(getPetPayload.bearerToken, '')

  const createPetPayload = settings.createPet.payloads[0]
  equal(createPetPayload.requestBodyJson, '{\n  "name": "Fido"\n}')
  equal(createPetPayload.bearerToken, '')
})

test('createOperationSettings seeds basic auth fields as empty strings on every payload', () => {
  const settings = createOperationSettings([getOperation])

  equal(settings.getPet.payloads[0].basicAuthUsername, '')
  equal(settings.getPet.payloads[0].basicAuthPassword, '')
  equal(settings.getPet.basicAuthUsername, '')
  equal(settings.getPet.basicAuthPassword, '')
  equal(settings.getPet.payloads[0].apiKey, '')
  equal(settings.getPet.apiKey, '')
  equal(settings.getPet.payloads[0].oauth2Token, '')
  equal(settings.getPet.oauth2Token, '')
})

test('createOperationSettings seeds payloads[0] and the legacy fields with the same initial values', () => {
  // The pool is the single source of truth: `buildOperationConfigurations`
  // and `validateOperationSettings` both read from `payloads[0]`. The
  // legacy flat fields are seeded with the same initial values so
  // existing callers (and the report builder) can still read them
  // without going through the migration, but the two views are
  // independent — mutating one does not silently rewrite the other.
  const settings = createOperationSettings([getOperation])

  // Initial values are mirrored.
  equal(settings.getPet.payloads[0].parameterValues['path:id'], settings.getPet.parameterValues['path:id'])
  equal(settings.getPet.payloads[0].requestBodyJson, settings.getPet.requestBodyJson)
  equal(settings.getPet.payloads[0].bearerToken, settings.getPet.bearerToken)

  // But the underlying objects are not the same reference: mutating
  // one view does not rewrite the other.
  settings.getPet.payloads[0].parameterValues['path:id'] = '99'
  equal(settings.getPet.parameterValues['path:id'], '7')
})

test('migrateOperationSettings is a no-op when payloads is already populated', () => {
  const settings: OperationSettings = {
    payloads: [{ parameterValues: { 'path:id': '42' }, requestBodyJson: '{"x":1}', bearerToken: 't', basicAuthUsername: '', basicAuthPassword: '', apiKey: '', oauth2Token: '', oidcIdToken: '' }],
    parameterValues: { 'legacy:key': 'legacy-value' },
    requestBodyJson: 'legacy-body',
    bearerToken: 'legacy-token',
    basicAuthUsername: '',
    basicAuthPassword: '', apiKey: '', oauth2Token: '', oidcIdToken: '',
  }

  const migrated = migrateOperationSettings(settings)

  // Same object reference: migration should not allocate a new object
  // when there is nothing to do.
  equal(migrated, settings)
  equal(migrated.payloads.length, 1)
  equal(migrated.payloads[0].parameterValues['path:id'], '42')
  equal(migrated.parameterValues['legacy:key'], 'legacy-value')
})

test('migrateOperationSettings synthesises a single payload from legacy fields when payloads is empty', () => {
  const settings: OperationSettings = {
    payloads: [],
    parameterValues: { 'path:id': '42', 'query:expand': 'owner' },
    requestBodyJson: '{"name":"Luna"}',
    bearerToken: 'secret',
    basicAuthUsername: '',
    basicAuthPassword: '', apiKey: '', oauth2Token: '', oidcIdToken: '',
  }

  const migrated = migrateOperationSettings(settings)

  equal(migrated.payloads.length, 1)
  equal(migrated.payloads[0].parameterValues['path:id'], '42')
  equal(migrated.payloads[0].parameterValues['query:expand'], 'owner')
  equal(migrated.payloads[0].requestBodyJson, '{"name":"Luna"}')
  equal(migrated.payloads[0].bearerToken, 'secret')
  // Legacy fields are preserved on the migrated object so any consumer
  // still reading them continues to work.
  equal(migrated.parameterValues['path:id'], '42')
  equal(migrated.requestBodyJson, '{"name":"Luna"}')
  equal(migrated.bearerToken, 'secret')
})

test('migrateOperationSettings copies basic auth fields from the legacy layout', () => {
  const settings: OperationSettings = {
    payloads: [],
    parameterValues: { 'path:id': '42' },
    requestBodyJson: '',
    bearerToken: '',
    basicAuthUsername: 'alice',
    basicAuthPassword: 's3cret',
    apiKey: '',
    oauth2Token: '', oidcIdToken: '',
  }

  const migrated = migrateOperationSettings(settings)

  equal(migrated.payloads[0].basicAuthUsername, 'alice')
  equal(migrated.payloads[0].basicAuthPassword, 's3cret')
  equal(migrated.basicAuthUsername, 'alice')
  equal(migrated.basicAuthPassword, 's3cret')
  equal(migrated.payloads[0].apiKey, '')
  equal(migrated.apiKey, '')
  equal(migrated.payloads[0].oauth2Token, '')
  equal(migrated.oauth2Token, '')
})

test('migrateOperationSettings is idempotent when called twice', () => {
  const settings: OperationSettings = {
    payloads: [],
    parameterValues: { 'path:id': '7' },
    requestBodyJson: '',
    bearerToken: '', basicAuthUsername: '', basicAuthPassword: '', apiKey: '', oauth2Token: '', oidcIdToken: '',
  }

  const once = migrateOperationSettings(settings)
  const twice = migrateOperationSettings(once)

  deepEqual(twice, once)
  equal(twice.payloads.length, 1)
})

test('migrateOperationSettings defaults undefined legacy auth fields to empty strings', () => {
  // Older settings persisted before Basic auth / API key /
  // OAuth 2.0 shipped won't carry the fields; the migration
  // must default them to empty strings via the `??` short-circuit.
  // We cast through `unknown` because the test deliberately
  // simulates the pre-migration shape.
  const settings = {
    payloads: [],
    parameterValues: {},
    requestBodyJson: '',
    bearerToken: '',
  } as unknown as OperationSettings

  const migrated = migrateOperationSettings(settings)
  equal(migrated.basicAuthUsername, '')
  equal(migrated.basicAuthPassword, '')
  equal(migrated.apiKey, '')
  equal(migrated.oauth2Token, '')
  equal(migrated.payloads[0].basicAuthUsername, '')
  equal(migrated.payloads[0].basicAuthPassword, '')
  equal(migrated.payloads[0].apiKey, '')
  equal(migrated.payloads[0].oauth2Token, '')
})

test('migrateOperationSettings clones the legacy parameterValues to decouple mutation', () => {
  const legacy: Record<string, string> = { 'path:id': '42' }
  const settings: OperationSettings = {
    payloads: [],
    parameterValues: legacy,
    requestBodyJson: '',
    bearerToken: '', basicAuthUsername: '', basicAuthPassword: '', apiKey: '', oauth2Token: '', oidcIdToken: '',
  }

  const migrated = migrateOperationSettings(settings)
  // Mutate the migrated payload — the original legacy map must not change.
  migrated.payloads[0].parameterValues['path:id'] = '99'
  equal(legacy['path:id'], '42')
  equal(migrated.payloads[0].parameterValues['path:id'], '99')
})

test('buildOperationConfigurations migrates legacy settings before reading the active payload', () => {
  // Hand a pre-pool settings object directly (no createOperationSettings
  // call) to verify the migration is triggered inside
  // buildOperationConfigurations.
  const legacySettings: OperationSettings = {
    payloads: [],
    parameterValues: { 'path:id': '99' },
    requestBodyJson: '',
    bearerToken: '', basicAuthUsername: '', basicAuthPassword: '', apiKey: '', oauth2Token: '', oidcIdToken: '',
  }
  const configurations = buildOperationConfigurations([getOperation], new Set(['getPet']), { getPet: legacySettings })

  equal(configurations[0].parameterValues[0].value, '99')
})

test('buildOperationConfigurations reads from payloads[0] when the pool is populated', () => {
  const settings = createOperationSettings([getOperation])
  settings.getPet.payloads[0].parameterValues['path:id'] = '55'

  const configurations = buildOperationConfigurations([getOperation], new Set(['getPet']), settings)

  equal(configurations[0].parameterValues[0].value, '55')
})

test('buildOperationConfigurations forwards the bearer token from payloads[0]', () => {
  const settings = createOperationSettings([getOperation])
  settings.getPet.payloads[0].bearerToken = 'pool-bearer'

  const configurations = buildOperationConfigurations([getOperation], new Set(['getPet']), settings)

  equal(configurations[0].bearerToken, 'pool-bearer')
})

test('buildOperationConfigurations forwards the request body from payloads[0]', () => {
  const settings = createOperationSettings([postOperation])
  settings.createPet.payloads[0].requestBodyJson = '{"name":"Luna"}'

  const configurations = buildOperationConfigurations([postOperation], new Set(['createPet']), settings)

  equal(configurations[0].requestBodyJson, '{"name":"Luna"}')
})

test('buildOperationConfigurations forwards basic auth credentials from payloads[0]', () => {
  const settings = createOperationSettings([getOperation])
  settings.getPet.payloads[0].basicAuthUsername = 'alice'
  settings.getPet.payloads[0].basicAuthPassword = 's3cret'

  const configurations = buildOperationConfigurations([getOperation], new Set(['getPet']), settings)

  equal(configurations[0].basicAuthUsername, 'alice')
  equal(configurations[0].basicAuthPassword, 's3cret')
})

test('buildOperationConfigurations omits blank basic auth credentials on the wire', () => {
  const settings = createOperationSettings([getOperation])
  settings.getPet.payloads[0].basicAuthUsername = '   '
  settings.getPet.payloads[0].basicAuthPassword = ''

  const configurations = buildOperationConfigurations([getOperation], new Set(['getPet']), settings)

  // Whitespace-only credentials are treated as "not set" so the
  // k6 generator can recognise "no auth configured" without
  // having to do its own string hygiene. The wire shape therefore
  // strips them out.
  equal(configurations[0].basicAuthUsername, undefined)
  equal(configurations[0].basicAuthPassword, undefined)
})

test('buildOperationConfigurations forwards the apiKey from payloads[0]', () => {
  const settings = createOperationSettings([getOperation])
  settings.getPet.payloads[0].apiKey = 'sk-test-abc123'

  const configurations = buildOperationConfigurations([getOperation], new Set(['getPet']), settings)

  equal(configurations[0].apiKey, 'sk-test-abc123')
})

test('buildOperationConfigurations omits blank apiKey values on the wire', () => {
  const settings = createOperationSettings([getOperation])
  settings.getPet.payloads[0].apiKey = '   '

  const configurations = buildOperationConfigurations([getOperation], new Set(['getPet']), settings)

  // Same hygiene as the Bearer / Basic fields: a single space is
  // not a valid API key. The wire shape strips the value so the
  // backend's "is auth configured" check is accurate.
  equal(configurations[0].apiKey, undefined)
})

test('buildOperationConfigurations forwards the oauth2Token from payloads[0]', () => {
  const settings = createOperationSettings([getOperation])
  settings.getPet.payloads[0].oauth2Token = 'demo-oauth2-token-12345'

  const configurations = buildOperationConfigurations([getOperation], new Set(['getPet']), settings)

  equal(configurations[0].oauth2Token, 'demo-oauth2-token-12345')
})

test('buildOperationConfigurations omits blank oauth2Token values on the wire', () => {
  const settings = createOperationSettings([getOperation])
  settings.getPet.payloads[0].oauth2Token = '   '

  const configurations = buildOperationConfigurations([getOperation], new Set(['getPet']), settings)

  // Same hygiene as Bearer / apiKey: a single space is not a valid
  // OAuth 2.0 access token. The wire shape strips the value so the
  // backend's "is auth configured" check is accurate.
  equal(configurations[0].oauth2Token, undefined)
})

test('hasOAuth2Auth returns true only when an oauth2 authRequirement is declared', () => {
  const oauth2Only: Operation = {
    ...getOperation,
    authRequirements: [
      {
        kind: 'oauth2',
        schemeName: 'oauth2',
        flows: [{ type: 'clientCredentials', tokenUrl: 'https://x', scopes: [] }],
      },
    ],
  }
  const bearerOnly: Operation = {
    ...getOperation,
    authRequirements: [{ kind: 'bearer', schemeName: 'bearerAuth' }],
  }
  const dual: Operation = {
    ...getOperation,
    authRequirements: [
      {
        kind: 'oauth2',
        schemeName: 'oauth2',
        flows: [{ type: 'clientCredentials', tokenUrl: 'https://x', scopes: [] }],
      },
      { kind: 'bearer', schemeName: 'bearerAuth' },
    ],
  }
  const legacyNoField: Operation = { ...getOperation }

  equal(hasOAuth2Auth(oauth2Only), true)
  equal(hasOAuth2Auth(bearerOnly), false)
  equal(hasOAuth2Auth(dual), true)
  equal(hasOAuth2Auth(legacyNoField), false)
})

test('hasOpenIdConnectAuth returns true only when an openIdConnect authRequirement is declared', () => {
  // The OIDC discriminator on the wire is `openIdConnect` (camel
  // case to match the rest of the API). The predicate has to match
  // exactly that kind so a spec that only declares OAuth 2.0 or
  // plain Bearer does not accidentally light up the OIDC input.
  const oidcOnly: Operation = {
    ...getOperation,
    authRequirements: [
      {
        kind: 'openIdConnect',
        schemeName: 'oidcAuth',
        openIdConnectUrl: 'https://example.test/.well-known/openid-configuration',
        scopes: ['openid', 'profile'],
      },
    ],
  }
  const oauth2Only: Operation = {
    ...getOperation,
    authRequirements: [
      {
        kind: 'oauth2',
        schemeName: 'oauth2',
        flows: [{ type: 'clientCredentials', tokenUrl: 'https://x', scopes: [] }],
      },
    ],
  }
  const bearerOnly: Operation = {
    ...getOperation,
    authRequirements: [{ kind: 'bearer', schemeName: 'bearerAuth' }],
  }
  const dual: Operation = {
    ...getOperation,
    authRequirements: [
      {
        kind: 'openIdConnect',
        schemeName: 'oidcAuth',
        openIdConnectUrl: 'https://example.test/.well-known/openid-configuration',
        scopes: ['openid'],
      },
      { kind: 'bearer', schemeName: 'bearerAuth' },
    ],
  }
  const legacyNoField: Operation = { ...getOperation }

  equal(hasOpenIdConnectAuth(oidcOnly), true)
  equal(hasOpenIdConnectAuth(oauth2Only), false)
  equal(hasOpenIdConnectAuth(bearerOnly), false)
  equal(hasOpenIdConnectAuth(dual), true)
  equal(hasOpenIdConnectAuth(legacyNoField), false)
})

test('buildOperationConfigurations still rejects an empty required payload field after migration', () => {
  const legacySettings: OperationSettings = {
    payloads: [],
    parameterValues: {},
    requestBodyJson: '',
    bearerToken: '', basicAuthUsername: '', basicAuthPassword: '', apiKey: '', oauth2Token: '', oidcIdToken: '',
  }

  throws(
    () => buildOperationConfigurations([postOperation], new Set(['createPet']), { createPet: legacySettings }),
    /Pflicht-Request-Body/,
  )
})

test('buildOperationConfigurations still rejects a malformed JSON body after migration', () => {
  const legacySettings: OperationSettings = {
    payloads: [],
    parameterValues: {},
    requestBodyJson: '{invalid}',
    bearerToken: '', basicAuthUsername: '', basicAuthPassword: '', apiKey: '', oauth2Token: '', oidcIdToken: '',
  }

  throws(
    () => buildOperationConfigurations([postOperation], new Set(['createPet']), { createPet: legacySettings }),
    /kein gültiges JSON/,
  )
})

test('OperationPayload is a plain value object carrying per-request data', () => {
  // Compile-time shape check: a payload is exactly the five fields
  // the k6 generator needs for one HTTP call: the parameter
  // overrides, the optional JSON body, the optional Bearer token,
  // and the optional Basic auth username / password.
  const payload: OperationPayload = {
    parameterValues: { 'path:id': '42' },
    requestBodyJson: '{"name":"Luna"}',
    bearerToken: 'secret',
    basicAuthUsername: 'alice',
    basicAuthPassword: 's3cret', apiKey: '', oauth2Token: '', oidcIdToken: '',
  }

  equal(payload.parameterValues['path:id'], '42')
  equal(payload.requestBodyJson, '{"name":"Luna"}')
  equal(payload.bearerToken, 'secret')
})

test('buildOperationConfigurations serialises every payload in the pool (not just payloads[0])', () => {
  // Regression: the legacy wire format only carried one payload per
  // endpoint, so an early buildOperationConfigurations implementation
  // accidentally dropped payloads[1..N] before sending the request
  // to the backend. The backend then fell back to the single-dataset
  // legacy path, the report lost every entry after the first, and
  // the user saw a "this run pre-dates the pool feature" hint
  // instead of the actual pool.
  const settings = createOperationSettings([getOperation])
  addPayload(settings.getPet, 'getPet')
  addPayload(settings.getPet, 'getPet')
  settings.getPet.payloads[0].parameterValues['path:id'] = '42'
  settings.getPet.payloads[1].parameterValues['path:id'] = '17'
  settings.getPet.payloads[2].parameterValues['path:id'] = '99'

  const [configuration] = buildOperationConfigurations([getOperation], new Set(['getPet']), { getPet: settings.getPet })

  // All three payloads are present on the wire — this is what
  // reached the backend before the fix.
  equal(configuration.payloads.length, 3)
  equal(configuration.payloads[0].parameterValues[0].value, '42')
  equal(configuration.payloads[1].parameterValues[0].value, '17')
  equal(configuration.payloads[2].parameterValues[0].value, '99')
  // Legacy flat fields are kept in sync with payloads[0] for
  // backward compatibility.
  equal(configuration.parameterValues[0].value, '42')
  equal(configuration.requestBodyJson, undefined)
})

// Minimal addPayload helper for the multi-payload regression test
// above. Mirrors the production addPayload in App.tsx but is kept in
// the test file so the unit test does not need a React render to
// set up a multi-row pool.
function addPayload(settings: OperationSettings, _operationId: string): void {
  const seed = settings.payloads[0]
  settings.payloads.push({
    parameterValues: { ...seed.parameterValues },
    requestBodyJson: seed.requestBodyJson,
    bearerToken: seed.bearerToken,
    basicAuthUsername: seed.basicAuthUsername,
    basicAuthPassword: seed.basicAuthPassword,
    apiKey: seed.apiKey,
    oauth2Token: seed.oauth2Token,
    oidcIdToken: seed.oidcIdToken,
  })
}

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
  const settings: OperationSettings = { payloads: [], parameterValues: {}, requestBodyJson: '', bearerToken: '', basicAuthUsername: '', basicAuthPassword: '', apiKey: '', oauth2Token: '', oidcIdToken: '' }

  deepEqual(validateOperationSettings(operation, settings), { parameterErrors: {} })
})

test('parameterInputKind falls back to text when no schema is given', () => {
  equal(parameterInputKind(undefined), 'text')
  equal(parameterInputKind({ type: 'string' }), 'text')
  equal(parameterInputKind({ type: 'string', format: 'uuid' }), 'text')
  equal(parameterInputKind({ type: 'integer' }), 'text')
  equal(parameterInputKind({ type: 'number', format: 'float' }), 'text')
  // An empty enum is treated as "no enum" — the dropdown would have
  // nothing to offer.
  equal(parameterInputKind({ type: 'string', enum: [] }), 'text')
})

test('parameterInputKind returns enum when the schema declares an enum', () => {
  // The enum wins over the underlying type: a numeric enum must still
  // render as a dropdown (with the values the spec author wrote).
  equal(parameterInputKind({ type: 'string', enum: ['a', 'b'] }), 'enum')
  equal(parameterInputKind({ type: 'integer', enum: ['1', '2', '3'] }), 'enum')
  equal(parameterInputKind({ type: 'boolean', enum: ['true'] }), 'enum')
})

test('parameterInputKind returns boolean for unconstrained boolean schemas', () => {
  equal(parameterInputKind({ type: 'boolean' }), 'boolean')
  equal(parameterInputKind({ type: 'boolean', format: 'something' }), 'boolean')
})

test('parameterSelectOptions returns the enum values in declaration order', () => {
  const parameter: ApiParameter = {
    name: 'status',
    location: 'query',
    required: false,
    example: 'pending',
    schema: { type: 'string', enum: ['pending', 'active', 'archived'] },
  }
  deepEqual(parameterSelectOptions(parameter, 'enum'), ['pending', 'active', 'archived'])
})

test('parameterSelectOptions returns true then false for boolean parameters', () => {
  const parameter: ApiParameter = {
    name: 'verbose',
    location: 'query',
    required: false,
    example: true,
    schema: { type: 'boolean' },
  }
  deepEqual(parameterSelectOptions(parameter, 'boolean'), ['true', 'false'])
  // The helper ignores schema.enum when the kind is 'boolean' to
  // keep the dropdown deterministic ("true" first, "false" second).
  const withEnum: ApiParameter = {
    ...parameter,
    schema: { type: 'boolean', enum: ['false', 'true'] },
  }
  deepEqual(parameterSelectOptions(withEnum, 'enum'), ['false', 'true'])
})

test('parameterSelectOptions returns an empty list for text-kind parameters', () => {
  const parameter: ApiParameter = {
    name: 'id',
    location: 'path',
    required: true,
    example: 7,
    schema: { type: 'integer' },
  }
  deepEqual(parameterSelectOptions(parameter, 'text'), [])
})

test('parameterSelectOptions falls back to an empty list when the kind is enum but the parameter has no schema', () => {
  // Edge case: a caller asks for 'enum' options on a parameter
  // without a schema. The `parameter.schema?.enum` safe-call
  // short-circuits to undefined, so the `&&` is false, and the
  // helper returns [] instead of throwing.
  const parameter: ApiParameter = {
    name: 'id',
    location: 'path',
    required: true,
    example: 7,
  }
  deepEqual(parameterSelectOptions(parameter, 'enum'), [])
})

test('parameterSelectOptions falls back to an empty list when the enum is empty', () => {
  // Edge case: a caller asks for 'enum' options on a parameter
  // whose schema declares an empty enum. The `?.enum` is
  // truthy (the array exists) but the `&&` requires the array
  // to be non-empty — the function returns [].
  const parameter: ApiParameter = {
    name: 'status',
    location: 'query',
    required: false,
    example: 'pending',
    schema: { type: 'string', enum: [] },
  }
  deepEqual(parameterSelectOptions(parameter, 'enum'), [])
})

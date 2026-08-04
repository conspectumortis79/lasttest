import { deepEqual, equal, throws } from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildOperationConfigurations,
  createOperationSettings,
  hasMultipleServers,
  parameterKey,
  type ApiServer,
  type Operation,
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

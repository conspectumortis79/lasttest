import { deepEqual, equal } from 'node:assert/strict'
import { test } from 'node:test'
import { DEMO_CREDENTIALS, findDemoCredentials } from './demoCredentials.ts'

test('findDemoCredentials returns the Basic entry for the bundled admin endpoint', () => {
  const entry = findDemoCredentials('getAdminStats')

  deepEqual(entry, {
    kind: 'basic',
    operationIds: ['getAdminStats'],
    username: 'alice',
    password: 's3cret',
  })
})

test('findDemoCredentials returns the Bearer entry for the bundled search endpoint', () => {
  const entry = findDemoCredentials('searchProducts')

  deepEqual(entry, {
    kind: 'bearer',
    operationIds: ['searchProducts'],
    token: 'demo-bearer-token',
  })
})

test('findDemoCredentials returns undefined for any non-demo operation', () => {
  equal(findDemoCredentials('listProducts'), undefined)
  equal(findDemoCredentials('createProduct'), undefined)
  equal(findDemoCredentials('getProduct'), undefined)
  equal(findDemoCredentials('updateProduct'), undefined)
  equal(findDemoCredentials('deleteProduct'), undefined)
  // Unknown id is also undefined; the lookup never throws.
  equal(findDemoCredentials('totally-made-up'), undefined)
})

test('every demo operation id is unique across the table', () => {
  // The banner component looks up one entry per operation; if two
  // entries shared the same id, the first one in source order would
  // win and the other would silently be unreachable. Pinning the
  // invariant here so a future addition can't regress it.
  const allIds = DEMO_CREDENTIALS.flatMap(entry => entry.operationIds)
  const uniqueIds = new Set(allIds)
  equal(uniqueIds.size, allIds.length, `duplicate demo operation ids: ${allIds.join(', ')}`)
})

test('every demo credential has a non-empty secret', () => {
  // A demo entry with an empty username/password/token would let the
  // user click "In Felder übernehmen" and end up with blank inputs —
  // the k6 script would then send an empty Authorization header.
  for (const entry of DEMO_CREDENTIALS) {
    if (entry.kind === 'basic') {
      equal(entry.username.length > 0, true, `basic entry has empty username: ${JSON.stringify(entry)}`)
      equal(entry.password.length > 0, true, `basic entry has empty password: ${JSON.stringify(entry)}`)
    } else if (entry.kind === 'bearer') {
      equal(entry.token.length > 0, true, `bearer entry has empty token: ${JSON.stringify(entry)}`)
    } else if (entry.kind === 'apiKey') {
      equal(entry.key.length > 0, true, `apiKey entry has empty key: ${JSON.stringify(entry)}`)
      equal(entry.headerName.length > 0, true, `apiKey entry has empty headerName: ${JSON.stringify(entry)}`)
    } else {
      equal(entry.token.length > 0, true, `oauth2 entry has empty token: ${JSON.stringify(entry)}`)
      equal(entry.flowType.length > 0, true, `oauth2 entry has empty flowType: ${JSON.stringify(entry)}`)
    }
  }
})

test('findDemoCredentials returns the apiKey entry for the bundled lookup endpoint', () => {
  const entry = findDemoCredentials('lookupProduct')

  deepEqual(entry, {
    kind: 'apiKey',
    operationIds: ['lookupProduct'],
    key: 'demo-api-key-12345',
    headerName: 'X-API-Key',
  })
})

test('findDemoCredentials returns the oauth2 entry for the bundled me endpoint', () => {
  const entry = findDemoCredentials('getMe')

  deepEqual(entry, {
    kind: 'oauth2',
    operationIds: ['getMe'],
    token: 'demo-oauth2-token-12345',
    flowType: 'clientCredentials',
    scopes: ['read:products', 'write:products'],
  })
})

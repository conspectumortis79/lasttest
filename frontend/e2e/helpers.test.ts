import test from 'node:test'
import assert from 'node:assert/strict'
import { endpointCheckboxLabel, resolveDemoEndpoint } from './helpers.ts'

test('endpointCheckboxLabel mirrors the hardcoded German format in App.tsx', () => {
  assert.equal(endpointCheckboxLabel('GET', '/products'), 'Endpunkt GET /products auswählen')
  assert.equal(
    endpointCheckboxLabel('POST', '/products/search'),
    'Endpunkt POST /products/search auswählen',
  )
  assert.equal(
    endpointCheckboxLabel('PUT', '/products/{id}'),
    'Endpunkt PUT /products/{id} auswählen',
  )
})

test('resolveDemoEndpoint maps every demo operationId to (method, path)', () => {
  const expectations: Array<[string, string, string]> = [
    ['listProducts', 'GET', '/products'],
    ['getProduct', 'GET', '/products/{id}'],
    ['searchProducts', 'POST', '/products/search'],
    ['createProduct', 'POST', '/products'],
    ['updateProduct', 'PUT', '/products/{id}'],
    ['deleteProduct', 'DELETE', '/products/{id}'],
    ['getAdminStats', 'GET', '/products/admin/stats'],
    ['lookupProduct', 'GET', '/products/lookup-by-id'],
    ['getMe', 'GET', '/products/me'],
    ['getMyProfile', 'GET', '/products/my-profile'],
  ]
  for (const [operationId, method, path] of expectations) {
    assert.deepEqual(resolveDemoEndpoint(operationId), { method, path })
  }
})

test('resolveDemoEndpoint throws on unknown operationIds', () => {
  assert.throws(() => resolveDemoEndpoint('list-products'), /Unknown demo operationId/)
  assert.throws(() => resolveDemoEndpoint(''), /Unknown demo operationId/)
  assert.throws(() => resolveDemoEndpoint('listProducts '), /Unknown demo operationId/)
})

test('endpointCheckboxLabel composes correctly with resolveDemoEndpoint', () => {
  const resolved = resolveDemoEndpoint('searchProducts')
  assert.equal(
    endpointCheckboxLabel(resolved.method, resolved.path),
    'Endpunkt POST /products/search auswählen',
  )
})

import { deepEqual, equal } from 'node:assert/strict'
import { test } from 'node:test'
import { validateSpecificationUrl } from './specificationSource.ts'

test('validateSpecificationUrl accepts http and https URLs with a host', () => {
  equal(validateSpecificationUrl('https://api.example.com/openapi.json'), undefined)
  equal(validateSpecificationUrl('http://api.example.com/openapi.json'), undefined)
  equal(validateSpecificationUrl('  https://api.example.com/swagger-ui  '), undefined)
})

test('validateSpecificationUrl accepts the demo Swagger UI URL', () => {
  equal(validateSpecificationUrl('http://localhost:8286/demo-swagger-ui'), undefined)
  equal(validateSpecificationUrl('https://api.example.com/swagger-ui/index.html'), undefined)
})

test('validateSpecificationUrl tolerates an empty input', () => {
  equal(validateSpecificationUrl(''), undefined)
  equal(validateSpecificationUrl('   '), undefined)
})

test('validateSpecificationUrl rejects URLs with a non-http scheme', () => {
  equal(validateSpecificationUrl('ftp://example.com/spec.json'), 'Die URL muss mit http:// oder https:// beginnen.')
  equal(validateSpecificationUrl('file:///etc/passwd'), 'Die URL muss mit http:// oder https:// beginnen.')
})

test('validateSpecificationUrl rejects URLs that are syntactically invalid', () => {
  equal(validateSpecificationUrl('https://'), 'Die URL ist ungültig.')
  equal(validateSpecificationUrl('not a url'), 'Die URL ist ungültig.')
  equal(validateSpecificationUrl('example.com/openapi.json'), 'Die URL ist ungültig.')
})

test('validateSpecificationUrl accepts host-less URLs that the JS URL parser still recognises', () => {
  // The WHATWG URL parser treats `https:///path` as having hostname `path`.
  // The backend will reject it later if appropriate; the frontend does not
  // duplicate that check.
  equal(validateSpecificationUrl('https:///path'), undefined)
})

test('validateSpecificationUrl rejects URLs with credentials', () => {
  equal(validateSpecificationUrl('https://user:pass@example.com/openapi.json'), 'Die URL darf keine Zugangsdaten enthalten.')
})

test('validateSpecificationUrl rejects URLs that are too long', () => {
  const tooLong = 'https://api.example.com/' + 'a'.repeat(2048)
  const result = validateSpecificationUrl(tooLong)
  equal(result?.startsWith('Die URL ist zu lang'), true)
})


test('validateSpecificationUrl uses the deepEqual contract for its return value', () => {
  deepEqual(validateSpecificationUrl(''), undefined)
  deepEqual(validateSpecificationUrl('ftp://example.com'), 'Die URL muss mit http:// oder https:// beginnen.')
})

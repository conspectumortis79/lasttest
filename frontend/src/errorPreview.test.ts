import { equal } from 'node:assert/strict'
import { test } from 'node:test'
import { firstErrorLine } from './errorPreview.ts'

test('firstErrorLine returns the first line when there is only one', () => {
  equal(firstErrorLine('k6: connection refused'), 'k6: connection refused')
})

test('firstErrorLine returns the first line of a multi-line error', () => {
  const error = 'ERRO[0001] script error\n  at script.js:42:5\n  at native\n  at processTicksAndRejections'
  equal(firstErrorLine(error), 'ERRO[0001] script error')
})

test('firstErrorLine trims surrounding whitespace from the error and the line', () => {
  const error = '   \n  ERRO[0001] timeout after 30s  \n  more details  '
  equal(firstErrorLine(error), 'ERRO[0001] timeout after 30s')
})

test('firstErrorLine handles Windows line endings', () => {
  const error = 'ERRO[0001] connection refused\r\n  at script.js:1:1'
  equal(firstErrorLine(error), 'ERRO[0001] connection refused')
})

test('firstErrorLine truncates very long first lines with an ellipsis', () => {
  const long = 'A'.repeat(500)
  const result = firstErrorLine(long)
  equal(result.length, 140)
  equal(result.endsWith('…'), true)
})

test('firstErrorLine returns an empty string for an empty error', () => {
  equal(firstErrorLine(''), '')
  equal(firstErrorLine('   \n  \n  '), '')
})

test('firstErrorLine keeps short lines exactly as-is without an ellipsis', () => {
  const short = 'X'.repeat(139)
  equal(firstErrorLine(short), short)
})

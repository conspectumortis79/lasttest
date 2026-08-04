import { equal } from 'node:assert/strict'
import { test } from 'node:test'
import { MAX_VIRTUAL_USERS, validateLoadProfile } from './loadProfile.ts'

test('accepts the virtual user boundaries', () => {
  equal(validateLoadProfile(1, 10), undefined)
  equal(validateLoadProfile(MAX_VIRTUAL_USERS, 10), undefined)
})

test('rejects virtual users outside the supported range', () => {
  equal(validateLoadProfile(0, 10), 'Virtual Users müssen zwischen 1 und 1000 liegen.')
  equal(validateLoadProfile(1001, 10), 'Virtual Users müssen zwischen 1 und 1000 liegen.')
})

test('rejects non-integer virtual users and invalid durations', () => {
  equal(validateLoadProfile(1.5, 10), 'Virtual Users müssen zwischen 1 und 1000 liegen.')
  equal(validateLoadProfile(10, 0), 'Die Dauer muss zwischen 1 und 3600 Sekunden liegen.')
})

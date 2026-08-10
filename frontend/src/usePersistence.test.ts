// Tests for the storage write side of the
// timeline-persistence toggle. The provider component
// (`usePersistence.tsx`) is a thin wrapper around the pure
// [writeStoredPersistRuns] function exposed here, so the
// storage contract is testable without spinning up the
// React tree. The provider is exercised indirectly via
// the Settings drawer tests.

import { equal } from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import {
  DEFAULT_PERSIST_RUNS,
  readStoredPersistRuns,
  STORAGE_KEY,
  writeStoredPersistRuns,
} from './persistenceStorage.ts'

// Mirror the languageStorage test setup: the storage
// helpers touch `localStorage` directly, so a JSDOM
// environment with a real storage slot is required.
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' })
function setGlobal(name: string, value: unknown) {
  Object.defineProperty(globalThis, name, {
    value,
    writable: true,
    configurable: true,
  })
}
setGlobal('window', dom.window)
setGlobal('document', dom.window.document)
setGlobal('localStorage', dom.window.localStorage)

test('writeStoredPersistRuns persists a true value into the storage slot', () => {
  // The Settings drawer calls this through the
  // provider's useEffect. Pinning the write path here
  // means a regression that swapped the storage key
  // (or dropped the write entirely) surfaces here as a
  // missing value, not as a Settings drawer UI bug.
  writeStoredPersistRuns(true)
  equal(localStorage.getItem(STORAGE_KEY), 'true')
  // The reader must see the same value the writer
  // just stored — without this, the storage contract
  // is broken at the round-trip level and a page
  // reload would flip the user's choice back to the
  // default.
  equal(readStoredPersistRuns(), true)
  writeStoredPersistRuns(false)
})

test('writeStoredPersistRuns persists a false value into the storage slot', () => {
  // The user might toggle the switch back to off
  // after a few persisted runs. The writer must
  // overwrite the previous value rather than
  // appending to it.
  writeStoredPersistRuns(true)
  writeStoredPersistRuns(false)
  equal(localStorage.getItem(STORAGE_KEY), 'false')
  equal(readStoredPersistRuns(), false)
})

test('readStoredPersistRuns returns the default when the storage slot is empty', () => {
  // The user's "first visit" contract: no entry in
  // localStorage means the toggle is off. A regression
  // that hard-coded `true` here would silently flip
  // every new visitor's first session to "persist
  // every run".
  localStorage.removeItem(STORAGE_KEY)
  equal(readStoredPersistRuns(), DEFAULT_PERSIST_RUNS)
  equal(readStoredPersistRuns(), false)
})

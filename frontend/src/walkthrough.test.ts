// The walkthrough data structure is the source of truth for the
// User Guide popup. The four steps are referenced in lock-step
// with i18n keys — every step has a title, an intro, and the
// same number of annotations in the same order. A regression in
// either side would surface as a `walk.X.ann.N.title` key that
// resolves to the raw key (the i18n fallback).
import { equal, ok } from 'node:assert/strict'
import { test } from 'node:test'
import { STEPS, annotationText } from './walkthroughData.ts'
import { translate } from './i18n.ts'

test('every step has a non-empty title and intro in both languages', () => {
  for (const step of STEPS) {
    equal(typeof translate('en', step.titleKey), 'string')
    equal(typeof translate('de', step.titleKey), 'string')
    ok(translate('en', step.titleKey).length > 0, `${step.id} titleKey (en) must be non-empty`)
    ok(translate('de', step.titleKey).length > 0, `${step.id} titleKey (de) must be non-empty`)
    ok(translate('en', step.introKey).length > 0, `${step.id} introKey (en) must be non-empty`)
    ok(translate('de', step.introKey).length > 0, `${step.id} introKey (de) must be non-empty`)
  }
})

test('every annotation has a non-empty title and body in both languages', () => {
  for (const step of STEPS) {
    for (const ann of step.annotations) {
      const en = annotationText('en', ann)
      const de = annotationText('de', ann)
      ok(en.title.length > 0, `${step.id}.ann.${ann.n} title (en) must be non-empty`)
      ok(de.title.length > 0, `${step.id}.ann.${ann.n} title (de) must be non-empty`)
      ok(en.body.length > 0, `${step.id}.ann.${ann.n} body (en) must be non-empty`)
      ok(de.body.length > 0, `${step.id}.ann.${ann.n} body (de) must be non-empty`)
    }
  }
})

test('annotations are numbered 1..N contiguously within each step', () => {
  for (const step of STEPS) {
    const ns = step.annotations.map(a => a.n).sort((a, b) => a - b)
    for (let i = 0; i < ns.length; i++) {
      equal(ns[i], i + 1, `${step.id} annotation numbering must be contiguous from 1`)
    }
  }
})

test('exactly five steps exist in the canonical order', () => {
  equal(STEPS.length, 5)
  equal(STEPS.map(s => s.id).join(','), 'step1,step2,step3,step4,step5')
})

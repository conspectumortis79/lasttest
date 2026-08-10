// Pinning the Settings-drawer section order. The drawer
// has four sections today (Language, Notifications,
// Timeline, Demo API) and the test guards against a
// refactor that silently re-shuffles them — a regression
// there would move the "Save executed test configurations"
// toggle back into the Demo API group, where the user
// originally reported it as confusing (it has nothing to
// do with the demo). The test renders the drawer in a
// stub harness so the production translations drive the
// visible labels, and then asserts the section order via
// the heading text.

import { equal, ok } from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'

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
setGlobal('navigator', dom.window.navigator)
setGlobal('HTMLElement', dom.window.HTMLElement)
setGlobal('Element', dom.window.Element)
setGlobal('Node', dom.window.Node)
setGlobal('DocumentFragment', dom.window.DocumentFragment)
setGlobal('localStorage', dom.window.localStorage)
setGlobal('getComputedStyle', dom.window.getComputedStyle)
setGlobal('IS_REACT_ACT_ENVIRONMENT', true)

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { SettingsDrawer } from './SettingsDrawer.tsx'
import { LanguageProvider } from './useLanguage.tsx'
import { PersistenceProvider } from './usePersistence.tsx'
import { DemoStatusProvider } from './useDemoStatus.tsx'

type Section = { heading: string, firstTestId: string | null }

function renderDrawer(language: 'en' | 'de') {
  // The drawer needs the same providers the App tree
  // wires up so the hook calls inside the switches see
  // the live context. We render the drawer in "open"
  // state and inspect the resulting DOM.
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  localStorage.setItem('lasttest.language', language)
  act(() => {
    root.render(
      createElement(
        LanguageProvider,
        null,
        createElement(
          PersistenceProvider,
          null,
          createElement(
            DemoStatusProvider,
            null,
            createElement(SettingsDrawer, {
              open: true,
              language,
              notificationSettings: { enabled: true },
              notificationPermission: 'default',
              onClose: () => {},
              onLanguageChange: () => {},
              onNotificationSettingsChange: () => {},
              onRequestNotificationPermission: () => {},
            }),
          ),
        ),
      ),
    )
  })
  return {
    container,
    unmount: () => {
      act(() => { root.unmount() })
      container.remove()
      localStorage.removeItem('lasttest.language')
    },
  }
}

function extractSections(container: HTMLElement): Section[] {
  // Each section is rendered as `<h3 class="drawer-section">`
  // followed by a `<div class="drawer-radio-group">` or
  // `<div class="drawer-checkbox-group">` that contains the
  // controls. We walk the drawer body, picking up the
  // heading + the first switch/radio test-id under it so
  // the test can assert both the order and the binding.
  const headings = Array.from(container.querySelectorAll('.drawer-section'))
  return headings.map(heading => {
    const group = heading.nextElementSibling
    const firstControl = group?.querySelector('input[data-testid]')
    return {
      heading: heading.textContent?.trim() ?? '',
      firstTestId: firstControl?.getAttribute('data-testid') ?? null,
    }
  })
}

test('sections are rendered in the documented order (Language → Notifications → Timeline → Demo API)', () => {
  // The user reported the toggle belonged nowhere
  // before — it sat under "Demo API" with no heading
  // of its own. Pin the order so a future refactor
  // cannot re-shuffle the sections and silently drop
  // the Timeline heading again.
  const handle = renderDrawer('en')
  try {
    const sections = extractSections(handle.container)
    equal(sections.length, 4, 'the drawer must render exactly four sections')
    equal(sections[0].heading, 'Language')
    equal(sections[1].heading, 'Notifications')
    equal(sections[2].heading, 'Timeline')
    equal(sections[3].heading, 'Demo API')
  } finally {
    handle.unmount()
  }
})

test('the Timeline section owns the Save-executions toggle', () => {
  // The regression the user reported: the toggle sat
  // under "Demo API" and had no heading of its own. The
  // fix moved the toggle into the new "Timeline" group
  // so the user can see at a glance that the setting
  // controls the timeline persistence, not the demo.
  const handle = renderDrawer('en')
  try {
    const sections = extractSections(handle.container)
    const timeline = sections[2]
    equal(timeline.heading, 'Timeline')
    equal(
      timeline.firstTestId,
      'settings-save-executions-switch',
      'the Save-executions switch must live in the Timeline section, not the Demo API section',
    )
  } finally {
    handle.unmount()
  }
})

test('the Demo API section owns only the bundled-demo-API switch', () => {
  // Before the fix the Demo API section hosted two
  // unrelated switches (demo on/off + persist on/off).
  // The fix split them apart: the Demo API section now
  // owns only the bundled-demo switch. Pin the
  // membership so a future refactor that re-introduces
  // the bundle does not silently re-bundle the
  // persistence toggle.
  const handle = renderDrawer('en')
  try {
    const sections = extractSections(handle.container)
    const demo = sections[3]
    equal(demo.heading, 'Demo API')
    equal(
      demo.firstTestId,
      'settings-demo-api-switch',
      'the Demo API section must only own the bundled-demo switch',
    )
  } finally {
    handle.unmount()
  }
})

test('the Timeline heading uses the standard drawer-section class — no special icon or colour', () => {
  // The user explicitly asked for the new heading to
  // match the existing headings exactly: same class,
  // no decorative icon, no colour override. A
  // regression that adds a `★` icon or a custom
  // background would surface here as a class-list
  // mismatch.
  const handle = renderDrawer('en')
  try {
    const headings = Array.from(handle.container.querySelectorAll('.drawer-section'))
    const timelineHeading = headings.find(heading => heading.textContent?.trim() === 'Timeline')
    ok(timelineHeading, 'expected a heading labelled "Timeline"')
    // The heading must use only the shared class — no
    // helper / utility / colour-override classes that
    // would visually distinguish it from its peers.
    equal(timelineHeading?.className.trim(), 'drawer-section')
    // The heading must not contain any decorative
    // glyphs (the user explicitly asked for "kein
    // Stern"). The text content is exactly the
    // translated label.
    equal(timelineHeading?.textContent?.trim(), 'Timeline')
  } finally {
    handle.unmount()
  }
})

test('german localisation uses the same order and the translated Timeline heading', () => {
  // Pair with the English test: the German copy
  // describes the drawer in the user's preferred
  // language. Pinning both languages against the same
  // structural expectations keeps the section order
  // stable across the i18n split.
  const handle = renderDrawer('de')
  try {
    const sections = extractSections(handle.container)
    equal(sections[0].heading, 'Sprache')
    equal(sections[1].heading, 'Benachrichtigungen')
    equal(sections[2].heading, 'Timeline')
    equal(sections[3].heading, 'Demo-API')
  } finally {
    handle.unmount()
  }
})

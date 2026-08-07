// Pure data for the User Guide walkthrough. Lives in its own
// `.ts` file (no JSX) so the i18n wiring can be exercised under
// node:test without bundling the SVG illustrations.
import type { SupportedLanguage } from './i18n.ts'
import { translate } from './i18n.ts'

export type WalkthroughStepId = 'step1' | 'step2' | 'step3' | 'step4' | 'step5'

export type WalkthroughAnnotation = {
  n: number
  titleKey: `walk.${WalkthroughStepId}.ann.${number}.title`
  bodyKey: `walk.${WalkthroughStepId}.ann.${number}.body`
}

export type WalkthroughStep = {
  id: WalkthroughStepId
  titleKey: `walk.${WalkthroughStepId}.title`
  introKey: `walk.${WalkthroughStepId}.intro`
  annotations: WalkthroughAnnotation[]
}

export const STEPS: WalkthroughStep[] = [
  {
    id: 'step1',
    titleKey: 'walk.step1.title',
    introKey: 'walk.step1.intro',
    annotations: [
      { n: 1, titleKey: 'walk.step1.ann.1.title', bodyKey: 'walk.step1.ann.1.body' },
      { n: 2, titleKey: 'walk.step1.ann.2.title', bodyKey: 'walk.step1.ann.2.body' },
      { n: 3, titleKey: 'walk.step1.ann.3.title', bodyKey: 'walk.step1.ann.3.body' },
      { n: 4, titleKey: 'walk.step1.ann.4.title', bodyKey: 'walk.step1.ann.4.body' },
    ],
  },
  {
    id: 'step2',
    titleKey: 'walk.step2.title',
    introKey: 'walk.step2.intro',
    annotations: [
      { n: 1, titleKey: 'walk.step2.ann.1.title', bodyKey: 'walk.step2.ann.1.body' },
      { n: 2, titleKey: 'walk.step2.ann.2.title', bodyKey: 'walk.step2.ann.2.body' },
      { n: 3, titleKey: 'walk.step2.ann.3.title', bodyKey: 'walk.step2.ann.3.body' },
      { n: 4, titleKey: 'walk.step2.ann.4.title', bodyKey: 'walk.step2.ann.4.body' },
    ],
  },
  {
    id: 'step3',
    titleKey: 'walk.step3.title',
    introKey: 'walk.step3.intro',
    annotations: [
      { n: 1, titleKey: 'walk.step3.ann.1.title', bodyKey: 'walk.step3.ann.1.body' },
      { n: 2, titleKey: 'walk.step3.ann.2.title', bodyKey: 'walk.step3.ann.2.body' },
      { n: 3, titleKey: 'walk.step3.ann.3.title', bodyKey: 'walk.step3.ann.3.body' },
    ],
  },
  {
    id: 'step4',
    titleKey: 'walk.step4.title',
    introKey: 'walk.step4.intro',
    annotations: [
      { n: 1, titleKey: 'walk.step4.ann.1.title', bodyKey: 'walk.step4.ann.1.body' },
      { n: 2, titleKey: 'walk.step4.ann.2.title', bodyKey: 'walk.step4.ann.2.body' },
      { n: 3, titleKey: 'walk.step4.ann.3.title', bodyKey: 'walk.step4.ann.3.body' },
      { n: 4, titleKey: 'walk.step4.ann.4.title', bodyKey: 'walk.step4.ann.4.body' },
    ],
  },
  {
    id: 'step5',
    titleKey: 'walk.step5.title',
    introKey: 'walk.step5.intro',
    annotations: [
      { n: 1, titleKey: 'walk.step5.ann.1.title', bodyKey: 'walk.step5.ann.1.body' },
      { n: 2, titleKey: 'walk.step5.ann.2.title', bodyKey: 'walk.step5.ann.2.body' },
      { n: 3, titleKey: 'walk.step5.ann.3.title', bodyKey: 'walk.step5.ann.3.body' },
      { n: 4, titleKey: 'walk.step5.ann.4.title', bodyKey: 'walk.step5.ann.4.body' },
    ],
  },
]

export function annotationText(lang: SupportedLanguage, ann: WalkthroughAnnotation): { title: string; body: string } {
  return {
    title: translate(lang, ann.titleKey),
    body: translate(lang, ann.bodyKey),
  }
}

/**
 * Selection of the four annotations whose emphasis on the
 * illustration differs. The colour palette is fixed so the same
 * "input zone" reads the same across all four steps.
 */
export const ZONE_COLOR = {
  /** Where the user types or pastes something. */
  input: '#7d63ff',
  /** Controls that start a backend action. */
  action: '#22d3ee',
  /** Output / explanation. */
  output: '#facc15',
  /** Status / indicators. */
  status: '#fb923c',
} as const

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
  /**
   * Optional secondary SVG illustration shown below the primary
   * one. Used by the step 4 ("Test Runs") tab, which has too
   * many new features — the Letzte Läufe row list and the run
   * detail tab strip — to fit in a single schematic. The
   * design constraint is "max 2 SVGs per step". When this
   * field is set, the [UserGuideWalkthrough] component renders
   * the secondary illustration right below the primary one
   * inside the same illustration card, and the second batch
   * of annotations points at the secondary SVG.
   */
  secondarySvg?: 'step4-detail'
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
      { n: 5, titleKey: 'walk.step1.ann.5.title', bodyKey: 'walk.step1.ann.5.body' },
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
    secondarySvg: 'step4-detail',
    // Annotations 1–4 belong to the primary SVG (the Letzte
    // Läufe row list). Annotations 5–8 belong to the secondary
    // SVG (the run detail tab strip plus the overview tab).
    // The numbers are contiguous [1..8] per the walkthrough
    // test in [walkthrough.test.ts].
    annotations: [
      { n: 1, titleKey: 'walk.step4.ann.1.title', bodyKey: 'walk.step4.ann.1.body' },
      { n: 2, titleKey: 'walk.step4.ann.2.title', bodyKey: 'walk.step4.ann.2.body' },
      { n: 3, titleKey: 'walk.step4.ann.3.title', bodyKey: 'walk.step4.ann.3.body' },
      { n: 4, titleKey: 'walk.step4.ann.4.title', bodyKey: 'walk.step4.ann.4.body' },
      { n: 5, titleKey: 'walk.step4.ann.5.title', bodyKey: 'walk.step4.ann.5.body' },
      { n: 6, titleKey: 'walk.step4.ann.6.title', bodyKey: 'walk.step4.ann.6.body' },
      { n: 7, titleKey: 'walk.step4.ann.7.title', bodyKey: 'walk.step4.ann.7.body' },
      { n: 8, titleKey: 'walk.step4.ann.8.title', bodyKey: 'walk.step4.ann.8.body' },
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

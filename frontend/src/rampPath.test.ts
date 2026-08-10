import { equal, ok } from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildIstPath,
  buildRampPlot,
  buildSollPath,
  profileTotalSeconds,
  type ReportLoadProfile,
} from './k6Report.ts'

test('profileTotalSeconds sums the stage durations for ramping-vus', () => {
  const profile: ReportLoadProfile = {
    type: 'ramping-vus',
    startVUs: 0,
    stages: [
      { target: 0, durationSeconds: 10 },
      { target: 800, durationSeconds: 10 },
      { target: 800, durationSeconds: 30 },
      { target: 0, durationSeconds: 30 },
    ],
  }
  equal(profileTotalSeconds(profile), 80)
})

test('profileTotalSeconds returns the explicit duration for constant-vus', () => {
  equal(profileTotalSeconds({ type: 'constant-vus', virtualUsers: 50, durationSeconds: 120 }), 120)
})

test('profileTotalSeconds returns undefined for shared-iterations', () => {
  equal(profileTotalSeconds({ type: 'shared-iterations', virtualUsers: 10, iterations: 100 }), undefined)
})

test('profileTotalSeconds returns the explicit duration for constant-arrival-rate', () => {
  // The constant-arrival-rate executor does not iterate VUs,
  // it requests a fixed requests/second rate for the given
  // duration. The total run length is the duration itself, so
  // the helper mirrors the constant-vus branch. Pin the
  // branch so a future refactor that drops the case does not
  // silently produce 0 for arrival-rate profiles (the
  // "default" branch is the silent fail).
  equal(
    profileTotalSeconds({ type: 'constant-arrival-rate', rate: 50, timeUnitSeconds: 1, durationSeconds: 120, preAllocatedVUs: 10, maxVUs: 100 }),
    120,
  )
})

test('profileTotalSeconds sums the stage durations for ramping-arrival-rate', () => {
  // Mirror of the ramping-vus branch: the total run length
  // is the sum of every stage's durationSeconds. A regression
  // that drops the case would land on the "default" branch
  // and return undefined — the timeline chart would silently
  // shrink to the 60-second fallback.
  const profile: ReportLoadProfile = {
    type: 'ramping-arrival-rate',
    startRate: 0,
    stages: [
      { target: 100, durationSeconds: 30 },
      { target: 100, durationSeconds: 60 },
      { target: 0, durationSeconds: 30 },
    ],
  }
  equal(profileTotalSeconds(profile), 120)
})

test('profileTotalSeconds returns undefined for an unknown profile type', () => {
  // The `default` branch of [profileTotalSeconds] covers any
  // profile shape that does not match the four known k6
  // executor types. Cast through `unknown` so the fixture
  // type-checks at compile time without dragging a new
  // ReportLoadProfile variant into the public model just for
  // this test.
  const unknown = { type: 'something-new', virtualUsers: 1 } as unknown as ReportLoadProfile
  equal(profileTotalSeconds(unknown), undefined)
})

test('buildSollPath emits the ramp shape for a ramping-vus profile', () => {
  const profile: ReportLoadProfile = {
    type: 'ramping-vus',
    startVUs: 0,
    stages: [
      { target: 0, durationSeconds: 10 },
      { target: 800, durationSeconds: 10 },
      { target: 800, durationSeconds: 30 },
      { target: 0, durationSeconds: 30 },
    ],
  }
  const plot = buildRampPlot(profile, [])
  const path = buildSollPath(plot)
  // 2 points per stage + 1 start point = 9 points → 1 M + 8 L.
  // (Plateau transition 800→800 creates an extra segment endpoint.)
  ok(path.startsWith('M '), 'path starts with M')
  const segments = path.split('L').length - 1
  ok(segments >= 7, `expected at least 7 line segments, got ${segments}`)
  // The path ends at the bottom edge (Y coordinate = plot height - padding),
  // because the last stage target is 0 VUs.
  const lastSegment = path.split('L').pop()!.trim()
  const lastY = Number(lastSegment.split(' ').pop())
  equal(lastY, plot.height - 4, 'last Y-coordinate is the bottom edge')
})

test('buildSollPath emits a horizontal line for constant-vus', () => {
  const profile: ReportLoadProfile = { type: 'constant-vus', virtualUsers: 25, durationSeconds: 60 }
  const plot = buildRampPlot(profile, [])
  const path = buildSollPath(plot)
  // 2 Punkte: (0,25) → (60,25)
  equal(path.split('L').length - 1, 1)
})

test('buildSollPath emits a horizontal line for constant-arrival-rate', () => {
  const profile: ReportLoadProfile = {
    type: 'constant-arrival-rate',
    rate: 50,
    timeUnitSeconds: 1,
    durationSeconds: 120,
    preAllocatedVUs: 10,
    maxVUs: 100,
  }
  const plot = buildRampPlot(profile, [])
  // buildSollPath returns pixel coordinates, not the raw values.
  // We check that the line has an M + exactly one L (horizontal)
  // and that both Y coordinates are equal.
  const path = buildSollPath(plot)
  const segments = path.split('L')
  equal(segments.length, 2, 'horizontal line has exactly 1 L-segment')
  const startMatch = segments[0].trim().match(/^M ([\d.]+) ([\d.]+)$/)
  const endMatch = segments[1].trim().match(/^([\d.]+) ([\d.]+)$/)
  ok(startMatch, `start segment is well-formed: ${segments[0]}`)
  ok(endMatch, `end segment is well-formed: ${segments[1]}`)
  equal(startMatch![2], endMatch![2], 'Y-Koordinaten sind gleich (horizontale Linie)')
})

test('buildSollPath returns empty string for shared-iterations', () => {
  const profile: ReportLoadProfile = { type: 'shared-iterations', virtualUsers: 10, iterations: 100 }
  const plot = buildRampPlot(profile, [])
  equal(buildSollPath(plot), '')
})

test('buildSollPath emits the ramp shape for a ramping-arrival-rate profile', () => {
  // Mirror of the ramping-vus test for arrival-rate profiles:
  // the target line walks through every stage's target rate so
  // the user can compare the configured RPS against the
  // measured RPS. A regression that drops the case would
  // land on the default branch and the path would silently
  // become empty.
  const profile: ReportLoadProfile = {
    type: 'ramping-arrival-rate',
    startRate: 0,
    stages: [
      { target: 50, durationSeconds: 30 },
      { target: 50, durationSeconds: 30 },
      { target: 0, durationSeconds: 30 },
    ],
  }
  const plot = buildRampPlot(profile, [])
  const path = buildSollPath(plot)
  ok(path.startsWith('M '), 'ramping-arrival-rate path starts with M')
  const segments = path.split('L').length - 1
  ok(segments >= 5, `expected at least 5 L-segments, got ${segments}`)
})

test('buildSollPath returns empty string for an unknown profile type', () => {
  // The `default` branch of [buildSollPoints] (which feeds
  // [buildSollPath]) must mirror the `default` branch of
  // [profileTotalSeconds]: anything we do not know how to
  // render produces an empty path so the chart never shows a
  // garbage line. Cast through `unknown` so the fixture
  // type-checks without a new ReportLoadProfile variant.
  const unknown = { type: 'something-new', virtualUsers: 1 } as unknown as ReportLoadProfile
  const plot = buildRampPlot(unknown, [])
  equal(buildSollPath(plot), '')
})

test('buildRampPlot incorporates ist points and scales the Y axis to the maximum value', () => {
  const profile: ReportLoadProfile = {
    type: 'ramping-vus',
    startVUs: 0,
    stages: [
      { target: 0, durationSeconds: 10 },
      { target: 1000, durationSeconds: 10 },
    ],
  }
  const ist = [
    { time: '2026-08-04T16:50:00Z', value: 0 },
    { time: '2026-08-04T16:50:05Z', value: 500 },
    { time: '2026-08-04T16:50:10Z', value: 980 },
    { time: '2026-08-04T16:50:20Z', value: 1000 },
  ]
  const plot = buildRampPlot(profile, ist)
  // Y-axis must be above the highest value (1.1x).
  ok(plot.maxValue >= 1000, 'maxValue scales to the ist peak')
  ok(plot.istPoints, 'istPoints set')
  equal(plot.istPoints?.length, 4)
})

test('buildRampPlot omits istPoints when the ist list is empty', () => {
  const profile: ReportLoadProfile = { type: 'constant-vus', virtualUsers: 10, durationSeconds: 30 }
  const plot = buildRampPlot(profile, [])
  equal(plot.istPoints, undefined)
  equal(buildIstPath(plot), '')
})

test('buildIstPath normalises timestamps so the first sample starts at 0 s', () => {
  const profile: ReportLoadProfile = { type: 'constant-vus', virtualUsers: 10, durationSeconds: 30 }
  const ist = [
    { time: '2026-08-04T16:50:00Z', value: 0 },
    { time: '2026-08-04T16:50:10Z', value: 10 },
    { time: '2026-08-04T16:50:30Z', value: 10 },
  ]
  const plot = buildRampPlot(profile, ist)
  const path = buildIstPath(plot)
  ok(path.startsWith('M '))
  ok(path.includes('L '), 'multiple points produce L commands')
})

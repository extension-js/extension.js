import assert from 'node:assert/strict'
import {test} from 'node:test'
import {
  dateToEpoch,
  findHeldViolations,
  HELD_STRINGS
} from '../check-held-strings.mjs'

const CLI_BUILD = 'unpublished-build-for-review?utm_source=cli-build'
const PLANTED = 'held-marketing-banner?utm_source=future-campaign'

function dist(...strings) {
  return strings.map((contents, i) => ({file: `${i}.mjs`, contents}))
}

test('RED: a held string dated in the future present in the dist is a violation', () => {
  const violations = findHeldViolations({
    heldStrings: [{string: PLANTED, heldUntil: '2026-08-14'}],
    distFiles: dist(`export const hint = "${PLANTED}"`),
    now: new Date('2026-08-01T00:00:00Z')
  })
  assert.equal(violations.length, 1)
  assert.equal(violations[0].string, PLANTED)
  assert.equal(violations[0].heldUntil, '2026-08-14')
  assert.equal(violations[0].file, '0.mjs')
})

test('GREEN by date: once heldUntil has passed the same string is allowed', () => {
  const violations = findHeldViolations({
    heldStrings: [{string: PLANTED, heldUntil: '2026-08-14'}],
    distFiles: dist(`export const hint = "${PLANTED}"`),
    now: new Date('2026-08-14T00:00:00Z')
  })
  assert.deepEqual(violations, [])
})

test('GREEN by date: a day after the hold there is no violation', () => {
  const violations = findHeldViolations({
    heldStrings: [{string: PLANTED, heldUntil: '2026-08-14'}],
    distFiles: dist(`export const hint = "${PLANTED}"`),
    now: new Date('2026-08-15T09:00:00Z')
  })
  assert.deepEqual(violations, [])
})

test('GREEN by absence: a future-held string absent from the dist is allowed', () => {
  const violations = findHeldViolations({
    heldStrings: [{string: PLANTED, heldUntil: '2026-08-14'}],
    distFiles: dist('export const hint = "nothing to see here"'),
    now: new Date('2026-08-01T00:00:00Z')
  })
  assert.deepEqual(violations, [])
})

test('GREEN by grandfather: an already-shipped held string never reds the gate', () => {
  const violations = findHeldViolations({
    heldStrings: [
      {string: CLI_BUILD, heldUntil: '2026-08-14', grandfathered: true}
    ],
    distFiles: dist(`export const hint = "${CLI_BUILD}"`),
    now: new Date('2026-08-01T00:00:00Z')
  })
  assert.deepEqual(violations, [])
})

test('the grandfather bypass is the ONLY thing keeping cli-build green today', () => {
  const distFiles = dist(`export const hint = "${CLI_BUILD}"`)
  const now = new Date('2026-08-01T00:00:00Z')

  const grandfathered = findHeldViolations({
    heldStrings: [
      {string: CLI_BUILD, heldUntil: '2026-08-14', grandfathered: true}
    ],
    distFiles,
    now
  })
  assert.deepEqual(grandfathered, [])

  const withoutBypass = findHeldViolations({
    heldStrings: [{string: CLI_BUILD, heldUntil: '2026-08-14'}],
    distFiles,
    now
  })
  assert.equal(withoutBypass.length, 1)
})

test('the shipped held list carries the cli-build entry, grandfathered, with a real date', () => {
  const entry = HELD_STRINGS.find((h) => h.string === CLI_BUILD)
  assert.ok(entry, 'cli-build entry is present in the shipped held list')
  assert.equal(entry.grandfathered, true)
  assert.doesNotThrow(() => dateToEpoch(entry.heldUntil))
})

test('the shipped held list never reds the gate on a dist that carries cli-build today', () => {
  const violations = findHeldViolations({
    heldStrings: HELD_STRINGS,
    distFiles: dist(`export const hint = "${CLI_BUILD}"`),
    now: new Date('2026-08-01T00:00:00Z')
  })
  assert.deepEqual(violations, [])
})

test('an unparseable heldUntil throws rather than passing silently', () => {
  assert.throws(() => dateToEpoch('not-a-date'))
  assert.throws(() =>
    findHeldViolations({
      heldStrings: [{string: PLANTED, heldUntil: 'someday'}],
      distFiles: dist(`export const hint = "${PLANTED}"`),
      now: new Date('2026-08-01T00:00:00Z')
    })
  )
})

test('a held string is matched anywhere in any dist file, not just the first', () => {
  const violations = findHeldViolations({
    heldStrings: [{string: PLANTED, heldUntil: '2026-08-14'}],
    distFiles: dist('clean file', `prefix ${PLANTED} suffix`),
    now: new Date('2026-08-01T00:00:00Z')
  })
  assert.equal(violations.length, 1)
  assert.equal(violations[0].file, '1.mjs')
})

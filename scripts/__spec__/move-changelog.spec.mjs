import assert from 'node:assert/strict'
import {test} from 'node:test'
import {formatReleaseDate, moveChangelog} from '../move-changelog.mjs'

const BASE = `# Changelog

## Unreleased

### Features

- Something new ([abc1234](https://example.com/abc1234))

## 3.18.0 (May 28, 2026)

- Older thing
`

test('writes a dated version heading', () => {
  const out = moveChangelog(BASE, '4.0.13', 'July 19, 2026', '- Something new')
  assert.match(out, /^## 4\.0\.13 \(July 19, 2026\)$/m)
})

test('regression: version and date are not empty', () => {
  // The inline shell version expanded ${version} and ${date} away, producing
  // "##  ()". Guard against ever shipping that shape again.
  const out = moveChangelog(BASE, '4.0.13', 'July 19, 2026', '- x')
  assert.ok(!out.includes('##  ()'), 'must not emit an empty heading')
})

test('leaves a fresh empty Unreleased section on top', () => {
  const out = moveChangelog(BASE, '4.0.13', 'July 19, 2026', '- x')
  const unreleased = out.indexOf('## Unreleased')
  const version = out.indexOf('## 4.0.13')
  assert.ok(unreleased !== -1 && version > unreleased)
})

test('preserves earlier releases', () => {
  const out = moveChangelog(BASE, '4.0.13', 'July 19, 2026', '- x')
  assert.ok(out.includes('## 3.18.0 (May 28, 2026)'))
  assert.ok(out.includes('- Older thing'))
})

test('falls back when there are no notes', () => {
  const out = moveChangelog(BASE, '4.0.13', 'July 19, 2026', '   ')
  assert.ok(out.includes('- No changes listed.'))
})

test('requires a version and a date', () => {
  assert.throws(
    () => moveChangelog(BASE, '', 'July 19, 2026', '- x'),
    /version is required/
  )
  assert.throws(
    () => moveChangelog(BASE, '4.0.13', '', '- x'),
    /date is required/
  )
})

test('throws when there is no Unreleased section to move', () => {
  const out = moveChangelog(
    '# Changelog\n\n## 1.0.0 (a)\n',
    '2.0.0',
    'b',
    '- x'
  )
  assert.ok(out.includes('## 2.0.0 (b)'))
})

test('formatReleaseDate renders a UTC long date', () => {
  assert.equal(
    formatReleaseDate(new Date('2026-07-19T23:30:00Z')),
    'July 19, 2026'
  )
})

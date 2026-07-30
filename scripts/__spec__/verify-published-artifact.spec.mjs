import assert from 'node:assert/strict'
import {test} from 'node:test'
import {
  findMissingMarkers,
  REQUIRED_ARTIFACT_MARKERS
} from '../verify-published-artifact.mjs'

const MARKERS = [
  {file: 'dist/cli.cjs', pattern: "source: 'ci'", invariant: 'ci consent gate'}
]

test('passes when every marker is present in the artifact', () => {
  const read = () => "if (isCI()) return {enabled: false, source: 'ci'}"
  assert.deepEqual(findMissingMarkers(read, MARKERS), [])
})

test('fails when the shipped bundle lost a marker', () => {
  const read = () => 'function isCI() { return false }'
  const missing = findMissingMarkers(read, MARKERS)
  assert.equal(missing.length, 1)
  assert.equal(missing[0].pattern, "source: 'ci'")
})

test('fails when the artifact has no such file at all', () => {
  const read = () => {
    throw new Error('ENOENT')
  }
  assert.equal(findMissingMarkers(read, MARKERS).length, 1)
})

test('the shipped marker list is not empty', () => {
  assert.ok(REQUIRED_ARTIFACT_MARKERS.length > 0)
  for (const marker of REQUIRED_ARTIFACT_MARKERS) {
    assert.ok(marker.file)
    assert.ok(marker.pattern)
    assert.ok(marker.invariant)
  }
})

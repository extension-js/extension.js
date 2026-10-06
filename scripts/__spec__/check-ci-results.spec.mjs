import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import path from 'node:path'
import test from 'node:test'
import {fileURLToPath} from 'node:url'

const script = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'check-ci-results.sh'
)

const run = (results) =>
  spawnSync('bash', [script, results], {encoding: 'utf8'})

test('passes when every job succeeded or was skipped', () => {
  const result = run('success success skipped success')
  assert.equal(result.status, 0, result.stdout + result.stderr)
})

test('fails on the results a dropped runner queue reports', () => {
  const result = run(
    'abandoned abandoned abandoned abandoned success abandoned abandoned abandoned'
  )
  assert.equal(result.status, 1)
  assert.match(result.stdout, /ended as abandoned/)
})

for (const state of ['failure', 'cancelled', 'timed_out', 'unknown']) {
  test(`fails on a job that ended as ${state}`, () => {
    assert.equal(run(`success ${state} success`).status, 1)
  })
}

test('fails on no results at all', () => {
  assert.equal(run('').status, 1)
})

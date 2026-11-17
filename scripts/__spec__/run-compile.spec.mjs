import assert from 'node:assert/strict'
import {test} from 'node:test'
import {runCompile} from '../run-compile.mjs'

// A fake runner that answers each call in turn: a number is an exit code, an
// Error is a runner that could not start.
function fakeRunner(...answers) {
  const calls = []
  const run = async (command, args) => {
    calls.push([command, ...args].join(' '))
    const answer = answers[calls.length - 1]
    if (answer instanceof Error) throw answer
    return answer
  }

  return {run, calls}
}

test('a turbo compile that ran and failed runs once and keeps its exit code', async () => {
  const {run, calls} = fakeRunner(2)

  assert.equal(await runCompile(run), 2)
  assert.deepEqual(calls, ['dotenv -- turbo run compile'])
})

test('a turbo compile that passed runs once', async () => {
  const {run, calls} = fakeRunner(0)

  assert.equal(await runCompile(run), 0)
  assert.equal(calls.length, 1)
})

test('a turbo that could not start falls back to pnpm across the programs', async () => {
  const {run, calls} = fakeRunner(new Error('spawn dotenv ENOENT'), 0)

  assert.equal(await runCompile(run), 0)
  assert.deepEqual(calls, [
    'dotenv -- turbo run compile',
    'pnpm -r --filter ./programs/* run compile'
  ])
})

test('the fallback exit code is the one the script returns', async () => {
  const {run} = fakeRunner(new Error('spawn dotenv ENOENT'), 1)

  assert.equal(await runCompile(run), 1)
})

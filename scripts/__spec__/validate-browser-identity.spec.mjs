import assert from 'node:assert/strict'
import test from 'node:test'
import {judgeIdentityRun} from '../lib/browser-identity-verdict.mjs'

const skip = (target) => ({
  target,
  cacheLabel: 'warm',
  status: 'SKIP',
  detail: `${target} isn't installed.`
})
const pass = (target) => ({
  target,
  cacheLabel: 'warm',
  status: 'PASS',
  detail: ''
})

test('a run where every target skipped fails unless skips were allowed', () => {
  const rows = [skip('brave'), skip('vivaldi'), skip('zen')]
  const verdict = judgeIdentityRun(rows)

  assert.equal(verdict.ok, false)
  assert.match(verdict.message, /0 of 3 target\(s\)/)
  assert.match(verdict.message, /skipped: brave, vivaldi, zen/)
  assert.match(verdict.message, /--allow-skips/)
})

test('an empty run proved nothing and fails', () => {
  assert.equal(judgeIdentityRun([]).ok, false)
})

test('--allow-skips accepts an all-skip run and still says how many targets were proved', () => {
  const verdict = judgeIdentityRun([skip('brave'), skip('zen')], {
    allowSkips: true
  })

  assert.equal(verdict.ok, true)
  assert.match(verdict.message, /^PASS: 0 of 2 target\(s\)/)
  assert.match(verdict.message, /2 skipped \(brave, zen\)/)
})

test('a partial run names how many targets it actually proved', () => {
  const verdict = judgeIdentityRun([pass('chrome'), skip('brave'), skip('zen')])

  assert.equal(verdict.ok, true)
  assert.match(verdict.message, /^PASS: 1 of 3 target\(s\)/)
  assert.match(verdict.message, /2 skipped \(brave, zen\)/)
})

test('a full pass reports every target without a skip note', () => {
  const verdict = judgeIdentityRun([pass('chrome'), pass('firefox')])

  assert.equal(verdict.ok, true)
  assert.equal(
    verdict.message,
    'PASS: 2 of 2 target(s) ran the browser the card names'
  )
})

test('a failed target fails the run whatever the skip policy', () => {
  const rows = [
    pass('chrome'),
    {
      target: 'brave',
      cacheLabel: 'warm',
      status: 'FAIL',
      detail: 'ran a managed Chrome'
    }
  ]

  for (const allowSkips of [false, true]) {
    const verdict = judgeIdentityRun(rows, {allowSkips})

    assert.equal(verdict.ok, false)
    assert.match(
      verdict.message,
      /1 target\(s\) did not run the browser they claim/
    )

    assert.match(verdict.message, /brave \(ran a managed Chrome\)/)
  }
})

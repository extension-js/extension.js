import assert from 'node:assert/strict'
import test from 'node:test'
import {
  classify,
  findKnownBreak,
  KNOWN_UPSTREAM_BREAKS
} from '../deps-canary-known-breaks.mjs'
import {LEGS} from '../deps-canary-overrides.mjs'

const typescriptNextLog = [
  '| typescript | 7.0.2 | typescript@next = 7.1.0-dev.20261102.1 | `7.1.0-dev.20261102.1` |',
  'error   Failed to resolve the native TypeScript executable. `dts.tsgo` requires `typescript` >= 7.0.0.',
  '    at getDtsExecutablePath (file:///node_modules/.pnpm/rsbuild-plugin-dts@1.0.0/node_modules/rsbuild-plugin-dts/dist/tsgo.js)',
  ' ELIFECYCLE  Command failed with exit code 1.'
].join('\n')

// The shape an entry takes while a break waits on an upstream release, kept
// here so the classifier stays covered when the shipped list is empty.
const getExePathBreak = {
  leg: 'typescript-next',
  name: 'rsbuild-plugin-dts calls getExePath() with no argument',
  signature: 'Failed to resolve the native TypeScript executable',
  upstream: [
    'https://github.com/microsoft/TypeScript/pull/64174',
    'https://github.com/web-infra-dev/rslib/pull/1993'
  ],
  retire:
    'an rsbuild-plugin-dts release after 1.0.5 carries rslib#1993 and the lockfile takes it'
}

const breaks = [getExePathBreak]

test('every known break names a real leg, a signature and an upstream link', () => {
  for (const entry of [...KNOWN_UPSTREAM_BREAKS, ...breaks]) {
    assert.ok(LEGS[entry.leg], entry.leg)
    assert.ok(entry.signature.length > 20, entry.name)
    assert.ok(entry.upstream.length > 0, entry.name)

    for (const url of entry.upstream) {
      assert.match(
        url,
        /^https:\/\/github\.com\/[^/]+\/[^/]+\/(pull|issues)\/\d+$/
      )
    }

    assert.ok(entry.retire, entry.name)
  }
})

test('a red that prints a listed signature is an allowed upstream break', () => {
  const result = classify(
    {leg: 'typescript-next', outcome: 'failure', log: typescriptNextLog},
    breaks
  )

  assert.equal(result.exitCode, 0)
  assert.equal(
    result.upstream,
    'rsbuild-plugin-dts calls getExePath() with no argument'
  )

  assert.match(
    result.lines[0],
    /^::warning title=Upstream break on typescript-next::/
  )

  assert.match(result.lines[0], /web-infra-dev\/rslib\/pull\/1993/)
  assert.match(result.lines[0], /Not an Extension\.js defect/)
})

test('any other red on the same leg still fails and is reported as ours', () => {
  const result = classify(
    {
      leg: 'typescript-next',
      outcome: 'failure',
      log: 'FAIL __spec__/build-env.spec.ts > inlines the public env\n'
    },
    breaks
  )

  assert.equal(result.exitCode, 1)
  assert.equal(result.upstream, undefined)
  assert.match(
    result.lines[0],
    /^::error title=Dependency canary typescript-next is red::/
  )
})

test('a known signature on another leg is not allowed there', () => {
  assert.equal(findKnownBreak('rspack-canary', typescriptNextLog, breaks), null)
  assert.equal(
    classify(
      {leg: 'rspack-canary', outcome: 'failure', log: typescriptNextLog},
      breaks
    ).exitCode,
    1
  )
})

test('a leg that runs green again asks for its known break to be deleted', () => {
  const result = classify(
    {leg: 'typescript-next', outcome: 'success', log: ''},
    breaks
  )

  assert.equal(result.exitCode, 0)
  assert.equal(result.lines.length, 1)
  assert.match(
    result.lines[0],
    /^::notice title=Known upstream break no longer reproduces on typescript-next::/
  )

  assert.deepEqual(
    classify({leg: 'frameworks-next', outcome: 'success', log: ''}, breaks)
      .lines,
    []
  )
})

test('with rslib 1.0.6 locked, the getExePath red is ours to read again', () => {
  assert.deepEqual(KNOWN_UPSTREAM_BREAKS, [])

  const result = classify({
    leg: 'typescript-next',
    outcome: 'failure',
    log: typescriptNextLog
  })

  assert.equal(result.exitCode, 1)
  assert.equal(result.upstream, undefined)
})

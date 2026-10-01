import assert from 'node:assert/strict'
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  describeReusedDist,
  newestMtime,
  parseSmokeOptions,
  workspacePackages
} from '../smoke-npx.mjs'

test('the default run compiles every package it packs', () => {
  assert.deepEqual(parseSmokeOptions([]), {fast: false})
  assert.deepEqual(workspacePackages, [
    'programs/extension',
    'programs/create',
    'programs/develop',
    'programs/install'
  ])
})

test('--fast is the only way into the dist-reusing path', () => {
  assert.deepEqual(parseSmokeOptions(['--fast']), {fast: true})
  assert.throws(() => parseSmokeOptions(['--fats']), /Unknown option --fats/)
  assert.throws(
    () => parseSmokeOptions(['--fast', 'extra']),
    /Unknown option extra/
  )
})

test('newestMtime reports the youngest file under a dist, not the folder', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'extjs-smoke-npx-'))

  try {
    mkdirSync(path.join(dir, 'nested'), {recursive: true})
    writeFileSync(path.join(dir, 'old.js'), '')
    writeFileSync(path.join(dir, 'nested', 'young.js'), '')
    const old = new Date('2024-01-01T00:00:00Z')
    const young = new Date('2025-06-01T00:00:00Z')
    utimesSync(path.join(dir, 'old.js'), old, old)
    utimesSync(path.join(dir, 'nested', 'young.js'), young, young)
    utimesSync(dir, old, old)

    assert.equal(newestMtime(dir).toISOString(), young.toISOString())
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})

test('newestMtime of an empty dist is null', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'extjs-smoke-npx-'))

  try {
    assert.equal(newestMtime(dir), null)
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})

test('a reused dist is named with the package, its path and when it was built', () => {
  const line = describeReusedDist(
    'extension-develop',
    '/repo/programs/develop/dist',
    new Date('2025-06-01T12:30:00Z')
  )

  assert.match(line, /^--fast: reusing the existing dist for extension-develop/)
  assert.match(line, /[\\/]programs[\\/]develop[\\/]dist/)
  assert.match(line, /built 2025-06-01T12:30:00\.000Z/)
  assert.match(line, /not the source in this checkout/)
  assert.match(
    describeReusedDist('extension-create', '/repo/programs/create/dist', null),
    /built an empty dist/
  )
})

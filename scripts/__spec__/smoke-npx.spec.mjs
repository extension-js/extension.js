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
import buildExtensions from '../build-extensions.cjs'
import {
  assertCompanionsPacked,
  describeReusedDist,
  missingCompanionManifests,
  newestMtime,
  parseSmokeOptions,
  workspacePackages
} from '../smoke-npx.mjs'

// What tar -tzf prints for a pnpm pack tarball that holds every companion.
function fullListing() {
  const lines = ['package/package.json', 'package/dist/module.cjs']

  for (const name of ['extension-js-devtools', 'extension-js-theme']) {
    for (const engine of ['chromium', 'chrome', 'edge', 'firefox']) {
      lines.push(`package/dist/${name}/${engine}/manifest.json`)
    }
  }

  return lines
}

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

test('the companion check expects every engine the build script produces', () => {
  assert.deepEqual(buildExtensions.ENGINES, [
    'chromium',
    'chrome',
    'edge',
    'firefox'
  ])

  assert.deepEqual(buildExtensions.BUNDLED_PACKAGES, [
    'extension-js-devtools',
    'extension-js-theme'
  ])

  assert.deepEqual(missingCompanionManifests(fullListing()), [])
  assert.doesNotThrow(() =>
    assertCompanionsPacked('extension-develop-1.0.0.tgz', fullListing())
  )
})

test('a tarball without a companion manifest fails and names each missing file', () => {
  const listing = fullListing().filter(
    (line) =>
      line !== 'package/dist/extension-js-theme/firefox/manifest.json' &&
      !line.startsWith('package/dist/extension-js-devtools/')
  )

  assert.deepEqual(missingCompanionManifests(listing), [
    'dist/extension-js-devtools/chromium/manifest.json',
    'dist/extension-js-devtools/chrome/manifest.json',
    'dist/extension-js-devtools/edge/manifest.json',
    'dist/extension-js-devtools/firefox/manifest.json',
    'dist/extension-js-theme/firefox/manifest.json'
  ])

  assert.throws(
    () => assertCompanionsPacked('extension-develop-1.0.0.tgz', listing),
    (/** @type {any} */ error) => {
      assert.match(
        error.message,
        /^extension-develop-1\.0\.0\.tgz is missing the bundled companion manifests:/
      )

      assert.match(
        error.message,
        /dist\/extension-js-theme\/firefox\/manifest\.json/
      )

      assert.match(error.message, /Run node scripts\/build-extensions\.cjs/)

      return true
    }
  )
})

test('an empty listing is a failure, not a pass', () => {
  assert.equal(missingCompanionManifests([]).length, 8)
  assert.equal(missingCompanionManifests(['']).length, 8)
})

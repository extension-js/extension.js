import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import {fileURLToPath} from 'node:url'

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
)

// These scripts failed the JavaScript typecheck when it was turned on. The
// list only shrinks: a script whose types are fixed leaves it, none joins it.
const EXCLUDED_SCRIPTS = [
  './scripts/__spec__/check-emitted-types.spec.mjs',
  './scripts/__spec__/check-messaging.spec.mjs',
  './scripts/__spec__/generate-release-notes.spec.mjs',
  './scripts/__spec__/nightly-dev-smoke.spec.mjs',
  './scripts/__spec__/publish-release-gates.spec.mjs',
  './scripts/__spec__/run-locked.spec.mjs',
  './scripts/__spec__/run-optional-deps-smoke.spec.mjs',
  './scripts/__spec__/run-test.spec.mjs',
  './scripts/__spec__/smoke-npx.spec.mjs',
  './scripts/__spec__/spec-path-gates.spec.mjs',
  './scripts/__spec__/spec-temp-folder.spec.mjs',
  './scripts/__spec__/verify-npm-publish.spec.mjs',
  './scripts/build-extensions.cjs',
  './scripts/build-with-manifest.mjs',
  './scripts/bump-release-gates.mjs',
  './scripts/check-emitted-types.mjs',
  './scripts/check-messaging.mjs',
  './scripts/format-wrapper.cjs',
  './scripts/generate-release-notes.mjs',
  './scripts/nightly-dev-smoke.mjs',
  './scripts/pre-commit-lint-staged.mjs',
  './scripts/run-locked.mjs',
  './scripts/run-optional-deps-smoke.mjs',
  './scripts/smoke-npx.mjs',
  './scripts/validate-bun-runtime.mjs',
  './scripts/validate-deno-runtime.mjs',
  './scripts/verify-edge-system-locate.mjs'
]

function readTsconfig(file) {
  const text = fs
    .readFileSync(path.join(root, file), 'utf8')
    .replace(/^\s*\/\/.*$/gm, '')

  return JSON.parse(text)
}

test('tsconfig.scripts.json checks every script as JavaScript', () => {
  const config = readTsconfig('tsconfig.scripts.json')

  assert.equal(config.extends, './tsconfig.json')
  assert.equal(config.compilerOptions.allowJs, true)
  assert.equal(config.compilerOptions.checkJs, true)
  assert.deepEqual(config.include, [
    './scripts/**/*.mjs',
    './scripts/**/*.cjs',
    './scripts/**/*.js'
  ])
})

test('tsconfig.scripts.json excludes exactly the pinned scripts', () => {
  const config = readTsconfig('tsconfig.scripts.json')
  const excluded = config.exclude.filter((entry) => entry !== 'node_modules')

  assert.deepEqual(
    [...excluded].sort(),
    [...EXCLUDED_SCRIPTS].sort(),
    'fix the script types instead of excluding it, and drop a fixed script from both lists'
  )

  for (const entry of excluded) {
    assert.ok(fs.existsSync(path.join(root, entry)), `${entry} does not exist`)
  }
})

test('the typecheck script runs the scripts project', () => {
  const scripts = JSON.parse(
    fs.readFileSync(path.join(root, 'package.json'), 'utf8')
  ).scripts

  assert.match(scripts.typecheck, /tsc --noEmit -p tsconfig\.scripts\.json/)
})

// Explicit any is an error everywhere except the spec folders that still hold
// it. A new folder starts clean and stays clean.
test('biome reports explicit any outside the pinned spec folders', () => {
  const biome = JSON.parse(
    fs.readFileSync(path.join(root, 'biome.json'), 'utf8')
  )

  assert.equal(biome.linter.rules.suspicious.noExplicitAny, 'error')

  const off = biome.overrides.filter(
    (entry) => entry.linter?.rules?.suspicious?.noExplicitAny === 'off'
  )
  assert.equal(off.length, 1)
  assert.deepEqual(off[0].includes, [
    'programs/develop/**/__spec__/**',
    'programs/develop/**/*.spec.ts',
    'programs/extension/**/__spec__/**',
    'programs/extension/**/*.spec.ts',
    'programs/create/__spec__/create-install-order.spec.ts',
    'programs/create/__spec__/create-into-existing-repo.spec.ts',
    'programs/create/steps/__spec__/write-deno-jsonc.spec.ts'
  ])
})

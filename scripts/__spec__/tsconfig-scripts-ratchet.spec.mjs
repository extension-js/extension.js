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

// Every script passed when the last exclusion was cleared, so a new one that
// fails gets its types fixed, not a line in the exclude list.
test('tsconfig.scripts.json excludes no script', () => {
  const config = readTsconfig('tsconfig.scripts.json')

  assert.deepEqual(config.exclude, ['node_modules'])
})

// The shared helpers refuse implicit any too, every one of them.
test('tsconfig.scripts-lib.json refuses implicit any in the shared helpers', () => {
  const config = readTsconfig('tsconfig.scripts-lib.json')

  assert.equal(config.extends, './tsconfig.scripts.json')
  assert.equal(config.compilerOptions.noImplicitAny, true)
  assert.ok(config.include.includes('./scripts/lib/**/*.mjs'))
  assert.deepEqual(config.exclude, ['node_modules'])
})

test('the typecheck script runs the scripts project', () => {
  const scripts = JSON.parse(
    fs.readFileSync(path.join(root, 'package.json'), 'utf8')
  ).scripts

  assert.match(scripts.typecheck, /tsc --noEmit -p tsconfig\.scripts\.json/)
  assert.match(scripts.typecheck, /tsc --noEmit -p tsconfig\.scripts-lib\.json/)
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

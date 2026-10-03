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

// tsconfig.spec.json started life with 98 spec files excluded as "not passing
// yet" and nothing stopped that list from growing. This pins it. A spec that
// fails the typecheck gets its types fixed, it does not get a line here.
const BASE_EXCLUDES = [
  '**/dist',
  './examples/**',
  './templates/**',
  'node_modules'
]
const EXCLUDED_SPECS = []

function readTsconfig(file) {
  const text = fs
    .readFileSync(path.join(root, file), 'utf8')
    .replace(/^\s*\/\/.*$/gm, '')

  return JSON.parse(text)
}

function isSpecPath(entry) {
  return /\.spec\.ts$/.test(entry)
}

test('tsconfig.spec.json includes every program source and spec', () => {
  const config = readTsconfig('tsconfig.spec.json')

  assert.deepEqual(config.include, ['./programs/**/*.ts'])
  assert.equal(config.extends, './tsconfig.json')
})

test('tsconfig.spec.json excludes exactly the pinned paths and no extra spec', () => {
  const config = readTsconfig('tsconfig.spec.json')
  const excluded = [...config.exclude].sort()
  const specs = excluded.filter(isSpecPath)
  const others = excluded.filter((entry) => !isSpecPath(entry))
  const extra = specs.filter((entry) => !EXCLUDED_SPECS.includes(entry))

  assert.deepEqual(
    extra,
    [],
    `tsconfig.spec.json excludes specs the ratchet does not know:\n  ${extra.join(
      '\n  '
    )}\nFix the spec's types so \`tsc --noEmit -p tsconfig.spec.json\` passes with it included. Do not extend the exclude list.`
  )

  assert.deepEqual(
    specs,
    [...EXCLUDED_SPECS].sort(),
    'a spec left the exclude list, so remove it from EXCLUDED_SPECS in this ratchet too'
  )

  assert.deepEqual(others, [...BASE_EXCLUDES].sort())
})

test('every concrete path tsconfig.spec.json excludes exists', () => {
  const config = readTsconfig('tsconfig.spec.json')

  for (const entry of config.exclude) {
    if (/[*?]/.test(entry)) continue

    assert.ok(
      fs.existsSync(path.join(root, entry)),
      `${entry} is excluded but does not exist, drop the stale entry`
    )
  }
})

test('the typecheck script runs the spec project', () => {
  const scripts = JSON.parse(
    fs.readFileSync(path.join(root, 'package.json'), 'utf8')
  ).scripts

  assert.match(scripts.typecheck, /tsc --noEmit -p tsconfig\.json/)
  assert.match(scripts.typecheck, /tsc --noEmit -p tsconfig\.spec\.json/)
})

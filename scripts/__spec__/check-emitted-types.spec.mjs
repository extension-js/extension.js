// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {after, test} from 'node:test'
import {fileURLToPath} from 'node:url'
import {
  checkEmittedTypes,
  consumerSource,
  consumerTsconfig,
  listPublishedPackages,
  ownedDiagnostics,
  parseDiagnostics,
  typedEntries
} from '../check-emitted-types.mjs'

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
)
const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc')
const fixtures = []

after(() => {
  for (const dir of fixtures) fs.rmSync(dir, {recursive: true, force: true})
})

// Under the repo's own node_modules, so the consumer finds @types/node the
// way it does in the real run, by walking up.
function makeFixtureRoot() {
  const cache = path.join(root, 'node_modules', '.cache')

  fs.mkdirSync(cache, {recursive: true})

  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(cache, 'check-emitted-types-spec-'))
  )

  fixtures.push(dir)

  return dir
}

function writePackage(fixtureRoot, name, files, manifest = {}) {
  const dir = path.join(fixtureRoot, 'programs', name)

  fs.mkdirSync(dir, {recursive: true})

  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), {recursive: true})
    fs.writeFileSync(path.join(dir, file), content)
  }

  const fullManifest = {
    name: `fixture-${name}`,
    version: '1.0.0',
    exports: {'.': {types: './dist/index.d.ts', default: './dist/index.js'}},
    ...manifest
  }

  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify(fullManifest, null, 2)
  )

  return {dir, manifest: fullManifest}
}

const SOUND_ENTRY = [
  "import type {Helper} from './helper.js'",
  'export declare function run(helper: Helper): Promise<void>',
  ''
].join('\n')
const SOUND_HELPER = 'export interface Helper {\n  name: string\n}\n'

test('typed entries are the exports that name a declaration file', () => {
  assert.deepEqual(
    typedEntries({
      name: 'pkg',
      exports: {
        '.': {development: './module.ts', types: './dist/module.d.ts'},
        './sub': {types: './dist/sub.d.ts', import: './dist/sub.mjs'},
        './contract/*': './dist/contract/*',
        './untyped': {import: './dist/untyped.mjs'},
        './package.json': './package.json'
      }
    }),
    [
      {specifier: 'pkg', types: './dist/module.d.ts'},
      {specifier: 'pkg/sub', types: './dist/sub.d.ts'}
    ]
  )

  assert.deepEqual(typedEntries({name: 'old', types: './index.d.ts'}), [
    {specifier: 'old', types: './index.d.ts'}
  ])

  assert.deepEqual(typedEntries({name: 'none', exports: {'.': './a.js'}}), [])
})

test('the consumer resolves like an installed copy and checks library files', () => {
  const options = consumerTsconfig().compilerOptions

  assert.equal(options.skipLibCheck, false)
  assert.equal(options.customConditions, undefined)
  assert.equal(options.noUncheckedSideEffectImports, true)
  assert.equal(
    consumerSource(['a', 'a/b']),
    "import 'a'\nimport 'a/b'\n\nexport {}\n"
  )
})

test('diagnostics are parsed with their file, and only ours are kept', () => {
  const cwd = path.join(root, 'node_modules', '.cache', 'work')
  const ours = path.join(root, 'programs', 'develop')
  const parsed = parseDiagnostics(
    [
      '../../../programs/develop/dist/module.d.ts(3,1): error TS1128: Declaration or statement expected.',
      "../../../programs/develop/node_modules/dep/index.d.ts(9,4): error TS2304: Cannot find name 'X'.",
      "consumer.ts(1,8): error TS2307: Cannot find module 'gone' or its corresponding type declarations.",
      "error TS2688: Cannot find type definition file for 'node'.",
      'Found 4 errors.',
      ''
    ].join('\r\n'),
    cwd
  )

  assert.equal(parsed.length, 4)
  assert.equal(parsed[0].file, path.join(ours, 'dist', 'module.d.ts'))
  assert.equal(parsed[0].line, 3)
  assert.equal(parsed[3].file, null)

  assert.deepEqual(
    ownedDiagnostics(parsed, [ours], cwd).map((diagnostic) => diagnostic.code),
    ['TS1128', 'TS2307', 'TS2688']
  )
})

test('the published packages are the four programs', () => {
  assert.deepEqual(
    listPublishedPackages(root).map(({manifest}) => manifest.name),
    ['extension-create', 'extension-develop', 'extension', 'extension-install']
  )
})

test('sound declarations pass', () => {
  const fixtureRoot = makeFixtureRoot()
  const good = writePackage(fixtureRoot, 'good', {
    'dist/index.d.ts': SOUND_ENTRY,
    'dist/helper.d.ts': SOUND_HELPER
  })
  const result = checkEmittedTypes({root: fixtureRoot, packages: [good], tsc})

  assert.deepEqual(result.problems, [])
  assert.equal(result.ok, true)
  assert.deepEqual(result.specifiers, ['fixture-good'])
})

test('a declaration file with the tail of another copy fails and is named', () => {
  const fixtureRoot = makeFixtureRoot()
  const torn = writePackage(fixtureRoot, 'torn', {
    'dist/index.d.ts': SOUND_ENTRY,
    'dist/helper.d.ts': `${SOUND_HELPER}me: string\n}\n`
  })
  const result = checkEmittedTypes({root: fixtureRoot, packages: [torn], tsc})

  assert.equal(result.ok, false)
  assert.ok(
    result.problems.some((problem) =>
      problem.startsWith('programs/torn/dist/helper.d.ts:')
    ),
    result.problems.join('\n')
  )
})

test('a declaration that names a type nothing declares fails', () => {
  const fixtureRoot = makeFixtureRoot()
  const dangling = writePackage(fixtureRoot, 'dangling', {
    'dist/index.d.ts': 'export declare const value: NothingDeclaresThis\n'
  })
  const result = checkEmittedTypes({
    root: fixtureRoot,
    packages: [dangling],
    tsc
  })

  assert.equal(result.ok, false)
  assert.ok(result.problems.join('\n').includes('TS2304'))
})

test('a types target that was never emitted is a failure of its own', () => {
  const fixtureRoot = makeFixtureRoot()
  const unbuilt = writePackage(fixtureRoot, 'unbuilt', {})
  const result = checkEmittedTypes({
    root: fixtureRoot,
    packages: [unbuilt],
    tsc
  })

  assert.equal(result.ok, false)
  assert.ok(result.problems[0].includes('./dist/index.d.ts does not exist'))
})

test("an error inside a dependency's own declarations is counted, not blamed on the package", () => {
  const fixtureRoot = makeFixtureRoot()
  const leaning = writePackage(fixtureRoot, 'leaning', {
    'dist/index.d.ts':
      "import type {Dep} from 'broken-dep'\nexport declare const dep: Dep\n",
    'node_modules/broken-dep/package.json': JSON.stringify({
      name: 'broken-dep',
      version: '1.0.0',
      types: './index.d.ts'
    }),
    'node_modules/broken-dep/index.d.ts':
      'export interface Dep {\n  inner: NothingDeclaresThis\n}\n'
  })
  const result = checkEmittedTypes({
    root: fixtureRoot,
    packages: [leaning],
    tsc
  })

  assert.deepEqual(result.problems, [])
  assert.equal(result.foreign, 1)
})

test('the work folder is removed after a run', () => {
  const fixtureRoot = makeFixtureRoot()
  const good = writePackage(fixtureRoot, 'good', {
    'dist/index.d.ts': 'export declare const value: number\n'
  })

  checkEmittedTypes({root: fixtureRoot, packages: [good], tsc})

  assert.deepEqual(
    fs.readdirSync(path.join(fixtureRoot, 'node_modules', '.cache')),
    []
  )
})

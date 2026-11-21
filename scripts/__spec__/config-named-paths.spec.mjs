import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import {
  biomeConfigEntries,
  entriesNamingNothing,
  gitIgnores,
  lintConfigEntries,
  matchesGlob,
  namedPlace,
  parseJsonWithComments,
  repoRoot,
  specRunnerEntries,
  specsNoRunnerReaches,
  trackedPlaces,
  typeConfigEntries,
  workflowPathEntries,
  workspaceEntries
} from '../lib/config-named-paths.mjs'

const tracked = trackedPlaces()

const TYPE_CONFIGS = [...tracked]
  .filter((file) => /(^|\/)tsconfig[^/]*\.json$/.test(file))
  .filter((file) => !file.includes('/templates/'))
  .filter((file) => !file.includes('/__spec__/'))
  .sort()

/** @param {import('../lib/config-named-paths.mjs').NamedEntry[]} entries */
const dead = (entries) => entriesNamingNothing(entries, tracked, gitIgnores)

test('reads the place an entry names, and none from a bare glob', () => {
  assert.equal(
    namedPlace('programs/develop/types.ts'),
    'programs/develop/types.ts'
  )

  assert.equal(
    namedPlace('./programs/extension/types/**'),
    'programs/extension/types'
  )

  assert.equal(
    namedPlace('!extensions/browser-extension/'),
    'extensions/browser-extension'
  )

  assert.equal(
    namedPlace('programs/develop/**/__spec__/**'),
    'programs/develop'
  )

  assert.equal(namedPlace('**/*.{ts,mts,cts}'), '')
  assert.equal(namedPlace('*.md'), '')
})

// A rule turned off for a named file follows no rename. The file moves, the
// rule comes back on, and the autofix of a commit rewrites the file.
test('reports an entry whose file moved and passes a local artifact', () => {
  /** @type {import('../lib/config-named-paths.mjs').NamedEntry[]} */
  const entries = [
    {from: 'lint files', entry: 'scripts/lib/workflow-yaml.mjs'},
    {from: 'lint files', entry: 'scripts/lib/moved-away.mjs'},
    {from: 'lint files', entry: 'scripts/gone/**'},
    {from: 'lint ignores', entry: 'node_modules/'},
    {from: 'lint ignores', entry: 'programs/develop/dist/'},
    {from: 'lint ignores', entry: 'scripts/lib/moved-away/'},
    {
      from: 'programs/develop/tsconfig.json include',
      entry: '../extension/types',
      base: 'programs/develop'
    },
    {
      from: 'programs/develop/tsconfig.json include',
      entry: './no-such-folder/**',
      base: 'programs/develop'
    }
  ]

  assert.deepEqual(dead(entries), [
    'lint files: scripts/lib/moved-away.mjs',
    'lint files: scripts/gone/**',
    'lint ignores: scripts/lib/moved-away/',
    'programs/develop/tsconfig.json include: ./no-such-folder/**'
  ])
})

test('reads a config that carries comments and trailing commas', () => {
  assert.deepEqual(
    parseJsonWithComments(
      '{\n  // why\n  "url": "https://a.b//c", "list": ["x", "y",],\n}'
    ),
    {url: 'https://a.b//c', list: ['x', 'y']}
  )
})

test('every path the lint config names exists', async () => {
  const entries = await lintConfigEntries()

  assert.ok(entries.length > 0)
  assert.deepEqual(dead(entries), [])
})

test('every path the formatter config names exists', () => {
  const entries = biomeConfigEntries()

  assert.ok(entries.length > 0)
  assert.deepEqual(dead(entries), [])
})

test('every path a type config names exists', () => {
  assert.ok(TYPE_CONFIGS.includes('tsconfig.json'))
  assert.ok(TYPE_CONFIGS.includes('programs/develop/tsconfig.json'))

  const entries = typeConfigEntries(TYPE_CONFIGS)

  assert.ok(entries.length > 0)
  assert.deepEqual(dead(entries), [])
})

test('every path a workflow filter names exists', () => {
  const entries = workflowPathEntries()

  assert.ok(entries.length > 0)
  assert.deepEqual(dead(entries), [])
})

// The docs index skips folders by path and files by bare name.
test('every folder and file the docs index config skips exists', () => {
  const config = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'context7.json'), 'utf8')
  )
  const names = new Set([...tracked].map((file) => path.posix.basename(file)))

  assert.deepEqual(
    dead(
      config.excludeFolders.map((/** @type {string} */ entry) => ({
        from: 'context7.json excludeFolders',
        entry
      }))
    ),
    []
  )

  assert.deepEqual(
    config.excludeFiles.filter(
      (/** @type {string} */ name) => !names.has(name)
    ),
    []
  )
})

const SPEC_RUNNERS = [...tracked]
  .filter((file) => /^programs\/[^/]+\/vitest\.config\.m?ts$/.test(file))
  .sort()

test('every path a spec runner config names exists', async () => {
  assert.equal(SPEC_RUNNERS.length, 4)

  const entries = await specRunnerEntries(SPEC_RUNNERS)

  assert.ok(entries.length > 0)
  assert.deepEqual(dead(entries), [])
})

test('matches the glob forms the spec runners use', () => {
  const include = 'plugin-*/**/__spec__/**/*.spec.ts'

  assert.ok(matchesGlob('plugin-css/__spec__/a.spec.ts', include))
  assert.ok(matchesGlob('plugin-css/x/y/__spec__/z/a.spec.ts', include))
  assert.ok(!matchesGlob('plugin-css/__spec__/a.spec.tsx', include))
  assert.ok(!matchesGlob('command-steps/__spec__/a.spec.ts', include))
  assert.ok(matchesGlob('__spec__/a.spec.ts', '__spec__/*.spec.ts'))
  assert.ok(!matchesGlob('__spec__/exec/a.spec.ts', '__spec__/*.spec.ts'))
  assert.ok(matchesGlob('a/b.spec.ts', '**/*.spec.ts'))
  assert.throws(() => matchesGlob('a.ts', '*.{ts,tsx}'))
})

test('reports a spec in a folder no include names', async () => {
  const withStray = new Set([
    ...tracked,
    'programs/develop/command-steps/__spec__/stray.spec.ts'
  ])

  assert.deepEqual(await specsNoRunnerReaches(SPEC_RUNNERS, withStray), [
    'programs/develop/command-steps/__spec__/stray.spec.ts'
  ])
})

test('every spec file is reached by the include list of its program', async () => {
  assert.deepEqual(await specsNoRunnerReaches(SPEC_RUNNERS, tracked), [])
})

test('every package the workspace names exists', () => {
  const entries = workspaceEntries()

  assert.ok(entries.length > 0)
  assert.deepEqual(dead(entries), [])
})

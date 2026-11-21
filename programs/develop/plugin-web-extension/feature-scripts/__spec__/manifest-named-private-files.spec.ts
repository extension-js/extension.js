import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {
  build,
  canLink,
  expectNothingPrivate,
  linkPackages,
  linkWorkspace,
  MARKER,
  manifest,
  PAGE,
  project
} from '../../../__spec__/helpers/private-files-project'

// Whole production builds, one per target: a manifest key no browser defines
// names that target, and the row says what the output folder holds.

interface Row {
  // Every file in the output folder but the page and the manifest.
  shipped: string[]
  // The shipped files that carry a marker, which no build should hold.
  marked: string[]
  // Each value the build says it will not copy, with the key that names it.
  said: string[]
  errors: number
}

type Table = Record<string, Row>

interface Field {
  name: string
  // The key as a finding spells it.
  key: string
  // What every build of the fixture lands besides the target.
  always: string[]
  declare: (target: string) => Record<string, unknown>
}

const TOP_LEVEL: Field = {
  name: 'a custom manifest key',
  key: 'my_files',
  always: ['hosted.txt'],
  declare: (target) => ({my_files: [target]})
}

const UNDER_BACKGROUND: Field = {
  name: 'a custom key under background',
  key: 'background.my_files',
  always: ['background/service_worker.js', 'hosted.txt'],
  declare: (target) => ({
    background: {service_worker: 'sw.js', my_files: [target]}
  })
}

const foldsCase = fs.existsSync(__filename.toUpperCase())

const FILES: Record<string, string> = {
  '.git/hooks/pre-push.sh': `# ${MARKER}-git-hook\n`,
  'node_modules/pkg/lib.js': 'var lib = "installed"\n',
  '.env.example': 'EXAMPLE_KEY=\n',
  'public/hosted.txt': 'hosted',
  'sw.js': 'console.log("worker")\n'
}

function fixture(field: Field, target: string) {
  const root = project({
    ...FILES,
    'manifest.json': manifest(field.declare(target))
  })

  linkWorkspace(root, {'logo.txt': 'workspace-shared\n'})
  linkPackages(root)

  return root
}

async function rowFor(root: string): Promise<Row> {
  const result = await build(root)
  const said = new Set<string>()

  for (const match of result.printed.matchAll(
    /manifest\.json names '([^']+)' under the custom key (\S+), but the file isn't in the output\./g
  )) {
    said.add(`${match[2]}: ${match[1]}`)
  }

  // No message and no output file carries what a private file holds.
  expectNothingPrivate(result)

  return {
    shipped: result.shipped,
    marked: result.marked,
    said: [...said].sort(),
    errors: result.errors
  }
}

async function tableFor(field: Field, targets: string[]): Promise<Table> {
  const table: Table = {}

  for (const target of targets) {
    table[target] = await rowFor(fixture(field, target))
  }

  return table
}

const TIMEOUT = 300_000

// A build that lands the files given beside what the fixture always lands.
const landed = (field: Field, files: string[] = []): Row => ({
  shipped: [...field.always, ...files].sort(),
  marked: [],
  said: [],
  errors: 0
})

// A build that copies nothing for the value and says so, once.
const withheld = (field: Field, literal: string): Row => ({
  shipped: field.always,
  marked: [],
  said: [`${field.key}: ${literal}`],
  errors: 0
})

const PRIVATE_TARGETS = [
  '/.env',
  '.env',
  './.env',
  '.env.local',
  '.npmrc',
  '.git/hooks/pre-push.sh',
  'a/../.envrc',
  'node_modules/plain-pkg/.env',
  'node_modules/.npmrc'
]
const LINKED_PACKAGES_OUT = ['node_modules/far-pkg/data.json']
// Links that lead beside the project, into the workspace it belongs to.
const LINKS_TO_WORKSPACE = [
  'linked.txt',
  'linked-folder/inner.txt',
  'shared/logo.txt'
]

const withheldEach = (field: Field, targets: string[]): Table =>
  Object.fromEntries(targets.map((target) => [target, withheld(field, target)]))

// A value is read as a file name only when it ends like one, and a path is
// resolved the way a URL is, so it never climbs above the manifest folder.
const neverRead = (field: Field): Table => ({
  '.git/config': landed(field),
  '../outside.txt': landed(field),
  'sub/../../outside.txt': landed(field),
  '%2e%2e/outside.txt': landed(field),
  'nothing.txt': landed(field)
})

const landedEach = (field: Field, targets: string[]): Table =>
  Object.fromEntries(
    targets.map((target) => [
      target,
      landed(field, [target.replace(/^\//, '')])
    ])
  )

const links = (field: Field): Table => ({
  ...landedEach(field, LINKS_TO_WORKSPACE),
  'alias.json': landed(field, ['alias.json'])
})

// A file the author names ships from an installed package.
const packageFiles = (field: Field): Table =>
  landedEach(field, [
    'node_modules/pkg/data.json',
    '/node_modules/pkg/data.json',
    'node_modules/pkg/lib.js',
    'node_modules/plain-pkg/data.json'
  ])

// It ships through the links of a package manager too, when the link stays
// in a `node_modules` folder of the project or of a folder above it.
const linkedPackageFiles = (field: Field): Table => ({
  ...landedEach(field, [
    'node_modules/store-pkg/data.json',
    'node_modules/workspace-pkg/data.json',
    // The link leads to a folder of the workspace.
    'node_modules/stray-pkg/data.json'
  ]),
  ...withheldEach(field, LINKED_PACKAGES_OUT)
})

const projectContent = (field: Field): Table => ({
  'data/ok.json': landed(field, ['data/ok.json']),
  './data/ok.json': landed(field, ['data/ok.json']),
  '/data/ok.json': landed(field, ['data/ok.json']),
  'hosted.txt': landed(field),
  '.env.example': landed(field, ['.env.example'])
})

const keys = (table: Table) => Object.keys(table)

describe.each([TOP_LEVEL, UNDER_BACKGROUND])('$name', (field) => {
  it(
    'names a private file',
    async () => {
      const expected = withheldEach(field, PRIVATE_TARGETS)

      expect(await tableFor(field, keys(expected))).toEqual(expected)
    },
    TIMEOUT
  )

  // A file system that folds letter case reads `.ENV` as the env file.
  it.skipIf(!foldsCase)(
    'names a private file in another letter case',
    async () => {
      expect(await tableFor(field, ['.ENV'])).toEqual({
        '.ENV': withheld(field, '.ENV')
      })
    },
    TIMEOUT
  )

  it(
    'names a value the build never reads as a file',
    async () => {
      const expected = neverRead(field)

      expect(await tableFor(field, keys(expected))).toEqual(expected)
    },
    TIMEOUT
  )

  it(
    'names a file of an installed package',
    async () => {
      const expected = packageFiles(field)

      expect(await tableFor(field, keys(expected))).toEqual(expected)
    },
    TIMEOUT
  )

  it.skipIf(!canLink)(
    'names a file of a linked package',
    async () => {
      const expected = linkedPackageFiles(field)

      expect(await tableFor(field, keys(expected))).toEqual(expected)
    },
    TIMEOUT
  )

  it.skipIf(!canLink)(
    'names a link',
    async () => {
      const expected = links(field)

      expect(await tableFor(field, keys(expected))).toEqual(expected)
    },
    TIMEOUT
  )

  it(
    'names project content',
    async () => {
      const expected = projectContent(field)

      expect(await tableFor(field, keys(expected))).toEqual(expected)
    },
    TIMEOUT
  )

  it(
    'names a file beside a manifest under src/',
    async () => {
      const root = project({
        ...FILES,
        'src/manifest.json': manifest({
          ...field.declare('assets/list.txt'),
          reach: '../data/ok.json'
        }),
        'src/popup.html': PAGE,
        'src/sw.js': FILES['sw.js'],
        'src/assets/list.txt': 'list'
      })

      fs.rmSync(path.join(root, 'manifest.json'))
      fs.rmSync(path.join(root, 'popup.html'))

      // The climbing value is clamped to the manifest folder and finds nothing.
      expect(await rowFor(root)).toEqual(landed(field, ['assets/list.txt']))
    },
    TIMEOUT
  )
})

describe('a file a custom key names and the build withholds', () => {
  it(
    'is said once, however many values name it',
    async () => {
      const root = project({
        ...FILES,
        'manifest.json': manifest({
          my_files: ['.env', './.env'],
          other: {file: '/.env'}
        })
      })
      const result = await build(root)
      const times = (part: string) => result.printed.split(part).length - 1

      // The text is read twice over: the printed lines, then the summary.
      for (const sentence of [
        "manifest.json names '.env' under the custom key my_files, but the file isn't in the output.",
        'NOT FOUND .env',
        'A read of it fails at runtime.',
        'The build copies only files the project or its workspace shares, never env files or tooling files.'
      ]) {
        expect(times(sentence), sentence).toBe(2)
      }

      expect(times('under the custom key')).toBe(2)
      expect(result.shipped).toEqual(['hosted.txt'])
      expect(result.marked).toEqual([])
      expectNothingPrivate(result)
      expect(result.errors).toBe(0)
    },
    TIMEOUT
  )
})

describe('the manifest values read as file names', () => {
  it(
    'are the strings under keys no browser defines that end like a file',
    async () => {
      const root = project({
        ...FILES,
        'README.md': 'readme',
        'notes.txt': 'notes',
        'two words.txt': 'spaced',
        LICENSE: 'license',
        'inner.txt': 'inner',
        'manifest.json': manifest({
          // Keys a browser defines are never scanned, at any depth.
          description: 'README.md',
          version_name: 'package.json',
          author: 'notes.txt',
          action: {default_popup: 'popup.html', my_file: 'inner.txt'},
          // A custom key is scanned whole, however deep the string sits.
          docs: 'README.md',
          nested: {deep: [{file: 'a/keep.txt'}]},
          background: {service_worker: 'sw.js', extra: 'data/ok.json'},
          // A value with a space, no ending or a scheme is not a file name.
          spaced: 'two words.txt',
          bare: 'LICENSE',
          remote: 'https://example.com/data/ok.json',
          absent: 'nothing.txt'
        })
      })

      expect(await rowFor(root)).toEqual({
        shipped: [
          'README.md',
          'a/keep.txt',
          'background/service_worker.js',
          'data/ok.json',
          'hosted.txt'
        ],
        marked: [],
        said: [],
        errors: 0
      })
    },
    TIMEOUT
  )
})

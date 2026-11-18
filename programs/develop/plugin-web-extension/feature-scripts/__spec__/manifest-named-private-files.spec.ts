import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {
  build,
  canLink,
  linkWorkspace,
  MARKER,
  manifest,
  PAGE,
  project
} from '../../../plugin-special-folders/__spec__/helpers/private-files-project'

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

// The opening of each fake private file, which no message may quote.
const OPENINGS = ['PRIVATE_K', 'export PR', '# FAKE', 'FAKE-MARK']

const foldsCase = fs.existsSync(__filename.toUpperCase())

const FILES: Record<string, string> = {
  '.git/hooks/pre-push.sh': `# ${MARKER}-git-hook\n`,
  'node_modules/pkg/lib.js': `var lib = "${MARKER}-node-modules-script"\n`,
  '.env.example': 'PRIVATE_KEY=\n',
  'public/hosted.txt': 'hosted',
  'sw.js': 'console.log("worker")\n'
}

function fixture(field: Field, target: string) {
  const root = project({
    ...FILES,
    'manifest.json': manifest(field.declare(target))
  })

  linkWorkspace(root, {'logo.txt': `${MARKER}-workspace\n`})

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

  // No message carries what a file holds, its opening characters included.
  for (const text of [MARKER, ...OPENINGS]) {
    expect(result.printed).not.toContain(text)
  }

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
const landed = (field: Field, files: string[] = [], marked = false): Row => ({
  shipped: [...field.always, ...files].sort(),
  marked: marked ? files : [],
  said: [],
  errors: 0
})

const privateFiles = (field: Field): Table => ({
  '/.env': landed(field, ['.env'], true),
  '.env': landed(field, ['.env'], true),
  './.env': landed(field, ['.env'], true),
  '.env.local': landed(field, ['.env.local'], true),
  '.npmrc': landed(field, ['.npmrc'], true),
  '.git/hooks/pre-push.sh': landed(field, ['.git/hooks/pre-push.sh'], true),
  'a/../.envrc': landed(field, ['.envrc'], true),
  'node_modules/pkg/data.json': landed(
    field,
    ['node_modules/pkg/data.json'],
    true
  ),
  'node_modules/pkg/lib.js': landed(field, ['node_modules/pkg/lib.js'], true)
})

// A value is read as a file name only when it ends like one, and a path is
// resolved the way a URL is, so it never climbs above the manifest folder.
const neverRead = (field: Field): Table => ({
  '.git/config': landed(field),
  '../outside.txt': landed(field),
  'sub/../../outside.txt': landed(field),
  '%2e%2e/outside.txt': landed(field),
  'nothing.txt': landed(field)
})

const links = (field: Field): Table => ({
  'linked.txt': landed(field, ['linked.txt'], true),
  'linked-folder/inner.txt': landed(field, ['linked-folder/inner.txt'], true),
  'shared/logo.txt': landed(field, ['shared/logo.txt'], true),
  'alias.json': landed(field, ['alias.json'])
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
      const expected = privateFiles(field)

      expect(await tableFor(field, keys(expected))).toEqual(expected)
    },
    TIMEOUT
  )

  // A file system that folds letter case reads `.ENV` as the env file.
  it.skipIf(!foldsCase)(
    'names a private file in another letter case',
    async () => {
      expect(await tableFor(field, ['.ENV'])).toEqual({
        '.ENV': landed(field, ['.ENV'], true)
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

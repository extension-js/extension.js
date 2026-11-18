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

// Whole production builds, one per target: a manifest field that names a
// JSON file names that target, and the row says what the output folder holds.

interface Row {
  // Every file in the output folder but the page and the manifest.
  shipped: string[]
  // The shipped files that carry a marker, which no build should hold.
  marked: string[]
  // Each finding the build prints, with the path it names from the project.
  said: string[]
  // What a message quotes of a fake private file, which is never right.
  quoted: string[]
  errors: number
}

type Table = Record<string, Row>

interface Field {
  name: string
  // The file the field lands as in the output folder.
  output: string
  declare: (target: string) => Record<string, unknown>
  // A file the field accepts, carrying the text given.
  valid: (text: string) => string
}

const RULES: Field = {
  name: 'declarative_net_request.rule_resources',
  output: 'declarative_net_request/rules.json',
  declare: (target) => ({
    permissions: ['declarativeNetRequest'],
    declarative_net_request: {
      rule_resources: [{id: 'rules', enabled: true, path: target}]
    }
  }),
  valid: (text) =>
    JSON.stringify([
      {
        id: 1,
        priority: 1,
        action: {type: 'block'},
        condition: {urlFilter: text}
      }
    ])
}

const SCHEMA: Field = {
  name: 'storage.managed_schema',
  output: 'storage/managed_schema.json',
  declare: (target) => ({
    permissions: ['storage'],
    storage: {managed_schema: target}
  }),
  valid: (text) => JSON.stringify({type: 'object', description: text})
}

const foldsCase = fs.existsSync(__filename.toUpperCase())

// The opening of each fake private file, which a parse error would quote.
const OPENINGS = ['PRIVATE_K', 'export PR', '# FAKE', 'FAKE-MARK']

function files(field: Field): Record<string, string> {
  return {
    'node_modules/pkg/data.json': field.valid(`${MARKER}-node-modules`),
    'data/ok.json': field.valid('ok'),
    'public/hosted.json': field.valid('hosted'),
    '.env.example': field.valid('example')
  }
}

function fixture(field: Field, target: string) {
  const root = project({
    ...files(field),
    'manifest.json': manifest(field.declare(target))
  })

  linkWorkspace(root, {'data.json': field.valid(`${MARKER}-workspace`)})
  fs.writeFileSync(
    path.join(path.dirname(root), 'outside.json'),
    field.valid(`${MARKER}-outside`)
  )

  return root
}

// The path a finding names, read from the project folder.
function fromProject(root: string, shown: string) {
  return path.relative(root, shown).split(path.sep).join('/')
}

// Each message names its file on the line below its opening sentence.
const FINDINGS: Array<[string, RegExp]> = [
  ['missing', /Can't find the JSON file listed in \S+\.\n.*NOT FOUND (\S+)/g],
  ['folder', /The JSON path listed in \S+ is a folder.*\n.*FOLDER (\S+)/g],
  ['unparsed', /Can't parse the JSON file listed in \S+\.\n.*PATH (\S+)/g],
  ['not rules', /isn't a rule array\.\n.*PATH (\S+)/g],
  ['not a schema', /isn't a schema object\.\n.*PATH (\S+)/g]
]

async function rowFor(root: string): Promise<Row> {
  const result = await build(root)
  const said = new Set<string>()

  for (const [kind, pattern] of FINDINGS) {
    for (const match of result.printed.matchAll(pattern)) {
      said.add(`${kind}: ${fromProject(root, match[1])}`)
    }
  }

  return {
    shipped: result.shipped,
    marked: result.marked,
    said: [...said].sort(),
    quoted: [MARKER, ...OPENINGS].filter((text) =>
      result.printed.includes(text)
    ),
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

// A build that stops with one error, and so writes no output folder.
const stopped = (said: string, quoted: string[] = []): Row => ({
  shipped: [],
  marked: [],
  said: [said],
  quoted,
  errors: 1
})

// A build that lands the field's file, with a marker inside or without one.
const landed = (field: Field, marked = false): Row => ({
  shipped: [field.output, 'hosted.json'].sort(),
  marked: marked ? [field.output] : [],
  said: [],
  quoted: [],
  errors: 0
})

// A file under public/ is copied as it is and the field adds no second copy.
const HOSTED: Row = {
  shipped: ['hosted.json'],
  marked: [],
  said: [],
  quoted: [],
  errors: 0
}

const privateFiles = (field: Field): Table => ({
  '/.env': stopped('unparsed: .env', ['PRIVATE_K']),
  '.env': stopped('unparsed: .env', ['PRIVATE_K']),
  './.env': stopped('unparsed: .env', ['PRIVATE_K']),
  '.env.local': stopped('unparsed: .env.local', ['PRIVATE_K']),
  '.npmrc': stopped('unparsed: .npmrc', ['# FAKE']),
  '.git/config': stopped('unparsed: .git/config', ['# FAKE']),
  'a/../.envrc': stopped('unparsed: .envrc', ['export PR']),
  'node_modules/pkg/data.json': landed(field, true),
  '../outside.txt': stopped('unparsed: ../outside.txt', ['FAKE-MARK']),
  '../outside.json': landed(field, true),
  'sub/../../outside.txt': stopped('unparsed: ../outside.txt', ['FAKE-MARK']),
  '%2e%2e/outside.txt': stopped('missing: %2e%2e/outside.txt'),
  'nothing.json': stopped('missing: nothing.json')
})

const links = (field: Field): Table => ({
  'linked.txt': stopped('unparsed: linked.txt', ['FAKE-MARK']),
  'shared/data.json': landed(field, true),
  'alias.json': landed(field)
})

const projectContent = (field: Field): Table => ({
  'data/ok.json': landed(field),
  './data/ok.json': landed(field),
  '/data/ok.json': landed(field),
  'hosted.json': HOSTED,
  '/hosted.json': HOSTED,
  'public/hosted.json': HOSTED,
  '.env.example': landed(field)
})

const keys = (table: Table) => Object.keys(table)

describe.each([RULES, SCHEMA])('$name', (field) => {
  it(
    'names a private file or a file outside the project',
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
        '.ENV': stopped('unparsed: .ENV', ['PRIVATE_K'])
      })
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
    'reaches a sibling folder from a manifest under src/',
    async () => {
      const root = project({
        ...files(field),
        'src/manifest.json': manifest(field.declare('../data/ok.json')),
        'src/popup.html': PAGE
      })

      fs.rmSync(path.join(root, 'manifest.json'))
      fs.rmSync(path.join(root, 'popup.html'))

      expect(await rowFor(root)).toEqual(landed(field))
    },
    TIMEOUT
  )
})

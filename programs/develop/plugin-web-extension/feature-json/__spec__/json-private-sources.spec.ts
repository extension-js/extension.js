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

// The opening of each fake private file, which a parse error would quote.
const OPENINGS = ['PRIVATE_K', 'export PR', '# FAKE', 'FAKE-MARK']

function files(field: Field): Record<string, string> {
  return {
    'node_modules/pkg/data.json': field.valid(`${MARKER}-node-modules`),
    'data/ok.json': field.valid('ok'),
    'public/hosted.json': field.valid('hosted'),
    '.env.example': field.valid('example'),
    'public/.env.local': field.valid(`${MARKER}-public-env`)
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
const stopped = (said: string): Row => ({
  shipped: [],
  marked: [],
  said: [said],
  quoted: [],
  errors: 1
})

// A build that lands the field's file beside the one public/ holds.
const landed = (field: Field): Row => ({
  shipped: [field.output, 'hosted.json'].sort(),
  marked: [],
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

// A withheld file is said in the words a missing one gets, and never opened.
const PRIVATE_FILES: Table = {
  '/.env': stopped('missing: .env'),
  '.env': stopped('missing: .env'),
  './.env': stopped('missing: .env'),
  '.ENV': stopped('missing: .ENV'),
  '.env.local': stopped('missing: .env.local'),
  '.npmrc': stopped('missing: .npmrc'),
  '.git/config': stopped('missing: .git/config'),
  'a/../.envrc': stopped('missing: .envrc'),
  'node_modules/pkg/data.json': stopped('missing: node_modules/pkg/data.json'),
  '../outside.txt': stopped('missing: ../outside.txt'),
  '../outside.json': stopped('missing: ../outside.json'),
  'sub/../../outside.txt': stopped('missing: ../outside.txt'),
  '%2e%2e/outside.txt': stopped('missing: %2e%2e/outside.txt'),
  'nothing.json': stopped('missing: nothing.json'),
  // The copier leaves this one out of public/, so no field may name it.
  'public/.env.local': stopped('missing: public/.env.local')
}

const links = (field: Field): Table => ({
  'linked.txt': stopped('missing: linked.txt'),
  'shared/data.json': stopped('missing: shared/data.json'),
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
      expect(await tableFor(field, keys(PRIVATE_FILES))).toEqual(PRIVATE_FILES)
    },
    TIMEOUT
  )

  it(
    'says a withheld file in the words a missing one gets, once',
    async () => {
      const result = await build(fixture(field, '.env'))
      const times = (part: string) => result.printed.split(part).length - 1
      const feature = field.output.replace(/\.json$/, '')

      // The text is read twice over: the printed lines, then the failure.
      for (const sentence of [
        `Can't find the JSON file listed in ${feature}.`,
        'Browsers can reject or crash the extension when required JSON files like rulesets are missing.',
        'The build stops here.',
        'Update the JSON path in your manifest.json to a file that ships with the extension.'
      ]) {
        expect(times(sentence), sentence).toBe(2)
      }

      expect(result.printed).not.toContain("Can't parse the JSON file")
      expect(result.printed).not.toContain(MARKER)
      expect(result.errors).toBe(1)
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

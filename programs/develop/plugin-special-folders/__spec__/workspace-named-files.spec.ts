import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {
  build,
  canLink,
  expectNothingPrivate,
  expectNoWorkspaceAboveTemp,
  MARKER,
  PAGE
} from './helpers/private-files-project'

// Whole production builds of a project two folders below a workspace root:
// each route names files of the workspace, and a row says where each landed.

const holders: string[] = []

beforeAll(expectNoWorkspaceAboveTemp)

afterAll(() => {
  for (const holder of holders) {
    fs.rmSync(holder, {recursive: true, force: true})
  }
})

// A file is found in the output by the token it alone holds.
const token = (relative: string) => `TOKEN:${relative}`

// A rule array, so a JSON field accepts any file of the fixture.
const rules = (text: string) =>
  JSON.stringify([
    {id: 1, priority: 1, action: {type: 'block'}, condition: {urlFilter: text}}
  ])

// Files of the workspace, by their path from the workspace root. A file the
// build must never copy carries the marker.
const WORKSPACE_FILES: Record<string, string> = {
  'shared/logo.png': token('shared/logo.png'),
  // A link in the project leads here, so a row of it stands apart.
  'shared/linked.png': token('shared/linked.png'),
  'shared/rules.json': rules(token('shared/rules.json')),
  'packages/ui/logo.png': token('packages/ui/logo.png'),
  'packages/ui/tokens.json': rules(token('packages/ui/tokens.json')),
  'shared/.env': `KEY=${MARKER}-shared-env ${token('shared/.env')}\n`,
  '.npmrc': `# ${MARKER}-npmrc ${token('.npmrc')}\n`,
  '.git/config': `# ${MARKER}-git ${token('.git/config')}\n`,
  '.cache/x.json': rules(`${MARKER}-cache ${token('.cache/x.json')}`),
  'packages/ui/node_modules/dep/data.json': rules(
    `${MARKER}-other-modules ${token('packages/ui/node_modules/dep/data.json')}`
  ),
  'node_modules/dep/data.json': rules(token('node_modules/dep/data.json'))
}

// What marks the workspace root, written at `ws/`. Only the first three do.
const MARKERS: Record<string, Record<string, string>> = {
  'pnpm-workspace.yaml': {'pnpm-workspace.yaml': 'packages:\n  - apps/*\n'},
  'workspaces list': {
    'package.json': JSON.stringify({private: true, workspaces: ['apps/*']})
  },
  'workspaces object': {
    'package.json': JSON.stringify({
      private: true,
      workspaces: {packages: ['apps/*']}
    })
  },
  'no marker': {},
  'a lockfile alone': {'pnpm-lock.yaml': "lockfileVersion: '9.0'\n"},
  'a .git folder alone': {'.git/HEAD': 'ref: refs/heads/main\n'},
  'lerna.json alone': {'lerna.json': JSON.stringify({version: '1.0.0'})}
}

const MATCHES = ['https://workspace.example/*']

interface Fixture {
  holder: string
  ws: string
  root: string
}

function write(file: string, contents: string) {
  fs.mkdirSync(path.dirname(file), {recursive: true})
  fs.writeFileSync(file, contents)
}

function fixture(
  marker: Record<string, string>,
  project: Record<string, string>
): Fixture {
  const holder = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-workspace-named-'))
  )
  holders.push(holder)

  const ws = path.join(holder, 'ws')
  const root = path.join(ws, 'apps', 'ext')

  for (const [relative, contents] of Object.entries({
    ...WORKSPACE_FILES,
    ...marker
  })) {
    write(path.join(ws, relative), contents)
  }

  write(
    path.join(holder, 'outside.json'),
    rules(`${MARKER}-outside ${token('outside.json')}`)
  )

  for (const [relative, contents] of Object.entries({
    'package.json': JSON.stringify({private: true, name: 'ext'}),
    'popup.html': PAGE,
    ...project
  })) {
    write(path.join(root, relative), contents)
  }

  if (canLink) {
    fs.symlinkSync(
      path.join(ws, 'shared', 'linked.png'),
      path.join(root, 'linked-in.png')
    )

    fs.symlinkSync(
      path.join(holder, 'outside.json'),
      path.join(root, 'linked-out.json')
    )
  }

  return {holder, ws, root}
}

function manifest(extra: Record<string, unknown>) {
  return JSON.stringify({
    manifest_version: 3,
    name: 'workspace-named',
    version: '1.0.0',
    action: {default_popup: 'popup.html'},
    ...extra
  })
}

// The refs every route names, by the file each one reaches.
const REFS: Record<string, string> = {
  '../../shared/logo.png': 'shared/logo.png',
  '../../packages/ui/logo.png': 'packages/ui/logo.png',
  '../../packages/ui/tokens.json': 'packages/ui/tokens.json',
  '../../shared/.env': 'shared/.env',
  '../../.npmrc': '.npmrc',
  '../../.git/config': '.git/config',
  '../../.cache/x.json': '.cache/x.json',
  '../../packages/ui/node_modules/dep/data.json':
    'packages/ui/node_modules/dep/data.json',
  '../../node_modules/dep/data.json': 'node_modules/dep/data.json',
  '../../../outside.json': 'outside.json',
  ...(canLink
    ? {'linked-in.png': 'shared/linked.png', 'linked-out.json': 'outside.json'}
    : {})
}

// The files of the output folder that hold a token, by that token.
function landings(root: string): Map<string, string[]> {
  const out = path.join(root, 'dist', 'chrome')
  const found = new Map<string, string[]>()

  const walk = (dir: string) => {
    let entries: fs.Dirent[] = []

    try {
      entries = fs.readdirSync(dir, {withFileTypes: true})
    } catch {
      return
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        walk(full)
        continue
      }

      const text = fs.readFileSync(full, 'utf8')
      const name = path
        .relative(out, full)
        .split(path.sep)
        .join('/')
        .replace(/\.[0-9a-f]{8}(?=\.|$)/, '.<hash>')

      for (const match of text.matchAll(/TOKEN:([\w./-]+?)(?=["\s\\]|$)/g)) {
        const list = found.get(match[1]) || []
        if (!list.includes(name)) list.push(name)

        found.set(match[1], list)
      }
    }
  }

  walk(out)

  return found
}

interface Route {
  name: string
  refs: string[]
  // The project files that make the route name every ref.
  project: (refs: string[]) => Record<string, string>
  // The refs a warning of this route names.
  said: RegExp
}

const CODE_REFS = Object.keys(REFS)

const ROUTES: Route[] = [
  {
    name: 'web_accessible_resources',
    refs: CODE_REFS,
    project: (refs) => ({
      'manifest.json': manifest({
        web_accessible_resources: [{resources: refs, matches: MATCHES}]
      })
    }),
    said: /Can't find the file (\S+) listed in web_accessible_resources\./g
  },
  {
    name: 'a custom manifest key',
    refs: CODE_REFS,
    project: (refs) => ({'manifest.json': manifest({my_files: refs})}),
    said: /manifest\.json names '([^']+)' under the custom key my_files, but the file isn't in the output\./g
  },
  {
    name: 'runtime.getURL()',
    refs: CODE_REFS,
    project: (refs) => ({
      'manifest.json': manifest({background: {service_worker: 'sw.js'}}),
      'sw.js': refs
        .map((ref) => `chrome.runtime.getURL(${JSON.stringify(ref)})\n`)
        .join('')
    }),
    said: /references '([^']+)' via chrome\.runtime\.getURL\(\), but the file isn't in the output\.|names '([^']+)', but the file isn't in the output\./g
  },
  {
    name: 'fetch()',
    refs: CODE_REFS,
    project: (refs) => ({
      'manifest.json': manifest({background: {service_worker: 'sw.js'}}),
      'sw.js': refs.map((ref) => `fetch(${JSON.stringify(ref)})\n`).join('')
    }),
    said: /loads '([^']+)' at runtime \(fetch\/XMLHttpRequest\/new URL\), but the file isn't in the output\.|names '([^']+)', but the file isn't in the output\./g
  }
]

// A row: where the file landed in the output, then whether a warning named it.
type Table = Record<string, string>

async function routeTable(
  route: Route,
  marker: Record<string, string>
): Promise<Table> {
  const {root} = fixture(marker, route.project(route.refs))
  const result = await build(root)
  const said = new Set<string>()

  for (const match of result.printed.matchAll(route.said)) {
    said.add(match[1] || match[2])
  }

  expectNothingPrivate(result, 'printed')
  expect(result.marked, route.name).toEqual([])
  expect(result.errors, route.name).toBe(0)

  const landed = landings(root)

  return Object.fromEntries(
    route.refs.map((ref) => [
      ref,
      [
        (landed.get(REFS[ref]) || []).sort().join(' + ') || 'nothing',
        ...(said.has(ref) ? ['said'] : [])
      ].join(' | ')
    ])
  )
}

// A JSON field stops the build on a file it cannot read, so each ref is a
// build of its own.
const JSON_REFS = [
  '../../shared/rules.json',
  '../../packages/ui/tokens.json',
  '../../.cache/x.json',
  '../../packages/ui/node_modules/dep/data.json',
  '../../node_modules/dep/data.json',
  '../../../outside.json',
  ...(canLink ? ['linked-out.json'] : [])
]
const JSON_TARGETS: Record<string, string> = {
  '../../shared/rules.json': 'shared/rules.json',
  '../../packages/ui/tokens.json': 'packages/ui/tokens.json',
  '../../.cache/x.json': '.cache/x.json',
  '../../packages/ui/node_modules/dep/data.json':
    'packages/ui/node_modules/dep/data.json',
  '../../node_modules/dep/data.json': 'node_modules/dep/data.json',
  '../../../outside.json': 'outside.json',
  'linked-out.json': 'outside.json'
}

async function jsonTable(marker: Record<string, string>): Promise<Table> {
  const table: Table = {}

  for (const ref of JSON_REFS) {
    const {root} = fixture(marker, {
      'manifest.json': manifest({
        permissions: ['declarativeNetRequest'],
        declarative_net_request: {
          rule_resources: [{id: 'rules', enabled: true, path: ref}]
        }
      })
    })
    const result = await build(root)

    expectNothingPrivate(result, 'printed')
    expect(result.marked, ref).toEqual([])

    const missing = /Can't find the JSON file listed in \S+\./.test(
      result.printed
    )

    table[ref] = [
      (landings(root).get(JSON_TARGETS[ref]) || []).sort().join(' + ') ||
        'nothing',
      ...(missing ? ['said'] : []),
      ...(result.errors ? [`errors ${result.errors}`] : [])
    ].join(' | ')
  }

  return table
}

const TIMEOUT = 600_000

const each = (refs: string[], row: string, except: Table = {}): Table => ({
  ...Object.fromEntries(refs.map((ref) => [ref, row])),
  ...except
})

const LINK_REFS = canLink ? ['linked-in.png', 'linked-out.json'] : []

// Without a workspace a named file outside the project never ships.
const OUTSIDE_PROJECT: Record<string, Table> = {
  web_accessible_resources: each(CODE_REFS, 'nothing | said'),
  'a custom manifest key': {
    // A value is resolved the way a URL is, so it never climbs out.
    ...each(CODE_REFS, 'nothing'),
    ...each(LINK_REFS, 'nothing | said')
  },
  'runtime.getURL()': each(CODE_REFS, 'nothing | said', {
    '../../.git/config': 'nothing'
  }),
  'fetch()': each(CODE_REFS, 'nothing | said', {
    '../../.git/config': 'nothing'
  }),
  json: each(JSON_REFS, 'nothing | said | errors 1')
}

// A named file of the workspace ships, at the path each route gives it. A
// path a URL resolves never climbs out of the extension root, so it reaches
// the workspace only through a link. Two files of one name land apart.
const IN_WORKSPACE: Record<string, Table> = {
  web_accessible_resources: {
    ...OUTSIDE_PROJECT.web_accessible_resources,
    '../../shared/logo.png': 'assets/logo.<hash>.png',
    '../../packages/ui/logo.png': 'assets/logo.<hash>.png',
    '../../packages/ui/tokens.json': 'assets/tokens.<hash>.json',
    '../../node_modules/dep/data.json': 'assets/data.<hash>.json',
    ...(canLink ? {'linked-in.png': 'linked-in.png'} : {})
  },
  'a custom manifest key': {
    ...OUTSIDE_PROJECT['a custom manifest key'],
    ...(canLink ? {'linked-in.png': 'linked-in.png'} : {})
  },
  'runtime.getURL()': {
    ...OUTSIDE_PROJECT['runtime.getURL()'],
    ...(canLink ? {'linked-in.png': 'linked-in.png'} : {})
  },
  'fetch()': {
    ...OUTSIDE_PROJECT['fetch()'],
    ...(canLink ? {'linked-in.png': 'background/linked-in.png'} : {})
  },
  json: {
    ...OUTSIDE_PROJECT.json,
    '../../shared/rules.json': 'declarative_net_request/rules.json',
    '../../packages/ui/tokens.json': 'declarative_net_request/rules.json',
    '../../node_modules/dep/data.json': 'declarative_net_request/rules.json'
  }
}

const EXPECTED: Record<string, Record<string, Table>> = {
  'pnpm-workspace.yaml': IN_WORKSPACE,
  'workspaces list': IN_WORKSPACE,
  'workspaces object': IN_WORKSPACE,
  'no marker': OUTSIDE_PROJECT,
  'a lockfile alone': OUTSIDE_PROJECT,
  'a .git folder alone': OUTSIDE_PROJECT,
  'lerna.json alone': OUTSIDE_PROJECT
}

const NESTED = {outer: [], nearest: ['assets/logo.<hash>.png']}

describe.each(
  Object.keys(MARKERS)
)('a project in a workspace marked by %s', (markerName) => {
  for (const route of ROUTES) {
    it(
      `names workspace files through ${route.name}`,
      async () => {
        const table = await routeTable(route, MARKERS[markerName])
        expect(table).toEqual(EXPECTED[markerName]?.[route.name])
      },
      TIMEOUT
    )
  }

  it(
    'names workspace files through a JSON field',
    async () => {
      const table = await jsonTable(MARKERS[markerName])
      expect(table).toEqual(EXPECTED[markerName]?.json)
    },
    TIMEOUT
  )
})

describe('nested workspaces', () => {
  it(
    'read the nearest marker as the workspace root',
    async () => {
      const refs = ['../../shared/logo.png', '../common/logo.png']
      const {ws, root} = fixture(
        MARKERS['pnpm-workspace.yaml'],
        ROUTES[0].project(refs)
      )

      write(path.join(ws, 'apps', 'pnpm-workspace.yaml'), 'packages: []\n')
      write(
        path.join(ws, 'apps', 'common', 'logo.png'),
        token('apps/common/logo.png')
      )

      const result = await build(root)
      const landed = landings(root)

      expectNothingPrivate(result, 'printed')
      expect(result.errors).toBe(0)
      expect({
        outer: landed.get('shared/logo.png') || [],
        nearest: landed.get('apps/common/logo.png') || []
      }).toEqual(NESTED)
    },
    TIMEOUT
  )
})

// A folder entry, a pattern, the scripts/ walk and the public/ copy walk
// what they reach, and a walk never leaves the project.
describe.skipIf(!canLink)('a walk that reaches a workspace file', () => {
  it(
    'copies none of it',
    async () => {
      const {ws, root} = fixture(MARKERS['pnpm-workspace.yaml'], {
        'manifest.json': manifest({
          web_accessible_resources: [
            {
              resources: ['linked-dir', 'linked-dir/*', '../../shared/'],
              matches: MATCHES
            }
          ]
        }),
        'scripts/keep.js': 'console.log("kept")\n',
        'public/kept.txt': 'kept'
      })

      write(
        path.join(ws, 'shared', 'tool.js'),
        `// ${token('shared/tool.js')}\n`
      )

      fs.symlinkSync(path.join(ws, 'shared'), path.join(root, 'linked-dir'))
      fs.symlinkSync(
        path.join(ws, 'shared', 'tool.js'),
        path.join(root, 'scripts', 'linked.js')
      )

      fs.symlinkSync(
        path.join(ws, 'shared', 'logo.png'),
        path.join(root, 'public', 'linked.png')
      )

      const result = await build(root)

      expectNothingPrivate(result, 'printed')
      expect(result.errors).toBe(0)
      expect([...landings(root).keys()].sort()).toEqual([])
      expect(result.shipped).toContain('kept.txt')
    },
    TIMEOUT
  )
})

describe('two workspace files of one name', () => {
  it(
    'land as two files, each with its own content',
    async () => {
      const {root} = fixture(
        MARKERS['pnpm-workspace.yaml'],
        ROUTES[0].project([
          '../../shared/logo.png',
          '../../packages/ui/logo.png'
        ])
      )
      const result = await build(root)
      const assets = path.join(root, 'dist', 'chrome', 'assets')
      const held = fs
        .readdirSync(assets)
        .filter((name) => name.endsWith('.png'))
        .map((name) => fs.readFileSync(path.join(assets, name), 'utf8'))
        .sort()

      expect(result.errors).toBe(0)
      expect(held).toEqual([
        token('packages/ui/logo.png'),
        token('shared/logo.png')
      ])
    },
    TIMEOUT
  )
})

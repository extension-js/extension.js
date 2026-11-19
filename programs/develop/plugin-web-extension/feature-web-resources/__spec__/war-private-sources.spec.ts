import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {
  build,
  canLink,
  expectNothingPrivate,
  linkPackages,
  MARKER,
  makeWorkspace,
  manifest,
  PAGE,
  project
} from '../../../plugin-special-folders/__spec__/helpers/private-files-project'

// Whole production builds, one per entry: web_accessible_resources names a
// file, a folder or a pattern, and the row says what the output folder holds.

interface Row {
  // Every file in the output folder but the page and the manifest.
  shipped: string[]
  // The shipped files that carry a marker, which no build should hold.
  marked: string[]
  // The resources the manifest in the output folder lists.
  listed: string[]
  // The entries the missing-resource finding names.
  reported: string[]
}

type Table = Record<string, Row>

const withoutHash = (name: string) =>
  name.replace(/\.[0-9a-f]{8}(?=\.|$)/, '.<hash>')

function declare(version: 2 | 3, resources: string[]) {
  return version === 3
    ? manifest({
        web_accessible_resources: [{resources, matches: ['<all_urls>']}]
      })
    : manifest({
        manifest_version: 2,
        action: undefined,
        browser_action: {default_popup: 'popup.html'},
        web_accessible_resources: resources
      })
}

function listedIn(root: string): string[] {
  const written = JSON.parse(
    fs.readFileSync(path.join(root, 'dist', 'chrome', 'manifest.json'), 'utf8')
  ) as {web_accessible_resources?: Array<string | {resources: string[]}>}

  return (written.web_accessible_resources || [])
    .flatMap((entry) => (typeof entry === 'string' ? [entry] : entry.resources))
    .map(withoutHash)
    .sort()
}

const FILES: Record<string, string> = {
  'sub/keep.txt': 'keep',
  'sub/.env': `PRIVATE_KEY=${MARKER}-sub-env\n`,
  'sub/deep/.npmrc': `# ${MARKER}-sub-npmrc\n`,
  'sub/deep/keep.txt': 'keep',
  'images/logo.png': 'png',
  'images/.DS_Store': `${MARKER}-ds-store`,
  '.env.example': 'EXAMPLE_KEY=\n',
  '.well-known/links.json': '[]',
  'public/hosted.txt': 'hosted',
  'frame.html': PAGE.replace(
    '<body>',
    '<body><script src="./frame.ts"></script>'
  ),
  'frame.ts': 'console.log("frame")\n'
}

// A package of a workspace that links a folder its siblings share.
function workspaceProject(version: 2 | 3, entry: string) {
  const root = project({...FILES, 'manifest.json': declare(version, [entry])})
  const holder = path.dirname(root)

  makeWorkspace(root)
  linkPackages(root)
  fs.mkdirSync(path.join(holder, 'shared-assets'))
  fs.writeFileSync(
    path.join(holder, 'shared-assets', 'logo.txt'),
    'workspace-shared\n'
  )

  if (canLink) {
    fs.symlinkSync(
      path.join(holder, 'shared-assets'),
      path.join(root, 'shared')
    )

    fs.symlinkSync(
      path.join(root, 'data', 'ok.json'),
      path.join(root, 'alias.json')
    )
  }

  return root
}

async function rowFor(version: 2 | 3, entry: string): Promise<Row> {
  const root = workspaceProject(version, entry)
  const result = await build(root)
  const reported = new Set<string>()

  for (const match of result.printed.matchAll(
    /Can't find the file (\S+) listed in web_accessible_resources\./g
  )) {
    reported.add(match[1])
  }

  // No message carries what a file holds, and no build fails over an entry.
  // The output is read row by row: a project file may carry a marker.
  expectNothingPrivate(result, 'printed')
  expect(result.errors, entry).toBe(0)

  return {
    shipped: result.shipped,
    marked: result.marked,
    listed: listedIn(root),
    reported: [...reported].sort()
  }
}

async function tableFor(version: 2 | 3, entries: string[]): Promise<Table> {
  const table: Table = {}

  for (const entry of entries) table[entry] = await rowFor(version, entry)

  return table
}

const TIMEOUT = 300_000
const VERSIONS = [3, 2] as const

// The holder is the workspace root, so a file beside the project ships once,
// as an asset the manifest lists in place of the entry.
const IN_WORKSPACE: Row = {
  shipped: ['assets/outside.<hash>.txt', 'hosted.txt'],
  marked: [],
  listed: ['assets/outside.<hash>.txt'],
  reported: []
}

const PRIVATE_FILES: Table = {
  // A page refuses a root path that climbs out of the extension root.
  '/../outside.txt': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: [],
    reported: ['../outside.txt']
  },
  '../outside.txt': IN_WORKSPACE,
  'sub/../../outside.txt': IN_WORKSPACE,
  '/%2e%2e/outside.txt': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: [],
    reported: ['%2e%2e/outside.txt']
  },
  '%2e%2e/outside.txt': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: [],
    reported: ['%2e%2e/outside.txt']
  },
  '/.env': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: [],
    reported: ['.env']
  },
  '.env': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: [],
    reported: ['.env']
  },
  './.env': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: [],
    reported: ['./.env']
  },
  '/.env.local': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: [],
    reported: ['.env.local']
  },
  '/.npmrc': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: [],
    reported: ['.npmrc']
  },
  '/.git/config': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: [],
    reported: ['.git/config']
  },
  '.git/config': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: [],
    reported: ['.git/config']
  },
  '/a/../.envrc': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: [],
    reported: ['a/../.envrc']
  },
  'sub/../.env': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: [],
    reported: ['sub/../.env']
  },
  'sub/.env': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: [],
    reported: ['sub/.env']
  },
  '.ENV': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: [],
    reported: ['.ENV']
  },
  '/nothing.txt': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: [],
    reported: ['nothing.txt']
  },
  'nothing.txt': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: [],
    reported: ['nothing.txt']
  }
}

// An entry the build copies nothing for, and names as missing.
const refused = (entry: string): Row => ({
  shipped: ['hosted.txt'],
  marked: [],
  listed: [],
  reported: [entry]
})

// An entry that names one file of an installed package, which ships.
const vendored = (file: string): Row => ({
  shipped: ['hosted.txt', file],
  marked: [],
  listed: [file],
  reported: []
})

// A file the author names ships from an installed package, through the
// links of a package manager too. A private name and a link out do not.
const PACKAGE_FILES: Table = {
  '/node_modules/pkg/data.json': vendored('node_modules/pkg/data.json'),
  'node_modules/pkg/data.json': vendored('node_modules/pkg/data.json'),
  'node_modules/plain-pkg/lib.js': vendored('node_modules/plain-pkg/lib.js'),
  'node_modules/plain-pkg/.env': refused('node_modules/plain-pkg/.env'),
  'node_modules/.npmrc': refused('node_modules/.npmrc')
}
const LINKED_PACKAGE_FILES: Table = {
  'node_modules/store-pkg/data.json': vendored(
    'node_modules/store-pkg/data.json'
  ),
  'node_modules/workspace-pkg/data.json': vendored(
    'node_modules/workspace-pkg/data.json'
  ),
  // The link leads to a folder of the workspace.
  'node_modules/stray-pkg/data.json': vendored(
    'node_modules/stray-pkg/data.json'
  ),
  'node_modules/far-pkg/data.json': refused('node_modules/far-pkg/data.json')
}
// A folder entry or a pattern never descends into installed packages.
const PACKAGE_FOLDERS: Table = {
  'node_modules/plain-pkg': refused('node_modules/plain-pkg'),
  'node_modules/plain-pkg/*': refused('node_modules/plain-pkg/*'),
  'node_modules/store-pkg/': refused('node_modules/store-pkg/'),
  'node_modules/store-pkg/*': refused('node_modules/store-pkg/*'),
  'node_modules/workspace-pkg/': refused('node_modules/workspace-pkg/'),
  'node_modules/*/data.json': refused('node_modules/*/data.json')
}
const PRIVATE_FOLDERS: Table = {
  '.git': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: [],
    reported: ['.git']
  },
  '.git/': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: [],
    reported: ['.git/']
  },
  node_modules: {
    shipped: ['hosted.txt'],
    marked: [],
    listed: [],
    reported: ['node_modules']
  },
  'node_modules/pkg/': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: [],
    reported: ['node_modules/pkg/']
  },
  sub: {
    shipped: ['hosted.txt', 'sub/deep/keep.txt', 'sub/keep.txt'],
    marked: [],
    listed: ['sub/*'],
    reported: ['sub/.env']
  },
  'sub/': {
    shipped: ['hosted.txt', 'sub/deep/keep.txt', 'sub/keep.txt'],
    marked: [],
    listed: ['sub/*'],
    reported: ['sub/.env']
  }
}
const PATTERNS: Table = {
  '*.env': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: ['*.env'],
    reported: []
  },
  '/.env*': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: ['/.env*'],
    reported: []
  },
  '**/*': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: ['**/*'],
    reported: []
  },
  '/*': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: ['/*'],
    reported: []
  },
  '.env*': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: ['.env*'],
    reported: []
  },
  'sub/*': {
    shipped: ['hosted.txt', 'sub/deep/keep.txt', 'sub/keep.txt'],
    marked: [],
    listed: ['sub/*'],
    reported: ['sub/.env']
  },
  '/sub/*': {
    shipped: ['hosted.txt', 'sub/deep/keep.txt', 'sub/keep.txt'],
    marked: [],
    listed: ['/sub/*'],
    reported: ['sub/.env']
  },
  'sub/.e*': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: ['sub/.e*'],
    reported: ['sub/.env']
  },
  '.git/*': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: [],
    reported: ['.git/*']
  },
  'node_modules/pkg/*': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: [],
    reported: ['node_modules/pkg/*']
  },
  '../*.txt': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: [],
    reported: []
  },
  'images/*': {
    shipped: ['hosted.txt', 'images/logo.png'],
    marked: [],
    listed: ['images/*'],
    reported: []
  }
}
// A link into the workspace ships the file it leads to, at the link's path.
const LINKS: Table = {
  '/linked.txt': vendored('linked.txt'),
  'linked.txt': vendored('linked.txt'),
  '/linked-folder/inner.txt': vendored('linked-folder/inner.txt'),
  'linked-folder/inner.txt': vendored('linked-folder/inner.txt'),
  'linked-folder': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: [],
    reported: ['linked-folder']
  },
  'linked-folder/*': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: [],
    reported: ['linked-folder/*']
  },
  'shared/logo.txt': vendored('shared/logo.txt'),
  shared: {
    shipped: ['hosted.txt'],
    marked: [],
    listed: [],
    reported: ['shared']
  },
  'shared/*': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: [],
    reported: ['shared/*']
  },
  'alias.json': {
    shipped: ['alias.json', 'hosted.txt'],
    marked: [],
    listed: ['alias.json'],
    reported: []
  }
}
const PROJECT_CONTENT: Table = {
  'data/ok.json': {
    shipped: ['data/ok.json', 'hosted.txt'],
    marked: [],
    listed: ['data/ok.json'],
    reported: []
  },
  '/data/ok.json': {
    shipped: ['data/ok.json', 'hosted.txt'],
    marked: [],
    listed: ['data/ok.json'],
    reported: []
  },
  './data/ok.json': {
    shipped: ['data/ok.json', 'hosted.txt'],
    marked: [],
    listed: ['data/ok.json'],
    reported: []
  },
  'hosted.txt': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: ['hosted.txt'],
    reported: []
  },
  '/hosted.txt': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: ['hosted.txt'],
    reported: []
  },
  'images/logo.png': {
    shipped: ['hosted.txt', 'images/logo.png'],
    marked: [],
    listed: ['images/logo.png'],
    reported: []
  },
  '.well-known/links.json': {
    shipped: ['.well-known/links.json', 'hosted.txt'],
    marked: [],
    listed: ['.well-known/links.json'],
    reported: []
  },
  '.env.example': {
    shipped: ['.env.example', 'hosted.txt'],
    marked: [],
    listed: ['.env.example'],
    reported: []
  },
  'frame.html': {
    shipped: ['frame.html', 'frame.js', 'hosted.txt'],
    marked: [],
    listed: ['frame.html'],
    reported: []
  },
  'package.json': {
    shipped: ['hosted.txt', 'package.json'],
    marked: ['package.json'],
    listed: ['package.json'],
    reported: []
  }
}

describe.each(
  VERSIONS
)('web_accessible_resources in a version %i manifest', (version) => {
  it(
    'names a private file or a file outside the project',
    async () => {
      expect(await tableFor(version, Object.keys(PRIVATE_FILES))).toEqual(
        PRIVATE_FILES
      )
    },
    TIMEOUT
  )

  it(
    'names a file of an installed package',
    async () => {
      expect(await tableFor(version, Object.keys(PACKAGE_FILES))).toEqual(
        PACKAGE_FILES
      )
    },
    TIMEOUT
  )

  it.skipIf(!canLink)(
    'names a file of a linked package',
    async () => {
      expect(
        await tableFor(version, Object.keys(LINKED_PACKAGE_FILES))
      ).toEqual(LINKED_PACKAGE_FILES)
    },
    TIMEOUT
  )

  it.skipIf(!canLink)(
    'names a folder or a pattern inside installed packages',
    async () => {
      expect(await tableFor(version, Object.keys(PACKAGE_FOLDERS))).toEqual(
        PACKAGE_FOLDERS
      )
    },
    TIMEOUT
  )

  it(
    'names a folder',
    async () => {
      expect(await tableFor(version, Object.keys(PRIVATE_FOLDERS))).toEqual(
        PRIVATE_FOLDERS
      )
    },
    TIMEOUT
  )

  it(
    'names a pattern',
    async () => {
      expect(await tableFor(version, Object.keys(PATTERNS))).toEqual(PATTERNS)
    },
    TIMEOUT
  )

  it.skipIf(!canLink)(
    'names a link',
    async () => {
      expect(await tableFor(version, Object.keys(LINKS))).toEqual(LINKS)
    },
    TIMEOUT
  )

  it(
    'names project content',
    async () => {
      expect(await tableFor(version, Object.keys(PROJECT_CONTENT))).toEqual(
        PROJECT_CONTENT
      )
    },
    TIMEOUT
  )
})

describe('a web_accessible_resources entry the build withholds', () => {
  it(
    'is said in the words a missing file gets, once',
    async () => {
      const entries = ['.env', '../outside.txt', 'nothing.txt']
      const root = project({...FILES, 'manifest.json': declare(3, entries)})
      const result = await build(root)
      const times = (part: string) => result.printed.split(part).length - 1

      // The text is read twice over: the printed lines, then the summary.
      for (const entry of entries) {
        expect(
          times(
            `Can't find the file ${entry} listed in web_accessible_resources.`
          ),
          entry
        ).toBe(2)
      }

      expect(
        times(
          'Relative paths must point to a real source file so the build can emit it.'
        )
      ).toBe(entries.length * 2)

      expect(
        times(
          'Create the missing file, or update the path to an existing source file.'
        )
      ).toBe(entries.length * 2)

      expect(result.marked).toEqual([])
      expectNothingPrivate(result)
      expect(result.errors).toBe(0)
    },
    TIMEOUT
  )

  it(
    'is not answered by a file of the same name in public/',
    async () => {
      const root = project({
        'public/.env': `PRIVATE_KEY=${MARKER}-public-env\n`,
        'public/.npmrc': `# ${MARKER}-public-npmrc\n`,
        'public/hosted.txt': 'hosted',
        'manifest.json': declare(3, ['/.env', '.npmrc', '/hosted.txt'])
      })
      const result = await build(root)

      expect(result.shipped).toEqual(['hosted.txt'])
      expect(result.marked).toEqual([])

      for (const entry of ['.env', '.npmrc']) {
        expect(result.printed).toContain(
          `Can't find the file ${entry} listed in web_accessible_resources.`
        )
      }

      expectNothingPrivate(result)
      expect(result.errors).toBe(0)
    },
    TIMEOUT
  )
})

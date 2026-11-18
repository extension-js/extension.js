import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {
  build,
  canLink,
  MARKER,
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
  '.env.example': 'PRIVATE_KEY=\n',
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

  fs.writeFileSync(path.join(holder, 'pnpm-workspace.yaml'), 'packages: []\n')
  fs.mkdirSync(path.join(holder, 'shared-assets'))
  fs.writeFileSync(
    path.join(holder, 'shared-assets', 'logo.txt'),
    `${MARKER}-workspace\n`
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
  expect(result.printed, entry).not.toContain(MARKER)
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

const PRIVATE_FILES: Table = {
  '/../outside.txt': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: ['../outside.txt'],
    reported: ['../outside.txt']
  },
  '../outside.txt': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: ['../outside.txt'],
    reported: ['../outside.txt']
  },
  'sub/../../outside.txt': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: ['sub/../../outside.txt'],
    reported: ['sub/../../outside.txt']
  },
  '/%2e%2e/outside.txt': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: ['%2e%2e/outside.txt'],
    reported: ['%2e%2e/outside.txt']
  },
  '%2e%2e/outside.txt': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: ['%2e%2e/outside.txt'],
    reported: ['%2e%2e/outside.txt']
  },
  '/.env': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: ['.env'],
    reported: ['.env']
  },
  '.env': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: ['.env'],
    reported: ['.env']
  },
  './.env': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: ['./.env'],
    reported: ['./.env']
  },
  '/.env.local': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: ['.env.local'],
    reported: ['.env.local']
  },
  '/.npmrc': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: ['.npmrc'],
    reported: ['.npmrc']
  },
  '/.git/config': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: ['.git/config'],
    reported: ['.git/config']
  },
  '.git/config': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: ['.git/config'],
    reported: ['.git/config']
  },
  '/a/../.envrc': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: ['a/../.envrc'],
    reported: ['a/../.envrc']
  },
  'sub/../.env': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: ['sub/../.env'],
    reported: ['sub/../.env']
  },
  'sub/.env': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: ['sub/.env'],
    reported: ['sub/.env']
  },
  '.ENV': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: ['.ENV'],
    reported: ['.ENV']
  },
  '/node_modules/pkg/data.json': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: ['node_modules/pkg/data.json'],
    reported: ['node_modules/pkg/data.json']
  },
  'node_modules/pkg/data.json': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: ['node_modules/pkg/data.json'],
    reported: ['node_modules/pkg/data.json']
  },
  '/nothing.txt': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: ['nothing.txt'],
    reported: ['nothing.txt']
  },
  'nothing.txt': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: ['nothing.txt'],
    reported: ['nothing.txt']
  }
}
const PRIVATE_FOLDERS: Table = {
  '.git': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: ['.git'],
    reported: ['.git']
  },
  '.git/': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: ['.git/'],
    reported: ['.git/']
  },
  node_modules: {
    shipped: ['hosted.txt'],
    marked: [],
    listed: ['node_modules'],
    reported: ['node_modules']
  },
  'node_modules/pkg/': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: ['node_modules/pkg/'],
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
    listed: ['.git/*'],
    reported: ['.git/*']
  },
  'node_modules/pkg/*': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: ['node_modules/pkg/*'],
    reported: ['node_modules/pkg/*']
  },
  '../*.txt': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: ['../*.txt'],
    reported: []
  },
  'images/*': {
    shipped: ['hosted.txt', 'images/logo.png'],
    marked: [],
    listed: ['images/*'],
    reported: []
  }
}
const LINKS: Table = {
  '/linked.txt': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: ['linked.txt'],
    reported: ['linked.txt']
  },
  'linked.txt': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: ['linked.txt'],
    reported: ['linked.txt']
  },
  '/linked-folder/inner.txt': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: ['linked-folder/inner.txt'],
    reported: ['linked-folder/inner.txt']
  },
  'linked-folder/inner.txt': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: ['linked-folder/inner.txt'],
    reported: ['linked-folder/inner.txt']
  },
  'linked-folder': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: ['linked-folder'],
    reported: ['linked-folder']
  },
  'linked-folder/*': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: ['linked-folder/*'],
    reported: ['linked-folder/*']
  },
  'shared/logo.txt': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: ['shared/logo.txt'],
    reported: ['shared/logo.txt']
  },
  shared: {
    shipped: ['hosted.txt'],
    marked: [],
    listed: ['shared'],
    reported: ['shared']
  },
  'shared/*': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: ['shared/*'],
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
      expect(result.printed).not.toContain(MARKER)
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

      expect(result.printed).not.toContain(MARKER)
      expect(result.errors).toBe(0)
    },
    TIMEOUT
  )
})

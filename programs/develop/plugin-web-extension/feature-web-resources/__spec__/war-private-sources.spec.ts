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
    shipped: ['assets/outside.<hash>.txt', 'hosted.txt'],
    marked: ['assets/outside.<hash>.txt'],
    listed: ['assets/outside.<hash>.txt'],
    reported: []
  },
  '../outside.txt': {
    shipped: ['assets/outside.<hash>.txt', 'hosted.txt'],
    marked: ['assets/outside.<hash>.txt'],
    listed: ['assets/outside.<hash>.txt'],
    reported: []
  },
  'sub/../../outside.txt': {
    shipped: ['assets/outside.<hash>.txt', 'hosted.txt'],
    marked: ['assets/outside.<hash>.txt'],
    listed: ['assets/outside.<hash>.txt'],
    reported: []
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
    shipped: ['.env', 'hosted.txt'],
    marked: ['.env'],
    listed: ['.env'],
    reported: []
  },
  '.env': {
    shipped: ['.env', 'hosted.txt'],
    marked: ['.env'],
    listed: ['.env'],
    reported: []
  },
  './.env': {
    shipped: ['.env', 'hosted.txt'],
    marked: ['.env'],
    listed: ['.env'],
    reported: []
  },
  '/.env.local': {
    shipped: ['.env.local', 'hosted.txt'],
    marked: ['.env.local'],
    listed: ['.env.local'],
    reported: []
  },
  '/.npmrc': {
    shipped: ['.npmrc', 'hosted.txt'],
    marked: ['.npmrc'],
    listed: ['.npmrc'],
    reported: []
  },
  '/.git/config': {
    shipped: ['.git/config', 'hosted.txt'],
    marked: ['.git/config'],
    listed: ['.git/config'],
    reported: []
  },
  '.git/config': {
    shipped: ['.git/config', 'hosted.txt'],
    marked: ['.git/config'],
    listed: ['.git/config'],
    reported: []
  },
  '/a/../.envrc': {
    shipped: ['.envrc', 'hosted.txt'],
    marked: ['.envrc'],
    listed: ['.envrc'],
    reported: []
  },
  'sub/../.env': {
    shipped: ['.env', 'hosted.txt'],
    marked: ['.env'],
    listed: ['.env'],
    reported: []
  },
  'sub/.env': {
    shipped: ['hosted.txt', 'sub/.env'],
    marked: ['sub/.env'],
    listed: ['sub/.env'],
    reported: []
  },
  '.ENV': {
    shipped: ['.ENV', 'hosted.txt'],
    marked: ['.ENV'],
    listed: ['.ENV'],
    reported: []
  },
  '/node_modules/pkg/data.json': {
    shipped: ['hosted.txt', 'node_modules/pkg/data.json'],
    marked: ['node_modules/pkg/data.json'],
    listed: ['node_modules/pkg/data.json'],
    reported: []
  },
  'node_modules/pkg/data.json': {
    shipped: ['hosted.txt', 'node_modules/pkg/data.json'],
    marked: ['node_modules/pkg/data.json'],
    listed: ['node_modules/pkg/data.json'],
    reported: []
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
    shipped: ['.git/config', 'hosted.txt'],
    marked: ['.git/config'],
    listed: ['.git/*'],
    reported: []
  },
  '.git/': {
    shipped: ['.git/config', 'hosted.txt'],
    marked: ['.git/config'],
    listed: ['.git/*'],
    reported: []
  },
  node_modules: {
    shipped: ['hosted.txt', 'node_modules/pkg/data.json'],
    marked: ['node_modules/pkg/data.json'],
    listed: ['node_modules/*'],
    reported: []
  },
  'node_modules/pkg/': {
    shipped: ['hosted.txt', 'node_modules/pkg/data.json'],
    marked: ['node_modules/pkg/data.json'],
    listed: ['node_modules/pkg/*'],
    reported: []
  },
  sub: {
    shipped: [
      'hosted.txt',
      'sub/.env',
      'sub/deep/.npmrc',
      'sub/deep/keep.txt',
      'sub/keep.txt'
    ],
    marked: ['sub/.env', 'sub/deep/.npmrc'],
    listed: ['sub/*'],
    reported: []
  },
  'sub/': {
    shipped: [
      'hosted.txt',
      'sub/.env',
      'sub/deep/.npmrc',
      'sub/deep/keep.txt',
      'sub/keep.txt'
    ],
    marked: ['sub/.env', 'sub/deep/.npmrc'],
    listed: ['sub/*'],
    reported: []
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
    shipped: [
      'hosted.txt',
      'sub/.env',
      'sub/deep/.npmrc',
      'sub/deep/keep.txt',
      'sub/keep.txt'
    ],
    marked: ['sub/.env', 'sub/deep/.npmrc'],
    listed: ['sub/*'],
    reported: []
  },
  '/sub/*': {
    shipped: [
      'hosted.txt',
      'sub/.env',
      'sub/deep/.npmrc',
      'sub/deep/keep.txt',
      'sub/keep.txt'
    ],
    marked: ['sub/.env', 'sub/deep/.npmrc'],
    listed: ['/sub/*'],
    reported: []
  },
  'sub/.e*': {
    shipped: ['hosted.txt', 'sub/.env'],
    marked: ['sub/.env'],
    listed: ['sub/.e*'],
    reported: []
  },
  '.git/*': {
    shipped: ['.git/config', 'hosted.txt'],
    marked: ['.git/config'],
    listed: ['.git/*'],
    reported: []
  },
  'node_modules/pkg/*': {
    shipped: ['hosted.txt', 'node_modules/pkg/data.json'],
    marked: ['node_modules/pkg/data.json'],
    listed: ['node_modules/pkg/*'],
    reported: []
  },
  '../*.txt': {
    shipped: ['hosted.txt'],
    marked: [],
    listed: ['../*.txt'],
    reported: []
  },
  'images/*': {
    shipped: ['hosted.txt', 'images/.DS_Store', 'images/logo.png'],
    marked: ['images/.DS_Store'],
    listed: ['images/*'],
    reported: []
  }
}
const LINKS: Table = {
  '/linked.txt': {
    shipped: ['hosted.txt', 'linked.txt'],
    marked: ['linked.txt'],
    listed: ['linked.txt'],
    reported: []
  },
  'linked.txt': {
    shipped: ['hosted.txt', 'linked.txt'],
    marked: ['linked.txt'],
    listed: ['linked.txt'],
    reported: []
  },
  '/linked-folder/inner.txt': {
    shipped: ['hosted.txt', 'linked-folder/inner.txt'],
    marked: ['linked-folder/inner.txt'],
    listed: ['linked-folder/inner.txt'],
    reported: []
  },
  'linked-folder/inner.txt': {
    shipped: ['hosted.txt', 'linked-folder/inner.txt'],
    marked: ['linked-folder/inner.txt'],
    listed: ['linked-folder/inner.txt'],
    reported: []
  },
  'linked-folder': {
    shipped: ['hosted.txt', 'linked-folder/inner.txt'],
    marked: ['linked-folder/inner.txt'],
    listed: ['linked-folder/*'],
    reported: []
  },
  'linked-folder/*': {
    shipped: ['hosted.txt', 'linked-folder/inner.txt'],
    marked: ['linked-folder/inner.txt'],
    listed: ['linked-folder/*'],
    reported: []
  },
  'shared/logo.txt': {
    shipped: ['hosted.txt', 'shared/logo.txt'],
    marked: ['shared/logo.txt'],
    listed: ['shared/logo.txt'],
    reported: []
  },
  shared: {
    shipped: ['hosted.txt', 'shared/logo.txt'],
    marked: ['shared/logo.txt'],
    listed: ['shared/*'],
    reported: []
  },
  'shared/*': {
    shipped: ['hosted.txt', 'shared/logo.txt'],
    marked: ['shared/logo.txt'],
    listed: ['shared/*'],
    reported: []
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

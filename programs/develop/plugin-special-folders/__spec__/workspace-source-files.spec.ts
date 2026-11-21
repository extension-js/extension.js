import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {beforeAll, describe, expect, it} from 'vitest'
import {
  sourceFileMayShip,
  workspaceRootOf
} from '../../lib/public-private-files'
import {expectNoWorkspaceAboveTemp} from './helpers/private-files-project'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import {writeProjectFiles} from '../../__spec__/helpers/extension-project'

// The predicate on its own, for a project two folders below a workspace
// root. A row is a path from the project and whether each ask may ship it.

const tempFolder = trackTempFolders()

beforeAll(expectNoWorkspaceAboveTemp)
const canLink = process.platform !== 'win32'

const FILES = [
  'apps/ext/data/ok.json',
  'apps/ext/node_modules/pkg/data.json',
  'shared/logo.png',
  'shared/.env',
  'shared/.env.example',
  'shared/deep/data.json',
  '.npmrc',
  '.git/config',
  '.cache/x.json',
  '.turbo/x.json',
  'packages/ui/tokens.json',
  'packages/ui/.next/x.json',
  'packages/ui/node_modules/dep/data.json',
  'node_modules/dep/data.json',
  'node_modules/.pnpm/dep@1.0.0/node_modules/dep/data.json',
  'apps/node_modules/dep/data.json'
]

function layout(marker: Record<string, string>) {
  const holder = fs.realpathSync(tempFolder('extjs-workspace-source-'))

  const ws = path.join(holder, 'ws')
  const root = path.join(ws, 'apps', 'ext')

  for (const relative of [...FILES, ...Object.keys(marker)]) {
    const file = path.join(ws, relative)
    fs.mkdirSync(path.dirname(file), {recursive: true})
    fs.writeFileSync(file, marker[relative] ?? 'fake')
  }

  fs.writeFileSync(path.join(holder, 'outside.json'), 'fake')

  if (canLink) {
    fs.symlinkSync(
      path.join(ws, 'shared', 'logo.png'),
      path.join(root, 'linked-in.png')
    )

    fs.symlinkSync(
      path.join(holder, 'outside.json'),
      path.join(root, 'linked-out.json')
    )

    fs.symlinkSync(path.join(ws, '.npmrc'), path.join(root, 'linked-npmrc'))
    fs.symlinkSync(
      path.join(ws, 'shared', 'logo.png'),
      path.join(root, '.env.linked')
    )
  }

  return root
}

const REFS = [
  'data/ok.json',
  'node_modules/pkg/data.json',
  '../../shared/logo.png',
  '../../shared/deep/data.json',
  '../../shared/.env',
  '../../shared/.env.example',
  '../../.npmrc',
  '../../.git/config',
  '../../.cache/x.json',
  '../../.turbo/x.json',
  '../../packages/ui/tokens.json',
  '../../packages/ui/.next/x.json',
  '../../packages/ui/node_modules/dep/data.json',
  '../../node_modules/dep/data.json',
  '../../node_modules/.pnpm/dep@1.0.0/node_modules/dep/data.json',
  '../node_modules/dep/data.json',
  '../../../outside.json',
  ...(canLink
    ? ['linked-in.png', 'linked-out.json', 'linked-npmrc', '.env.linked']
    : [])
]

// A row in one line: what a named ask answers, then a walked one.
function tableFor(root: string, roots: string[] = [root]) {
  return Object.fromEntries(
    REFS.map((ref) => {
      const file = path.join(root, ref)
      const named = sourceFileMayShip(file, roots, 'named')
      const walked = sourceFileMayShip(file, roots, 'walked')

      return [
        ref,
        `named ${named ? 'ships' : 'refused'}, walked ${walked ? 'ships' : 'refused'}`
      ]
    })
  )
}

const row = (named: boolean, walked = false) =>
  `named ${named ? 'ships' : 'refused'}, walked ${walked ? 'ships' : 'refused'}`

const each = (refs: string[], value: string) =>
  Object.fromEntries(refs.map((ref) => [ref, value]))

// Without a workspace: the project and the `node_modules` of a folder above it,
// which here is outside the project root and so outside the workspace too.
const PROJECT_ONLY = {
  ...each(REFS, row(false)),
  'data/ok.json': row(true, true),
  'node_modules/pkg/data.json': row(true)
}

// A named file may come from the workspace, through no dot-folder and no
// `node_modules` of another package. A walk stays in the project.
const WORKSPACE = {
  ...PROJECT_ONLY,
  '../../shared/logo.png': row(true),
  '../../shared/deep/data.json': row(true),
  '../../packages/ui/tokens.json': row(true),
  '../../node_modules/dep/data.json': row(true),
  '../../node_modules/.pnpm/dep@1.0.0/node_modules/dep/data.json': row(true),
  '../node_modules/dep/data.json': row(true),
  ...(canLink ? {'linked-in.png': row(true)} : {})
}

describe('sourceFileMayShip for a project inside a workspace', () => {
  it('answers each path of a pnpm workspace', () => {
    const root = layout({'pnpm-workspace.yaml': 'packages: []\n'})

    expect(tableFor(root)).toEqual(WORKSPACE)
  })

  it('answers the same for a src/ manifest folder given as a second root', () => {
    const root = layout({'pnpm-workspace.yaml': 'packages: []\n'})

    expect(tableFor(root, [root, path.join(root, 'src')])).toEqual(WORKSPACE)
  })

  it('keeps every path outside the project when no marker is there', () => {
    const root = layout({'pnpm-lock.yaml': "lockfileVersion: '9.0'\n"})

    expect(tableFor(root)).toEqual(PROJECT_ONLY)
  })
})

// Folders made under the temp folder, standing for a home folder and what
// sits above and below it. Nothing is read or written outside it.
function tree(files: Record<string, string>) {
  // Spelled as the walk spells its answer, or a row fails on Windows.
  const holder = fs.realpathSync.native(tempFolder('extjs-workspace-root-'))

  writeProjectFiles(holder, files)

  return holder
}

const PNPM = 'packages: []\n'
const PROJECT = {'home/me/ws/apps/ext/package.json': '{}'}

// The workspace root, read from the holder, for the project at `ext`.
function rootOf(holder: string, project: string, home?: string) {
  const at = path.join(holder, project)
  fs.mkdirSync(at, {recursive: true})

  const found = workspaceRootOf(
    at,
    home === undefined ? path.join(holder, 'home', 'me') : home
  )

  return path.relative(holder, found).split(path.sep).join('/')
}

describe('workspaceRootOf', () => {
  it.each([
    ['pnpm-workspace.yaml', {'home/me/ws/pnpm-workspace.yaml': PNPM}],
    [
      'a workspaces list',
      {'home/me/ws/package.json': JSON.stringify({workspaces: ['apps/*']})}
    ],
    [
      'a workspaces object',
      {
        'home/me/ws/package.json': JSON.stringify({
          workspaces: {packages: ['apps/*'], nohoist: []}
        })
      }
    ]
  ])('finds the folder that holds %s', (_name, marker) => {
    expect(rootOf(tree({...PROJECT, ...marker}), 'home/me/ws/apps/ext')).toBe(
      'home/me/ws'
    )
  })

  it.each([
    ['a lockfile', {'home/me/ws/pnpm-lock.yaml': "lockfileVersion: '9.0'\n"}],
    ['a .git folder', {'home/me/ws/.git/HEAD': 'ref: refs/heads/main\n'}],
    ['lerna.json', {'home/me/ws/lerna.json': '{}'}],
    ['nx.json', {'home/me/ws/nx.json': '{}'}],
    ['turbo.json', {'home/me/ws/turbo.json': '{}'}],
    [
      'a workspaces field of another shape',
      {'home/me/ws/package.json': JSON.stringify({workspaces: 'apps/*'})}
    ],
    [
      'an object without a packages list',
      {'home/me/ws/package.json': JSON.stringify({workspaces: {nohoist: []}})}
    ],
    ['a package.json that does not parse', {'home/me/ws/package.json': '{'}],
    ['no marker', {}]
  ])('answers the project itself for %s', (_name, marker) => {
    expect(rootOf(tree({...PROJECT, ...marker}), 'home/me/ws/apps/ext')).toBe(
      'home/me/ws/apps/ext'
    )
  })

  it('counts a marker in the project itself', () => {
    const holder = tree({
      ...PROJECT,
      'home/me/ws/pnpm-workspace.yaml': PNPM,
      'home/me/ws/apps/ext/pnpm-workspace.yaml': PNPM
    })

    expect(rootOf(holder, 'home/me/ws/apps/ext')).toBe('home/me/ws/apps/ext')
  })

  it('reads the nearest marker of nested workspaces', () => {
    const holder = tree({
      ...PROJECT,
      'home/me/ws/pnpm-workspace.yaml': PNPM,
      'home/me/ws/apps/package.json': JSON.stringify({workspaces: ['*']})
    })

    expect(rootOf(holder, 'home/me/ws/apps/ext')).toBe('home/me/ws/apps')
  })

  it('ignores a marker in the home folder and above it', () => {
    const holder = tree({
      ...PROJECT,
      'home/me/pnpm-workspace.yaml': PNPM,
      'home/pnpm-workspace.yaml': PNPM,
      'pnpm-workspace.yaml': PNPM
    })

    expect(rootOf(holder, 'home/me/ws/apps/ext')).toBe('home/me/ws/apps/ext')
  })

  it('answers the home folder itself when it is the project', () => {
    const holder = tree({'home/me/pnpm-workspace.yaml': PNPM})

    expect(rootOf(holder, 'home/me')).toBe('home/me')
  })

  it('walks past the home folder for a project outside it', () => {
    const holder = tree({'srv/pnpm-workspace.yaml': PNPM})

    expect(rootOf(holder, 'srv/apps/ext')).toBe('srv')
  })

  it('reads the real path of a linked project', () => {
    const holder = tree({...PROJECT, 'home/me/ws/pnpm-workspace.yaml': PNPM})

    if (!canLink) return

    fs.mkdirSync(path.join(holder, 'home', 'me', 'links'))
    fs.symlinkSync(
      path.join(holder, 'home', 'me', 'ws', 'apps', 'ext'),
      path.join(holder, 'home', 'me', 'links', 'ext')
    )

    expect(rootOf(holder, 'home/me/links/ext')).toBe('home/me/ws')
  })

  // A volume that ignores letter case answers for a second spelling of a
  // folder, the way Windows answers for a short name beside the long one.
  it.skipIf(!fs.existsSync(os.tmpdir().toUpperCase()))(
    'answers in the spelling the disk holds for a project spelled another way',
    () => {
      const holder = tree({...PROJECT, 'home/me/ws/pnpm-workspace.yaml': PNPM})
      const me = path.join(holder, 'home', 'me')

      expect(
        workspaceRootOf(path.join(me, 'WS', 'APPS', 'ext'), me.toUpperCase())
      ).toBe(path.join(me, 'ws'))
    }
  )

  it('keeps its first answer for a project root', () => {
    const holder = tree(PROJECT)

    expect(rootOf(holder, 'home/me/ws/apps/ext')).toBe('home/me/ws/apps/ext')

    fs.writeFileSync(
      path.join(holder, 'home', 'me', 'ws', 'pnpm-workspace.yaml'),
      PNPM
    )

    expect(rootOf(holder, 'home/me/ws/apps/ext')).toBe('home/me/ws/apps/ext')
  })
})

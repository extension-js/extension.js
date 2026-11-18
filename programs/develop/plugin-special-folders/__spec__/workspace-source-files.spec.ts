import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {sourceFileMayShip} from '../public-private-files'
import {expectNoWorkspaceAboveTemp} from './helpers/private-files-project'

// The predicate on its own, for a project two folders below a workspace
// root. A row is a path from the project and whether each ask may ship it.

const holders: string[] = []

beforeAll(expectNoWorkspaceAboveTemp)
const canLink = process.platform !== 'win32'

afterAll(() => {
  for (const holder of holders) {
    fs.rmSync(holder, {recursive: true, force: true})
  }
})

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
  const holder = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-workspace-source-'))
  )
  holders.push(holder)

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

// Today: only the project and the `node_modules` of a folder above it.
const PROJECT_ONLY = {
  ...each(REFS, row(false)),
  'data/ok.json': row(true, true),
  'node_modules/pkg/data.json': row(true)
}

describe('sourceFileMayShip for a project inside a workspace', () => {
  it('answers each path of a pnpm workspace', () => {
    const root = layout({'pnpm-workspace.yaml': 'packages: []\n'})

    expect(tableFor(root)).toEqual(PROJECT_ONLY)
  })

  it('answers the same for a src/ manifest folder given as a second root', () => {
    const root = layout({'pnpm-workspace.yaml': 'packages: []\n'})

    expect(tableFor(root, [root, path.join(root, 'src')])).toEqual(PROJECT_ONLY)
  })

  it('keeps every path outside the project when no marker is there', () => {
    const root = layout({'pnpm-lock.yaml': "lockfileVersion: '9.0'\n"})

    expect(tableFor(root)).toEqual(PROJECT_ONLY)
  })
})

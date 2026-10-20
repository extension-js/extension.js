import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
import {
  classifyFromSession,
  type DevWatchSession,
  errorsOf,
  openDevWatchSession
} from './helpers/dev-watch-session'

// An edit under public/ ships at the dist root, so the watch session must
// observe it and answer with a full extension reload, whichever of the two
// public/ layouts the project uses. Real watch-mode compiles, no browser.
const roots: string[] = []
const sessions: DevWatchSession[] = []

afterAll(async () => {
  for (const session of sessions) await session.close()
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

type Layout = 'root' | 'src'

function project(layout: Layout) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-public-reload-'))
  roots.push(root)
  const manifestDir = layout === 'src' ? path.join(root, 'src') : root
  const publicDir = path.join(manifestDir, 'public')
  fs.mkdirSync(publicDir, {recursive: true})
  // With both special folders present the project root is not a fallback
  // context dependency, so only the public/ watch can observe the edits.
  fs.mkdirSync(path.join(root, 'pages'), {recursive: true})
  fs.mkdirSync(path.join(root, 'scripts'), {recursive: true})
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'public-reload', version: '0.0.0'})
  )

  fs.writeFileSync(
    path.join(manifestDir, 'background.js'),
    'console.log("bg")\n'
  )

  fs.writeFileSync(
    path.join(publicDir, 'rules.json'),
    JSON.stringify([
      {
        id: 1,
        priority: 1,
        action: {type: 'block'},
        condition: {urlFilter: 'v1.example', resourceTypes: ['main_frame']}
      }
    ])
  )

  // Nothing references this file: only the public/ copier ships it.
  fs.writeFileSync(path.join(publicDir, 'data.json'), '{"value":"v1"}')
  const manifest: Record<string, unknown> = {
    manifest_version: 3,
    name: 'public-reload',
    version: '1.0.0',
    background: {service_worker: 'background.js'}
  }

  // The ruleset resolver only knows the root public/ folder today, so the
  // next-to-manifest layout ships its files without naming them.
  if (layout === 'root') {
    manifest.permissions = ['declarativeNetRequest']
    manifest.declarative_net_request = {
      rule_resources: [{id: 'ruleset_1', enabled: true, path: 'rules.json'}]
    }
  }

  fs.writeFileSync(
    path.join(manifestDir, 'manifest.json'),
    JSON.stringify(manifest)
  )

  return {root, manifestDir, publicDir}
}

async function editAndClassify(
  session: DevWatchSession,
  file: string,
  from: string,
  to: string
) {
  const seen = await session.settle()
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(from, to))
  const stats = await session.doneAfter(seen)
  expect(errorsOf(stats)).toEqual([])

  return classifyFromSession(session, stats)
}

describe.each<Layout>([
  'root',
  'src'
])('public/ edits under extension dev (%s layout)', (layout) => {
  it('a file only the copier ships is observed, classified as a full reload, and re-shipped', async () => {
    const files = project(layout)
    const session = await openDevWatchSession(files.root)
    sessions.push(session)
    const source = path.join(files.publicDir, 'data.json')
    const rel = path.relative(files.root, source).replace(/\\/g, '/')

    const first = await session.doneAfter(0)
    expect(errorsOf(first)).toEqual([])
    const shipped = path.join(session.distPath, 'data.json')
    expect(fs.readFileSync(shipped, 'utf8')).toBe('{"value":"v1"}')

    const instruction = await editAndClassify(session, source, 'v1', 'v2')
    expect(instruction?.type).toBe('full')
    expect(instruction?.changedAssets).toEqual([rel])
    expect(instruction?.label).toBe(`extension (${rel})`)
    expect(fs.readFileSync(shipped, 'utf8')).toBe('{"value":"v2"}')
  }, 60000)

  it('a file deleted or renamed mid-session leaves no copy of its old path in dist', async () => {
    const files = project(layout)
    const deleted = path.join(files.publicDir, 'deleted-mid-session.bin')
    const before = path.join(files.publicDir, 'fonts', 'renamed-before.bin')
    const after = path.join(files.publicDir, 'fonts', 'renamed-after.bin')
    fs.mkdirSync(path.dirname(before), {recursive: true})
    fs.writeFileSync(deleted, 'stale-public-token:deleted')
    fs.writeFileSync(before, 'stale-public-token:renamed')
    const session = await openDevWatchSession(files.root)
    sessions.push(session)
    const inDist = (...segments: string[]) =>
      path.join(session.distPath, ...segments)

    const first = await session.doneAfter(0)
    expect(errorsOf(first)).toEqual([])
    expect(fs.existsSync(inDist('deleted-mid-session.bin'))).toBe(true)
    expect(fs.existsSync(inDist('fonts', 'renamed-before.bin'))).toBe(true)
    fs.writeFileSync(inDist('not-from-public.bin'), 'stale-public-token:other')

    const seen = await session.settle()
    fs.rmSync(deleted)
    fs.renameSync(before, after)
    const stats = await session.doneAfter(seen)
    expect(errorsOf(stats)).toEqual([])
    await session.settle()

    expect(fs.existsSync(inDist('deleted-mid-session.bin'))).toBe(false)
    expect(fs.existsSync(inDist('fonts', 'renamed-before.bin'))).toBe(false)
    expect(fs.readFileSync(inDist('fonts', 'renamed-after.bin'), 'utf8')).toBe(
      'stale-public-token:renamed'
    )

    expect(fs.readFileSync(inDist('data.json'), 'utf8')).toBe('{"value":"v1"}')
    expect(fs.existsSync(inDist('not-from-public.bin'))).toBe(true)
  }, 60000)
})

describe('public/ edits under extension dev (manifest-named ruleset)', () => {
  it('a DNR ruleset edit is classified as a full reload and re-shipped', async () => {
    const files = project('root')
    const session = await openDevWatchSession(files.root)
    sessions.push(session)
    const source = path.join(files.publicDir, 'rules.json')

    const first = await session.doneAfter(0)
    expect(errorsOf(first)).toEqual([])
    const shipped = path.join(session.distPath, 'rules.json')
    expect(fs.readFileSync(shipped, 'utf8')).toContain('v1.example')

    const instruction = await editAndClassify(
      session,
      source,
      'v1.example',
      'v2.example'
    )
    expect(instruction?.type).toBe('full')
    expect(instruction?.changedAssets).toEqual(['public/rules.json'])
    expect(fs.readFileSync(shipped, 'utf8')).toContain('v2.example')
  }, 60000)
})

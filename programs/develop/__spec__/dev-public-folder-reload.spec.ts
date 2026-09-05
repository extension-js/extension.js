import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {type Compiler, rspack, type Stats} from '@rspack/core'
import {afterAll, describe, expect, it} from 'vitest'
import {getProjectStructure} from '../lib/project'
import {
  buildSourceFeatureIndex,
  classifyReloadFromSources,
  createChangedSourcesTracker,
  readContentScriptCount
} from '../plugin-reload'
import webpackConfig from '../rspack-config'

// An edit under public/ ships at the dist root, so the watch session must
// observe it and answer with a full extension reload, whichever of the two
// public/ layouts the project uses. Real watch-mode compiles, no browser.
const roots: string[] = []
const sessions: Array<{close: () => Promise<void>}> = []

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

async function watchSession(root: string) {
  const projectStructure = await getProjectStructure(root)
  const distPath = path.join(root, 'dist', 'chrome')
  const config = webpackConfig(projectStructure, {
    browser: 'chrome',
    mode: 'development',
    metadataCommand: 'dev',
    silent: true,
    output: {clean: false, path: distPath}
  } as any)
  config.plugins = (config.plugins || []).filter(
    (plugin) =>
      plugin?.constructor.name !== 'plugin-browsers' &&
      plugin?.constructor.name !== 'plugin-playwright'
  )
  config.stats = false
  const compiler: Compiler = rspack(config)
  const tracker = createChangedSourcesTracker(compiler)

  // Every finished compile lands here; a test waits for the one after the
  // count it last saw, so a startup invalidation never masquerades as the edit.
  const dones: Stats[] = []
  let lastDoneAt = 0
  compiler.hooks.done.tap('spec-public-reload', (stats) => {
    dones.push(stats)
    lastDoneAt = Date.now()
  })
  const doneAfter = (seen: number, timeoutMs = 15000) =>
    new Promise<Stats>((resolve, reject) => {
      const startedAt = Date.now()
      const poll = () => {
        if (dones.length > seen) return resolve(dones[seen])
        if (Date.now() - startedAt > timeoutMs) {
          return reject(new Error('no rebuild observed within 15s'))
        }
        setTimeout(poll, 25)
      }
      poll()
    })
  // Quiet for a full second: the watcher has finished any startup churn.
  const settle = () =>
    new Promise<number>((resolve) => {
      const poll = () => {
        if (dones.length > 0 && Date.now() - lastDoneAt > 1000) {
          return resolve(dones.length)
        }
        setTimeout(poll, 50)
      }
      poll()
    })

  const watching = compiler.watch({aggregateTimeout: 50}, () => {})
  const session = {
    compiler,
    tracker,
    distPath,
    doneAfter,
    settle,
    close: () =>
      new Promise<void>((resolve) => {
        watching.close(() => resolve())
      })
  }
  sessions.push(session)
  return session
}

// The same classification the launched and --no-browser paths perform.
function classify(
  session: Awaited<ReturnType<typeof watchSession>>,
  stats: Stats
) {
  const compilation = stats.compilation
  const outputPath = String(compilation.options?.output?.path || '')
  const contextDir = String(compilation.options?.context || '')
  const {forcedFull, changedSources} = session.tracker.snapshot()
  return classifyReloadFromSources({
    changedSources,
    forcedFull,
    getContentScriptCount: () =>
      readContentScriptCount(compilation, outputPath),
    getSourceFeatureIndex: () =>
      buildSourceFeatureIndex(compilation, contextDir),
    outputPath
  })
}

const errorsOf = (stats: Stats) =>
  Array.from(stats.compilation.errors || []).map((error) =>
    String((error as Error)?.message || error)
  )

async function editAndClassify(
  session: Awaited<ReturnType<typeof watchSession>>,
  file: string,
  from: string,
  to: string
) {
  const seen = await session.settle()
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(from, to))
  const stats = await session.doneAfter(seen)
  expect(errorsOf(stats)).toEqual([])
  return classify(session, stats)
}

describe.each<Layout>([
  'root',
  'src'
])('public/ edits under extension dev (%s layout)', (layout) => {
  it('a file only the copier ships is observed, classified as a full reload, and re-shipped', async () => {
    const files = project(layout)
    const session = await watchSession(files.root)
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
})

describe('public/ edits under extension dev (manifest-named ruleset)', () => {
  it('a DNR ruleset edit is classified as a full reload and re-shipped', async () => {
    const files = project('root')
    const session = await watchSession(files.root)
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

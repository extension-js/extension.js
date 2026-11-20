import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import {rspack} from '@rspack/core'
import {describe, expect, it} from 'vitest'
import contentScriptWrapper from '../../plugin-web-extension/feature-scripts/steps/add-content-script-wrapper/content-script-wrapper'
import {contentScriptReinject} from '../reload-lib/content-script-reinject'
import {wrapsForDevSession} from '../steps/add-content-script-reinject'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'

// A dev session injects a content script again after each edit. These rows
// inject a second copy while the first still waits on a top-level await.
const tempFolder = trackTempFolders()

// Each copy takes a number, waits on its own gate, and then mounts.
const MOUNTS_AFTER_AWAIT = [
  'const copy = (globalThis.copies = (globalThis.copies || 0) + 1)',
  'await globalThis.gates[copy - 1].opened',
  'export default function main() {',
  '  globalThis.live.push(copy)',
  '  return () => globalThis.live.splice(globalThis.live.indexOf(copy), 1)',
  '}',
  ''
].join('\n')

// A script with no default export starts itself as it is imported.
const STARTS_ITSELF = [
  "import {started} from './started.js'",
  'const copy = (globalThis.copies = (globalThis.copies || 0) + 1)',
  'started(copy)',
  'globalThis.live.push(copy)',
  'globalThis.__EXTENSIONJS_registerCleanup(() => {',
  '  globalThis.live.splice(globalThis.live.indexOf(copy), 1)',
  '})',
  'await globalThis.gates[copy - 1].opened',
  ''
].join('\n')

const STARTED =
  'export function started(copy) { globalThis.starts.push(copy) }\n'

// The wrapper loader on the script, with the reinject runtime a dev session
// adds, then a real bundle of what it returned.
async function bundled(
  source: string,
  mode: 'development' | 'production',
  runAt = 'document_idle'
) {
  const root = fs.realpathSync(tempFolder('extjs-pending-await-'))

  const at = (...parts: string[]) => path.join(root, ...parts)

  fs.mkdirSync(at('content'))
  fs.writeFileSync(at('package.json'), '{"name":"fixture"}\n')
  fs.writeFileSync(at('content', 'started.js'), STARTED)
  fs.writeFileSync(at('content', 'main.js'), source)
  fs.writeFileSync(
    at('manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'pending-await',
      version: '1.0.0',
      content_scripts: [
        {matches: ['<all_urls>'], js: ['content/main.js'], run_at: runAt}
      ]
    })
  )

  const wrapped = String(
    contentScriptWrapper.call(
      {
        resourcePath: at('content', 'main.js'),
        emitWarning() {},
        getOptions: () => ({
          manifestPath: at('manifest.json'),
          mode,
          extensions: wrapsForDevSession(mode, undefined)
            ? [contentScriptReinject]
            : []
        })
      } as any,
      source
    )
  )

  fs.writeFileSync(at('content', 'wrapped.js'), wrapped)

  const errors = await new Promise<string[]>((resolve, reject) => {
    const compiler = rspack({
      context: root,
      mode: 'production',
      devtool: false,
      entry: {wrapped: at('content', 'wrapped.js')},
      output: {path: at('dist')}
    })

    compiler.run((error, stats) => {
      compiler.close(() => {
        if (error) reject(error)
        else resolve((stats?.compilation.errors || []).map((e) => e.message))
      })
    })
  })

  expect(errors).toEqual([])

  return fs.readFileSync(at('dist', 'wrapped.js'), 'utf8')
}

interface Gate {
  opened: Promise<void>
  open: () => void
}

function gate(): Gate {
  let open = () => {}

  const opened = new Promise<void>((resolve) => {
    open = resolve
  })

  return {opened, open}
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 20))

// One page whose world outlives each injection, as a tab does in a session.
function page() {
  const world: Record<string, unknown> = {
    gates: [gate(), gate(), gate()],
    live: [] as number[],
    starts: [] as number[],
    document: {
      readyState: 'complete',
      addEventListener() {},
      removeEventListener() {},
      querySelectorAll: () => []
    },
    console: {log() {}, warn() {}, error() {}},
    setTimeout,
    clearTimeout,
    queueMicrotask
  }
  world.globalThis = world
  world.window = world
  world.self = world
  vm.createContext(world)

  return {
    world: world as {gates: Gate[]; live: number[]; starts: number[]},
    inject: (bundle: string) => vm.runInContext(bundle, world)
  }
}

describe('a content script injected again while its top-level await is pending', () => {
  it('mounts the newest copy alone when the waiting copy finishes first', async () => {
    const bundle = await bundled(MOUNTS_AFTER_AWAIT, 'development')
    const {world, inject} = page()

    inject(bundle)
    inject(bundle)
    await settled()

    expect(world.live).toEqual([])

    world.gates[0].open()
    await settled()
    world.gates[1].open()
    await settled()

    expect(world.live).toEqual([2])
  }, 120000)

  it('mounts the newest copy alone when the waiting copy finishes last', async () => {
    const bundle = await bundled(MOUNTS_AFTER_AWAIT, 'development')
    const {world, inject} = page()

    inject(bundle)
    inject(bundle)
    world.gates[1].open()
    await settled()

    expect(world.live).toEqual([2])

    world.gates[0].open()
    await settled()

    expect(world.live).toEqual([2])
  }, 120000)

  it('cleans the newest copy on the injection after it', async () => {
    const bundle = await bundled(MOUNTS_AFTER_AWAIT, 'development')
    const {world, inject} = page()

    inject(bundle)
    inject(bundle)
    world.gates[0].open()
    world.gates[1].open()
    await settled()
    inject(bundle)
    world.gates[2].open()
    await settled()

    expect(world.live).toEqual([3])
  }, 120000)

  it('runs the cleanups a waiting copy with no default export registered', async () => {
    const bundle = await bundled(STARTS_ITSELF, 'development')
    const {world, inject} = page()

    inject(bundle)
    await settled()

    expect(world.live).toEqual([1])

    inject(bundle)
    await settled()

    expect(world.starts).toEqual([1, 2])
    expect(world.live).toEqual([2])

    world.gates[0].open()
    world.gates[1].open()
    await settled()
    inject(bundle)
    await settled()

    expect(world.live).toEqual([3])
  }, 120000)
})

describe('a content script that awaits before it mounts', () => {
  it('mounts a document_start script only once the await ends', async () => {
    const bundle = await bundled(
      MOUNTS_AFTER_AWAIT,
      'production',
      'document_start'
    )
    const {world, inject} = page()

    inject(bundle)
    await settled()

    expect(world.live).toEqual([])

    world.gates[0].open()
    await settled()

    expect(world.live).toEqual([1])
  }, 120000)
})

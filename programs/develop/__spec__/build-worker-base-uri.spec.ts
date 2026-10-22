import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vm from 'node:vm'
import {afterAll, describe, expect, it} from 'vitest'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

// A module service worker whose bundle builds a worker URL: the bundler
// resolves that URL against its base URI runtime, which used to read
// document.baseURI on start and killed the worker before the first
// listener, and then gave an undefined base the URL could not use.
const SERVICE_WORKER = [
  'let worker = null',
  'function scanner() {',
  "  if (!worker) worker = new Worker(new URL('./scan.js', import.meta.url), {type: 'module'})",
  '  return worker',
  '}',
  'chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {',
  '  scanner().postMessage(message)',
  '  sendResponse({ok: true})',
  '  return true',
  '})',
  'globalThis.probe = {ready: true}',
  ''
].join('\n')

function project(background: Record<string, unknown>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-worker-base-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'worker-base', version: '0.0.0'})
  )

  fs.writeFileSync(path.join(root, 'background.js'), SERVICE_WORKER)
  fs.writeFileSync(
    path.join(root, 'scan.js'),
    'self.onmessage = (event) => self.postMessage({seen: event.data})\n'
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'worker-base',
      version: '1.0.0',
      background
    })
  )

  return root
}

async function build(root: string, mode: 'development' | 'production') {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'

  try {
    const summary = await extensionBuild(root, {
      browser: 'chrome',
      mode,
      silent: true,
      install: false,
      exitOnError: false
    } as any)
    expect(summary.errors_count).toBe(0)
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }

  return fs.readFileSync(
    path.join(root, 'dist', 'chrome', 'background', 'service_worker.js'),
    'utf8'
  )
}

// Runs the emitted worker the way Chrome starts it: no document, an
// extension runtime, a location, and a Worker constructor that records
// the URL it was given. Then delivers one message to the listener.
function startAsWorker(script: string) {
  const spawned: string[] = []
  const listeners: Array<(...args: unknown[]) => unknown> = []
  const root = 'chrome-extension://abcdefghijklmnop/'
  const self: Record<string, unknown> = {
    location: new URL(`${root}background/service_worker.js`),
    importScripts: () => {
      throw new TypeError('Module scripts do not support importScripts')
    }
  }
  const sandbox: Record<string, unknown> = {
    self,
    chrome: {
      runtime: {
        getURL: (p: string) => `${root}${String(p).replace(/^\/+/, '')}`,
        onMessage: {
          addListener: (fn: (...args: unknown[]) => unknown) =>
            listeners.push(fn)
        }
      }
    },
    Worker: class {
      constructor(url: URL | string) {
        spawned.push(String(url))
      }
      postMessage() {}
    },
    URL,
    console
  }
  sandbox.globalThis = sandbox

  try {
    vm.runInNewContext(script, sandbox, {filename: 'service_worker.js'})
  } catch (error) {
    throw new Error(`${(error as Error).message}\n${script.slice(0, 4000)}`)
  }

  const probe = sandbox.probe as {ready?: boolean} | undefined
  for (const listener of listeners) listener({ping: 1}, {}, () => undefined)

  return {spawned, probe}
}

describe('a worker entry resolves URLs without reading document', () => {
  it.each([
    'development',
    'production'
  ] as const)('a module service worker built in %s mode starts and spawns its worker from the extension root', async (mode) => {
    const script = await build(
      project({service_worker: 'background.js', type: 'module'}),
      mode
    )

    expect(script).not.toContain('document.baseURI || self.location.href')

    const started = startAsWorker(script)
    expect(started.probe).toEqual({ready: true})
    expect(started.spawned).toHaveLength(1)
    expect(started.spawned[0]).toMatch(
      /^chrome-extension:\/\/abcdefghijklmnop\/.*\.js$/
    )
  }, 180_000)

  it('a classic service worker keeps starting too', async () => {
    const script = await build(
      project({service_worker: 'background.js'}),
      'development'
    )

    const started = startAsWorker(script)
    expect(started.probe).toEqual({ready: true})
    expect(started.spawned).toHaveLength(1)
  }, 180_000)
})

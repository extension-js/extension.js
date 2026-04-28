// Classifier spec for `BrowsersPlugin.apply`.
//
// This is the test that would have caught the April 2026 regression, where
// `Object.keys(compilation.assets)` was used to classify the reload type.
// Because `compilation.assets` always contains a persistent
// `background/service_worker.js`, every incremental build was classified as
// `service-worker`, and content-script hot reload silently never ran.
//
// The spec drives the real `BrowsersPlugin` against a fake rspack `Compiler`
// and captures the `ReloadInstruction` passed to the injected launcher's
// `controller.reload()`. No browser, no timers — pure logic.

import {afterEach, describe, expect, it, vi} from 'vitest'
import * as path from 'path'
import {
  BrowsersPlugin,
  type BrowserController,
  type ReloadInstruction
} from '../index'

// -----------------------------------------------------------------------------
// Fake Compiler harness
// -----------------------------------------------------------------------------

interface Harness {
  plugin: BrowsersPlugin
  compiler: any
  reload: ReturnType<typeof vi.fn>
  controller: BrowserController
  triggerWatchRun(modifiedFiles: string[]): void
  triggerDone(options?: {
    manifest?: Record<string, unknown>
    errors?: any[]
  }): Promise<void>
  /** The ReloadInstruction passed to the most recent `controller.reload(...)` call. */
  lastReload(): ReloadInstruction | undefined
}

const CONTEXT = '/tmp/ext'
const OUTPUT = '/tmp/ext/dist/chromium'

function createHarness(manifestContentScripts: number = 1): Harness {
  const reload = vi.fn().mockResolvedValue(undefined)
  const controller: BrowserController = {
    reload,
    enableUnifiedLogging: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined)
  }

  const plugin = new BrowsersPlugin({
    launcher: vi.fn().mockResolvedValue(controller),
    browserOptions: {browser: 'chromium'} as any
  })
  plugin.extensionsToLoad = [OUTPUT]
  // Swallow emitted `error` events — Node's EventEmitter throws on
  // unhandled `error`. Tests assert reload.mock, not emitter events.
  plugin.emitter.on('error', () => {})

  let watchRunCb: (() => void) | undefined
  let doneCb: ((stats: any) => Promise<void>) | undefined

  const compiler: any = {
    options: {context: CONTEXT},
    modifiedFiles: undefined as ReadonlySet<string> | undefined,
    hooks: {
      watchRun: {tap: (_: string, fn: () => void) => (watchRunCb = fn)},
      done: {
        tapPromise: (_: string, fn: (s: any) => Promise<void>) => (doneCb = fn)
      }
    }
  }

  plugin.apply(compiler)

  const buildManifest = (count: number) =>
    JSON.stringify({
      manifest_version: 3,
      name: 'fake',
      version: '0',
      content_scripts: Array.from({length: count}, (_, i) => ({
        matches: ['https://example.com/*'],
        js: [`content/script-${i}.js`]
      }))
    })

  return {
    plugin,
    compiler,
    reload,
    controller,
    triggerWatchRun(modifiedFiles: string[]) {
      compiler.modifiedFiles = new Set(
        modifiedFiles.map((f) => path.join(CONTEXT, f))
      )
      if (!watchRunCb) throw new Error('watchRun not tapped')
      watchRunCb()
    },
    async triggerDone(opts = {}) {
      if (!doneCb) throw new Error('done not tapped')
      const manifestSource = buildManifest(
        opts.manifest
          ? ((opts.manifest.content_scripts as any[])?.length ?? 0)
          : manifestContentScripts
      )
      const stats = {
        compilation: {
          errors: opts.errors || [],
          options: {context: CONTEXT, output: {path: OUTPUT}},
          // Simulate the always-present emitted assets. This is what misled
          // the old classifier — a service_worker asset is ALWAYS here.
          assets: {
            'manifest.json': {},
            'background/service_worker.js': {},
            'content_scripts/content-0.abc12345.js': {}
          },
          getAsset: (name: string) =>
            name === 'manifest.json'
              ? {source: {source: () => manifestSource}}
              : undefined
        }
      }
      await doneCb(stats)
    },
    lastReload() {
      const calls = reload.mock.calls
      if (calls.length === 0) return undefined
      return calls[calls.length - 1][0] as ReloadInstruction | undefined
    }
  }
}

async function primeFirstCompile(h: Harness) {
  // First compile launches the browser and sets isFirstCompile=false.
  // No reloadInstruction is emitted for the first compile.
  await h.triggerDone()
  expect(h.reload).not.toHaveBeenCalled()
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe('BrowsersPlugin classifier', () => {
  afterEach(() => vi.clearAllMocks())

  it('classifies a content-script source change as "content-scripts"', async () => {
    const h = createHarness(1)
    await primeFirstCompile(h)

    h.triggerWatchRun(['src/content/ContentApp.tsx'])
    await h.triggerDone()

    const instruction = h.lastReload()
    expect(instruction?.type).toBe('content-scripts')
    // Must pass canonical entry names so selectContentScriptRules can resolve
    // rules from the manifest. Hashed asset filenames silently don't resolve.
    expect(instruction?.changedContentScriptEntries).toEqual([
      'content_scripts/content-0'
    ])
  })

  it('classifies a background source change as "service-worker"', async () => {
    const h = createHarness(1)
    await primeFirstCompile(h)

    h.triggerWatchRun(['src/background.ts'])
    await h.triggerDone()

    expect(h.lastReload()?.type).toBe('service-worker')
  })

  it('classifies a service-worker.ts source change as "service-worker"', async () => {
    const h = createHarness(1)
    await primeFirstCompile(h)

    h.triggerWatchRun(['src/worker/service-worker.ts'])
    await h.triggerDone()

    expect(h.lastReload()?.type).toBe('service-worker')
  })

  it('classifies a manifest edit as "full"', async () => {
    const h = createHarness(1)
    await primeFirstCompile(h)

    h.triggerWatchRun(['src/manifest.json'])
    await h.triggerDone()

    expect(h.lastReload()?.type).toBe('full')
  })

  it('classifies a _locales edit as "full"', async () => {
    const h = createHarness(1)
    await primeFirstCompile(h)

    h.triggerWatchRun(['src/_locales/en/messages.json'])
    await h.triggerDone()

    expect(h.lastReload()?.type).toBe('full')
  })

  it('background + content change prefers "service-worker" (widest blast radius wins)', async () => {
    const h = createHarness(1)
    await primeFirstCompile(h)

    h.triggerWatchRun(['src/background.ts', 'src/content/ContentApp.tsx'])
    await h.triggerDone()

    expect(h.lastReload()?.type).toBe('service-worker')
  })

  it('emits ALL canonical content-script entries when the manifest declares multiple', async () => {
    const h = createHarness(3)
    await primeFirstCompile(h)

    h.triggerWatchRun(['src/content/ContentApp.tsx'])
    await h.triggerDone()

    const instruction = h.lastReload()
    expect(instruction?.type).toBe('content-scripts')
    expect(instruction?.changedContentScriptEntries).toEqual([
      'content_scripts/content-0',
      'content_scripts/content-1',
      'content_scripts/content-2'
    ])
  })

  it('does not emit a reload instruction when no files changed', async () => {
    const h = createHarness(1)
    await primeFirstCompile(h)

    h.triggerWatchRun([])
    await h.triggerDone()

    // modifiedFiles was empty, so controller.reload must NOT be called
    expect(h.reload).not.toHaveBeenCalled()
  })

  it('does not emit a reload instruction when compilation has errors', async () => {
    const h = createHarness(1)
    await primeFirstCompile(h)

    h.triggerWatchRun(['src/content/ContentApp.tsx'])
    await h.triggerDone({errors: [new Error('boom')]})

    expect(h.reload).not.toHaveBeenCalled()
  })

  it('skips classification on the first compile (controller not yet live)', async () => {
    const h = createHarness(1)
    // First compile with modifiedFiles set should not trigger a reload —
    // the controller hasn't been created yet, that's this compile's job.
    h.triggerWatchRun(['src/content/ContentApp.tsx'])
    await h.triggerDone()

    expect(h.reload).not.toHaveBeenCalled()
  })
})

describe('BuildEmitter', () => {
  it('emit("error") does not throw when no listener is attached', async () => {
    // Regression: BuildEmitter inherits EventEmitter, which throws
    // ERR_UNHANDLED_ERROR when 'error' is emitted with no listener. The
    // CLI awaits extensionDev() but doesn't subscribe to 'error', so a
    // single rspack compile failure (e.g. user typo in a content script)
    // would crash the dev process via uncaughtException + cleanup.exit().
    // BuildEmitter installs a default no-op 'error' listener at construction
    // so build errors stay informational and the file watcher keeps
    // running, allowing the user to fix the source and recover on the
    // next save.
    const {BuildEmitter} = await import('../index')
    const emitter = new BuildEmitter()
    expect(() => emitter.emit('error', {errors: ['boom']})).not.toThrow()
  })

  it('user-installed error listeners still fire alongside the default', async () => {
    const {BuildEmitter} = await import('../index')
    const emitter = new BuildEmitter()
    const seen: string[][] = []
    emitter.on('error', (event) => seen.push([...event.errors]))
    emitter.emit('error', {errors: ['boom']})
    emitter.emit('error', {errors: ['second', 'third']})
    expect(seen).toEqual([['boom'], ['second', 'third']])
  })
})

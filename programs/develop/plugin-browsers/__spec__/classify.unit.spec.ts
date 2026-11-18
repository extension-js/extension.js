import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import type {ReloadInstruction} from '../../plugin-reload'
import {BrowsersPlugin, BuildEmitter} from '../index'
import {fakeCompilation, fakeCompiler} from './fake-compiler'

interface Harness {
  reload: ReturnType<typeof vi.fn>
  triggerWatchRun(modifiedFiles: string[]): void
  triggerDone(options?: {
    contentScripts?: number
    errors?: unknown[]
    writtenAssets?: string[]
  }): Promise<void>
  lastReload(): ReloadInstruction | undefined
}

const CONTEXT = '/tmp/ext'
const OUTPUT = '/tmp/ext/dist/chromium'

beforeEach(() => {
  expect.hasAssertions()
})

function createHarness(manifestContentScripts: number = 1): Harness {
  const reload = vi.fn()
  const plugin = new BrowsersPlugin({
    launcher: vi.fn().mockResolvedValue({
      enableUnifiedLogging: vi.fn().mockResolvedValue(undefined)
    }),
    browserOptions: {browser: 'chromium'}
  })
  plugin.extensionsToLoad = [OUTPUT]
  plugin.emitter.on('compiled', (ev) => {
    if (ev.reloadInstruction) reload(ev.reloadInstruction)
  })

  const fake = fakeCompiler({owner: BrowsersPlugin.name, context: CONTEXT})
  plugin.apply(fake.compiler)

  const manifest = (count: number) => ({
    manifest_version: 3,
    name: 'fake',
    version: '0',
    content_scripts: Array.from({length: count}, (_, i) => ({
      matches: ['https://example.com/*'],
      js: [`content/script-${i}.js`]
    }))
  })

  return {
    reload,
    triggerWatchRun: (modifiedFiles) => fake.watchRun(modifiedFiles),
    async triggerDone(opts = {}) {
      for (const file of opts.writtenAssets || []) fake.emitAsset(file)

      await fake.done({
        ...fakeCompilation({
          context: CONTEXT,
          output: OUTPUT,
          manifest: manifest(opts.contentScripts ?? manifestContentScripts),
          errors: opts.errors
        }),
        assets: {
          'manifest.json': {},
          'background/service_worker.js': {},
          'content_scripts/content-0.abc12345.js': {}
        }
      })
    },
    lastReload() {
      const calls = reload.mock.calls
      if (calls.length === 0) return undefined

      return calls[calls.length - 1][0] as ReloadInstruction | undefined
    }
  }
}

async function primeFirstCompile(h: Harness) {
  await h.triggerDone()
  expect(h.reload).not.toHaveBeenCalled()
}

describe('BrowsersPlugin classifier', () => {
  afterEach(() => vi.clearAllMocks())

  it('classifies a content-script source change as "content-scripts"', async () => {
    const h = createHarness(1)
    await primeFirstCompile(h)

    h.triggerWatchRun(['src/content/ContentApp.tsx'])
    await h.triggerDone()

    const instruction = h.lastReload()
    expect(instruction?.type).toBe('content-scripts')
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

  it('forwards changedAssets on a "full" reload', async () => {
    const h = createHarness(1)
    await primeFirstCompile(h)

    h.triggerWatchRun(['src/manifest.json'])
    await h.triggerDone()

    const instruction = h.lastReload()
    expect(instruction?.type).toBe('full')
    expect(instruction?.changedAssets).toEqual(['src/manifest.json'])
  })

  it('classifies a _locales edit as "full"', async () => {
    const h = createHarness(1)
    await primeFirstCompile(h)

    h.triggerWatchRun(['src/_locales/en/messages.json'])
    await h.triggerDone()

    expect(h.lastReload()?.type).toBe('full')
  })

  it('classifies a project-root _locales edit as "full"', async () => {
    const h = createHarness(1)
    await primeFirstCompile(h)

    h.triggerWatchRun(['_locales/en/messages.json'])
    await h.triggerDone()

    const instruction = h.lastReload()
    expect(instruction?.type).toBe('full')
    expect(instruction?.changedAssets).toEqual(['_locales/en/messages.json'])
  })

  it('emits a notify-only "page" instruction when a non-content-script project edits a page asset', async () => {
    const h = createHarness(0)
    await primeFirstCompile(h)

    h.triggerWatchRun(['src/action/scripts.js'])
    await h.triggerDone()

    const instruction = h.lastReload()
    expect(instruction?.type).toBe('page')
    expect(instruction?.label).toBe('popup page (src/action/scripts.js)')
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

    expect(h.reload).not.toHaveBeenCalled()
  })

  it('does not emit a reload instruction when compilation has errors', async () => {
    const h = createHarness(1)
    await primeFirstCompile(h)

    h.triggerWatchRun(['src/content/ContentApp.tsx'])
    await h.triggerDone({errors: [new Error('boom')]})

    expect(h.reload).not.toHaveBeenCalled()
  })

  it('after a failed compile, a later success reloads every held change', async () => {
    const h = createHarness(1)
    await primeFirstCompile(h)

    h.triggerWatchRun(['src/manifest.json', 'src/background.ts'])
    await h.triggerDone({errors: [new Error('typo in background')]})
    expect(h.reload).not.toHaveBeenCalled()

    h.triggerWatchRun(['src/background.ts'])
    await h.triggerDone()

    const instruction = h.lastReload()
    expect(instruction?.type).toBe('full')
    expect(instruction?.changedAssets).toEqual([
      'src/background.ts',
      'src/manifest.json'
    ])
  })

  it('after a failed compile, a success with no new files still reloads held changes', async () => {
    const h = createHarness(1)
    await primeFirstCompile(h)

    h.triggerWatchRun(['src/content/ContentApp.tsx'])
    await h.triggerDone({errors: [new Error('boom')]})

    h.triggerWatchRun([])
    await h.triggerDone()

    expect(h.lastReload()?.type).toBe('content-scripts')
    expect(h.lastReload()?.changedAssets).toEqual([
      'src/content/ContentApp.tsx'
    ])
  })

  it('after a failed compile, reloads for assets the success actually wrote', async () => {
    const h = createHarness(1)
    await primeFirstCompile(h)

    h.triggerWatchRun(['src/background.ts'])
    await h.triggerDone({errors: [new Error('typo')]})

    h.triggerWatchRun(['src/background.ts'])
    await h.triggerDone({
      writtenAssets: ['background/service_worker.js', 'manifest.json']
    })

    const instruction = h.lastReload()
    expect(instruction?.type).toBe('full')
    expect(instruction?.changedAssets).toEqual([
      'src/background.ts',
      'background/service_worker.js',
      'manifest.json'
    ])
  })

  it('skips classification on the first compile (controller not yet live)', async () => {
    const h = createHarness(1)
    h.triggerWatchRun(['src/content/ContentApp.tsx'])
    await h.triggerDone()

    expect(h.reload).not.toHaveBeenCalled()
  })
})

describe('BuildEmitter', () => {
  it('emit("error") does not throw when no listener is attached', () => {
    const emitter = new BuildEmitter()
    expect(() => emitter.emit('error', {errors: ['boom']})).not.toThrow()
  })

  it('user-installed error listeners still fire alongside the default', () => {
    const emitter = new BuildEmitter()
    const seen: string[][] = []
    emitter.on('error', (event) => seen.push([...event.errors]))
    emitter.emit('error', {errors: ['boom']})
    emitter.emit('error', {errors: ['second', 'third']})
    expect(seen).toEqual([['boom'], ['second', 'third']])
  })
})

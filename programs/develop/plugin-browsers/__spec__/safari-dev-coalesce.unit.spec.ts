import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {classifyReloadFromSources, type ReloadBroker} from '../../plugin-reload'
import {
  reloadSurvivingPackage,
  SafariDevPlugin,
  type SafariPackagerFn
} from '../safari-dev-plugin'
import {fakeCompilation, fakeCompiler} from './fake-compiler'

beforeEach(() => {
  expect.hasAssertions()
})

const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

type Call = {
  distPath: string
  mode: 'full' | 'resync'
  resolve: () => void
  reject: (error: unknown) => void
}

function makeDeferredPackager() {
  const calls: Call[] = []
  const fn: SafariPackagerFn = (distPath, mode) =>
    new Promise<void>((resolve, reject) => {
      calls.push({distPath, mode, resolve: () => resolve(), reject})
    })
  const callFor = (distPath: string) =>
    calls.find((c) => c.distPath === distPath)!
  const modes = () => calls.map((c) => `${c.mode}:${c.distPath}`)

  return {fn, calls, callFor, modes}
}

function makeCompiler(context = 'ctx') {
  const fake = fakeCompiler({owner: SafariDevPlugin.name, context})

  const trigger = (
    outputPath: string,
    opts?: {
      errors?: unknown[]
      // Project-relative saves that started this rebuild.
      changedFiles?: string[]
      // The classifier reads the emitted manifest to count content scripts, so
      // a content edit only classifies as one when the build declares them.
      contentScripts?: number
    }
  ) => {
    if (opts?.changedFiles) fake.watchRun(opts.changedFiles)

    return fake.done(
      fakeCompilation({
        context,
        output: outputPath,
        errors: opts?.errors,
        manifest: {
          content_scripts: Array.from(
            {length: opts?.contentScripts || 0},
            () => ({js: ['content.js']})
          )
        }
      })
    )
  }

  return {compiler: fake.compiler, trigger}
}

function makeBroker() {
  const sent: Array<{
    type: string
    label?: string
    entries?: string[]
  }> = []
  const broker: ReloadBroker = {
    broadcastReload: (instruction) => {
      sent.push({
        type: instruction.type,
        label: instruction.label,
        entries: instruction.changedContentScriptEntries
      })

      return 1
    }
  }

  return {broker, sent}
}

function harness(broker?: ReloadBroker, context?: string) {
  const pkg = makeDeferredPackager()
  const plugin = new SafariDevPlugin(pkg.fn)
  if (broker) plugin.setReloadBroker(broker)

  const {compiler, trigger} = makeCompiler(context)
  plugin.apply(compiler)
  const compiled: Array<{isFirstCompile: boolean; outputPath: string}> = []
  const errors: Array<{errors: string[]}> = []
  plugin.emitter.on('compiled', (e) => compiled.push(e as never))
  plugin.emitter.on('error', (e) => errors.push(e as never))

  return {plugin, trigger, compiled, errors, ...pkg}
}

async function settleFirst(h: ReturnType<typeof harness>, out = '/init') {
  const p = h.trigger(out)
  await flush()
  h.callFor(out).resolve()
  await p
}

describe('SafariDevPlugin watch-loop coalescing', () => {
  it('first compile does a full package and blocks the hook until it finishes', async () => {
    const h = harness()
    const p = h.trigger('/out1')
    await flush()
    expect(h.modes()).toEqual(['full:/out1'])

    let hookSettled = false
    void p.then(() => (hookSettled = true))
    await flush()
    expect(hookSettled).toBe(false)

    h.callFor('/out1').resolve()
    await p
    expect(h.compiled).toEqual([
      {outputPath: '/out1', contextDir: 'ctx', isFirstCompile: true}
    ])
  })

  it('a quiet second save resyncs in the background', async () => {
    const h = harness()
    await settleFirst(h)
    const p = h.trigger('/out2')
    await p
    expect(h.modes()).toEqual(['full:/init', 'resync:/out2'])
    h.callFor('/out2').resolve()
    await h.plugin.idle()
    expect(h.compiled[1].isFirstCompile).toBe(false)
  })

  it('a burst v2,v3,v4 collapses to a single v4 follow-up', async () => {
    const h = harness()
    await settleFirst(h)
    await h.trigger('/v2')
    const idle = h.plugin.idle()
    await h.trigger('/v3')
    await h.trigger('/v4')
    h.callFor('/v2').resolve()
    await flush()
    h.callFor('/v4').resolve()
    await idle
    expect(h.modes()).toEqual(['full:/init', 'resync:/v2', 'resync:/v4'])
  })

  it('does not run a follow-up without a new compile', async () => {
    const h = harness()
    await settleFirst(h)
    await h.trigger('/v2')
    h.callFor('/v2').resolve()
    await h.plugin.idle()
    expect(h.modes()).toEqual(['full:/init', 'resync:/v2'])
  })

  it('surfaces a first-compile failure and emits no compiled event', async () => {
    const h = harness()
    const p = h.trigger('/out1')
    await flush()
    h.callFor('/out1').reject(new Error('boom'))
    await p
    expect(h.errors).toEqual([{errors: ['boom']}])
    expect(h.compiled).toHaveLength(0)
  })

  it('retries the full flow after a failed first package', async () => {
    const h = harness()
    const p1 = h.trigger('/out1')
    await flush()
    h.callFor('/out1').reject(new Error('boom'))
    await p1
    const p2 = h.trigger('/out1b')
    await flush()
    expect(h.modes()).toEqual(['full:/out1', 'full:/out1b'])
    h.callFor('/out1b').resolve()
    await p2
    expect(h.compiled[0].isFirstCompile).toBe(true)
  })

  it('tells the ready listener once, after the first package that worked', async () => {
    const h = harness()
    const listener = vi.fn()
    h.plugin.setReadyListener(listener)

    const p1 = h.trigger('/out1')
    await flush()
    h.callFor('/out1').reject(new Error('boom'))
    await p1
    expect(listener).not.toHaveBeenCalled()

    const p2 = h.trigger('/out1b')
    await flush()
    h.callFor('/out1b').resolve()
    await p2
    expect(listener).toHaveBeenCalledTimes(1)

    void h.trigger('/v2')
    await flush()
    h.callFor('/v2').resolve()
    await h.plugin.idle()
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('a mid-burst failure emits an error AND still runs the pending follow-up', async () => {
    const h = harness()
    await settleFirst(h)
    await h.trigger('/v2')
    const idle = h.plugin.idle()
    await h.trigger('/v3')
    h.callFor('/v2').reject(new Error('midfail'))
    await flush()
    expect(h.errors).toContainEqual({errors: ['midfail']})
    expect(h.modes()).toEqual(['full:/init', 'resync:/v2', 'resync:/v3'])
    h.callFor('/v3').resolve()
    await idle
  })

  it('does not enter packaging state on bundler compile errors', async () => {
    const h = harness()
    await h.trigger('/x', {errors: ['compile broke']})
    expect(h.errors).toEqual([{errors: ['compile broke']}])
    expect(h.calls).toHaveLength(0)
    const p = h.trigger('/y')
    await flush()
    expect(h.modes()).toEqual(['full:/y'])
    h.callFor('/y').resolve()
    await p
  })

  it('idle() resolves immediately when nothing is in flight', async () => {
    const h = harness()
    let resolved = false
    void h.plugin.idle().then(() => (resolved = true))
    await flush()
    expect(resolved).toBe(true)
  })

  it('idle() waits for the burst lifecycle to finish', async () => {
    const h = harness()
    await settleFirst(h)
    await h.trigger('/v2')
    let resolved = false
    void h.plugin.idle().then(() => (resolved = true))
    await flush()
    expect(resolved).toBe(false)
    h.callFor('/v2').resolve()
    await flush()
    expect(resolved).toBe(true)
  })
})

// A manifest edit is the one change that always classifies as a full reload,
// so these cover the seam itself rather than the classifier.
const MANIFEST_EDIT = {changedFiles: ['manifest.json']}
// A content edit is the one kind that survives the package, since a restart
// does not re-inject content scripts into tabs that are already open.
const CONTENT_EDIT = {
  changedFiles: ['src/content/scripts.js'],
  contentScripts: 1
}
const BACKGROUND_EDIT = {changedFiles: ['src/background.js']}

describe('SafariDevPlugin reload seam', () => {
  it('reloads only after the package that replaced the appex', async () => {
    const {broker, sent} = makeBroker()
    const h = harness(broker)
    await settleFirst(h)

    const p = h.trigger('/out2', MANIFEST_EDIT)
    await flush()
    // The package is still running, so nothing has replaced the bytes yet.
    expect(sent).toEqual([])

    h.callFor('/out2').resolve()
    await p
    await flush()
    // A manifest edit is a full reload everywhere else. Here the package
    // already restarted the extension with it, so nothing is sent.
    expect(sent).toEqual([])
  })

  it('stays silent on the first package, which is the state Safari loads', async () => {
    const {broker, sent} = makeBroker()
    const h = harness(broker)
    await settleFirst(h, '/init')
    expect(sent).toEqual([])
  })

  it('stays silent when the package failed', async () => {
    const {broker, sent} = makeBroker()
    const h = harness(broker)
    await settleFirst(h)

    const p = h.trigger('/broken', MANIFEST_EDIT)
    await flush()
    h.callFor('/broken').reject(new Error('xcodebuild failed'))
    await p
    await flush()

    expect(sent).toEqual([])
    expect(h.errors).toHaveLength(1)
  })

  it('reloads once per package when a burst collapses', async () => {
    const {broker, sent} = makeBroker()
    const h = harness(broker)
    await settleFirst(h)

    const p2 = h.trigger('/v2', CONTENT_EDIT)
    await flush()
    void h.trigger('/v3', CONTENT_EDIT)
    void h.trigger('/v4', CONTENT_EDIT)
    await flush()

    h.callFor('/v2').resolve()
    await p2
    await flush()
    h.callFor('/v4').resolve()
    await flush()

    // Two packages ran (v2, then the collapsed v4), so two reloads went out.
    expect(h.modes()).toEqual(['full:/init', 'resync:/v2', 'resync:/v4'])
    expect(sent).toHaveLength(2)
    expect(sent.every((s) => s.type === 'content-scripts')).toBe(true)
  })

  it('packages normally with no broker attached', async () => {
    const h = harness()
    await settleFirst(h)
    const p = h.trigger('/out2', MANIFEST_EDIT)
    await flush()
    h.callFor('/out2').resolve()
    await p
    expect(h.modes()).toEqual(['full:/init', 'resync:/out2'])
  })
})

// Packaging replaces the appex under a running Safari, so the extension restarts
// and the save-driven dispatch lands with zero producers on purpose.
describe('SafariDevPlugin undelivered reload after a package', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function makeDetachedBroker(warning: string | null = null) {
    const asked: Array<{producerRestartExpected?: boolean} | undefined> = []
    const broker: ReloadBroker = {
      broadcastReload: () => 0,
      undeliveredReloadWarning: (context) => {
        asked.push(context)

        return warning
      }
    }

    return {broker, asked}
  }

  async function saveOnce(h: ReturnType<typeof harness>, out: string) {
    const p = h.trigger(out, CONTENT_EDIT)
    await flush()
    h.callFor(out).resolve()
    await p
    await flush()
  }

  it('declares the restart it caused and never warns about it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const {broker, asked} = makeDetachedBroker()
    const h = harness(broker)
    await settleFirst(h)

    await saveOnce(h, '/out2')

    expect(asked).toEqual([{producerRestartExpected: true}])
    expect(warn).not.toHaveBeenCalled()
    const lines = log.mock.calls.map((c) => String(c[0]))
    expect(lines.some((l) => l.includes('Queued'))).toBe(true)
    expect(lines.some((l) => l.includes('when it reconnects'))).toBe(true)
  })

  it('still surfaces a warning the broker considers real', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const {broker} = makeDetachedBroker('SW not attached, your edit compiled')
    const h = harness(broker)
    await settleFirst(h)

    await saveOnce(h, '/out2')

    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('SW not attached')
    expect(log).not.toHaveBeenCalled()
  })

  it('announces a normal reload when the producer survived', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const {broker, sent} = makeBroker()
    const h = harness(broker)
    await settleFirst(h)

    await saveOnce(h, '/out2')

    expect(sent).toHaveLength(1)
    expect(warn).not.toHaveBeenCalled()
    expect(String(log.mock.calls[0][0])).toContain('Reloading')
  })
})

// The package restarts the extension by itself, so the only reload still worth
// sending is the one a restart cannot deliver.
describe('reloadSurvivingPackage', () => {
  const CONTENT_ENTRY = 'content_scripts/content-0'

  it('drops a full reload, which would restart what just started', () => {
    expect(
      reloadSurvivingPackage({
        type: 'full',
        changedAssets: ['src/manifest.json'],
        label: 'extension (src/manifest.json)'
      })
    ).toBeUndefined()
  })

  it('drops a background-only service-worker reload', () => {
    expect(
      reloadSurvivingPackage({
        type: 'service-worker',
        changedAssets: ['src/background.js'],
        label: 'service_worker (src/background.js)'
      })
    ).toBeUndefined()
  })

  it('keeps a content-scripts reload untouched', () => {
    const instruction = {
      type: 'content-scripts' as const,
      changedContentScriptEntries: [CONTENT_ENTRY],
      changedAssets: ['src/content/scripts.js'],
      label: 'content_script (src/content/scripts.js)'
    }
    expect(reloadSurvivingPackage(instruction)).toEqual(instruction)
  })

  it('downgrades a shared background + content edit to its content half', () => {
    expect(
      reloadSurvivingPackage({
        type: 'service-worker',
        changedContentScriptEntries: [CONTENT_ENTRY],
        changedAssets: ['src/shared.ts'],
        label: 'service_worker + content_script (src/shared.ts)'
      })
    ).toEqual({
      type: 'content-scripts',
      changedContentScriptEntries: [CONTENT_ENTRY],
      changedAssets: ['src/shared.ts'],
      label: 'content_script (src/shared.ts)'
    })
  })

  it('keeps a notify-only page instruction, which restarts nothing', () => {
    const instruction = {
      type: 'page' as const,
      changedAssets: ['src/popup/index.js'],
      label: 'popup page (src/popup/index.js)'
    }
    expect(reloadSurvivingPackage(instruction)).toEqual(instruction)
  })

  it('is a no-op for no instruction', () => {
    expect(reloadSurvivingPackage(undefined)).toBeUndefined()
  })
})

describe('SafariDevPlugin reload trimming after a package', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function saveOnce(
    h: ReturnType<typeof harness>,
    out: string,
    edit: Record<string, unknown>
  ) {
    const p = h.trigger(out, edit as never)
    await flush()
    h.callFor(out).resolve()
    await p
    await flush()
  }

  it('sends nothing for a manifest edit: the package restarted the extension', async () => {
    const {broker, sent} = makeBroker()
    const h = harness(broker)
    await settleFirst(h)
    await saveOnce(h, '/out2', MANIFEST_EDIT)
    expect(sent).toEqual([])
  })

  it('sends nothing for a background edit, the restart already ran it', async () => {
    const {broker, sent} = makeBroker()
    const h = harness(broker)
    await settleFirst(h)
    await saveOnce(h, '/out2', BACKGROUND_EDIT)
    expect(sent).toEqual([])
  })

  it('still reloads content scripts, which a restart does not re-inject', async () => {
    const {broker, sent} = makeBroker()
    const h = harness(broker)
    await settleFirst(h)
    await saveOnce(h, '/out2', CONTENT_EDIT)
    expect(sent).toHaveLength(1)
    expect(sent[0].type).toBe('content-scripts')
    expect(sent[0].entries?.length).toBeGreaterThan(0)
  })

  it('keeps the content half of a burst that ends on a manifest edit', async () => {
    const {broker, sent} = makeBroker()
    const h = harness(broker)
    await settleFirst(h)

    const p2 = h.trigger('/v2', MANIFEST_EDIT)
    await flush()
    void h.trigger('/v3', CONTENT_EDIT)
    void h.trigger('/v4', MANIFEST_EDIT)
    await flush()

    h.callFor('/v2').resolve()
    await p2
    await flush()
    h.callFor('/v4').resolve()
    await flush()

    // The first package answers a manifest edit and sends nothing. The
    // collapsed follow-up still carries the content edit that rode along.
    expect(h.modes()).toEqual(['full:/init', 'resync:/v2', 'resync:/v4'])
    expect(sent).toHaveLength(1)
    expect(sent[0].type).toBe('content-scripts')
  })

  it('says nothing at all when the whole instruction is dropped', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const asked: unknown[] = []
    const broker: ReloadBroker = {
      broadcastReload: () => 0,
      undeliveredReloadWarning: (context) => {
        asked.push(context)

        return null
      }
    }
    const h = harness(broker)
    await settleFirst(h)

    await saveOnce(h, '/out2', BACKGROUND_EDIT)

    expect(asked).toEqual([])
    expect(warn).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
  })
})

describe('SafariDevPlugin failures and reloads it does not report', () => {
  const roots: string[] = []

  afterEach(() => {
    vi.restoreAllMocks()

    for (const root of roots.splice(0)) {
      fs.rmSync(root, {recursive: true, force: true})
    }
  })

  // Pins today's behavior. Ledger 1382 D3.
  it('prints nothing and never says ready when the first package throws an error of its own', async () => {
    const quiet = vi.fn()
    vi.spyOn(console, 'log').mockImplementation(quiet)
    vi.spyOn(console, 'warn').mockImplementation(quiet)
    vi.spyOn(console, 'error').mockImplementation(quiet)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => {
      quiet()

      return true
    })

    const ready = vi.fn()
    // Neither of the two failures the packager prints for itself (converter
    // and xcodebuild), so nothing on the way out names it.
    const plugin = new SafariDevPlugin(async () => {
      throw new Error("EACCES: permission denied, open 'Info.plist'")
    })
    plugin.setReadyListener(ready)
    const {compiler, trigger} = makeCompiler()
    plugin.apply(compiler)

    await trigger('/out1')

    expect(quiet).not.toHaveBeenCalled()
    expect(ready).not.toHaveBeenCalled()
    expect(plugin.emitter.listenerCount('error')).toBe(1)
  })

  // Pins today's behavior. Ledger 1382 D5.
  it('sends a copied page edit with no standalone page, so its open tabs are not refreshed', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-safari-page-'))
    roots.push(root)
    const output = path.join(root, 'dist')
    const page = '<!doctype html><title>options</title>\n'

    for (const dir of [root, output]) {
      fs.mkdirSync(path.join(dir, 'pages'), {recursive: true})
      fs.writeFileSync(path.join(dir, 'pages/options.html'), page)
    }

    const frames: Array<Record<string, unknown>> = []
    const pkg = makeDeferredPackager()
    const plugin = new SafariDevPlugin(pkg.fn)
    plugin.setReloadBroker({
      broadcastReload: (frame) => {
        frames.push({...frame})

        return 1
      }
    })

    const {compiler, trigger} = makeCompiler(root)
    plugin.apply(compiler)

    const first = trigger(output)
    await flush()
    pkg.callFor(output).resolve()
    await first

    pkg.calls.length = 0
    await trigger(output, {changedFiles: ['pages/options.html']})
    await flush()
    pkg.callFor(output).resolve()
    await plugin.idle()

    expect(frames).toEqual([
      {
        type: 'page',
        label: 'options page (pages/options.html)',
        changedContentScriptEntries: undefined,
        changedFiles: ['pages/options.html']
      }
    ])

    // The same edit names the page once the classifier is told the root.
    expect(
      classifyReloadFromSources({
        changedSources: ['pages/options.html'],
        getContentScriptCount: () => 0,
        outputPath: output,
        contextDir: root
      })?.standalonePages
    ).toEqual(['pages/options.html'])
  })
})

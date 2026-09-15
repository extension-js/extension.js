import {describe, expect, it} from 'vitest'
import type {ReloadBroker} from '../../plugin-reload'
import {SafariDevPlugin, type SafariPackagerFn} from '../safari-dev-plugin'

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

function makeCompiler() {
  let cb: (stats: unknown) => Promise<void>
  let watchRunCb: (() => void) | undefined
  let doneTapCb: ((stats: unknown) => void) | undefined
  // A watching compiler, so the changed-sources tracker the plugin builds has
  // the hooks it taps. Without changedFiles a trigger behaves as it always did.
  const compiler: {
    hooks: Record<string, unknown>
    options: {context: string}
    modifiedFiles?: Set<string>
  } = {
    hooks: {
      done: {
        tapPromise: (_n: string, f: typeof cb) => (cb = f),
        tap: (_n: string, f: (stats: unknown) => void) => (doneTapCb = f)
      },
      watchRun: {tap: (_n: string, f: () => void) => (watchRunCb = f)}
    },
    options: {context: 'ctx'}
  }
  const trigger = (
    outputPath: string,
    opts?: {errors?: unknown[]; changedFiles?: string[]}
  ) => {
    if (opts?.changedFiles) {
      compiler.modifiedFiles = new Set(opts.changedFiles)
      watchRunCb?.()
    }
    const stats = {
      compilation: {
        errors: opts?.errors || [],
        options: {output: {path: outputPath}, context: 'ctx'}
      }
    }
    doneTapCb?.(stats)
    return cb(stats)
  }
  return {compiler: compiler as never, trigger}
}

function makeBroker() {
  const sent: Array<{type: string; label?: string}> = []
  const broker: ReloadBroker = {
    broadcastReload: (instruction) => {
      sent.push({type: instruction.type, label: instruction.label})
      return 1
    }
  }
  return {broker, sent}
}

function harness(broker?: ReloadBroker) {
  const pkg = makeDeferredPackager()
  const plugin = new SafariDevPlugin(pkg.fn)
  if (broker) plugin.setReloadBroker(broker)
  const {compiler, trigger} = makeCompiler()
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
const MANIFEST_EDIT = {changedFiles: ['ctx/manifest.json']}

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
    expect(sent).toHaveLength(1)
    expect(sent[0].type).toBe('full')
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

    const p2 = h.trigger('/v2', MANIFEST_EDIT)
    await flush()
    void h.trigger('/v3', MANIFEST_EDIT)
    void h.trigger('/v4', MANIFEST_EDIT)
    await flush()

    h.callFor('/v2').resolve()
    await p2
    await flush()
    h.callFor('/v4').resolve()
    await flush()

    // Two packages ran (v2, then the collapsed v4), so two reloads went out.
    expect(h.modes()).toEqual(['full:/init', 'resync:/v2', 'resync:/v4'])
    expect(sent).toHaveLength(2)
    expect(sent.every((s) => s.type === 'full')).toBe(true)
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

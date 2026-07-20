import {describe, expect, it} from 'vitest'
import {SafariDevPlugin, type SafariPackagerFn} from '../safari-dev-plugin'

// Drains the microtask queue so the plugin's promise-based state machine can
// advance between assertions. No timers (the fake packager is deferred-promise).
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
  const compiler = {
    hooks: {done: {tapPromise: (_n: string, f: typeof cb) => (cb = f)}}
  }
  const trigger = (outputPath: string, opts?: {errors?: unknown[]}) =>
    cb({
      compilation: {
        errors: opts?.errors || [],
        options: {output: {path: outputPath}, context: 'ctx'}
      }
    })
  return {compiler: compiler as never, trigger}
}

function harness() {
  const pkg = makeDeferredPackager()
  const plugin = new SafariDevPlugin(pkg.fn)
  const {compiler, trigger} = makeCompiler()
  plugin.apply(compiler)
  const compiled: Array<{isFirstCompile: boolean; outputPath: string}> = []
  const errors: Array<{errors: string[]}> = []
  plugin.emitter.on('compiled', (e) => compiled.push(e as never))
  plugin.emitter.on('error', (e) => errors.push(e as never))
  return {plugin, trigger, compiled, errors, ...pkg}
}

// Run + resolve a clean first compile so the plugin is in steady (resync) state.
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
    expect(hookSettled).toBe(false) // still blocking on the packager

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
    await p // background hook returns immediately
    expect(h.modes()).toEqual(['full:/init', 'resync:/out2'])
    h.callFor('/out2').resolve()
    await h.plugin.idle()
    expect(h.compiled[1].isFirstCompile).toBe(false)
  })

  it('a burst v2,v3,v4 collapses to a single v4 follow-up', async () => {
    const h = harness()
    await settleFirst(h)
    await h.trigger('/v2') // starts the background run (packager in flight)
    const idle = h.plugin.idle()
    await h.trigger('/v3') // queued
    await h.trigger('/v4') // queued (overwrites v3)
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
    expect(h.modes()).toEqual(['full:/out1', 'full:/out1b']) // still full
    h.callFor('/out1b').resolve()
    await p2
    expect(h.compiled[0].isFirstCompile).toBe(true)
  })

  it('a mid-burst failure emits an error AND still runs the pending follow-up', async () => {
    const h = harness()
    await settleFirst(h)
    await h.trigger('/v2')
    const idle = h.plugin.idle()
    await h.trigger('/v3') // queued
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
    // firstRun untouched: the next clean compile is still a full package
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
    expect(resolved).toBe(false) // still packaging
    h.callFor('/v2').resolve()
    await flush()
    expect(resolved).toBe(true)
  })
})

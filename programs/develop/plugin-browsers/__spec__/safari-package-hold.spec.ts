import fs from 'node:fs'
import path from 'node:path'
import {type Compiler, rspack} from '@rspack/core'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {idleCompiler} from '../../__spec__/helpers/real-compiler'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import type {ReloadBroker} from '../../plugin-reload'
import type {SafariPackagerFn} from '../../types'
import {
  SAFARI_FIRST_PACKAGE_TIMEOUT_MS,
  SAFARI_RESYNC_TIMEOUT_MS,
  SafariDevPlugin
} from '../safari-dev-plugin'
import {fakeCompilation} from './fake-compiler'

const tempFolder = trackTempFolders()

beforeEach(() => {
  expect.hasAssertions()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// A packager whose every call ends only when the test says so.
function deferredPackager() {
  const calls: Array<{target: string; finish: () => void}> = []
  const fn: SafariPackagerFn = (distPath, mode) =>
    new Promise<void>((resolve) => {
      calls.push({target: `${mode}:${distPath}`, finish: () => resolve()})
    })

  return {fn, calls, targets: () => calls.map(({target}) => target)}
}

// The plugin on a real compiler that never runs, so each hook is the
// bundler's own and a test fires the ones a watch rebuild would.
function session(broker?: ReloadBroker) {
  const root = tempFolder('extjs-safari-hold-')
  const compiler = idleCompiler(root, 'development')
  const pkg = deferredPackager()
  const plugin = new SafariDevPlugin(pkg.fn)
  const failures: string[][] = []

  if (broker) plugin.setReloadBroker(broker)

  plugin.emitter.on('error', (event) => failures.push(event.errors))
  plugin.apply(compiler)

  // A watch rebuild starting after saves to these project-relative files.
  const starts = (files: string[] = []) => {
    compiler.modifiedFiles = new Set(files.map((file) => path.join(root, file)))

    return compiler.hooks.watchRun.promise(compiler)
  }

  const ends = (output: string, errors: unknown[] = []) =>
    compiler.hooks.done.promise({
      compilation: fakeCompilation({
        context: root,
        output,
        errors,
        manifest: {content_scripts: [{js: ['content.js']}]}
      })
    } as never)

  // The first package, then a resync the done hook stops waiting for.
  const hangResync = async (output: string) => {
    void ends('/init')
    await vi.advanceTimersByTimeAsync(0)
    pkg.calls[0].finish()
    await vi.advanceTimersByTimeAsync(0)

    await starts()
    void ends(output)
    await vi.advanceTimersByTimeAsync(SAFARI_RESYNC_TIMEOUT_MS)
  }

  const onCompiled = (listener: () => void) => {
    plugin.emitter.on('compiled', listener)
  }

  return {...pkg, starts, ends, hangResync, failures, onCompiled}
}

describe('a Safari package no done hook waits on', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('holds the next build until the follow-up package finished', async () => {
    const dev = session()
    await dev.hangResync('/out2')

    await dev.starts()
    await dev.ends('/out3')
    dev.calls[1].finish()
    await vi.advanceTimersByTimeAsync(0)

    expect(dev.targets()).toEqual([
      'full:/init',
      'resync:/out2',
      'resync:/out3'
    ])

    let buildStarted = false
    void dev.starts().then(() => {
      buildStarted = true
    })

    await vi.advanceTimersByTimeAsync(1000)
    expect(buildStarted).toBe(false)

    dev.calls[2].finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(buildStarted).toBe(true)
  })

  it('stops holding the next build at the bound of the follow-up', async () => {
    const dev = session()
    await dev.hangResync('/out2')

    await dev.starts()
    await dev.ends('/out3')
    dev.calls[1].finish()
    await vi.advanceTimersByTimeAsync(0)

    let buildStarted = false
    void dev.starts().then(() => {
      buildStarted = true
    })

    await vi.advanceTimersByTimeAsync(SAFARI_RESYNC_TIMEOUT_MS - 1)
    expect(buildStarted).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    expect(buildStarted).toBe(true)
  })

  // The bound of that run is spent, so a save is never held a second time.
  it('holds no build for a package that already passed its bound', async () => {
    const dev = session()
    await dev.hangResync('/out2')

    let buildStarted = false
    void dev.starts().then(() => {
      buildStarted = true
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(buildStarted).toBe(true)
  })

  // The build that is compiling may be writing the dist, so the package
  // that waited becomes that build's own resync, awaited by its done hook.
  it('starts no package while a build compiles, and packages once after it', async () => {
    const dev = session()
    await dev.hangResync('/out2')

    await dev.starts()
    await dev.ends('/out3')
    await dev.starts()
    dev.calls[1].finish()
    await vi.advanceTimersByTimeAsync(0)

    expect(dev.targets()).toEqual(['full:/init', 'resync:/out2'])

    let hookReturned = false
    void dev.ends('/out4').then(() => {
      hookReturned = true
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(dev.targets()).toEqual([
      'full:/init',
      'resync:/out2',
      'resync:/out4'
    ])

    expect(hookReturned).toBe(false)

    dev.calls[2].finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(hookReturned).toBe(true)
    expect(dev.targets()).toHaveLength(3)
  })

  it('keeps the reload of the save that waited in that one package', async () => {
    const sent: string[] = []
    const dev = session({
      broadcastReload: (instruction) => {
        sent.push(instruction.type)

        return 1
      }
    })
    await dev.hangResync('/out2')

    await dev.starts(['content.js'])
    await dev.ends('/out3')
    await dev.starts(['manifest.json'])
    dev.calls[1].finish()
    await vi.advanceTimersByTimeAsync(0)

    void dev.ends('/out4')
    await vi.advanceTimersByTimeAsync(0)
    dev.calls[2].finish()
    await vi.advanceTimersByTimeAsync(0)

    expect(dev.targets()).toEqual([
      'full:/init',
      'resync:/out2',
      'resync:/out4'
    ])

    expect(sent).toEqual(['content-scripts'])
  })

  it('packages the save that waited when the build after it fails', async () => {
    const dev = session()
    await dev.hangResync('/out2')

    await dev.starts()
    await dev.ends('/out3')
    await dev.starts()
    dev.calls[1].finish()
    await vi.advanceTimersByTimeAsync(0)
    await dev.ends('/out4', [new Error('Module not found')])

    expect(dev.targets()).toEqual([
      'full:/init',
      'resync:/out2',
      'resync:/out3'
    ])
  })
})

describe('a save that waits on a late first Safari package', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  // Safari has no extension yet, so there is nothing a resync could update.
  it('is not packaged by a failed build while the first package still runs', async () => {
    const dev = session()

    void dev.ends('/init')
    await vi.advanceTimersByTimeAsync(SAFARI_FIRST_PACKAGE_TIMEOUT_MS)
    await dev.starts()
    await dev.ends('/out2')
    await dev.starts()
    await dev.ends('/out3', [new Error('Module not found')])

    expect(dev.targets()).toEqual(['full:/init'])

    dev.calls[0].finish()
    await vi.advanceTimersByTimeAsync(0)

    expect(dev.targets()).toEqual(['full:/init', 'resync:/out2'])
  })

  it('reaches the error event when a listener throws after a late package', async () => {
    const dev = session()
    await dev.hangResync('/out2')

    dev.onCompiled(() => {
      throw new Error('listener broke')
    })

    dev.calls[1].finish()
    await vi.advanceTimersByTimeAsync(0)

    expect(dev.failures.at(-1)).toEqual(['listener broke'])
  })
})

// The plugin under a real watching compiler. The bundler awaits watchRun
// before it compiles, and it does not wait for a done hook that is still
// out, so the hold in watchRun is what keeps the dist unwritten.
describe('a Safari package under a real watch', () => {
  const realSetTimeout = globalThis.setTimeout
  const pause = (ms: number) =>
    new Promise((resolve) => realSetTimeout(resolve, ms))

  async function until(what: string, met: () => boolean) {
    const deadline = Date.now() + 20_000

    while (!met()) {
      if (Date.now() > deadline) throw new Error(`Timed out: ${what}`)

      await pause(10)
    }
  }

  function watchSession() {
    const root = tempFolder('extjs-safari-watch-')
    const entry = path.join(root, 'a.js')
    const longAgo = new Date(Date.now() - 60_000)
    fs.writeFileSync(entry, 'export const a = 1\n')
    // A file written just now reads as a save to a watcher that starts now.
    fs.utimesSync(entry, longAgo, longAgo)

    const pkg = deferredPackager()
    const log: string[] = []
    const seen = {builds: 0}
    const probe = {
      apply(compiler: Compiler) {
        compiler.hooks.watchRun.tap('probe', () => {
          log.push('build starts')
        })

        compiler.hooks.compile.tap('probe', () => {
          log.push('compile')
        })
      }
    }
    const compiler = rspack({
      mode: 'development',
      context: root,
      devtool: false,
      entry: {a: entry},
      output: {path: path.join(root, 'dist', 'safari')},
      plugins: [probe, new SafariDevPlugin(pkg.fn)]
    })
    const watching = compiler.watch({}, () => {
      seen.builds += 1
    })

    return {
      ...pkg,
      // What happened up to the first compile after the build was asked for.
      untilCompile: () => log.slice(0, log.indexOf('compile') + 1),
      seen,
      rebuild: () => watching.invalidate(),
      // A build asked for now, given time to compile if nothing held it.
      async rebuildAndWait() {
        log.length = 0
        watching.invalidate()
        await until('the next build to start', () =>
          log.includes('build starts')
        )

        await pause(300)
        log.push('package finished')
      },
      async close() {
        for (const call of pkg.calls) call.finish()
        await new Promise<void>((resolve) => watching.close(() => resolve()))
      }
    }
  }

  it('compiles a build asked for during the first package only after it', async () => {
    const dev = watchSession()

    try {
      await until('the first package', () => dev.calls.length === 1)
      await dev.rebuildAndWait()
      dev.calls[0].finish()

      await until('the resync of that build', () => dev.calls.length === 2)

      expect(dev.untilCompile()).toEqual([
        'build starts',
        'package finished',
        'compile'
      ])

      expect(dev.targets().map((target) => target.split(':')[0])).toEqual([
        'full',
        'resync'
      ])
    } finally {
      await dev.close()
    }
  }, 60_000)

  it('compiles a build asked for during a resync only after it', async () => {
    const dev = watchSession()

    try {
      await until('the first package', () => dev.calls.length === 1)
      dev.calls[0].finish()
      await until('the first build', () => dev.seen.builds === 1)

      dev.rebuild()
      await until('the resync', () => dev.calls.length === 2)
      await dev.rebuildAndWait()
      dev.calls[1].finish()

      await until('the resync of that build', () => dev.calls.length === 3)

      expect(dev.untilCompile()).toEqual([
        'build starts',
        'package finished',
        'compile'
      ])
    } finally {
      await dev.close()
    }
  }, 60_000)

  it('compiles a build asked for during a follow-up package only after it', async () => {
    // Only the first resync passes its bound here, in 50 ms. The follow-up
    // keeps the real one, so nothing but the package releases the hold.
    let shortened = false
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
      run: () => void,
      ms?: number
    ) => {
      if (ms !== SAFARI_RESYNC_TIMEOUT_MS || shortened) {
        return realSetTimeout(run, ms)
      }

      shortened = true

      return realSetTimeout(run, 50)
    }) as never)

    const dev = watchSession()

    try {
      await until('the first package', () => dev.calls.length === 1)
      dev.calls[0].finish()
      await until('the first build', () => dev.seen.builds === 1)

      // This resync passes its bound, so the hook returns with it running.
      dev.rebuild()
      await until('the second build', () => dev.seen.builds === 2)
      expect(dev.calls).toHaveLength(2)

      // A build meanwhile queues behind it and becomes the follow-up.
      dev.rebuild()
      await until('the third build', () => dev.seen.builds === 3)
      dev.calls[1].finish()
      await until('the follow-up package', () => dev.calls.length === 3)

      await dev.rebuildAndWait()
      dev.calls[2].finish()

      await until('the resync of that build', () => dev.calls.length === 4)

      expect(dev.untilCompile()).toEqual([
        'build starts',
        'package finished',
        'compile'
      ])
    } finally {
      await dev.close()
    }
  }, 60_000)
})

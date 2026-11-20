import * as path from 'node:path'
import {describe, expect, it, vi} from 'vitest'
import {createReloadSession, reloadEachBuild} from '../reload-session'

type Tap = (...args: any[]) => unknown

// The hooks a reload session taps, fired in registration order.
function watchingCompiler(context: string) {
  const taps: Record<string, Tap[]> = {}

  const hook = (name: string) => {
    const tap = (_tapName: unknown, run: Tap) => {
      taps[name] = [...(taps[name] || []), run]
    }

    return {tap, tapPromise: tap}
  }

  const compiler = {
    options: {mode: 'development', context},
    modifiedFiles: undefined as Set<string> | undefined,
    hooks: {
      watchRun: hook('watchRun'),
      done: hook('done'),
      assetEmitted: hook('assetEmitted')
    }
  }

  return {
    compiler: compiler as never,
    async build(saved: string[], errors: unknown[] = []) {
      compiler.modifiedFiles = new Set(
        saved.map((file) => path.join(context, file))
      )

      for (const run of taps.watchRun || []) run(compiler)

      const compilation = {
        errors,
        options: {context, output: {path: path.join(context, 'dist')}},
        getAsset: () => undefined
      }

      for (const run of taps.done || []) await run({compilation})

      return compilation
    }
  }
}

function recordingBroker() {
  const sent: Array<{type: string; label?: string}> = []
  const applied: Array<[string, string | undefined]> = []
  const warned: unknown[] = []

  return {
    sent,
    applied,
    warned,
    broadcastReload: vi.fn((frame: {type: string; label?: string}) => {
      sent.push(frame)

      return 0
    }),
    undeliveredReloadWarning: (context?: unknown) => {
      warned.push(context)

      return null
    },
    noteReloadApplied: (kind: string, label?: string) => {
      applied.push([kind, label])
    }
  }
}

const ROOT = path.join(path.sep, 'project')

describe('reloadEachBuild', () => {
  it('reads the first build as loaded and sends each later edit once', async () => {
    const broker = recordingBroker()
    const watching = watchingCompiler(ROOT)

    reloadEachBuild(watching.compiler, {browser: 'chrome', broker})

    await watching.build([])
    expect(broker.sent).toEqual([])

    await watching.build(['manifest.json'])
    expect(broker.sent.map(({type}) => type)).toEqual(['full'])
  })

  it('sends nothing for a failed build or one the hold names', async () => {
    const broker = recordingBroker()
    const watching = watchingCompiler(ROOT)
    let holding = false

    reloadEachBuild(watching.compiler, {
      browser: 'chrome',
      broker,
      isHeld: () => holding
    })

    await watching.build([])
    await watching.build(['manifest.json'], [new Error('typo')])
    holding = true
    await watching.build(['manifest.json'])

    expect(broker.sent).toEqual([])
  })
})

describe('reloadEachBuild on a one-shot build', () => {
  it('taps nothing on a compiler that never watches', () => {
    const done = vi.fn()
    const compiler = {hooks: {done: {tap: done, tapPromise: done}}}

    reloadEachBuild(compiler as never, {
      browser: 'chrome',
      broker: recordingBroker()
    })

    expect(done).not.toHaveBeenCalled()
  })
})

describe('createReloadSession', () => {
  it('reports a held build without classifying it', async () => {
    const session = createReloadSession({browser: 'chrome'})
    const watching = watchingCompiler(ROOT)
    const builds = session.watch(watching.compiler)

    session.connect(recordingBroker())
    session.hold(() => true)

    const compilation = await watching.build(['manifest.json'])

    expect(builds.plan(compilation as never)).toEqual({held: true})
  })

  it('sends nothing without a broker and remembers nothing', async () => {
    const session = createReloadSession({browser: 'chrome'})

    expect(await session.deliver({type: 'full', label: 'extension'})).toBe(
      false
    )
  })

  it('stamps every package as applied and expects the restart it causes', async () => {
    const broker = recordingBroker()
    const session = createReloadSession({browser: 'safari', packaged: true})

    session.connect(broker)

    await session.deliver(undefined)
    await session.deliver({
      type: 'content-scripts',
      label: 'content_script',
      changedContentScriptEntries: ['content_scripts/content-0']
    })

    expect(broker.sent.map(({type}) => type)).toEqual(['content-scripts'])
    expect(broker.warned).toEqual([{producerRestartExpected: true}])
    expect(broker.applied).toEqual([
      ['safari-resync', undefined],
      ['safari-resync', 'content_script']
    ])
  })

  it('trims a packaged plan to what a restart cannot deliver', async () => {
    const session = createReloadSession({browser: 'safari', packaged: true})
    const watching = watchingCompiler(ROOT)
    const builds = session.watch(watching.compiler)
    const compilation = await watching.build(['manifest.json'])

    expect(builds.plan(compilation as never)).toEqual({
      held: false,
      instruction: undefined
    })
  })
})

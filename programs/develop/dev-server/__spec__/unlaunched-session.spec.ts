import * as path from 'node:path'
import {describe, expect, it, vi} from 'vitest'
import {reloadEachBuild} from '../../plugin-reload'
import {attachUnlaunchedSession, createReadyAnnouncer} from '../start-bundler'

type Tap = (...args: any[]) => unknown

const ROOT = path.join(path.sep, 'project')

// The hooks a session without a launcher taps, fired in registration order.
function watchingCompiler() {
  const taps: Record<string, Tap[]> = {}

  const hook = (name: string) => {
    const tap = (_tapName: unknown, run: Tap) => {
      taps[name] = [...(taps[name] || []), run]
    }

    return {tap, tapPromise: tap}
  }

  const compiler = {
    options: {mode: 'development', context: ROOT},
    modifiedFiles: undefined as Set<string> | undefined,
    hooks: {
      watchRun: hook('watchRun'),
      done: hook('done'),
      assetEmitted: hook('assetEmitted')
    }
  }

  return {
    compiler: compiler as never,
    tapped: () => Object.values(taps).flat().length,
    async build(saved: string[], errors: unknown[] = []) {
      compiler.modifiedFiles = new Set(
        saved.map((file) => path.join(ROOT, file))
      )

      for (const run of taps.watchRun || []) run(compiler)

      const compilation = {
        errors,
        options: {context: ROOT, output: {path: path.join(ROOT, 'dist')}},
        getAsset: () => undefined
      }

      for (const run of taps.done || []) {
        await run({compilation, hasErrors: () => errors.length > 0})
      }
    }
  }
}

function session(launches: boolean) {
  const sent: string[] = []
  const broker = {
    broadcastReload: vi.fn((frame: {type: string}) => {
      sent.push(frame.type)

      return 0
    }),
    undeliveredReloadWarning: () => null,
    noteReloadApplied: () => {}
  }
  const onReady = vi.fn()
  const watching = watchingCompiler()

  attachUnlaunchedSession(watching.compiler, {
    launches,
    reloadEachBuild: () =>
      reloadEachBuild(watching.compiler, {browser: 'chrome', broker}),
    announceReady: createReadyAnnouncer(onReady)
  })

  return {watching, sent, onReady}
}

describe('a dev session that launches no browser', () => {
  it('says ready on the first clean build and reloads on each later one', async () => {
    const {watching, sent, onReady} = session(false)

    await watching.build([], [new Error('does not compile')])
    expect(onReady).not.toHaveBeenCalled()
    expect(sent).toEqual([])

    await watching.build([])
    expect(onReady).toHaveBeenCalledTimes(1)
    expect(sent).toEqual([])

    await watching.build(['manifest.json'])
    expect(onReady).toHaveBeenCalledTimes(1)
    expect(sent).toEqual(['full'])
  })

  it('leaves both to the plugin that opens the browser', async () => {
    const {watching, sent, onReady} = session(true)

    expect(watching.tapped()).toBe(0)

    await watching.build([])
    await watching.build(['manifest.json'])

    expect(onReady).not.toHaveBeenCalled()
    expect(sent).toEqual([])
  })
})

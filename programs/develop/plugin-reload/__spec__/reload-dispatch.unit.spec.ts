import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  buildSourceFeatureIndex,
  classifyReloadFromSources
} from '../classify-reload'
import type {ReloadInstruction} from '../index'
import {
  createChangedSourcesTracker,
  dispatchReload,
  dispatchRestartReload,
  fullReloadsDeliveredTo,
  noteManifestPath,
  type ReloadBroker
} from '../reload-dispatch'

const CS: ReloadInstruction = {
  type: 'content-scripts',
  changedContentScriptEntries: ['content_scripts/content-0'],
  changedAssets: ['src/content/scripts.js'],
  label: 'content_script (src/content/scripts.js)'
}

beforeEach(() => {
  vi.stubEnv('EXTENSION_NO_RELOAD', undefined)
  vi.stubEnv('EXTENSION_OUTPUT', undefined)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('dispatchReload', () => {
  it('keeps the reload line off stdout while a machine owns it', async () => {
    vi.stubEnv('EXTENSION_OUTPUT', 'json')
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const stderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true)

    await dispatchReload(CS, {
      broker: {broadcastReload: vi.fn().mockReturnValue(1)}
    })

    expect(log).not.toHaveBeenCalled()
    expect(stderr.mock.calls.join(' ')).toContain(
      'content_script (src/content/scripts.js)'
    )
  })

  it('broadcasts over the broker with the shared label + changed files', async () => {
    const broker = {broadcastReload: vi.fn().mockReturnValue(1)}
    await dispatchReload(CS, {broker})
    expect(broker.broadcastReload).toHaveBeenCalledWith({
      type: 'content-scripts',
      changedContentScriptEntries: ['content_scripts/content-0'],
      label: 'content_script (src/content/scripts.js)',
      changedFiles: ['src/content/scripts.js']
    })
  })

  it('forwards changedScriptFiles so the SW can replay its executeScript calls', async () => {
    const broker = {broadcastReload: vi.fn().mockReturnValue(1)}
    await dispatchReload(
      {
        type: 'page',
        changedAssets: ['scripts/widget.ts'],
        changedScriptFiles: ['scripts/widget.js'],
        label: 'page (scripts/widget.ts)'
      },
      {broker}
    )

    expect(broker.broadcastReload).toHaveBeenCalledWith({
      type: 'page',
      changedContentScriptEntries: undefined,
      label: 'page (scripts/widget.ts)',
      changedFiles: ['scripts/widget.ts'],
      changedScriptFiles: ['scripts/widget.js']
    })
  })

  it('prints the stdout "Reloading …" line only when a producer was notified', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await dispatchReload(CS, {
      broker: {broadcastReload: vi.fn().mockReturnValue(0)}
    })

    expect(log).not.toHaveBeenCalled()

    await dispatchReload(CS, {
      broker: {broadcastReload: vi.fn().mockReturnValue(1)}
    })

    expect(log).toHaveBeenCalledTimes(1)
    expect(String(log.mock.calls[0][0])).toContain(
      'content_script (src/content/scripts.js)'
    )
  })

  // An edit to a file the background injected reloads no page: the file is
  // run again in the tabs it was injected into, and the line says that.
  describe('the line of an applied reload', () => {
    const INJECTED: ReloadInstruction = {
      type: 'page',
      changedAssets: ['scripts/widget.ts'],
      changedScriptFiles: ['scripts/widget.js'],
      label: 'page (scripts/widget.ts)'
    }

    const printed = async (
      instruction: ReloadInstruction,
      replayedTabs?: number
    ) => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {})

      await dispatchReload(instruction, {
        broker: {
          broadcastReload: vi.fn().mockReturnValue(1),
          awaitReloadAck: vi.fn().mockResolvedValue('acked'),
          ...(replayedTabs === undefined
            ? {}
            : {reloadReplayedTabs: () => replayedTabs})
        }
      })

      const lines = log.mock.calls.map((call) => String(call[0]))

      log.mockRestore()

      return lines
    }

    it('says the file ran again, in how many tabs, when no page reloaded', async () => {
      const [one, ...rest] = await printed(INJECTED, 1)
      const [three] = await printed(
        {
          ...INJECTED,
          changedAssets: ['scripts/a.ts', 'scripts/b.ts', 'scripts/c.ts']
        },
        3
      )

      expect(rest).toEqual([])
      expect(one).toContain(
        'Ran scripts/widget.ts again in 1 open tab, with no page reload.'
      )

      expect(one).not.toContain('Reloading')
      expect(three).toContain(
        'Ran scripts/a.ts, scripts/b.ts +1 more again in 3 open tabs, with no page reload.'
      )
    })

    it('keeps the reloading line when the file ran again in no tab', async () => {
      for (const tabs of [0, undefined]) {
        const lines = await printed(INJECTED, tabs)

        expect(lines).toHaveLength(1)
        expect(lines[0]).toContain('Reloading page (scripts/widget.ts)…')
      }
    })

    it('keeps the reloading line for a page edit that names no injected file', async () => {
      const lines = await printed(
        {
          type: 'page',
          changedAssets: ['pages/popup.html'],
          label: 'popup (pages/popup.html)'
        },
        2
      )

      expect(lines).toHaveLength(1)
      expect(lines[0]).toContain('Reloading popup (pages/popup.html)…')
    })

    it('keeps the line of every reload that is not a page one', async () => {
      const content = await printed(
        {...CS, changedScriptFiles: ['scripts/widget.js']},
        2
      )
      const full = await printed(
        {
          type: 'full',
          changedScriptFiles: ['scripts/widget.js'],
          label: 'extension'
        },
        2
      )
      const fixed = await printed(
        {
          ...INJECTED,
          staticContentScriptEntries: ['content_scripts/content-0']
        },
        2
      )

      expect(content[0]).toContain(
        'Reloading content_script (src/content/scripts.js)…'
      )

      expect(full[0]).toContain('Reloading extension…')
      expect(fixed[0]).toContain('Reloading the extension for page')
    })
  })

  it('says the extension reloads, and why, when the edited entry is a static one', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await dispatchReload(
      {...CS, staticContentScriptEntries: ['content_scripts/content-0']},
      {broker: {broadcastReload: vi.fn().mockReturnValue(1)}}
    )

    expect(log).toHaveBeenCalledTimes(1)
    expect(String(log.mock.calls[0][0])).toContain(
      'Reloading the extension for content_script (src/content/scripts.js)'
    )

    expect(String(log.mock.calls[0][0])).toContain('document_start')
  })

  it('warns with the broker hint when a reload reaches zero producers', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const broker = {
      broadcastReload: vi.fn().mockReturnValue(0),
      undeliveredReloadWarning: vi.fn().mockReturnValue('SW not attached, …')
    }
    await dispatchReload(CS, {broker})
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('SW not attached')
    expect(log).not.toHaveBeenCalled()
  })

  it('stays silent when zero producers but the broker returns no hint (grace/dedup)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const broker = {
      broadcastReload: vi.fn().mockReturnValue(0),
      undeliveredReloadWarning: vi.fn().mockReturnValue(null)
    }
    await dispatchReload(CS, {broker})
    expect(warn).not.toHaveBeenCalled()
  })

  it('does NOT ask for an undelivered-reload hint when a producer was notified', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const undeliveredReloadWarning = vi.fn().mockReturnValue('should not show')
    await dispatchReload(CS, {
      broker: {
        broadcastReload: vi.fn().mockReturnValue(1),
        undeliveredReloadWarning
      }
    })

    expect(undeliveredReloadWarning).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })

  it('announces the reload only after the extension acks it', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const awaitReloadAck = vi.fn().mockResolvedValue('acked')

    await dispatchReload(CS, {
      broker: {broadcastReload: vi.fn().mockReturnValue(1), awaitReloadAck}
    })

    expect(awaitReloadAck).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledTimes(1)
    expect(String(log.mock.calls[0][0])).toContain(
      'content_script (src/content/scripts.js)'
    )

    expect(warn).not.toHaveBeenCalled()
  })

  it('says so when the extension never comes back after an acked reload', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await dispatchReload(CS, {
      broker: {
        broadcastReload: vi.fn().mockReturnValue(1),
        awaitReloadAck: vi.fn().mockResolvedValue('acked'),
        awaitReloadRestart: vi.fn().mockResolvedValue('not-restarted')
      }
    })

    await Promise.resolve()

    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('has not come back')
  })

  it('takes the warning back when the extension says hello after the window', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    let hello: (late: {afterMs: number; runsBuild: boolean}) => void = () => {}

    await dispatchReload(CS, {
      broker: {
        broadcastReload: vi.fn().mockReturnValue(1),
        awaitReloadAck: vi.fn().mockResolvedValue('acked'),
        awaitReloadRestart: vi.fn().mockResolvedValue('not-restarted'),
        awaitLateReloadRestart: () =>
          new Promise((resolve) => {
            hello = resolve
          })
      }
    })

    await Promise.resolve()

    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('has not come back')

    const before = log.mock.calls.length

    hello({afterMs: 41000, runsBuild: true})
    await Promise.resolve()
    await Promise.resolve()

    const lines = log.mock.calls.slice(before).map((call) => String(call[0]))

    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain(
      'content_script (src/content/scripts.js) is back after 41s, so this edit is live'
    )

    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('warns again when the late extension runs a build from before the edit', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await dispatchReload(CS, {
      broker: {
        broadcastReload: vi.fn().mockReturnValue(1),
        awaitReloadAck: vi.fn().mockResolvedValue('acked'),
        awaitReloadRestart: vi.fn().mockResolvedValue('not-restarted'),
        awaitLateReloadRestart: vi
          .fn()
          .mockResolvedValue({afterMs: 20000, runsBuild: false})
      }
    })

    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(warn).toHaveBeenCalledTimes(2)
    expect(String(warn.mock.calls[1][0])).toContain(
      'is back after 20s on an earlier build, so this edit is not live'
    )
  })

  it('stays quiet when the extension came back or no restart was due', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    for (const outcome of ['restarted', 'not-expected']) {
      await dispatchReload(CS, {
        broker: {
          broadcastReload: vi.fn().mockReturnValue(1),
          awaitReloadAck: vi.fn().mockResolvedValue('acked'),
          awaitReloadRestart: vi.fn().mockResolvedValue(outcome)
        }
      })
    }

    await Promise.resolve()

    expect(warn).not.toHaveBeenCalled()
  })

  it('tells the user the edit may not be live when no ack arrives', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await dispatchReload(CS, {
      broker: {
        broadcastReload: vi.fn().mockReturnValue(1),
        awaitReloadAck: vi.fn().mockResolvedValue('unacked')
      }
    })

    expect(log).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(1)
    const line = String(warn.mock.calls[0][0])
    expect(line).toContain('content_script (src/content/scripts.js)')
    expect(line).toContain('never confirmed the reload')
    expect(line).toContain('may not be live')
  })

  it('announces on delivery alone when the producer cannot ack', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await dispatchReload(CS, {
      broker: {
        broadcastReload: vi.fn().mockReturnValue(1),
        awaitReloadAck: vi.fn().mockResolvedValue('not-expected')
      }
    })

    expect(warn).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledTimes(1)
  })

  it('is a no-op for an undefined instruction (no changed sources)', async () => {
    const broker = {broadcastReload: vi.fn()}
    await dispatchReload(undefined, {broker})
    expect(broker.broadcastReload).not.toHaveBeenCalled()
  })

  it('is a no-op when no broker is present', async () => {
    await expect(dispatchReload(CS, {})).resolves.toBe(false)
  })

  // The caller advances what it believes the browser holds on this answer,
  // so an edit that reached nobody must not read as one that was applied.
  it('answers whether a producer took the edit', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const taken = {broadcastReload: vi.fn().mockReturnValue(1)}
    const woken = {
      broadcastReload: vi.fn().mockReturnValue(0),
      deliverLatchedReload: vi.fn().mockResolvedValue(true)
    }
    const asleep = {
      broadcastReload: vi.fn().mockReturnValue(0),
      deliverLatchedReload: vi.fn().mockResolvedValue(false)
    }
    const failing = {
      broadcastReload: vi.fn().mockReturnValue(0),
      deliverLatchedReload: vi.fn().mockRejectedValue(new Error('no browser'))
    }
    const unacked = {
      broadcastReload: vi.fn().mockReturnValue(1),
      awaitReloadAck: vi.fn().mockResolvedValue('unacked')
    }

    await expect(dispatchReload(CS, {broker: taken})).resolves.toBe(true)
    await expect(dispatchReload(CS, {broker: woken})).resolves.toBe(true)
    await expect(dispatchReload(CS, {broker: asleep})).resolves.toBe(false)
    await expect(dispatchReload(CS, {broker: failing})).resolves.toBe(false)
    await expect(dispatchReload(CS, {broker: unacked})).resolves.toBe(false)
    await expect(dispatchReload(undefined, {broker: taken})).resolves.toBe(
      false
    )

    vi.stubEnv('EXTENSION_NO_RELOAD', 'true')
    await expect(dispatchReload(CS, {broker: taken})).resolves.toBe(false)
  })

  // The background bundle of the same compile names itself by this value, so
  // a producer that already runs it can tell a held reload is behind it.
  it('names the build on the frame when the caller knows it, and leaves it out otherwise', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const broker = {broadcastReload: vi.fn().mockReturnValue(1)}

    await dispatchReload(CS, {broker, build: 'abc123'})
    await dispatchReload(CS, {broker, build: ''})
    await dispatchReload(CS, {broker})

    expect(
      broker.broadcastReload.mock.calls.map((call) => call[0].build)
    ).toEqual(['abc123', undefined, undefined])

    expect('build' in broker.broadcastReload.mock.calls[2][0]).toBe(false)
  })

  // Two quick saves can compile the same bytes twice. The worker that
  // restarted for the first compile already runs them, so nothing is sent.
  it('sends no worker reload for a build every connected background already runs', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const broker = {
      broadcastReload: vi.fn().mockReturnValue(1),
      runsBuild: vi.fn((build: string) => build === 'same')
    }
    const worker: ReloadInstruction = {
      type: 'service-worker',
      changedAssets: ['background.js'],
      label: 'service_worker (background.js)'
    }

    await expect(dispatchReload(worker, {broker, build: 'same'})).resolves.toBe(
      true
    )

    expect(broker.broadcastReload).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()

    await dispatchReload(worker, {broker, build: 'other'})
    await dispatchReload(worker, {broker})
    await dispatchReload({...worker, type: 'full'}, {broker, build: 'same'})
    await dispatchReload(CS, {broker, build: 'same'})
    await dispatchReload(
      {...worker, changedContentScriptEntries: ['content_scripts/content-0']},
      {broker, build: 'same'}
    )

    await dispatchReload(
      {...worker, changedScriptFiles: ['scripts/widget.js']},
      {broker, build: 'same'}
    )

    await dispatchReload(
      {...worker, standalonePages: ['loose/index.html']},
      {broker, build: 'same'}
    )

    expect(broker.broadcastReload).toHaveBeenCalledTimes(7)
  })

  it('sends the worker reload to a broker that cannot tell which build runs', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const broker = {broadcastReload: vi.fn().mockReturnValue(1)}

    await dispatchReload(
      {type: 'service-worker', label: 'service_worker (background.js)'},
      {broker, build: 'same'}
    )

    expect(broker.broadcastReload).toHaveBeenCalledTimes(1)
  })

  it('forwards the pages the build ships as written', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const broker = {broadcastReload: vi.fn().mockReturnValue(1)}

    await dispatchReload(
      {
        type: 'page',
        changedAssets: ['loose/page.js'],
        standalonePages: ['loose/index.html'],
        label: 'page (loose/page.js)'
      },
      {broker}
    )

    expect(broker.broadcastReload.mock.calls[0][0]).toMatchObject({
      type: 'page',
      standalonePages: ['loose/index.html']
    })
  })

  // The Safari plugin trims its instruction with reloadSurvivingPackage first,
  // so the shared seam must keep broadcasting every kind for the others.
  it('broadcasts a full reload unchanged, the Safari trim runs before it', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const broker = {broadcastReload: vi.fn().mockReturnValue(1)}
    await dispatchReload(
      {
        type: 'full',
        changedAssets: ['src/manifest.json'],
        label: 'extension (src/manifest.json)'
      },
      {broker}
    )

    expect(broker.broadcastReload).toHaveBeenCalledWith({
      type: 'full',
      changedContentScriptEntries: undefined,
      label: 'extension (src/manifest.json)',
      changedFiles: ['src/manifest.json']
    })

    expect(String(log.mock.calls[0][0])).toContain('Reloading')
  })

  it('broadcasts a service-worker reload unchanged', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const broker = {broadcastReload: vi.fn().mockReturnValue(1)}
    await dispatchReload(
      {
        type: 'service-worker',
        changedAssets: ['src/background.js'],
        label: 'service_worker (src/background.js)'
      },
      {broker}
    )

    expect(broker.broadcastReload).toHaveBeenCalledWith({
      type: 'service-worker',
      changedContentScriptEntries: undefined,
      label: 'service_worker (src/background.js)',
      changedFiles: ['src/background.js']
    })
  })

  it('honors EXTENSION_NO_RELOAD', async () => {
    vi.stubEnv('EXTENSION_NO_RELOAD', 'true')
    const broker = {broadcastReload: vi.fn()}
    await dispatchReload(CS, {broker})
    expect(broker.broadcastReload).not.toHaveBeenCalled()
  })
})

describe('createChangedSourcesTracker', () => {
  function fakeCompiler() {
    let runner: (() => void) | undefined
    let doneRunner: ((stats: any) => void) | undefined
    let emittedRunner: ((file: string) => void) | undefined
    const compiler: any = {
      modifiedFiles: undefined as Set<string> | undefined,
      options: {context: '/proj'},
      hooks: {
        watchRun: {
          tap: (_name: string, fn: () => void) => {
            runner = fn
          }
        },
        done: {
          tap: (_name: string, fn: (stats: any) => void) => {
            doneRunner = fn
          }
        },
        assetEmitted: {
          tap: (_name: string, fn: (file: string) => void) => {
            emittedRunner = fn
          }
        }
      }
    }

    return {
      compiler,
      fireWatchRun: () => runner?.(),
      fireDone: (
        errors: any[] = [],
        extra?: {modifiedFiles?: string[]; fileDependencies?: string[]}
      ) =>
        doneRunner?.({
          compilation: {
            errors,
            modifiedFiles: extra?.modifiedFiles
              ? new Set(extra.modifiedFiles)
              : undefined,
            fileDependencies: extra?.fileDependencies
              ? new Set(extra.fileDependencies)
              : undefined
          }
        }),
      fireAssetEmitted: (file: string) => emittedRunner?.(file)
    }
  }

  it('records project-relative, forward-slashed changed sources', () => {
    const {compiler, fireWatchRun} = fakeCompiler()
    const tracker = createChangedSourcesTracker(compiler)
    compiler.modifiedFiles = new Set(['/proj/src/content/scripts.js'])
    fireWatchRun()
    expect(tracker.snapshot()).toEqual({
      forcedFull: false,
      changedSources: ['src/content/scripts.js']
    })
  })

  it('drops the watch root itself (relativizes to empty) from changed sources', () => {
    const {compiler, fireWatchRun} = fakeCompiler()
    const tracker = createChangedSourcesTracker(compiler)
    compiler.modifiedFiles = new Set(['/proj', '/proj/src/content/scripts.js'])
    fireWatchRun()
    expect(tracker.snapshot().changedSources).toEqual([
      'src/content/scripts.js'
    ])
  })

  it('forces a full reload for a manifest.json or _locales change', () => {
    const {compiler, fireWatchRun} = fakeCompiler()
    const tracker = createChangedSourcesTracker(compiler)
    compiler.modifiedFiles = new Set([
      '/proj/src/manifest.json',
      '/proj/src/popup/index.js'
    ])

    fireWatchRun()
    expect(tracker.snapshot().forcedFull).toBe(true)

    compiler.modifiedFiles = new Set(['/proj/src/_locales/en/messages.json'])
    fireWatchRun()
    expect(tracker.snapshot().forcedFull).toBe(true)
  })

  it('classifies a project-root _locales edit as "full"', () => {
    const {compiler, fireWatchRun} = fakeCompiler()
    const tracker = createChangedSourcesTracker(compiler)
    compiler.modifiedFiles = new Set(['/proj/_locales/en/messages.json'])
    fireWatchRun()

    const snapshot = tracker.snapshot()
    const instruction = classifyReloadFromSources({
      ...snapshot,
      getContentScriptCount: () => 1
    })

    expect(snapshot.forcedFull).toBe(true)
    expect(instruction?.type).toBe('full')
    expect(instruction?.changedAssets).toEqual(['_locales/en/messages.json'])
  })

  it('reloads only the page for a file whose name only ends in manifest.json', () => {
    const {compiler, fireWatchRun} = fakeCompiler()
    const tracker = createChangedSourcesTracker(compiler)
    compiler.modifiedFiles = new Set(['/proj/src/pwa/site-manifest.json'])
    fireWatchRun()

    expect(tracker.snapshot()).toEqual({
      forcedFull: false,
      changedSources: ['src/pwa/site-manifest.json']
    })
  })

  it('forces no full reload for a source file under a nested _locales folder', () => {
    const {compiler, fireWatchRun} = fakeCompiler()
    const tracker = createChangedSourcesTracker(compiler)
    compiler.modifiedFiles = new Set(['/proj/src/i18n/_locales/strings.ts'])
    fireWatchRun()

    expect(tracker.snapshot()).toEqual({
      forcedFull: false,
      changedSources: ['src/i18n/_locales/strings.ts']
    })
  })

  it('forces no full reload for a manifest.json copied from public/', () => {
    const {compiler, fireWatchRun} = fakeCompiler()
    const tracker = createChangedSourcesTracker(compiler)
    compiler.modifiedFiles = new Set(['/proj/public/app/manifest.json'])
    fireWatchRun()

    expect(tracker.snapshot().forcedFull).toBe(false)
  })

  it('forces a full reload for the manifest the plugin was given and its _locales', () => {
    const {compiler, fireWatchRun, fireDone} = fakeCompiler()
    noteManifestPath(compiler, '/proj/extension/manifest.json')
    const tracker = createChangedSourcesTracker(compiler)

    compiler.modifiedFiles = new Set(['/proj/extension/manifest.json'])
    fireWatchRun()
    fireDone()
    expect(tracker.snapshot().forcedFull).toBe(true)

    compiler.modifiedFiles = new Set([
      '/proj/extension/_locales/en/messages.json'
    ])

    fireWatchRun()
    fireDone()
    expect(tracker.snapshot().forcedFull).toBe(true)

    compiler.modifiedFiles = new Set(['/proj/src/manifest.json'])
    fireWatchRun()
    fireDone()
    expect(tracker.snapshot().forcedFull).toBe(false)
  })

  it('resets on the watchRun after a compile ended (no stale carryover)', () => {
    const {compiler, fireWatchRun, fireDone} = fakeCompiler()
    const tracker = createChangedSourcesTracker(compiler)
    compiler.modifiedFiles = new Set(['/proj/src/manifest.json'])
    fireWatchRun()
    fireDone()
    expect(tracker.snapshot().forcedFull).toBe(true)

    compiler.modifiedFiles = new Set()
    fireWatchRun()
    expect(tracker.snapshot()).toEqual({forcedFull: false, changedSources: []})
  })

  it('drops a saved file the build never read and keeps the ones it did', () => {
    const {compiler, fireWatchRun, fireDone} = fakeCompiler()
    const tracker = createChangedSourcesTracker(compiler)

    compiler.modifiedFiles = new Set([
      '/proj/notes.md',
      '/proj/src/content/scripts.js',
      '/proj/src/manifest.json'
    ])

    fireWatchRun()
    fireDone([], {fileDependencies: ['/proj/src/content/scripts.js']})

    expect(tracker.snapshot()).toEqual({
      forcedFull: true,
      changedSources: ['src/content/scripts.js', 'src/manifest.json']
    })
  })

  it('keeps a deleted file the compile before it read', () => {
    const {compiler, fireWatchRun, fireDone} = fakeCompiler()
    const tracker = createChangedSourcesTracker(compiler)
    const read = ['/proj/src/content/scripts.js', '/proj/src/parts/a.js']

    compiler.modifiedFiles = new Set()
    fireWatchRun()
    fireDone([], {fileDependencies: read})

    compiler.modifiedFiles = new Set()
    compiler.removedFiles = new Set(['/proj/src/parts/a.js', '/proj/old.md'])
    fireWatchRun()
    fireDone([], {fileDependencies: read.slice(0, 1)})

    expect(tracker.snapshot().changedSources).toEqual(['src/parts/a.js'])
  })

  // A save during a compile starts the next one, and the first never ends.
  it('keeps the files of a compile a newer save superseded', () => {
    const {compiler, fireWatchRun, fireDone} = fakeCompiler()
    const tracker = createChangedSourcesTracker(compiler)

    compiler.modifiedFiles = new Set(['/proj/src/background.ts'])
    fireWatchRun()
    compiler.modifiedFiles = new Set(['/proj/src/popup/index.js'])
    fireWatchRun()
    fireDone()

    expect(tracker.snapshot()).toEqual({
      forcedFull: false,
      changedSources: ['src/background.ts', 'src/popup/index.js']
    })
  })

  it('holds a failed compile so the next success reloads every pending change', () => {
    const {compiler, fireWatchRun, fireDone} = fakeCompiler()
    const tracker = createChangedSourcesTracker(compiler)

    compiler.modifiedFiles = new Set([
      '/proj/src/manifest.json',
      '/proj/src/background.ts'
    ])

    fireWatchRun()
    fireDone([new Error('typo in background')])

    compiler.modifiedFiles = new Set(['/proj/src/background.ts'])
    fireWatchRun()
    fireDone()
    expect(tracker.snapshot()).toEqual({
      forcedFull: true,
      changedSources: ['src/background.ts', 'src/manifest.json']
    })
  })

  it('reloads held files when a recovery compile reports no modifiedFiles', () => {
    const {compiler, fireWatchRun, fireDone} = fakeCompiler()
    const tracker = createChangedSourcesTracker(compiler)

    compiler.modifiedFiles = new Set(['/proj/src/content/scripts.js'])
    fireWatchRun()
    fireDone([new Error('boom')])

    compiler.modifiedFiles = new Set()
    fireWatchRun()
    fireDone()
    expect(tracker.snapshot()).toEqual({
      forcedFull: false,
      changedSources: ['src/content/scripts.js']
    })
  })

  it('on recovery, includes assets the successful compile actually wrote', () => {
    const {compiler, fireWatchRun, fireDone, fireAssetEmitted} = fakeCompiler()
    const tracker = createChangedSourcesTracker(compiler)

    compiler.modifiedFiles = new Set(['/proj/src/background.ts'])
    fireWatchRun()
    fireDone([new Error('typo')])

    compiler.modifiedFiles = new Set(['/proj/src/background.ts'])
    fireWatchRun()
    fireAssetEmitted('background/service_worker.js')
    fireAssetEmitted('manifest.json')
    fireAssetEmitted('hot/background.hot-update.js')
    fireDone()
    expect(tracker.snapshot()).toEqual({
      forcedFull: true,
      changedSources: [
        'src/background.ts',
        'background/service_worker.js',
        'manifest.json'
      ]
    })
  })

  it('does not leak a failed compile into a later unrelated successful save', () => {
    const {compiler, fireWatchRun, fireDone} = fakeCompiler()
    const tracker = createChangedSourcesTracker(compiler)

    compiler.modifiedFiles = new Set(['/proj/src/manifest.json'])
    fireWatchRun()
    fireDone([new Error('boom')])
    fireDone()
    tracker.snapshot()

    compiler.modifiedFiles = new Set(['/proj/src/popup/index.js'])
    fireWatchRun()
    fireDone()
    expect(tracker.snapshot()).toEqual({
      forcedFull: false,
      changedSources: ['src/popup/index.js']
    })
  })

  it('merges compilation.modifiedFiles when the watch set was empty', () => {
    const {compiler, fireWatchRun, fireDone} = fakeCompiler()
    const tracker = createChangedSourcesTracker(compiler)
    compiler.modifiedFiles = new Set()
    fireWatchRun()
    fireDone([], {modifiedFiles: ['/proj/src/background.ts']})
    expect(tracker.snapshot()).toEqual({
      forcedFull: false,
      changedSources: ['src/background.ts']
    })
  })
})

// A caller that restarts the extension to ship the build (the Safari packager)
// owns the zero-producer case: the broker latches the edit and it lands later.
describe('dispatchReload with an expected producer restart', () => {
  it('asks with the restart context and prints the queued line', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const undeliveredReloadWarning = vi.fn().mockReturnValue(null)

    await dispatchReload(CS, {
      broker: {
        broadcastReload: vi.fn().mockReturnValue(0),
        undeliveredReloadWarning
      },
      producerRestartExpected: true
    })

    expect(undeliveredReloadWarning).toHaveBeenCalledWith({
      producerRestartExpected: true
    })

    expect(warn).not.toHaveBeenCalled()
    const line = String(log.mock.calls[0][0])
    expect(line).toContain('Queued')
    expect(line).toContain('content_script (src/content/scripts.js)')
    expect(line).toContain('when it reconnects')
  })

  it('asks without a context on a plain dispatch, which still warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const undeliveredReloadWarning = vi
      .fn()
      .mockReturnValue('SW not attached, your edit compiled')

    await dispatchReload(CS, {
      broker: {
        broadcastReload: vi.fn().mockReturnValue(0),
        undeliveredReloadWarning
      }
    })

    expect(undeliveredReloadWarning).toHaveBeenCalledWith(undefined)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('prefers a warning the broker still returns over the queued line', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await dispatchReload(CS, {
      broker: {
        broadcastReload: vi.fn().mockReturnValue(0),
        undeliveredReloadWarning: vi
          .fn()
          .mockReturnValue('SW not attached, your edit compiled')
      },
      producerRestartExpected: true
    })

    expect(warn).toHaveBeenCalledTimes(1)
    expect(log).not.toHaveBeenCalled()
  })

  it('stays silent when the latched instruction carries no label', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await dispatchReload(
      {type: 'full', changedAssets: ['src/manifest.json']},
      {
        broker: {broadcastReload: vi.fn().mockReturnValue(0)},
        producerRestartExpected: true
      }
    )

    expect(log).not.toHaveBeenCalled()
  })

  it('announces a normal reload when a producer was notified', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const undeliveredReloadWarning = vi.fn().mockReturnValue('should not show')

    await dispatchReload(CS, {
      broker: {
        broadcastReload: vi.fn().mockReturnValue(1),
        undeliveredReloadWarning
      },
      producerRestartExpected: true
    })

    expect(undeliveredReloadWarning).not.toHaveBeenCalled()
    expect(String(log.mock.calls[0][0])).toContain('Reloading')
  })
})

describe('createChangedSourcesTracker on a symlinked project dir', () => {
  const made: string[] = []

  afterEach(() => {
    for (const dir of made.splice(0)) {
      fs.rmSync(dir, {recursive: true, force: true})
    }
  })

  function symlinkedProject() {
    const root = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-reload-symlink-'))
    )
    made.push(root)
    const real = path.join(root, 'private', 'var', 'proj')
    fs.mkdirSync(path.join(real, 'src'), {recursive: true})
    fs.writeFileSync(path.join(real, 'src', 'x.js'), 'export {}\n')
    const link = path.join(root, 'var')
    fs.symlinkSync(path.join(root, 'private', 'var'), link, 'dir')

    return {real, unresolved: path.join(link, 'proj')}
  }

  function trackerAt(context: string) {
    let runner: (() => void) | undefined
    const compiler: any = {
      modifiedFiles: undefined as Set<string> | undefined,
      options: {context},
      hooks: {
        watchRun: {
          tap: (_name: string, fn: () => void) => {
            runner = fn
          }
        }
      }
    }
    const tracker = createChangedSourcesTracker(compiler)

    return {compiler, tracker, fireWatchRun: () => runner?.()}
  }

  it('labels a watcher path reported by its real spelling relative to the project', () => {
    const {real, unresolved} = symlinkedProject()
    const {compiler, tracker, fireWatchRun} = trackerAt(unresolved)
    compiler.modifiedFiles = new Set([path.join(real, 'src', 'x.js')])
    fireWatchRun()

    const {changedSources} = tracker.snapshot()
    expect(changedSources).toEqual(['src/x.js'])

    const label = classifyReloadFromSources({
      changedSources,
      getContentScriptCount: () => 0
    })?.label
    expect(label).toContain('(src/x.js)')
    expect(label).not.toContain('..')
  })

  it('keeps one entry when the same file arrives under both spellings', () => {
    const {real, unresolved} = symlinkedProject()
    const {compiler, tracker, fireWatchRun} = trackerAt(unresolved)
    compiler.modifiedFiles = new Set([
      path.join(unresolved, 'src', 'x.js'),
      path.join(real, 'src', 'x.js')
    ])

    fireWatchRun()

    expect(tracker.snapshot().changedSources).toEqual(['src/x.js'])
  })

  it('resolves a deleted file through its nearest existing folder', () => {
    const {real, unresolved} = symlinkedProject()
    const {compiler, tracker, fireWatchRun} = trackerAt(unresolved)
    fs.rmSync(path.join(real, 'src', 'x.js'))
    compiler.modifiedFiles = new Set([path.join(real, 'src', 'x.js')])
    fireWatchRun()

    expect(tracker.snapshot().changedSources).toEqual(['src/x.js'])
  })

  it('classifies a popup script edit as a page edit when the index holds resolved module paths', () => {
    const {real, unresolved} = symlinkedProject()
    fs.mkdirSync(path.join(real, 'src', 'action'), {recursive: true})
    fs.mkdirSync(path.join(real, 'src', 'content'), {recursive: true})
    fs.writeFileSync(path.join(real, 'src', 'action', 'scripts.js'), '\n')
    fs.writeFileSync(path.join(real, 'src', 'content', 'scripts.js'), '\n')

    const chunks = [
      {
        name: 'action/index',
        modules: [path.join(real, 'src', 'action', 'scripts.js')]
      },
      {
        name: 'content_scripts/content-0',
        modules: [
          `/abs/wrapper.js!${path.join(real, 'src', 'content', 'scripts.js')}|extensionjs-content-script`
        ]
      }
    ]
    const compilation: any = {
      chunks: chunks.map((chunk) => ({name: chunk.name})),
      chunkGraph: {
        getChunkModulesIterable: (chunk: {name: string}) =>
          chunks
            .find((each) => each.name === chunk.name)!
            .modules.map((id) => ({identifier: () => id}))
      }
    }

    const {compiler, tracker, fireWatchRun} = trackerAt(unresolved)
    compiler.modifiedFiles = new Set([
      path.join(real, 'src', 'action', 'scripts.js')
    ])

    fireWatchRun()

    const instruction = classifyReloadFromSources({
      changedSources: tracker.snapshot().changedSources,
      getContentScriptCount: () => 1,
      getSourceFeatureIndex: () =>
        buildSourceFeatureIndex(compilation, unresolved)
    })

    expect(instruction?.type).toBe('page')
    expect(instruction?.label).toBe('popup page (src/action/scripts.js)')
  })
})

// A broker double that records each call and answers what the test says.
function recordingBroker(answers: {
  delivered?: number
  broadcast?: () => number
  ack?: () => ReturnType<NonNullable<ReloadBroker['awaitReloadAck']>>
}) {
  const sent: unknown[] = []
  const broker: ReloadBroker = {
    broadcastReload: (instruction) => {
      sent.push(instruction)

      return answers.broadcast ? answers.broadcast() : (answers.delivered ?? 1)
    },
    ...(answers.ack ? {awaitReloadAck: answers.ack} : {})
  }

  return {broker, sent}
}

describe('dispatchReload when the broker fails', () => {
  // Pins current behavior: a broker failure is not caught here.
  it('rejects with the error a throwing broadcast raised', async () => {
    const gone = new Error('socket gone')
    const {broker, sent} = recordingBroker({
      broadcast: () => {
        throw gone
      }
    })

    await expect(dispatchReload(CS, {broker})).rejects.toBe(gone)
    expect(sent).toHaveLength(1)
    expect(fullReloadsDeliveredTo(broker)).toBe(0)
  })

  it('rejects with the error a rejected ack wait raised', async () => {
    const lost = new Error('ack channel closed')
    const {broker, sent} = recordingBroker({ack: () => Promise.reject(lost)})

    await expect(
      dispatchReload({type: 'full', label: 'extension'}, {broker})
    ).rejects.toBe(lost)

    expect(sent).toHaveLength(1)
    expect(fullReloadsDeliveredTo(broker)).toBe(0)
  })
})

describe('dispatchRestartReload', () => {
  it('sends one full reload for the extension when no build reloaded it since', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const {broker, sent} = recordingBroker({})

    await expect(dispatchRestartReload({broker}, 0)).resolves.toBe(true)
    expect(sent).toEqual([
      {
        type: 'full',
        changedContentScriptEntries: undefined,
        label: 'extension',
        changedFiles: undefined
      }
    ])

    expect(fullReloadsDeliveredTo(broker)).toBe(1)
    expect(log.mock.calls.map((call) => call.join(' '))).toEqual([
      expect.stringContaining('Reloading extension')
    ])
  })

  it('sends nothing when a build of the new compiler already reloaded it', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const {broker, sent} = recordingBroker({})
    await dispatchReload({type: 'full', label: 'manifest.json'}, {broker})
    sent.length = 0

    await expect(dispatchRestartReload({broker}, 0)).resolves.toBe(false)
    expect(sent).toEqual([])
    expect(fullReloadsDeliveredTo(broker)).toBe(1)
  })

  it('sends nothing and reports false with no broker', async () => {
    await expect(dispatchRestartReload({}, 0)).resolves.toBe(false)
  })
})

describe('fullReloadsDeliveredTo', () => {
  // A reload that restarts only the worker, or one no producer took, leaves
  // the new entry set unloaded, so neither counts.
  it('counts only a full reload a producer took', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const taken = {broadcastReload: vi.fn(() => 1)}
    const missed = {broadcastReload: vi.fn(() => 0)}

    await dispatchReload(
      {type: 'service-worker', label: 'service_worker (background.js)'},
      {broker: taken}
    )

    await dispatchReload({type: 'full', label: 'extension'}, {broker: missed})

    expect(fullReloadsDeliveredTo(taken)).toBe(0)
    expect(fullReloadsDeliveredTo(missed)).toBe(0)

    await dispatchReload({type: 'full', label: 'extension'}, {broker: taken})

    expect(fullReloadsDeliveredTo(taken)).toBe(1)
  })
})

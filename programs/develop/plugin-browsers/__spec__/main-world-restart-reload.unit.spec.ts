import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  bindDevSessionRestart,
  DevSessionRestartScheduler,
  unbindDevSessionRestart
} from '../../dev-server/session-restart'
import {
  isAwaitingMainWorldRestart,
  MAIN_WORLD_SETTLE_MS,
  WarnMainWorldRegistrationChanged
} from '../../plugin-web-extension/feature-scripts/steps/warn-main-world-registration-changed'
import {BrowsersPlugin} from '../index'

const roots: string[] = []

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  unbindDevSessionRestart()

  for (const root of roots.splice(0)) {
    fs.rmSync(root, {recursive: true, force: true})
  }
})

const REGISTRATION =
  'chrome.scripting.registerContentScripts([{id: "hook", js: ["scripts/hook.js"], ' +
  'world: "MAIN", matches: ["<all_urls>"]}])\n'
const IDLE = 'console.log("nothing registered")\n'

// A launched dev session past its first build: the step that asks for the
// restart and the plugin that reloads after a build share one compiler.
function launchedSession() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-main-reload-'))
  roots.push(root)

  const at = (name: string) => path.join(root, name)

  fs.mkdirSync(at('scripts'), {recursive: true})
  fs.writeFileSync(at('manifest.json'), '{}')
  fs.writeFileSync(at('scripts/hook.js'), 'window.__PAGE_HOOK__ = 1\n')
  fs.writeFileSync(at('background.js'), IDLE)

  const taps: Record<string, Array<(...args: any[]) => unknown>> = {}
  const hook = (name: string) => {
    const tap = (_name: string, callback: (...args: any[]) => unknown) => {
      taps[name] = [...(taps[name] || []), callback]
    }

    return {tap, tapPromise: tap}
  }
  const compiler = {
    options: {mode: 'development', context: root},
    modifiedFiles: new Set<string>(),
    hooks: {
      thisCompilation: hook('thisCompilation'),
      watchRun: hook('watchRun'),
      watchClose: hook('watchClose'),
      assetEmitted: hook('assetEmitted'),
      done: hook('done')
    }
  }

  new WarnMainWorldRegistrationChanged({
    manifestPath: at('manifest.json'),
    includeList: {
      'background/service_worker': at('background.js'),
      'scripts/hook': at('scripts/hook.js')
    }
  }).apply(compiler as any)

  const plugin = new BrowsersPlugin({
    launcher: vi.fn(),
    browserOptions: {browser: 'chrome'}
  } as never)
  const broadcastReload = vi.fn((_instruction: {type: string}) => 0)

  plugin.setReloadBroker({broadcastReload})
  Object.assign(plugin as object, {
    isFirstCompile: false,
    controller: {getExtensionLoadRefusal: () => null}
  })
  plugin.apply(compiler as any)

  return {
    broadcastReload,
    begin,
    write: (contents: string) =>
      fs.writeFileSync(at('background.js'), contents),
    compiler,
    // One watch rebuild after a save to the manifest, which always reloads.
    rebuild: async () => {
      await begin().finish()
    }
  }

  // The same rebuild in its two halves, for a build that is slow to end.
  function begin() {
    compiler.modifiedFiles = new Set([at('manifest.json')])

    const compilation = {
      warnings: [],
      errors: [],
      options: {context: root, output: {path: at('dist')}}
    }

    for (const run of taps.watchRun || []) run(compiler)
    for (const run of taps.thisCompilation || []) run(compilation)

    return {
      compilation,
      finish: async () => {
        for (const run of taps.done || []) await run({compilation})
      }
    }
  }
}

describe('the reload after a build that asked for a MAIN world restart', () => {
  it('reloads after an edit that leaves the registrations alone', async () => {
    bindDevSessionRestart(new DevSessionRestartScheduler(0))
    const dev = launchedSession()

    await dev.rebuild()

    expect(dev.broadcastReload).toHaveBeenCalledTimes(1)
    expect(dev.broadcastReload.mock.calls[0][0]).toMatchObject({type: 'full'})
  })

  // The build reloaded the extension and the restart reloaded it again a
  // moment later, so the background started twice for one edit.
  it('leaves the one reload to the restart', async () => {
    const restarts = vi.fn()
    const scheduler = new DevSessionRestartScheduler(0)

    scheduler.setHandler(restarts)
    bindDevSessionRestart(scheduler)

    const dev = launchedSession()

    dev.write(`${IDLE}${REGISTRATION}`)
    await dev.rebuild()

    expect(dev.broadcastReload).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(MAIN_WORLD_SETTLE_MS + 1)
    await dev.rebuild()

    expect(restarts).toHaveBeenCalledTimes(1)
    expect(dev.broadcastReload).not.toHaveBeenCalled()
  })

  it('reloads for the build that takes the call back before the restart', async () => {
    const restarts = vi.fn()
    const scheduler = new DevSessionRestartScheduler(0)

    scheduler.setHandler(restarts)
    bindDevSessionRestart(scheduler)

    const dev = launchedSession()

    dev.write(`${IDLE}${REGISTRATION}`)
    await dev.rebuild()
    dev.write(`${IDLE}// taken back\n`)
    await dev.rebuild()

    await vi.advanceTimersByTimeAsync(MAIN_WORLD_SETTLE_MS + 1)

    expect(restarts).not.toHaveBeenCalled()
    expect(dev.broadcastReload).toHaveBeenCalledTimes(1)
  })

  // The window ended while the build was still running, the set read as
  // taken back, and the build then reloaded for the call it was made with.
  it('holds a slow build back after the call was taken back mid-build', async () => {
    const restarts = vi.fn()
    const scheduler = new DevSessionRestartScheduler(0)

    scheduler.setHandler(restarts)
    bindDevSessionRestart(scheduler)

    const dev = launchedSession()

    dev.write(`${IDLE}${REGISTRATION}`)

    const slow = dev.begin()

    dev.write(`${IDLE}// taken back\n`)
    await vi.advanceTimersByTimeAsync(MAIN_WORLD_SETTLE_MS + 1)

    expect(isAwaitingMainWorldRestart(dev.compiler)).toBe(false)
    expect(isAwaitingMainWorldRestart(dev.compiler, slow.compilation)).toBe(
      true
    )

    await slow.finish()
    expect(dev.broadcastReload).not.toHaveBeenCalled()

    await dev.rebuild()
    await vi.advanceTimersByTimeAsync(MAIN_WORLD_SETTLE_MS + 1)

    expect(restarts).not.toHaveBeenCalled()
    expect(dev.broadcastReload).toHaveBeenCalledTimes(1)
  })

  // The session without a launched browser asks the same question of the
  // same build before it reloads, so one answer serves both.
  it('answers for the build, whichever path asks', async () => {
    bindDevSessionRestart(new DevSessionRestartScheduler(0))
    const dev = launchedSession()
    const plain = dev.begin()

    expect(isAwaitingMainWorldRestart(dev.compiler, plain.compilation)).toBe(
      false
    )

    await plain.finish()
    dev.write(`${IDLE}${REGISTRATION}`)

    const held = dev.begin()

    expect(isAwaitingMainWorldRestart(dev.compiler, held.compilation)).toBe(
      true
    )

    expect(isAwaitingMainWorldRestart(undefined, held.compilation)).toBe(true)
    expect(isAwaitingMainWorldRestart(undefined, plain.compilation)).toBe(false)
  })

  it('reloads as usual in a session that can only warn about the change', async () => {
    const dev = launchedSession()

    dev.write(`${IDLE}${REGISTRATION}`)
    await dev.rebuild()

    expect(dev.broadcastReload).toHaveBeenCalledTimes(1)
  })
})

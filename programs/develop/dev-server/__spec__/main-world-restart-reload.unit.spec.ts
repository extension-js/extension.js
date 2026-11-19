import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {BrowsersPlugin} from '../../plugin-browsers'
import {
  fakeCompilation,
  fakeCompiler
} from '../../plugin-browsers/__spec__/fake-compiler'
import {SafariDevPlugin} from '../../plugin-browsers/safari-dev-plugin'
import {WarnMainWorldRegistrationChanged} from '../../plugin-web-extension/feature-scripts/steps/warn-main-world-registration-changed'
import {MAIN_WORLD_SETTLE_MS} from '../main-world-restart'
import {
  bindDevSessionRestart,
  DevSessionRestartScheduler,
  unbindDevSessionRestart
} from '../session-restart'
import {isAwaitingMainWorldRestart} from '../session-restart-holds'

const roots: string[] = []

beforeEach(() => {
  expect.hasAssertions()
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
async function launchedSession() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-main-reload-'))
  roots.push(root)

  const at = (name: string) => path.join(root, name)

  fs.mkdirSync(at('scripts'), {recursive: true})
  fs.writeFileSync(at('manifest.json'), '{}')
  fs.writeFileSync(at('scripts/hook.js'), 'window.__PAGE_HOOK__ = 1\n')
  fs.writeFileSync(at('background.js'), IDLE)

  const fake = fakeCompiler({owner: BrowsersPlugin.name, context: root})

  new WarnMainWorldRegistrationChanged({
    manifestPath: at('manifest.json'),
    includeList: {
      'background/service_worker': at('background.js'),
      'scripts/hook': at('scripts/hook.js')
    }
  }).apply(fake.compiler)

  const launcher = vi.fn().mockResolvedValue({
    enableUnifiedLogging: vi.fn(),
    getExtensionLoadRefusal: () => null
  })
  const plugin = new BrowsersPlugin({
    launcher,
    browserOptions: {browser: 'chrome'}
  })
  const broadcastReload = vi.fn((_instruction: {type: string}) => 0)

  plugin.setReloadBroker({broadcastReload})
  plugin.setRestartHold(isAwaitingMainWorldRestart)
  plugin.apply(fake.compiler)

  // The same rebuild in its two halves, for a build that is slow to end.
  // A build that names web resources emits a manifest listing them.
  const begin = (
    files: string[] = ['manifest.json'],
    webResources?: string[]
  ) => {
    const compilation = fakeCompilation({
      context: root,
      output: at('dist'),
      ...(webResources
        ? {
            manifest: {
              manifest_version: 3,
              web_accessible_resources: [
                {resources: webResources, matches: ['<all_urls>']}
              ]
            }
          }
        : {})
    })

    fake.watchRun(files)
    fake.thisCompilation(compilation)

    return {
      compilation,
      finish: () => fake.done(compilation)
    }
  }

  // The first build launches the browser, as it does in a session.
  await begin([]).finish()
  expect(launcher).toHaveBeenCalledTimes(1)

  return {
    broadcastReload,
    begin,
    write: (contents: string) =>
      fs.writeFileSync(at('background.js'), contents),
    compiler: fake.compiler as object,
    // One watch rebuild after a save to the manifest, which always reloads.
    rebuild: async () => {
      await begin().finish()
    }
  }
}

describe('the reload after a build that asked for a MAIN world restart', () => {
  it('reloads after an edit that leaves the registrations alone', async () => {
    bindDevSessionRestart(new DevSessionRestartScheduler(0))
    const dev = await launchedSession()

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

    const dev = await launchedSession()

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

    const dev = await launchedSession()

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

    const dev = await launchedSession()

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
    const dev = await launchedSession()
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

  // The held build never reached the browser, so the next build is compared
  // with the one it did load, which named other web resources.
  it('compares the next build with the build the browser loaded', async () => {
    const scheduler = new DevSessionRestartScheduler(0)

    scheduler.setHandler(vi.fn())
    bindDevSessionRestart(scheduler)

    const dev = await launchedSession()

    await dev.begin(['pages/options.html'], ['111.js']).finish()
    expect(dev.broadcastReload).toHaveBeenCalledTimes(1)
    expect(dev.broadcastReload.mock.calls[0][0]).toMatchObject({type: 'full'})

    dev.write(`${IDLE}${REGISTRATION}`)
    await dev.begin(['background.js'], ['222.js']).finish()
    expect(dev.broadcastReload).toHaveBeenCalledTimes(1)

    dev.write(`${IDLE}// taken back\n`)
    await dev.begin(['pages/options.html'], ['222.js']).finish()

    expect(dev.broadcastReload.mock.calls.map((call) => call[0].type)).toEqual([
      'full',
      'full'
    ])
  })

  it('reloads as usual in a session that can only warn about the change', async () => {
    const dev = await launchedSession()

    dev.write(`${IDLE}${REGISTRATION}`)
    await dev.rebuild()

    expect(dev.broadcastReload).toHaveBeenCalledTimes(1)
  })
})

// Safari past its first package: the resync is itself the reload, so a
// held build that packaged would restart the extension before the restart.
async function packagedSafariSession() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-main-safari-'))
  roots.push(root)

  const at = (name: string) => path.join(root, name)

  fs.mkdirSync(at('scripts'), {recursive: true})
  fs.writeFileSync(at('manifest.json'), '{}')
  fs.writeFileSync(at('scripts/hook.js'), 'window.__PAGE_HOOK__ = 1\n')
  fs.writeFileSync(at('background.js'), IDLE)

  const fake = fakeCompiler({owner: SafariDevPlugin.name, context: root})

  new WarnMainWorldRegistrationChanged({
    manifestPath: at('manifest.json'),
    includeList: {
      'background/service_worker': at('background.js'),
      'scripts/hook': at('scripts/hook.js')
    }
  }).apply(fake.compiler)

  const packager = vi.fn(async (_dist: string, _mode: 'full' | 'resync') => {})
  const plugin = new SafariDevPlugin(packager)
  const broadcastReload = vi.fn((_instruction: {type: string}) => 0)
  const compiled = vi.fn()

  plugin.setReloadBroker({broadcastReload})
  plugin.setRestartHold(isAwaitingMainWorldRestart)
  plugin.emitter.on('compiled', compiled)
  plugin.apply(fake.compiler)

  const rebuild = async (files: string[] = ['manifest.json']) => {
    const compilation = fakeCompilation({context: root, output: at('dist')})

    fake.watchRun(files)
    fake.thisCompilation(compilation)
    await fake.done(compilation)
  }

  await rebuild([])
  expect(packager.mock.calls.map((call) => call[1])).toEqual(['full'])

  return {
    packager,
    broadcastReload,
    compiled,
    rebuild,
    write: (contents: string) => fs.writeFileSync(at('background.js'), contents)
  }
}

describe('the Safari package after a build that asked for a MAIN world restart', () => {
  it('packages an edit that leaves the registrations alone', async () => {
    bindDevSessionRestart(new DevSessionRestartScheduler(0))
    const safari = await packagedSafariSession()

    await safari.rebuild()

    expect(safari.packager.mock.calls.map((call) => call[1])).toEqual([
      'full',
      'resync'
    ])
  })

  it('leaves the package and the reload to the restart', async () => {
    const restarts = vi.fn()
    const scheduler = new DevSessionRestartScheduler(0)

    scheduler.setHandler(restarts)
    bindDevSessionRestart(scheduler)

    const safari = await packagedSafariSession()

    safari.write(`${IDLE}${REGISTRATION}`)
    await safari.rebuild()

    expect(safari.packager.mock.calls.map((call) => call[1])).toEqual(['full'])
    expect(safari.broadcastReload).not.toHaveBeenCalled()
    expect(safari.compiled).toHaveBeenLastCalledWith(
      expect.objectContaining({isFirstCompile: false})
    )

    await vi.advanceTimersByTimeAsync(MAIN_WORLD_SETTLE_MS + 1)

    expect(restarts).toHaveBeenCalledTimes(1)
  })
})

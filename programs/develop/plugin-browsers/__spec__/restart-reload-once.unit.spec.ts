import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  dispatchReload,
  dispatchRestartReload,
  fullReloadsDeliveredTo
} from '../../plugin-reload'
import {BrowsersPlugin} from '../index'

let printed: string[] = []

beforeEach(() => {
  printed = []
  vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
    printed.push(parts.join(' '))
  })

  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

const reloadingLines = () =>
  printed.filter((line) => line.includes('Reloading'))

// A launched session after a dev server restart: the plugin that reloads
// after a build is the same one, applied to the compiler that took over.
function restartedSession(loadedWebResources: string[]) {
  const taps: Array<(stats: unknown) => unknown> = []
  const compiler = {
    options: {mode: 'development', context: '/project'},
    modifiedFiles: new Set<string>(),
    hooks: {
      watchRun: {tap: () => {}},
      assetEmitted: {tap: () => {}},
      done: {
        tap: (_name: string, run: (stats: unknown) => unknown) => {
          taps.push(run)
        },
        tapPromise: (_name: string, run: (stats: unknown) => unknown) => {
          taps.push(run)
        }
      }
    }
  }
  const plugin = new BrowsersPlugin({
    launcher: vi.fn(),
    browserOptions: {browser: 'chrome'}
  } as never)
  const broker = {broadcastReload: vi.fn((_instruction: object) => 1)}

  plugin.setReloadBroker(broker)
  Object.assign(plugin as object, {
    isFirstCompile: false,
    controller: {getExtensionLoadRefusal: () => null},
    loadedWebResources
  })

  plugin.apply(compiler as never)

  return {
    broker,
    // The first build of the new compiler: no source changed under it, and
    // the manifest it emits is compared with the one the browser loaded.
    firstBuild: async (emittedWebResources: string[]) => {
      const manifest = JSON.stringify({
        manifest_version: 3,
        web_accessible_resources: [
          {resources: emittedWebResources, matches: ['<all_urls>']}
        ]
      })
      const compilation = {
        warnings: [],
        errors: [],
        options: {context: '/project', output: {path: '/project/dist'}},
        getAsset: (name: string) =>
          name === 'manifest.json'
            ? {source: {source: () => manifest}}
            : undefined
      }

      for (const run of taps) await run({compilation})
    }
  }
}

describe('the reload a restarted dev session owes', () => {
  // Adding a MAIN world registration restarted the session, the first build
  // reloaded the extension for its manifest, and the restart said so again.
  it('prints one line when the first build already reloaded the extension', async () => {
    const dev = restartedSession(['111.js'])
    const before = fullReloadsDeliveredTo(dev.broker)

    await dev.firstBuild(['222.js'])
    const restartReloaded = await dispatchRestartReload(
      {broker: dev.broker},
      before
    )

    expect(restartReloaded).toBe(false)
    expect(dev.broker.broadcastReload).toHaveBeenCalledTimes(1)
    expect(reloadingLines()).toHaveLength(1)
    expect(reloadingLines()[0]).toContain(
      'Reloading extension (manifest.json)…'
    )
  })

  it('reloads and prints its own line when the first build reloaded nothing', async () => {
    const dev = restartedSession(['111.js'])
    const before = fullReloadsDeliveredTo(dev.broker)

    await dev.firstBuild(['111.js'])
    const restartReloaded = await dispatchRestartReload(
      {broker: dev.broker},
      before
    )

    expect(restartReloaded).toBe(true)
    expect(dev.broker.broadcastReload).toHaveBeenCalledTimes(1)
    expect(dev.broker.broadcastReload.mock.calls[0][0]).toMatchObject({
      type: 'full',
      label: 'extension'
    })

    expect(reloadingLines()).toHaveLength(1)
    expect(reloadingLines()[0]).toContain('Reloading extension…')
  })

  it('still reloads after a full reload that came before the restart', async () => {
    const dev = restartedSession(['111.js'])

    await dispatchReload(
      {type: 'full', label: 'extension (manifest.json)'},
      {broker: dev.broker}
    )

    const before = fullReloadsDeliveredTo(dev.broker)

    await dev.firstBuild(['111.js'])

    expect(await dispatchRestartReload({broker: dev.broker}, before)).toBe(true)
    expect(dev.broker.broadcastReload).toHaveBeenCalledTimes(2)
    expect(reloadingLines()).toHaveLength(2)
  })

  // A reload that restarts only the worker, or one no producer took, leaves
  // the new entry set unloaded, so neither counts.
  it('counts only a full reload a producer took', async () => {
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

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  fakeCompilation,
  fakeCompiler
} from '../../plugin-browsers/__spec__/fake-compiler'
import {BrowsersPlugin} from '../../plugin-browsers/index'
import {
  dispatchReload,
  dispatchRestartReload,
  fullReloadsDeliveredTo
} from '../index'

const CONTEXT = '/project'
const OUTPUT = '/project/dist'

let printed: string[] = []

beforeEach(() => {
  expect.hasAssertions()
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

const build = (webResources: string[]) =>
  fakeCompilation({
    context: CONTEXT,
    output: OUTPUT,
    manifest: {
      manifest_version: 3,
      web_accessible_resources: [
        {resources: webResources, matches: ['<all_urls>']}
      ]
    }
  })

// A launched session after a dev server restart: the plugin that launched the
// browser on the first compiler is the same one, applied to its successor.
async function restartedSession(loadedWebResources: string[]) {
  const plugin = new BrowsersPlugin({
    launcher: vi.fn().mockResolvedValue({
      enableUnifiedLogging: vi.fn(),
      getExtensionLoadRefusal: () => null
    }),
    browserOptions: {browser: 'chrome'}
  })
  const broker = {broadcastReload: vi.fn((_instruction: object) => 1)}

  plugin.setReloadBroker(broker)

  const first = fakeCompiler({owner: BrowsersPlugin.name, context: CONTEXT})
  plugin.apply(first.compiler)
  await first.done(build(loadedWebResources))

  const next = fakeCompiler({owner: BrowsersPlugin.name, context: CONTEXT})
  plugin.apply(next.compiler)

  return {
    broker,
    // The first build of the new compiler: no source changed under it, and
    // the manifest it emits is compared with the one the browser loaded.
    firstBuild: async (emittedWebResources: string[]) => {
      next.watchRun([])
      await next.done(build(emittedWebResources))
    }
  }
}

describe('the reload a restarted dev session owes', () => {
  // Adding a MAIN world registration restarted the session, the first build
  // reloaded the extension for its manifest, and the restart said so again.
  it('prints one line when the first build already reloaded the extension', async () => {
    const dev = await restartedSession(['111.js'])
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
    const dev = await restartedSession(['111.js'])
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
    const dev = await restartedSession(['111.js'])

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
})

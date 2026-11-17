import {beforeEach, describe, expect, it, vi} from 'vitest'
import type {BrowserLaunchOptions} from '../index'

const registers = vi.fn((_compilation: object | undefined) => false)

vi.mock('../../plugin-reload', async () => {
  const actual = (await vi.importActual('../../plugin-reload')) as Record<
    string,
    unknown
  >

  return {...actual, readBootRegistrations: registers}
})

const {BrowsersPlugin} = await import('../index')
const {fakeCompilation, fakeCompiler} = await import('./fake-compiler')

const CONTEXT = '/tmp/ext'
const OUTPUT = '/tmp/ext/dist/chrome'

type Wait = (timeoutMs: number) => Promise<'settled' | 'timeout'>

async function launchOnce(broker?: {awaitBootRegistrations?: Wait}) {
  const launcher = vi.fn(async (_options: BrowserLaunchOptions) => ({
    enableUnifiedLogging: vi.fn().mockResolvedValue(undefined)
  }))
  const plugin = new BrowsersPlugin({
    launcher,
    browserOptions: {browser: 'chrome'}
  })
  plugin.extensionsToLoad = [OUTPUT]

  if (broker) {
    plugin.setReloadBroker({broadcastReload: () => 0, ...broker})
  }

  const fake = fakeCompiler({owner: BrowsersPlugin.name, context: CONTEXT})
  plugin.apply(fake.compiler)

  await fake.done(
    fakeCompilation({
      context: CONTEXT,
      output: OUTPUT,
      manifest: {manifest_version: 3, name: 'fake', version: '0'}
    })
  )

  expect(launcher).toHaveBeenCalledTimes(1)

  return launcher.mock.calls[0][0]
}

describe('the hold a launch is handed for boot registrations', () => {
  beforeEach(() => {
    expect.hasAssertions()
    registers.mockReset()
  })

  it('hands the dev server wait to a launch whose background registers', async () => {
    registers.mockReturnValue(true)
    const awaitBootRegistrations = vi.fn<Wait>().mockResolvedValue('settled')
    const options = await launchOnce({awaitBootRegistrations})

    await expect(options.awaitBootRegistrations?.(5000)).resolves.toBe(
      'settled'
    )

    expect(awaitBootRegistrations).toHaveBeenCalledWith(5000)
  })

  // Nothing to wait on means the first page opens when it always did.
  it('hands no wait to a launch whose background registers nothing', async () => {
    registers.mockReturnValue(false)
    const awaitBootRegistrations = vi.fn<Wait>().mockResolvedValue('settled')
    const options = await launchOnce({awaitBootRegistrations})

    expect('awaitBootRegistrations' in options).toBe(false)
    expect(awaitBootRegistrations).not.toHaveBeenCalled()
  })

  it('hands no wait when no dev server can answer it', async () => {
    registers.mockReturnValue(true)

    expect('awaitBootRegistrations' in (await launchOnce())).toBe(false)
    expect('awaitBootRegistrations' in (await launchOnce({}))).toBe(false)
  })
})

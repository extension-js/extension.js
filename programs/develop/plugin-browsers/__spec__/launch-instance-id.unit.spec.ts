import {beforeEach, describe, expect, it, vi} from 'vitest'
import type {BrowserType} from '../../types'
import {type BrowserLaunchOptions, BrowsersPlugin} from '../index'
import {fakeCompilation, fakeCompiler} from './fake-compiler'

const CONTEXT = '/tmp/ext'
const OUTPUT = '/tmp/ext/dist/firefox'

beforeEach(() => {
  expect.hasAssertions()
})

async function launchOnce(
  browserOptions: {browser: BrowserType; instanceId?: string},
  instanceId?: string
) {
  const launcher = vi.fn(async (_options: BrowserLaunchOptions) => ({
    enableUnifiedLogging: vi.fn().mockResolvedValue(undefined)
  }))
  const plugin = new BrowsersPlugin({launcher, browserOptions})
  plugin.extensionsToLoad = [OUTPUT]

  if (instanceId) plugin.setInstanceId(instanceId)

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

describe('BrowsersPlugin hands the session instance to the launcher', () => {
  it('launches with the instance id the dev server assigned', async () => {
    const options = await launchOnce({browser: 'firefox'}, 'a1b2c3d4e5f60718')

    expect(options.instanceId).toBe('a1b2c3d4e5f60718')
  })

  it('keeps an instance id the caller already set', async () => {
    const options = await launchOnce(
      {browser: 'firefox', instanceId: 'pinned'},
      'a1b2c3d4e5f60718'
    )

    expect(options.instanceId).toBe('pinned')
  })

  it('launches without one when none was assigned', async () => {
    const options = await launchOnce({browser: 'firefox'})

    expect('instanceId' in options).toBe(false)
  })
})

describe('BrowsersPlugin hands the launcher what the dev server set', () => {
  it('passes the log sink and the emulator viewer URL it was given', async () => {
    const sink = vi.fn()
    const launcher = vi.fn(async (_options: BrowserLaunchOptions) => ({
      enableUnifiedLogging: vi.fn().mockResolvedValue(undefined)
    }))
    const plugin = new BrowsersPlugin({
      launcher,
      browserOptions: {browser: 'chrome'}
    })
    plugin.setLogSink(sink)
    plugin.setEmulatorViewerUrl('http://127.0.0.1:8080/emulator')

    const fake = fakeCompiler({owner: BrowsersPlugin.name, context: CONTEXT})
    plugin.apply(fake.compiler)
    await fake.done(fakeCompilation({context: CONTEXT, output: OUTPUT}))

    expect(launcher.mock.calls[0][0]).toMatchObject({
      logSink: sink,
      emulatorViewerUrl: 'http://127.0.0.1:8080/emulator'
    })
  })

  it('names no emulator viewer when none was set', async () => {
    const options = await launchOnce({browser: 'chrome'})

    expect('emulatorViewerUrl' in options).toBe(false)
    expect(options.logSink).toBeUndefined()
  })
})

describe('BrowsersPlugin wakes a suspended background through the browser', () => {
  async function launched(wakeBackground?: () => Promise<boolean>) {
    const plugin = new BrowsersPlugin({
      launcher: async () => ({
        enableUnifiedLogging: vi.fn().mockResolvedValue(undefined),
        ...(wakeBackground ? {wakeBackground} : {})
      }),
      browserOptions: {browser: 'firefox'}
    })
    const fake = fakeCompiler({owner: BrowsersPlugin.name, context: CONTEXT})
    plugin.apply(fake.compiler)

    return {
      plugin,
      launch: () =>
        fake.done(fakeCompilation({context: CONTEXT, output: OUTPUT}))
    }
  }

  it('answers false until a browser is up', async () => {
    const wake = vi.fn(async () => true)
    const {plugin, launch} = await launched(wake)

    expect(await plugin.wakeBackground()).toBe(false)
    expect(wake).not.toHaveBeenCalled()

    await launch()

    expect(await plugin.wakeBackground()).toBe(true)
    expect(wake).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['cannot be asked', undefined],
    ['answers anything but true', async () => 'yes' as unknown as boolean],
    [
      'throws',
      async () => {
        throw new Error('RDP socket closed')
      }
    ]
  ])('answers false for a browser that %s', async (_title, wake) => {
    const {plugin, launch} = await launched(wake)
    await launch()

    expect(await plugin.wakeBackground()).toBe(false)
  })
})

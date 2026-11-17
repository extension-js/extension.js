import {beforeEach, describe, expect, it, vi} from 'vitest'
import {type BrowserLaunchOptions, BrowsersPlugin} from '../index'
import {fakeCompilation, fakeCompiler} from './fake-compiler'

const CONTEXT = '/tmp/ext'
const OUTPUT = '/tmp/ext/dist/firefox'

beforeEach(() => {
  expect.hasAssertions()
})

async function launchOnce(
  browserOptions: {browser: string; instanceId?: string},
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

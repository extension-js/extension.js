import {describe, expect, it, vi} from 'vitest'
import {type BrowserController, BrowsersPlugin} from '../index'

const CONTEXT = '/tmp/ext'
const OUTPUT = '/tmp/ext/dist/firefox'

function launchOnce(
  browserOptions: Record<string, unknown>,
  instanceId?: string
) {
  const controller: BrowserController = {
    enableUnifiedLogging: vi.fn().mockResolvedValue(undefined)
  }
  const launcher = vi.fn().mockResolvedValue(controller)
  const plugin = new BrowsersPlugin({launcher, browserOptions} as never)
  plugin.extensionsToLoad = [OUTPUT]

  if (instanceId) plugin.setInstanceId(instanceId)

  const doneSync: Array<(stats: unknown) => void> = []
  let doneCb: ((stats: unknown) => Promise<void>) | undefined
  const compiler: any = {
    options: {context: CONTEXT},
    hooks: {
      watchRun: {tap: () => {}},
      done: {
        tap: (_: string, fn: (s: unknown) => void) => doneSync.push(fn),
        tapPromise: (_: string, fn: (s: unknown) => Promise<void>) =>
          (doneCb = fn)
      },
      assetEmitted: {tap: () => {}}
    }
  }

  plugin.apply(compiler)

  const manifest = JSON.stringify({
    manifest_version: 3,
    name: 'fake',
    version: '0'
  })
  const stats = {
    compilation: {
      errors: [],
      options: {context: CONTEXT, output: {path: OUTPUT}},
      getAsset: (name: string) =>
        name === 'manifest.json'
          ? {source: {source: () => manifest}}
          : undefined
    }
  }

  return (async () => {
    for (const fn of doneSync) fn(stats)
    await doneCb?.(stats)

    return launcher.mock.calls[0]?.[0] as Record<string, unknown> | undefined
  })()
}

describe('BrowsersPlugin hands the session instance to the launcher', () => {
  it('launches with the instance id the dev server assigned', async () => {
    const options = await launchOnce({browser: 'firefox'}, 'a1b2c3d4e5f60718')

    expect(options?.instanceId).toBe('a1b2c3d4e5f60718')
  })

  it('keeps an instance id the caller already set', async () => {
    const options = await launchOnce(
      {browser: 'firefox', instanceId: 'pinned'},
      'a1b2c3d4e5f60718'
    )

    expect(options?.instanceId).toBe('pinned')
  })

  it('launches without one when none was assigned', async () => {
    const options = await launchOnce({browser: 'firefox'})

    expect(options).toBeDefined()
    expect(options?.instanceId).toBeUndefined()
  })
})

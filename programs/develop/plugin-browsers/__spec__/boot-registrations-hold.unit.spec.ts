import {beforeEach, describe, expect, it, vi} from 'vitest'

const registers = vi.fn((_compilation: object | undefined) => false)

vi.mock('../../plugin-reload', async () => {
  const actual = (await vi.importActual('../../plugin-reload')) as Record<
    string,
    unknown
  >

  return {...actual, readBootRegistrations: registers}
})

const {BrowsersPlugin} = await import('../index')

const CONTEXT = '/tmp/ext'
const OUTPUT = '/tmp/ext/dist/chrome'

type Wait = (timeoutMs: number) => Promise<'settled' | 'timeout'>

async function launchOnce(broker?: {awaitBootRegistrations?: Wait}) {
  const launcher = vi.fn().mockResolvedValue({
    enableUnifiedLogging: vi.fn().mockResolvedValue(undefined)
  })
  const plugin = new BrowsersPlugin({
    launcher,
    browserOptions: {browser: 'chrome'}
  } as never)
  plugin.extensionsToLoad = [OUTPUT]

  if (broker) {
    plugin.setReloadBroker({broadcastReload: () => 0, ...broker} as never)
  }

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

  for (const fn of doneSync) fn(stats)
  await doneCb?.(stats)

  return launcher.mock.calls[0]?.[0] as {awaitBootRegistrations?: Wait}
}

describe('the hold a launch is handed for boot registrations', () => {
  beforeEach(() => {
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

    expect(options).toBeDefined()
    expect('awaitBootRegistrations' in options).toBe(false)
    expect(awaitBootRegistrations).not.toHaveBeenCalled()
  })

  it('hands no wait when no dev server can answer it', async () => {
    registers.mockReturnValue(true)

    expect('awaitBootRegistrations' in (await launchOnce())).toBe(false)
    expect('awaitBootRegistrations' in (await launchOnce({}))).toBe(false)
  })
})

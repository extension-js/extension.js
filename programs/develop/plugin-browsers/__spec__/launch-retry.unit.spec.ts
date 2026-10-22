import {afterEach, describe, expect, it, vi} from 'vitest'

vi.mock('../../plugin-reload', () => ({
  buildSourceFeatureIndex: vi.fn(),
  classifyReloadFromSources: vi.fn(() => undefined),
  createChangedSourcesTracker: vi.fn(() => ({
    snapshot: () => ({forcedFull: false, changedSources: []})
  })),
  dispatchReload: vi.fn(),
  readContentScriptCount: vi.fn(() => 0),
  readContentScriptFiles: vi.fn(() => []),
  reloadForRenamedContentScripts: vi.fn((instruction) => instruction)
}))

import {BrowsersPlugin} from '../index'

afterEach(() => {
  vi.restoreAllMocks()
})

const stats = {
  compilation: {
    errors: [],
    options: {output: {path: '/tmp/dist/chrome'}, context: '/tmp/project'}
  }
}

const applyPlugin = (plugin: BrowsersPlugin) => {
  let done: ((s: unknown) => Promise<void>) | undefined
  const compiler = {
    hooks: {
      done: {
        tapPromise: (_name: string, fn: (s: unknown) => Promise<void>) => {
          done = fn
        }
      }
    }
  }

  plugin.apply(compiler as never)

  return () => (done as (s: unknown) => Promise<void>)(stats)
}

describe('browser launch slot', () => {
  it('launches again on the next compile after a launch that threw', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const controller = {enableUnifiedLogging: vi.fn()}
    const launcher = vi
      .fn()
      .mockRejectedValueOnce(new Error('Chrome binary not found'))
      .mockResolvedValueOnce(controller)
    const plugin = new BrowsersPlugin({
      launcher,
      browserOptions: {browser: 'chrome'}
    } as never)
    plugin.emitter.on('error', () => {})
    const compile = applyPlugin(plugin)

    await compile()
    await compile()

    expect(launcher).toHaveBeenCalledTimes(2)
  })

  it('reports the retried compile as the first one', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const launcher = vi
      .fn()
      .mockRejectedValueOnce(new Error('Chrome binary not found'))
      .mockResolvedValueOnce({enableUnifiedLogging: vi.fn()})
    const plugin = new BrowsersPlugin({
      launcher,
      browserOptions: {browser: 'chrome'}
    } as never)
    plugin.emitter.on('error', () => {})
    const firsts: boolean[] = []
    plugin.emitter.on('compiled', (event: {isFirstCompile: boolean}) =>
      firsts.push(event.isFirstCompile)
    )

    const compile = applyPlugin(plugin)

    await compile()
    await compile()

    expect(firsts).toEqual([true, true])
  })

  it('does not launch twice once a browser is up', async () => {
    const launcher = vi.fn(async () => ({enableUnifiedLogging: vi.fn()}))
    const plugin = new BrowsersPlugin({
      launcher,
      browserOptions: {browser: 'chrome'}
    } as never)
    const compile = applyPlugin(plugin)

    await compile()
    await compile()

    expect(launcher).toHaveBeenCalledTimes(1)
  })

  it('keeps a running browser when only logging setup fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const launcher = vi.fn(async () => ({
      enableUnifiedLogging: vi.fn(async () => {
        throw new Error('logging refused')
      })
    }))
    const plugin = new BrowsersPlugin({
      launcher,
      browserOptions: {browser: 'chrome', logLevel: 'info'}
    } as never)
    plugin.emitter.on('error', () => {})
    const compile = applyPlugin(plugin)

    await compile()
    await compile()

    expect(launcher).toHaveBeenCalledTimes(1)
  })
})

import {describe, expect, it, type Mock, vi} from 'vitest'
import type {BrowserLogger} from '../../browsers-types'
import {createChromiumContext} from '../../run-chromium/chromium-context'
import {
  ChromiumLaunchPlugin,
  type LaunchDoneStats
} from '../../run-chromium/chromium-launch'

type DoneHandler = (stats: LaunchDoneStats) => Promise<void>

interface FakeCompiler {
  getInfrastructureLogger: () => BrowserLogger
  hooks: {done: {tapPromise: (name: string, fn: DoneHandler) => void}}
}

// The private members the rows stub or set on the plugin.
interface LaunchInternals {
  launchChromium: Mock
  didReportReady: boolean
}

function internals(plugin: ChromiumLaunchPlugin) {
  return plugin as unknown as LaunchInternals
}

function tappedDoneHandler(handler: DoneHandler | null): DoneHandler {
  if (!handler) throw new Error('the plugin tapped no done hook')

  return handler
}

describe('ChromiumLaunchPlugin', () => {
  it('logs a launch error instead of swallowing it', async () => {
    const ctx = createChromiumContext()
    const plugin = new ChromiumLaunchPlugin(
      {
        browser: 'chrome',
        extension: ['/ext'],
        dryRun: false
      },
      ctx
    )

    let doneHandler: DoneHandler | null = null
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    }

    const compiler: FakeCompiler = {
      getInfrastructureLogger: () => logger,
      hooks: {
        done: {
          tapPromise: (_name, fn) => {
            doneHandler = fn
          }
        }
      }
    }

    internals(plugin).launchChromium = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))

    plugin.apply(compiler)
    expect(typeof doneHandler).toBe('function')

    await tappedDoneHandler(doneHandler)({
      hasErrors: () => false,
      compilation: {options: {mode: 'development'}, errors: []}
    })

    expect(logger.error).toHaveBeenCalled()
    const msg = String((logger.error.mock.calls[0] || [])[0] || '')
    expect(msg).toMatch(/Can't launch/i)
    expect(msg).toMatch(/boom/)
  })

  it('logs only the ready line from the done hook', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const ctx = createChromiumContext()
    const plugin = new ChromiumLaunchPlugin(
      {
        browser: 'chrome',
        extension: ['/ext'],
        dryRun: false
      },
      ctx
    )

    let doneHandler: DoneHandler | null = null
    const compiler: FakeCompiler = {
      getInfrastructureLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      }),
      hooks: {
        done: {
          tapPromise: (_name, fn) => {
            doneHandler = fn
          }
        }
      }
    }

    internals(plugin).launchChromium = vi.fn().mockResolvedValueOnce(undefined)

    plugin.apply(compiler)
    expect(typeof doneHandler).toBe('function')

    await tappedDoneHandler(doneHandler)({
      hasErrors: () => false,
      compilation: {options: {mode: 'development'}, errors: []}
    })

    expect(consoleSpy).toHaveBeenCalled()
    const readyCall = consoleSpy.mock.calls.find((call) =>
      /ready for development/i.test(String(call[0] || ''))
    )
    expect(readyCall).toBeDefined()
    consoleSpy.mockRestore()
  })

  it('does not log ready twice when launch path already reported it', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const ctx = createChromiumContext()
    const plugin = new ChromiumLaunchPlugin(
      {
        browser: 'chrome',
        extension: ['/ext'],
        dryRun: false
      },
      ctx
    )

    let doneHandler: DoneHandler | null = null
    const compiler: FakeCompiler = {
      getInfrastructureLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      }),
      hooks: {
        done: {
          tapPromise: (_name, fn) => {
            doneHandler = fn
          }
        }
      }
    }

    internals(plugin).launchChromium = vi
      .fn()
      .mockImplementationOnce(async () => {
        internals(plugin).didReportReady = true
      })

    plugin.apply(compiler)
    expect(typeof doneHandler).toBe('function')

    await tappedDoneHandler(doneHandler)({
      hasErrors: () => false,
      compilation: {options: {mode: 'development'}, errors: []}
    })

    const readyCalls = consoleSpy.mock.calls.filter((call) =>
      /ready for development/i.test(String(call[0] || ''))
    )
    expect(readyCalls).toHaveLength(0)
    consoleSpy.mockRestore()
  })

  it('reports the skipped launch only before the browser is up', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const ctx = createChromiumContext()
    const plugin = new ChromiumLaunchPlugin(
      {
        browser: 'chrome',
        extension: ['/ext'],
        dryRun: false
      },
      ctx
    )

    let doneHandler: DoneHandler | null = null
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    }
    const compiler: FakeCompiler = {
      getInfrastructureLogger: () => logger,
      hooks: {
        done: {
          tapPromise: (_name, fn) => {
            doneHandler = fn
          }
        }
      }
    }

    internals(plugin).launchChromium = vi.fn().mockResolvedValue(undefined)

    plugin.apply(compiler)

    const failing = {
      hasErrors: () => true,
      compilation: {options: {mode: 'development'}, errors: [new Error('x')]}
    }
    const skipped = () =>
      logger.info.mock.calls.filter((call) =>
        /Skipping the browser launch/.test(String(call[0] || ''))
      )

    await tappedDoneHandler(doneHandler)(failing)
    expect(skipped()).toHaveLength(1)
    expect(internals(plugin).launchChromium).not.toHaveBeenCalled()

    await tappedDoneHandler(doneHandler)({
      hasErrors: () => false,
      compilation: {options: {mode: 'development'}, errors: []}
    })

    expect(internals(plugin).launchChromium).toHaveBeenCalledTimes(1)

    await tappedDoneHandler(doneHandler)(failing)
    expect(skipped()).toHaveLength(1)
    expect(internals(plugin).launchChromium).toHaveBeenCalledTimes(1)
    consoleSpy.mockRestore()
  })
})

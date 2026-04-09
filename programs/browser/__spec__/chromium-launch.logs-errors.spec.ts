import {describe, it, expect, vi} from 'vitest'
import {ChromiumLaunchPlugin} from '../run-chromium/chromium-launch'
import {createChromiumContext} from '../run-chromium/chromium-context'

describe('ChromiumLaunchPlugin', () => {
  it('logs a launch error instead of swallowing it', async () => {
    const ctx = createChromiumContext()
    const plugin = new ChromiumLaunchPlugin(
      {
        browser: 'chrome',
        extension: ['/ext'],
        dryRun: false
      } as any,
      ctx as any
    )

    let doneHandler: any = null
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    }

    const compiler: any = {
      getInfrastructureLogger: () => logger,
      hooks: {
        done: {
          tapPromise: (_name: string, fn: any) => {
            doneHandler = fn
          }
        }
      }
    }

    // Force the internal launch step to throw (simulate spawn/detection failure)
    ;(plugin as any).launchChromium = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))

    plugin.apply(compiler)
    expect(typeof doneHandler).toBe('function')

    await doneHandler({
      hasErrors: () => false,
      compilation: {options: {mode: 'development'}, errors: []}
    })

    expect(logger.error).toHaveBeenCalled()
    const msg = String((logger.error.mock.calls[0] || [])[0] || '')
    expect(msg).toMatch(/Error launching/i)
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
      } as any,
      ctx as any
    )

    let doneHandler: any = null
    const compiler: any = {
      getInfrastructureLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      }),
      hooks: {
        done: {
          tapPromise: (_name: string, fn: any) => {
            doneHandler = fn
          }
        }
      }
    }

    ;(plugin as any).launchChromium = vi.fn().mockResolvedValueOnce(undefined)

    plugin.apply(compiler)
    expect(typeof doneHandler).toBe('function')

    await doneHandler({
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
      } as any,
      ctx as any
    )

    let doneHandler: any = null
    const compiler: any = {
      getInfrastructureLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      }),
      hooks: {
        done: {
          tapPromise: (_name: string, fn: any) => {
            doneHandler = fn
          }
        }
      }
    }

    ;(plugin as any).launchChromium = vi
      .fn()
      .mockImplementationOnce(async () => {
        ;(plugin as any).didReportReady = true
      })

    plugin.apply(compiler)
    expect(typeof doneHandler).toBe('function')

    await doneHandler({
      hasErrors: () => false,
      compilation: {options: {mode: 'development'}, errors: []}
    })

    const readyCalls = consoleSpy.mock.calls.filter((call) =>
      /ready for development/i.test(String(call[0] || ''))
    )
    expect(readyCalls).toHaveLength(0)
    consoleSpy.mockRestore()
  })
})

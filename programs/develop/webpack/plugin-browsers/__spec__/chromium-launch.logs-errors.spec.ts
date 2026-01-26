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
})

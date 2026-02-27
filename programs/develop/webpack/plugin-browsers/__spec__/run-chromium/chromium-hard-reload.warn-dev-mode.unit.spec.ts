import {describe, it, expect, vi, beforeEach} from 'vitest'
import {ChromiumHardReloadPlugin} from '../../run-chromium/chromium-hard-reload'

describe('ChromiumHardReloadPlugin - developer mode guidance', () => {
  let warnMock: ReturnType<typeof vi.fn>
  let infoMock: ReturnType<typeof vi.fn>
  let compiler: any
  let doneCb: ((stats: any) => Promise<void>) | undefined

  beforeEach(() => {
    warnMock = vi.fn()
    infoMock = vi.fn()
    doneCb = undefined

    // Minimal fake compiler with infrastructure logger and done hook
    compiler = {
      getInfrastructureLogger: () => ({
        info: (...a: unknown[]) => infoMock(...a),
        warn: (...a: unknown[]) => warnMock(...a),
        error: (..._a: unknown[]) => {},
        debug: (..._a: unknown[]) => {}
      }),
      hooks: {
        // watchRun not required for this unit (we set pending reason directly)
        done: {
          tapPromise: (_: string, cb: (stats: any) => Promise<void>) => {
            doneCb = cb
          }
        }
      }
    }
  })

  function makeStats() {
    return {
      hasErrors: () => false,
      compilation: {
        assets: {
          'manifest.json': {
            source: () =>
              JSON.stringify({
                background: {service_worker: 'background/sw.js'}
              })
          }
        }
      }
    }
  }

  function makeCtx(hardReloadOk: boolean) {
    let pending: 'manifest' | 'locales' | 'sw' | undefined
    const ctrl = {
      hardReload: vi.fn(async () => hardReloadOk)
    }
    return {
      getController: () => ctrl,
      onControllerReady: () => {},
      setController: () => {},
      getPorts: () => ({}),
      getExtensionRoot: () => '/ext',
      setExtensionRoot: () => {},
      setServiceWorkerPaths: () => {},
      getServiceWorkerPaths: () => ({}),
      setPendingReloadReason: (r?: 'manifest' | 'locales' | 'sw') => {
        pending = r
      },
      getPendingReloadReason: () => pending,
      clearPendingReloadReason: () => {
        pending = undefined
      }
    }
  }

  it('prints a one-time warning when hardReload() returns false', async () => {
    const ctx = makeCtx(false)
    const plugin = new ChromiumHardReloadPlugin({}, ctx as any)
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1000)
      .mockReturnValue(7000)
    plugin.apply(compiler as any)

    // First successful build warms up startup state.
    expect(doneCb).toBeTypeOf('function')
    await (doneCb as any)(makeStats())

    // simulate a pending hard-reload reason after warmup
    ;(ctx as any).setPendingReloadReason('manifest')
    await (doneCb as any)(makeStats())
    expect(warnMock).toHaveBeenCalledTimes(1)

    // subsequent failures should not spam the warning
    ;(ctx as any).setPendingReloadReason('manifest')
    await (doneCb as any)(makeStats())
    expect(warnMock).toHaveBeenCalledTimes(1)
  })

  it('does not warn when hardReload() succeeds', async () => {
    const ctx = makeCtx(true)
    const plugin = new ChromiumHardReloadPlugin({}, ctx as any)
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1000)
      .mockReturnValue(7000)
    plugin.apply(compiler as any)

    // First successful build warms up startup state.
    expect(doneCb).toBeTypeOf('function')
    await (doneCb as any)(makeStats())

    ;(ctx as any).setPendingReloadReason('manifest')
    await (doneCb as any)(makeStats())
    expect(warnMock).not.toHaveBeenCalled()
  })
})

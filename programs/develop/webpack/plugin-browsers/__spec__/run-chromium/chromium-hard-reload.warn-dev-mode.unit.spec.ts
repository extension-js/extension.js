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
        info: (...a: unknown[]) => (infoMock as any)(...a),
        warn: (...a: unknown[]) => (warnMock as any)(...a),
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

  function makeCtx(
    hardReloadOk: boolean,
    developerModeStatus: 'enabled' | 'disabled' | 'unknown' = 'unknown'
  ) {
    let pending: 'manifest' | 'locales' | 'sw' | undefined
    const ctrl = {
      hardReload: vi.fn(async () => hardReloadOk),
      getDeveloperModeStatus: vi.fn(() => developerModeStatus)
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
      },
      getControl: () => ctrl
    }
  }

  it('prints a one-time warning and skips reload when developer mode is disabled', async () => {
    const ctx = makeCtx(false, 'disabled')
    const plugin = new ChromiumHardReloadPlugin({}, ctx as any)
    vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValue(7000)
    plugin.apply(compiler as any)

    // First successful build warms up startup state.
    expect(doneCb).toBeTypeOf('function')
    await (doneCb as any)(makeStats())

    // simulate a pending hard-reload reason after warmup
    ;(ctx as any).setPendingReloadReason('manifest')
    await (doneCb as any)(makeStats())
    expect(warnMock).toHaveBeenCalledTimes(1)
    expect((ctx as any).getControl().hardReload).not.toHaveBeenCalled()

    // subsequent failures should not spam the warning
    ;(ctx as any).setPendingReloadReason('manifest')
    await (doneCb as any)(makeStats())
    expect(warnMock).toHaveBeenCalledTimes(1)
  })

  it('prints a one-time generic warning when reload fails and developer mode is unknown', async () => {
    const ctx = makeCtx(false, 'unknown')
    const plugin = new ChromiumHardReloadPlugin({}, ctx as any)
    vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValue(7000)
    plugin.apply(compiler as any)

    // First successful build warms up startup state.
    expect(doneCb).toBeTypeOf('function')
    await (doneCb as any)(makeStats())

    ;(ctx as any).setPendingReloadReason('manifest')
    await (doneCb as any)(makeStats())
    expect((ctx as any).getControl().hardReload).toHaveBeenCalledTimes(1)
    expect(warnMock).toHaveBeenCalledTimes(1)
  })

  it('does not warn when hardReload() succeeds', async () => {
    const ctx = makeCtx(true, 'enabled')
    const plugin = new ChromiumHardReloadPlugin({}, ctx as any)
    vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValue(7000)
    plugin.apply(compiler as any)

    // First successful build warms up startup state.
    expect(doneCb).toBeTypeOf('function')
    await (doneCb as any)(makeStats())

    ;(ctx as any).setPendingReloadReason('manifest')
    await (doneCb as any)(makeStats())
    expect(warnMock).not.toHaveBeenCalled()
  })
})

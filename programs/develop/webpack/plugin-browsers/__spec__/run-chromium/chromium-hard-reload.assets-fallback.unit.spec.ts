import {describe, expect, it, vi} from 'vitest'
import {ChromiumHardReloadPlugin} from '../../run-chromium/chromium-hard-reload'

vi.mock('../../run-chromium/manifest-readiness', () => ({
  waitForStableManifest: vi.fn(async () => true)
}))

describe('ChromiumHardReloadPlugin emitted asset fallback', () => {
  it('falls back to emitted assets when watchRun does not provide a reason', async () => {
    let doneHandler: ((stats: any) => Promise<void>) | undefined

    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    }

    const compiler: any = {
      options: {context: '/project/templates/react'},
      getInfrastructureLogger: () => logger,
      hooks: {
        watchRun: {
          tapAsync: vi.fn()
        },
        done: {
          tapPromise: (_name: string, handler: any) => {
            doneHandler = handler
          }
        }
      }
    }

    const hardReload = vi.fn(async () => true)
    let pendingReason: 'manifest' | 'locales' | 'sw' | undefined
    const ctx: any = {
      getController: () => ({
        hardReload,
        getDeveloperModeStatus: () => 'enabled'
      }),
      onControllerReady: () => {},
      setController: () => {},
      getPorts: () => ({}),
      getExtensionRoot: () => '/project/dist/chromium',
      setExtensionRoot: () => {},
      setServiceWorkerPaths: () => {},
      getServiceWorkerPaths: () => ({}),
      setPendingReloadReason: (reason?: 'manifest' | 'locales' | 'sw') => {
        pendingReason = reason
      },
      getPendingReloadReason: () => pendingReason,
      clearPendingReloadReason: () => {
        pendingReason = undefined
      }
    }

    const plugin = new ChromiumHardReloadPlugin({}, ctx)
    vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValue(7000)
    plugin.apply(compiler)

    const firstStats = {
      hasErrors: () => false,
      compilation: {
        getAssets: () => [],
        entrypoints: new Map(),
        chunkGraph: {}
      },
      toJson: () => ({assets: []})
    }

    await (doneHandler as any)(firstStats)

    const secondStats = {
      hasErrors: () => false,
      compilation: {
        assets: {
          'manifest.json': {
            source: () => JSON.stringify({})
          }
        },
        getAsset: (name: string) =>
          name === 'manifest.json'
            ? {
                source: {
                  source: () => JSON.stringify({})
                }
              }
            : undefined,
        getAssets: () => [
          {name: 'background/service_worker.js', emitted: true}
        ],
        entrypoints: new Map(),
        chunkGraph: {}
      },
      toJson: () => ({
        assets: [{name: 'background/service_worker.js', emitted: true}]
      })
    }

    await (doneHandler as any)(secondStats)

    expect(hardReload).toHaveBeenCalledTimes(1)
    expect(logger.info).toHaveBeenCalledWith(
      '[reload] reloading extension (reason:sw)'
    )
    expect(pendingReason).toBeUndefined()
  })
})

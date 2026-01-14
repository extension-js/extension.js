import {describe, it, expect} from 'vitest'
import {ChromiumHardReloadPlugin} from '../../run-chromium/chromium-hard-reload'

describe('ChromiumHardReloadPlugin - service worker source dependency tracking', () => {
  it('marks sw reload when a source dependency of the service worker changes', async () => {
    let watchRunHandler:
      | ((compilerWithModifiedFiles: any, done: () => void) => void)
      | undefined
    let doneHandler: ((stats: any) => Promise<void>) | undefined

    const compiler: any = {
      getInfrastructureLogger: () => ({
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {}
      }),
      hooks: {
        watchRun: {
          tapAsync: (_name: string, handler: any) => {
            watchRunHandler = handler
          }
        },
        done: {
          tapPromise: (_name: string, handler: any) => {
            doneHandler = handler
          }
        }
      }
    }

    let pendingReloadReason: 'manifest' | 'locales' | 'sw' | undefined
    const ctx: any = {
      getController: () => undefined,
      onControllerReady: () => {},
      setController: () => {},
      getPorts: () => ({}),
      getExtensionRoot: () => '/extension-dist',
      setExtensionRoot: () => {},
      setServiceWorkerPaths: () => {},
      getServiceWorkerPaths: () => ({}),
      setPendingReloadReason: (reason?: 'manifest' | 'locales' | 'sw') => {
        pendingReloadReason = reason
      },
      getPendingReloadReason: () => pendingReloadReason,
      clearPendingReloadReason: () => {
        pendingReloadReason = undefined
      }
    }

    const plugin = new ChromiumHardReloadPlugin({}, ctx)
    plugin.apply(compiler)

    expect(doneHandler).toBeTypeOf('function')
    expect(watchRunHandler).toBeTypeOf('function')

    const serviceWorkerEntrypointName = 'background/service_worker'
    const serviceWorkerChunk = {id: 'sw-chunk'}

    const compilation: any = {
      assets: {
        'manifest.json': {
          source: () =>
            JSON.stringify({
              background: {service_worker: 'background/service_worker.js'}
            })
        }
      },
      entrypoints: new Map([
        [
          serviceWorkerEntrypointName,
          {
            chunks: new Set([serviceWorkerChunk])
          }
        ]
      ]),
      chunkGraph: {
        getChunkModulesIterable: (chunk: any) => {
          if (chunk !== serviceWorkerChunk) return []
          return [
            {resource: '/project/src/service-worker.ts'},
            {resource: '/project/src/shared/util.ts'}
          ]
        }
      }
    }

    await (doneHandler as any)({
      hasErrors: () => false,
      compilation
    })

    // Simulate a source change to a transitive dependency of the SW.
    ;(watchRunHandler as any)(
      {
        modifiedFiles: new Set<string>(['/project/src/shared/util.ts'])
      },
      () => {}
    )

    expect(pendingReloadReason).toBe('sw')
  })
})


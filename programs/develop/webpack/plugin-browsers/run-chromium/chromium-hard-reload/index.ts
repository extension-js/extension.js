import * as path from 'path'
import type {Compilation, Compiler} from '@rspack/core'
import type {ChromiumContext} from '../chromium-context'

/**
 * ChromiumHardReloadPlugin
 *
 * Intended responsibilities:
 * - watchRun: detect manifest/_locales/SW changes and mark pending reason
 * - done: perform CDP hard reload when build succeeds
 */
export class ChromiumHardReloadPlugin {
  private logger?: ReturnType<Compiler['getInfrastructureLogger']>

  constructor(
    private readonly options: {
      autoReload?: boolean
    },
    private readonly ctx: ChromiumContext
  ) {}

  apply(compiler: Compiler) {
    if (this.options?.autoReload === false) {
      return
    }

    this.logger =
      typeof compiler?.getInfrastructureLogger === 'function'
        ? compiler.getInfrastructureLogger('RunChromiumPlugin')
        : ({
            info: (...a: unknown[]) => console.log(...a),
            warn: (...a: unknown[]) => console.warn(...a),
            error: (...a: unknown[]) => console.error(...a),
            debug: (...a: unknown[]) => (console as any)?.debug?.(...a)
          } as ReturnType<Compiler['getInfrastructureLogger']>)

    // watchRun: detect inputs that require hard reload
    if (compiler.hooks?.watchRun?.tapAsync) {
      compiler.hooks.watchRun.tapAsync(
        'run-browsers:watch',
        (compilation, done) => {
          try {
            const files = compilation?.modifiedFiles || new Set<string>()
            const normalizedFilePaths = Array.from(files).map((filePath) =>
              filePath.replace(/\\/g, '/')
            )

            const hitManifest = normalizedFilePaths.some((filePath) =>
              /(^|\/)manifest\.json$/i.test(filePath)
            )
            const localeChanged = normalizedFilePaths.some((filePath) =>
              /(^|\/)__?locales\/.+\.json$/i.test(filePath)
            )

            let serviceWorkerChanged = false

            const {
              absolutePath: serviceWorkerAbsolutePath,
              relativePath: serviceWorkerRelativePath
            } = this.ctx.getServiceWorkerPaths() || {}

            if (serviceWorkerAbsolutePath) {
              const normalizedServiceWorkerAbsolutePath =
                serviceWorkerAbsolutePath.replace(/\\/g, '/')

              serviceWorkerChanged = normalizedFilePaths.some((filePath) => {
                const normalizedPath = filePath.replace(/\\/g, '/')

                return (
                  normalizedPath === normalizedServiceWorkerAbsolutePath ||
                  normalizedPath.endsWith(
                    normalizedServiceWorkerAbsolutePath
                  ) ||
                  (serviceWorkerRelativePath
                    ? normalizedPath ===
                        serviceWorkerRelativePath.replace(/\\/g, '/') ||
                      normalizedPath.endsWith(
                        '/' + serviceWorkerRelativePath.replace(/\\/g, '/')
                      )
                    : false)
                )
              })
            }

            if (hitManifest) {
              this.ctx.setPendingReloadReason('manifest')
            } else if (localeChanged) {
              this.ctx.setPendingReloadReason('locales')
            } else if (serviceWorkerChanged) {
              this.ctx.setPendingReloadReason('sw')
            }
          } catch (error) {
            this.logger?.warn?.(
              '[reload-debug] watchRun inspect failed:',
              String(error)
            )
          }
          done()
        }
      )
    }

    // done: apply hard reload post successful compilation
    compiler.hooks.done.tapPromise('run-browsers:module', async (stats) => {
      const hasErrors =
        typeof stats?.hasErrors === 'function'
          ? stats.hasErrors()
          : !!stats?.compilation?.errors?.length

      if (hasErrors) {
        return
      }

      this.refreshSWFromManifest(stats.compilation)

      const reason = this.ctx.getPendingReloadReason()
      if (!reason) {
        return
      }

      this.ctx.clearPendingReloadReason()

      const ctrl = this.ctx.getController()
      if (!ctrl) {
        return
      }

      this.logger?.info?.(`[reload] reloading extension (reason:${reason})`)
      await ctrl.hardReload()
    })
  }

  private refreshSWFromManifest(compilation: Compilation) {
    try {
      const assets = compilation.assets as unknown as Record<
        string,
        {
          source: () => unknown
        }
      >
      const manifestStr = assets['manifest.json']
        ? String(assets['manifest.json'].source())
        : ''
      if (!manifestStr) return
      const parsed = JSON.parse(manifestStr) as {
        background?: {service_worker?: unknown}
      }
      const sw = parsed?.background?.service_worker as unknown
      if (typeof sw === 'string' && sw) {
        const extRoot = this.ctx.getExtensionRoot() || ''
        const abs = extRoot ? path.join(extRoot, sw) : undefined
        this.ctx.setServiceWorkerPaths(sw, abs)
      }
    } catch {
      // ignore
    }
  }
}

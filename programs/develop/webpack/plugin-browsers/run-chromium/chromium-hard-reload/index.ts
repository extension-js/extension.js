// ██████╗ ██╗   ██╗███╗   ██╗       ██████╗██╗  ██╗██████╗  ██████╗ ███╗   ███╗██╗██╗   ██╗███╗   ███╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║  ██║██╔══██╗██╔═══██╗████╗ ████║██║██║   ██║████╗ ████║
// ██████╔╝██║   ██║██╔██╗ ██║█████╗██║     ███████║██████╔╝██║   ██║██╔████╔██║██║██║   ██║██╔████╔██║
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██║     ██╔══██║██╔══██╗██║   ██║██║╚██╔╝██║██║██║   ██║██║╚██╔╝██║
// ██║  ██║╚██████╔╝██║ ╚████║      ╚██████╗██║  ██║██║  ██║╚██████╔╝██║ ╚═╝ ██║██║╚██████╔╝██║ ╚═╝ ██║
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝       ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as path from 'path'
import type {Compilation, Compiler} from '@rspack/core'
import type {ChromiumContext} from '../chromium-context'
import * as messages from '../../browsers-lib/messages'
import {emitActionEvent} from '../../browsers-lib/source-output'
import type {DevOptions} from '../../../webpack-types'

/**
 * ChromiumHardReloadPlugin
 *
 * Intended responsibilities:
 * - watchRun: detect manifest/_locales/SW changes and mark pending reason
 * - done: perform CDP hard reload when build succeeds
 */
export class ChromiumHardReloadPlugin {
  private logger?: ReturnType<Compiler['getInfrastructureLogger']>
  private warnedDevMode?: boolean
  private warnedHardReloadFailure?: boolean
  private hasCompletedSuccessfulBuild = false
  private firstSuccessfulBuildAtMs: number | null = null
  private static readonly INITIAL_RELOAD_COOLDOWN_MS = 5000
  /**
   * Tracks the *author/source* file paths that are part of the service worker entrypoint
   * (including transitive dependencies) from the last successful compilation.
   *
   * Why: `compiler.modifiedFiles` reports changed *source* paths, while the emitted
   * `manifest.json` reports *output* (dist) paths. Comparing those directly will fail.
   */
  private serviceWorkerSourceDependencyPaths: Set<string> = new Set()

  constructor(
    private readonly options: {
      autoReload?: boolean
      browser?: DevOptions['browser']
      source?: DevOptions['source']
      watchSource?: DevOptions['watchSource']
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
        (compilerWithModifiedFiles, done) => {
          try {
            const modifiedFiles: ReadonlySet<string> =
              compilerWithModifiedFiles?.modifiedFiles || new Set<string>()
            const normalizedModifiedFilePaths = Array.from(modifiedFiles).map(
              (filePath) => String(filePath).replace(/\\/g, '/')
            )
            const compilerContextRoot = String(
              compiler?.options?.context || ''
            ).replace(/\\/g, '/')
            const filesInCurrentCompilerContext = compilerContextRoot
              ? normalizedModifiedFilePaths.filter(
                  (filePath) =>
                    filePath === compilerContextRoot ||
                    filePath.startsWith(`${compilerContextRoot}/`)
                )
              : normalizedModifiedFilePaths
            const watchedModifiedFilePaths = compilerContextRoot
              ? filesInCurrentCompilerContext
              : normalizedModifiedFilePaths
            const normalizedOutputPath = String(
              compiler?.options?.output?.path || ''
            ).replace(/\\/g, '/')
            const normalizedSourceRootPath = compilerContextRoot
              ? `${compilerContextRoot}/src`
              : ''
            const sourceModifiedFilePaths = watchedModifiedFilePaths.filter(
              (filePath) =>
                !(
                  normalizedOutputPath &&
                  (filePath === normalizedOutputPath ||
                    filePath.startsWith(`${normalizedOutputPath}/`))
                )
            )

            const hitManifest = sourceModifiedFilePaths.some((filePath) => {
              if (normalizedSourceRootPath) {
                return filePath === `${normalizedSourceRootPath}/manifest.json`
              }
              return /(^|\/)manifest\.json$/i.test(filePath)
            })
            const localeChanged = sourceModifiedFilePaths.some((filePath) => {
              if (normalizedSourceRootPath) {
                return filePath.startsWith(
                  `${normalizedSourceRootPath}/_locales/`
                )
              }
              return /(^|\/)__?locales\/.+\.json$/i.test(filePath)
            })

            let serviceWorkerChanged = false

            // Preferred: compare against *source* dependency paths captured from the last successful compilation.
            // This correctly catches edits to the service worker entry *and* any imported module.
            if (this.serviceWorkerSourceDependencyPaths.size > 0) {
              serviceWorkerChanged = sourceModifiedFilePaths.some(
                (modifiedFilePath) => {
                  if (
                    this.serviceWorkerSourceDependencyPaths.has(
                      modifiedFilePath
                    )
                  ) {
                    return true
                  }

                  // Best-effort fallback for path normalization differences (symlinks, prefixes).
                  for (const serviceWorkerSourceDependencyPath of this
                    .serviceWorkerSourceDependencyPaths) {
                    if (
                      modifiedFilePath.endsWith(
                        serviceWorkerSourceDependencyPath
                      )
                    ) {
                      return true
                    }
                  }

                  return false
                }
              )
            } else {
              // Fallback: old behavior based on output path from the emitted manifest.
              // This is less reliable because it compares output paths vs source paths.
              const {
                absolutePath: serviceWorkerAbsolutePath,
                relativePath: serviceWorkerRelativePath
              } = this.ctx.getServiceWorkerPaths() || {}

              if (serviceWorkerAbsolutePath) {
                const normalizedServiceWorkerAbsolutePath =
                  serviceWorkerAbsolutePath.replace(/\\/g, '/')

                serviceWorkerChanged = sourceModifiedFilePaths.some(
                  (filePath) => {
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
                  }
                )
              }
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

      // Refresh tracking data from the successful compilation:
      // - output SW path (from emitted manifest asset)
      // - source SW dependency paths (from module graph)
      this.refreshSWFromManifest(stats.compilation)
      this.refreshServiceWorkerSourceDependencyPaths(stats.compilation)

      // First successful build is the extension cold-start phase.
      // Avoid any hard reload attempts here (manifest/sw/locales) because
      // Chromium can leave unpacked extensions disabled in this window.
      if (!this.hasCompletedSuccessfulBuild) {
        this.hasCompletedSuccessfulBuild = true
        this.firstSuccessfulBuildAtMs = Date.now()
        this.ctx.clearPendingReloadReason()
        return
      }

      const pendingReason = this.ctx.getPendingReloadReason()
      const reason = pendingReason

      if (!reason) {
        return
      }

      this.ctx.clearPendingReloadReason()

      const now = Date.now()

      if (
        this.firstSuccessfulBuildAtMs &&
        now - this.firstSuccessfulBuildAtMs <
          ChromiumHardReloadPlugin.INITIAL_RELOAD_COOLDOWN_MS
      ) {
        this.logger?.info?.(
          `[reload] skipping early reload during startup cooldown (reason:${reason})`
        )
        return
      }

      const ctrl = this.ctx.getController()
      if (!ctrl) {
        return
      }

      const developerModeStatus =
        typeof (ctrl as {getDeveloperModeStatus?: () => string})
          .getDeveloperModeStatus === 'function'
          ? (ctrl as {getDeveloperModeStatus: () => string}).getDeveloperModeStatus()
          : 'unknown'

      if (developerModeStatus === 'disabled') {
        if (!this.warnedDevMode) {
          this.warnedDevMode = true
          this.logger?.warn?.(
            messages.chromiumDeveloperModeGuidance(this.options?.browser)
          )
        }
        return
      }

      this.logger?.info?.(`[reload] reloading extension (reason:${reason})`)
      if (this.shouldEmitReloadActionEvent()) {
        emitActionEvent('extension_reload', {
          reason: reason || 'unknown',
          browser: this.options?.browser
        })
      }
      const reloadTimeoutMs = 8000
      const ok = await Promise.race<boolean>([
        ctrl.hardReload(),
        new Promise<boolean>((resolve) => {
          setTimeout(() => {
            this.logger?.warn?.(
              `[reload] hardReload timed out after ${reloadTimeoutMs}ms; continuing with source inspection`
            )
            resolve(false)
          }, reloadTimeoutMs)
        })
      ])

      if (!ok && !this.warnedHardReloadFailure) {
        this.warnedHardReloadFailure = true
        this.logger?.warn?.(
          messages.chromiumHardReloadFailed(this.options?.browser)
        )
      }
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

  private refreshServiceWorkerSourceDependencyPaths(compilation: Compilation) {
    try {
      const serviceWorkerEntrypointName = 'background/service_worker'
      const discovered = this.collectEntrypointModuleResourcePaths(
        compilation,
        serviceWorkerEntrypointName
      )
      this.serviceWorkerSourceDependencyPaths = discovered
    } catch {
      // ignore best-effort
    }
  }

  private collectEntrypointModuleResourcePaths(
    compilation: Compilation,
    entrypointName: string
  ): Set<string> {
    const collectedResourcePaths = new Set<string>()

    const entrypoints: Map<string, any> | undefined = (compilation as any)
      ?.entrypoints

    const entrypoint = entrypoints?.get?.(entrypointName)
    if (!entrypoint) {
      return collectedResourcePaths
    }

    const chunkGraph: any = (compilation as any)?.chunkGraph
    if (!chunkGraph) {
      return collectedResourcePaths
    }

    const entrypointChunks: any[] = Array.from(
      (entrypoint as any)?.chunks || []
    )

    for (const chunk of entrypointChunks) {
      const modulesIterable: Iterable<any> | undefined =
        chunkGraph.getChunkModulesIterable?.(chunk) ||
        chunkGraph.getChunkModulesIterableBySourceType?.(chunk, 'javascript') ||
        chunkGraph.getChunkModules?.(chunk)

      if (!modulesIterable) continue

      for (const module of modulesIterable as any) {
        const resourcePath: unknown =
          (module as any)?.resource ||
          (module as any)?.rootModule?.resource ||
          (module as any)?.originalSource?.()?.resource

        if (typeof resourcePath === 'string' && resourcePath.length > 0) {
          collectedResourcePaths.add(resourcePath.replace(/\\/g, '/'))
        }
      }
    }

    return collectedResourcePaths
  }

  private shouldEmitReloadActionEvent(): boolean {
    return Boolean(this.options?.source || this.options?.watchSource)
  }
}

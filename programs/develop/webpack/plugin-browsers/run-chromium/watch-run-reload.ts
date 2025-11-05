import type {Compiler} from '@rspack/core'

type PendingReason = 'manifest' | 'locales' | 'sw'

type ChromiumWatchRunReloadPluginDependencies = {
  logger: ReturnType<Compiler['getInfrastructureLogger']>
  getServiceWorkerPaths: () => {absolutePath?: string; relativePath?: string}
  setPendingReason: (reason: PendingReason) => void
}

export class ChromiumWatchRunReloadPlugin {
  private readonly dependencies: ChromiumWatchRunReloadPluginDependencies

  constructor(dependencies: ChromiumWatchRunReloadPluginDependencies) {
    this.dependencies = dependencies
  }

  apply(compiler: Compiler) {
    // Guard for minimal/mock compiler objects in unit tests
    // Skip when the hook isn't available
    if (!compiler.hooks?.watchRun?.tapAsync) {
      return
    }

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
          } = this.dependencies.getServiceWorkerPaths() || {}

          if (serviceWorkerAbsolutePath) {
            const normalizedServiceWorkerAbsolutePath =
              serviceWorkerAbsolutePath.replace(/\\/g, '/')

            serviceWorkerChanged = normalizedFilePaths.some((filePath) => {
              const normalizedPath = filePath.replace(/\\/g, '/')

              return (
                normalizedPath === normalizedServiceWorkerAbsolutePath ||
                normalizedPath.endsWith(normalizedServiceWorkerAbsolutePath) ||
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
            this.dependencies.setPendingReason('manifest')
          } else if (localeChanged) {
            this.dependencies.setPendingReason('locales')
          } else if (serviceWorkerChanged) {
            this.dependencies.setPendingReason('sw')
          }
        } catch (error) {
          this.dependencies.logger?.warn?.(
            '[reload-debug] watchRun inspect failed:',
            String(error)
          )
        }
        done()
      }
    )
  }
}

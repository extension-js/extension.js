import * as path from 'path'
import type {Compilation, Compiler} from '@rspack/core'
import type {CDPExtensionController} from './setup-chrome-inspection/cdp-extension-controller'

type PendingReason = 'manifest' | 'locales' | 'sw'

type Deps = {
  logger: ReturnType<Compiler['getInfrastructureLogger']>
  getExtensionRoot: () => string
  setServiceWorkerPaths: (rel?: string, abs?: string) => void
  getPendingReason: () => PendingReason | undefined
  clearPendingReason: () => void
  getController: () => CDPExtensionController | undefined
}

export class ChromiumDoneReloadPlugin {
  private readonly deps: Deps

  constructor(deps: Deps) {
    this.deps = deps
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
      const parsed = JSON.parse(manifestStr)
      const sw = parsed?.background?.service_worker
      if (typeof sw === 'string' && sw) {
        const abs = path.join(this.deps.getExtensionRoot(), sw)
        this.deps.setServiceWorkerPaths(sw, abs)
      }
    } catch {
      // ignore
    }
  }

  apply(compiler: Compiler) {
    compiler.hooks.done.tapAsync('run-browsers:module', (stats, done) => {
      const hasErrors =
        typeof stats?.hasErrors === 'function'
          ? stats.hasErrors()
          : !!stats?.compilation?.errors?.length

      if (hasErrors) {
        done()
        return
      }

      this.refreshSWFromManifest(stats.compilation)

      const reason = this.deps.getPendingReason()
      if (!reason) {
        done()
        return
      }

      this.deps.clearPendingReason()

      const ctrl = this.deps.getController()
      if (!ctrl) {
        done()
        return
      }

      this.deps.logger?.info?.(
        `[reload] reloading extension (reason:${reason})`
      )
      ctrl.hardReload().finally(done)
    })
  }
}

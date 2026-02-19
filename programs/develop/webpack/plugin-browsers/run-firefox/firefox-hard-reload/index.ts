// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import type {Compiler} from '@rspack/core'
import type {FirefoxContext} from '../firefox-context'
import type {FirefoxPluginRuntime} from '../firefox-types'
import {emitActionEvent} from '../../browsers-lib/source-output'

export class FirefoxHardReloadPlugin {
  private readonly host: FirefoxPluginRuntime
  private readonly ctx: FirefoxContext

  constructor(host: FirefoxPluginRuntime, ctx: FirefoxContext) {
    this.host = host
    this.ctx = ctx
  }

  apply(compiler: Compiler) {
    if (compiler?.hooks?.watchRun?.tapAsync) {
      compiler.hooks.watchRun.tapAsync(
        'run-browsers:watch',
        (compilation, done) => {
          try {
            const files =
              (compilation as any)?.modifiedFiles || new Set<string>()
            const normalized = Array.from(files).map((p: unknown) =>
              String(p).replace(/\\/g, '/')
            )

            const hitManifest = normalized.some((p) =>
              /(^|\/)manifest\.json$/i.test(p)
            )
            const hitLocales = normalized.some((p) =>
              /(^|\/)__?locales\/.+\.json$/i.test(p)
            )
            const hitServiceWorker = normalized.some((p) =>
              /(^|\/)(service_worker|background)\.(m?js|cjs|ts)$/i.test(p)
            )

            if (hitManifest) this.ctx.setPendingReloadReason?.('manifest')
            else if (hitLocales) this.ctx.setPendingReloadReason?.('locales')
            else if (hitServiceWorker) this.ctx.setPendingReloadReason?.('sw')
          } catch (error) {
            this.ctx.logger?.warn?.(
              '[reload] watchRun inspect failed:',
              String(error)
            )
          }
          done()
        }
      )
    }

    // On build done, compute changed assets and request hard reload via controller
    compiler.hooks.done.tapAsync('run-firefox:module', async (stats, done) => {
      const hasErrors =
        typeof stats?.hasErrors === 'function'
          ? stats.hasErrors()
          : !!stats?.compilation?.errors?.length

      if (hasErrors) {
        done()
        return
      }

      try {
        const compilation = stats?.compilation
        const assetsArr: Array<{name: string; emitted?: boolean}> =
          Array.isArray(compilation?.getAssets?.())
            ? (compilation!.getAssets() as any)
            : []

        const changed = assetsArr
          .filter((a) => (a as any)?.emitted)
          .map((a) => String((a as any)?.name || ''))

        const controller = (this.host as any)?.rdpController as
          | {hardReload: (c: any, assets: string[]) => Promise<void>}
          | undefined
        if (controller && typeof controller.hardReload === 'function') {
          const reason = this.ctx.getPendingReloadReason?.()

          if (this.shouldEmitReloadActionEvent()) {
            emitActionEvent('extension_reload', {
              reason: reason || 'unknown',
              browser: this.host.browser
            })
          }

          await controller.hardReload(stats.compilation, changed)
        }
      } catch {
        // Ignore
      }

      done()
    })
  }

  private shouldEmitReloadActionEvent(): boolean {
    return Boolean(this.host.source || this.host.watchSource)
  }
}

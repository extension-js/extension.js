import * as fs from 'fs'
import * as path from 'path'
import {type Compiler} from '@rspack/core'
import * as messages from '../../../../webpack-lib/messages'
import * as utils from '../../../../webpack-lib/utils'
import {type Manifest} from '../../../../webpack-types'
import {type DevOptions} from '../../../../../develop-lib/config-types'

export class SetupBackgroundEntry {
  private readonly manifestPath: string
  private readonly browser: DevOptions['browser']

  constructor(options: {
    manifestPath: string
    browser?: DevOptions['browser']
  }) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
  }

  private getMissingBackgroundError(filePath: string): string | undefined {
    if (!fs.existsSync(filePath)) {
      if (this.manifestPath) {
        const manifest = JSON.parse(fs.readFileSync(this.manifestPath, 'utf8'))
        const patchedManifest = utils.filterKeysForThisBrowser(
          manifest,
          this.browser
        )

        const fieldKey =
          patchedManifest.manifest_version === 3
            ? 'background/service_worker'
            : 'background/scripts'
        return messages.backgroundIsRequiredMessageOnly(fieldKey)
      }
    }
    return undefined
  }

  private addDefaultEntry(
    compiler: Compiler,
    name: string,
    defaultScript: string
  ) {
    compiler.options.entry = {
      ...compiler.options.entry,
      [name]: {import: [defaultScript]}
    }
  }

  apply(compiler: Compiler) {
    // Guards are handled at the root plugin level

    const manifest: Manifest = JSON.parse(
      fs.readFileSync(this.manifestPath, 'utf-8')
    )
    const browser = this.browser
    const minimumBgScript = path.resolve(
      __dirname,
      browser === 'firefox' || browser === 'gecko-based'
        ? 'minimum-firefox-file'
        : 'minimum-chromium-file'
    )

    const dirname = path.dirname(this.manifestPath)
    let manifestBg: Record<string, any> | undefined =
      utils.filterKeysForThisBrowser(manifest, browser)

    if (browser === 'firefox' || browser === 'gecko-based') {
      manifestBg = (manifestBg as any)?.background ?? manifest.background

      const backgroundScripts = manifestBg?.scripts

      if (backgroundScripts && backgroundScripts.length > 0) {
        const backgroundScriptsPath = path.join(dirname, backgroundScripts[0])
        const maybeError = this.getMissingBackgroundError(backgroundScriptsPath)
        if (maybeError) {
          compiler.hooks.thisCompilation.tap(
            'run-chromium:setup-background-entry',
            (compilation: any) => {
              const WebpackErrorCtor = (compiler as any)?.rspack?.WebpackError
              compilation.errors = compilation.errors || []
              compilation.errors.push(
                WebpackErrorCtor
                  ? new WebpackErrorCtor(maybeError)
                  : new Error(maybeError)
              )
            }
          )
        }
      } else {
        this.addDefaultEntry(compiler, 'background/script', minimumBgScript)
      }
    } else {
      manifestBg = (manifestBg as any)?.background ?? manifest.background

      if ((manifestBg as any) && (manifest as any).manifest_version === 3) {
        const serviceWorker = manifestBg?.service_worker

        if (serviceWorker) {
          const serviceWorkerPath = path.join(dirname, serviceWorker)
          const maybeError = this.getMissingBackgroundError(serviceWorkerPath)
          if (maybeError) {
            compiler.hooks.thisCompilation.tap(
              'run-chromium:setup-background-entry',
              (compilation: any) => {
                const WebpackErrorCtor = (compiler as any)?.rspack?.WebpackError
                compilation.errors = compilation.errors || []
                compilation.errors.push(
                  WebpackErrorCtor
                    ? new WebpackErrorCtor(maybeError)
                    : new Error(maybeError)
                )
              }
            )
          }
        } else {
          this.addDefaultEntry(
            compiler,
            'background/service_worker',
            minimumBgScript
          )
        }
      } else if ((manifest as any).manifest_version === 2) {
        const backgroundScripts = manifestBg?.scripts

        if (backgroundScripts && backgroundScripts.length > 0) {
          const backgroundScriptPath = path.join(dirname, backgroundScripts[0])
          const maybeError =
            this.getMissingBackgroundError(backgroundScriptPath)
          if (maybeError) {
            compiler.hooks.thisCompilation.tap(
              'run-chromium:setup-background-entry',
              (compilation: any) => {
                const WebpackErrorCtor = (compiler as any)?.rspack?.WebpackError
                compilation.errors = compilation.errors || []
                compilation.errors.push(
                  WebpackErrorCtor
                    ? new WebpackErrorCtor(maybeError)
                    : new Error(maybeError)
                )
              }
            )
          }
        } else {
          this.addDefaultEntry(compiler, 'background/script', minimumBgScript)
        }
      }
    }
  }
}

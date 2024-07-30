import fs from 'fs'
import path from 'path'
import webpack, {Compilation, Compiler} from 'webpack'
import * as messages from '../../../lib/messages'
import {PluginInterface, FilepathList} from '../../../webpack-types'

export class CheckManifestFiles {
  public readonly manifestPath: string
  public readonly includeList?: FilepathList
  public readonly excludeList?: FilepathList

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
    this.excludeList = options.excludeList
  }

  private handleErrors(
    compilation: Compilation,
    WebpackError: typeof webpack.WebpackError
  ) {
    const iconExts = ['.png', '.jpg', '.jpeg', '.svg', '.gif', '.webp']
    const jsonExts = ['.json']
    const scriptExts = ['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs']
    const htmlExt = '.html'

    const entries = Object.entries(this.includeList || {})

    for (const [field, value] of entries) {
      if (value) {
        const valueArr = Array.isArray(value) ? value : [value]

        for (const item of valueArr) {
          const ext = path.extname(item as string)
          const fieldError = messages.manifestFieldError(field, item as string)

          if (!fs.existsSync(item as string)) {
            if (iconExts.includes(ext)) {
              compilation.errors.push(new WebpackError(fieldError))
            } else if (jsonExts.includes(ext)) {
              compilation.errors.push(new WebpackError(fieldError))
            } else if (scriptExts.includes(ext)) {
              compilation.errors.push(new WebpackError(fieldError))
            } else if (ext === htmlExt) {
              compilation.errors.push(new WebpackError(fieldError))
            } else if (typeof value === 'object' && !Array.isArray(value)) {
              const icon = value as {light?: string; dark?: string}

              if (icon.light && !fs.existsSync(icon.light)) {
                const lightError = messages.manifestFieldError(
                  field,
                  icon.light
                )
                compilation.errors.push(new WebpackError(lightError))
              }

              if (icon.dark && !fs.existsSync(icon.dark)) {
                const darkError = messages.manifestFieldError(field, icon.dark)
                compilation.errors.push(new WebpackError(darkError))
              }
            } else {
              const unknownExtError = messages.manifestFieldError(field, item)
              compilation.errors.push(new WebpackError(unknownExtError))
            }
          }
        }
      }
    }
  }

  apply(compiler: Compiler) {
    compiler.hooks.compilation.tap(
      'manifest:check-manifest-files',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'manifest:check-manifest-files',
            stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_COMPATIBILITY
          },
          () => {
            const WebpackError = webpack.WebpackError

            // Handle all errors.
            this.handleErrors(compilation, WebpackError)
          }
        )
      }
    )
  }
}

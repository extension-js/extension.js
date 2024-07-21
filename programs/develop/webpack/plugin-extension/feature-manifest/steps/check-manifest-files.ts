import fs from 'fs'
import path from 'path'
import webpack, {Compilation, type Compiler} from 'webpack'
import * as messages from '../../../lib/messages'
import {type PluginInterface, type FilepathList} from '../../../types'

export class CheckManifestFiles {
  public readonly manifestPath: string
  public readonly includeList?: FilepathList
  public readonly excludeList?: FilepathList

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
    this.excludeList = options.excludeList
  }

  private handleHtmlErrors(
    compilation: Compilation,
    WebpackError: typeof webpack.WebpackError
  ) {
    const htmlFields = Object.entries(this.includeList || {}).filter(
      ([, resource]) =>
        typeof resource === 'string' && resource?.endsWith('html')
    )

    for (const [field, value] of htmlFields) {
      if (value) {
        const fieldError = messages.manifestFieldError(field, value as string)

        if (!fs.existsSync(value as string)) {
          compilation.errors.push(new WebpackError(fieldError))
        }
      }
    }
  }

  private handleIconsErrors(
    compilation: Compilation,
    WebpackError: typeof webpack.WebpackError
  ) {
    const iconExts = ['.png', '.jpg', '.jpeg', '.svg', '.gif', '.webp']
    const iconsFields = Object.entries(this.includeList || {}).filter(
      ([, resource]) =>
        typeof resource === 'string' &&
        iconExts.includes(path.extname(resource))
    )

    for (const [field, value] of Object.entries(iconsFields)) {
      if (value) {
        if (typeof value === 'string') {
          const fieldError = messages.manifestFieldError(field, value)

          if (!fs.existsSync(value)) {
            compilation.warnings.push(new WebpackError(fieldError))
          }
        }
      }

      if (value != null && value.constructor.name === 'Object') {
        const icon = value as {light?: string; dark?: string}

        if (icon.light) {
          const fieldError = messages.manifestFieldError(field, icon.light)

          if (!fs.existsSync(icon.dark!)) {
            compilation.warnings.push(new WebpackError(fieldError))
          }
        }

        if (icon.dark) {
          const fieldError = messages.manifestFieldError(field, icon.dark)

          if (!fs.existsSync(icon.dark)) {
            compilation.warnings.push(new WebpackError(fieldError))
          }
        }
      }

      if (Array.isArray(value)) {
        for (const icon of value) {
          const fieldError = messages.manifestFieldError(field, icon as string)

          if (typeof icon === 'string') {
            if (!fs.existsSync(icon)) {
              compilation.warnings.push(new WebpackError(fieldError))
            }
          }
        }
      }
    }
  }

  private handleJsonErrors(
    compilation: Compilation,
    WebpackError: typeof webpack.WebpackError
  ) {
    const iconExts = ['.json']
    const jsonFields = Object.entries(this.includeList || {}).filter(
      ([, resource]) =>
        typeof resource === 'string' &&
        iconExts.includes(path.extname(resource))
    )

    for (const [field, jsonPath] of jsonFields) {
      if (jsonPath) {
        const fieldError = messages.manifestFieldError(
          field,
          jsonPath as string
        )

        if (!fs.existsSync(jsonPath as string)) {
          compilation.warnings.push(new WebpackError(fieldError))
        }
      }
    }
  }

  private handleScriptsErrors(
    compilation: Compilation,
    WebpackError: typeof webpack.WebpackError
  ) {
    const iconExts = ['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs']
    const scriptsFields = Object.entries(this.includeList || {}).filter(
      ([, resource]) =>
        typeof resource === 'string' &&
        iconExts.includes(path.extname(resource))
    )

    for (const [field, value] of Object.entries(scriptsFields)) {
      if (value) {
        const valueArr = Array.isArray(value) ? value : [value]

        for (const script of valueArr) {
          if (field.startsWith('content_scripts')) {
            const [featureName, index] = field.split('-')
            const prettyFeature = `${featureName} (index ${index})`
            const fieldError = messages.manifestFieldError(
              prettyFeature,
              script as string
            )

            if (!fs.existsSync(script as string)) {
              compilation.errors.push(new WebpackError(fieldError))
            }
          } else {
            const fieldError = messages.manifestFieldError(
              field,
              script as string
            )

            if (!fs.existsSync(script as string)) {
              compilation.errors.push(new WebpackError(fieldError))
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
            // Summarize the list of existing assets.
            stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_COMPATIBILITY
          },
          () => {
            const WebpackError = webpack.WebpackError
            // Handle HTML errors.
            this.handleHtmlErrors(compilation, WebpackError)

            // Handle icons errors.
            this.handleIconsErrors(compilation, WebpackError)

            // Handle JSON errors.
            this.handleJsonErrors(compilation, WebpackError)

            // Handle scripts errors.
            this.handleScriptsErrors(compilation, WebpackError)
          }
        )
      }
    )
  }
}

import fs from 'fs'
import webpack, {Compilation, type Compiler} from 'webpack'
import manifestFields from 'browser-extension-manifest-fields'
import errors from '../helpers/messages'
import utils from '../helpers/utils'

class CheckManifestFilesPlugin {
  private readonly manifestPath: string

  constructor(options: {manifestPath: string}) {
    this.manifestPath = options.manifestPath
  }

  private handleHtmlErrors(
    compilation: Compilation,
    WebpackError: typeof webpack.WebpackError
  ) {
    const manifest = utils.getManifestContent(compilation, this.manifestPath)
    const htmlFields = manifestFields(this.manifestPath, manifest).html

    for (const [field, value] of Object.entries(htmlFields)) {
      if (value) {
        const fieldError = errors.manifestFieldError(field, value?.html)

        if (!fs.existsSync(value.html)) {
          compilation.errors.push(new WebpackError(fieldError))
        }
      }
    }
  }

  private handleIconsErrors(
    compilation: Compilation,
    WebpackError: typeof webpack.WebpackError
  ) {
    const manifest = utils.getManifestContent(compilation, this.manifestPath)
    const iconsFields = manifestFields(this.manifestPath, manifest).icons

    for (const [field, value] of Object.entries(iconsFields)) {
      if (value) {
        if (typeof value === 'string') {
          const fieldError = errors.manifestFieldError(field, value)

          if (!fs.existsSync(value)) {
            compilation.warnings.push(new WebpackError(fieldError))
          }
        }
      }

      if (value != null && value.constructor.name === 'Object') {
        const icon = value as {light?: string; dark?: string}

        if (icon.light) {
          const fieldError = errors.manifestFieldError(
            field,
            icon.light
          )

          if (!fs.existsSync(icon.dark!)) {
            compilation.warnings.push(new WebpackError(fieldError))
          }
        }

        if (icon.dark) {
          const fieldError = errors.manifestFieldError(
            field,
            icon.dark
          )

          if (!fs.existsSync(icon.dark)) {
            compilation.warnings.push(new WebpackError(fieldError))
          }
        }
      }

      if (Array.isArray(value)) {
        for (const icon of value) {
          const fieldError = errors.manifestFieldError(field, icon as string)

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
    const manifest = utils.getManifestContent(compilation, this.manifestPath)
    const jsonFields = manifestFields(this.manifestPath, manifest).json

    for (const [field, jsonPath] of Object.entries(jsonFields)) {
      if (jsonPath) {
        const fieldError = errors.manifestFieldError(field, jsonPath)

        if (!fs.existsSync(jsonPath)) {
          compilation.warnings.push(new WebpackError(fieldError))
        }
      }
    }
  }

  private handleScriptsErrors(
    compilation: Compilation,
    WebpackError: typeof webpack.WebpackError
  ) {
    const manifest = utils.getManifestContent(compilation, this.manifestPath)
    const scriptsFields = manifestFields(this.manifestPath, manifest).scripts

    for (const [field, value] of Object.entries(scriptsFields)) {
      if (value) {
        const valueArr = Array.isArray(value) ? value : [value]

        for (const script of valueArr) {
          if (field.startsWith('content_scripts')) {
            const [featureName, index] = field.split('-')
            const prettyFeature = `${featureName} (index ${index})`
            const fieldError = errors.manifestFieldError(prettyFeature, script)

            if (!fs.existsSync(script)) {
              compilation.errors.push(new WebpackError(fieldError))
            }
          } else {
            const fieldError = errors.manifestFieldError(field, script)

            if (!fs.existsSync(script)) {
              compilation.errors.push(new WebpackError(fieldError))
            }
          }
        }
      }
    }
  }

  apply(compiler: Compiler) {
    compiler.hooks.compilation.tap(
      'ManifestPlugin (CheckManifestFilesPlugin)',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'ManifestPlugin (CheckManifestFilesPlugin)',
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

export default CheckManifestFilesPlugin

import fs from 'fs'
import webpack, {Compilation, type Compiler} from 'webpack'
import manifestFields from 'browser-extension-manifest-fields'
import {manifestFieldError} from '../helpers/messages'

class CheckManifestFilesPlugin {
  private readonly manifestPath: string

  constructor(options: {manifestPath: string}) {
    this.manifestPath = options.manifestPath
  }

  private handleHtmlErrors(
    compilation: Compilation,
    WebpackError: typeof webpack.WebpackError
  ) {
    const manifest = require(this.manifestPath)
    const htmlFields = manifestFields(this.manifestPath, manifest).html

    for (const [field, value] of Object.entries(htmlFields)) {
      if (value) {
        const fieldError = manifestFieldError(field, value?.html)

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
    const manifest = require(this.manifestPath)
    const iconsFields = manifestFields(this.manifestPath, manifest).icons

    for (const [field, value] of Object.entries(iconsFields)) {
      if (value) {
        if (typeof value === 'string') {
          const fieldError = manifestFieldError(field, value)

          if (!fs.existsSync(value)) {
            compilation.errors.push(new WebpackError(fieldError))
          }
        }
      }

      if (value != null && value.constructor.name === 'Object') {
        const icon = value as {light?: string; dark?: string}

        if (icon.light) {
          const fieldError = manifestFieldError(field, icon.light as string)

          if (!fs.existsSync(icon.dark as string)) {
            compilation.errors.push(new WebpackError(fieldError))
          }
        }

        if (icon.dark) {
          const fieldError = manifestFieldError(field, icon.dark as string)

          if (!fs.existsSync(icon.dark as string)) {
            compilation.errors.push(new WebpackError(fieldError))
          }
        }
      }

      if (Array.isArray(value)) {
        for (const icon of value) {
          const fieldError = manifestFieldError(field, icon as string)

          if (typeof icon === 'string') {
            if (!fs.existsSync(icon)) {
              compilation.errors.push(new WebpackError(fieldError))
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
    const manifest = require(this.manifestPath)
    const jsonFields = manifestFields(this.manifestPath, manifest).json

    for (const [field, value] of Object.entries(jsonFields)) {
      if (value) {
        const valueArr = Array.isArray(value) ? value : [value]

        for (const json of valueArr) {
          const fieldError = manifestFieldError(field, json)

          if (!fs.existsSync(json)) {
            compilation.errors.push(new WebpackError(fieldError))
          }
        }
      }
    }
  }

  private handleScriptsErrors(
    compilation: Compilation,
    WebpackError: typeof webpack.WebpackError
  ) {
    const manifest = require(this.manifestPath)
    const scriptsFields = manifestFields(this.manifestPath, manifest).scripts

    for (const [field, value] of Object.entries(scriptsFields)) {
      if (value) {
        const valueArr = Array.isArray(value) ? value : [value]

        for (const script of valueArr) {
          if (field.startsWith('content_scripts')) {
            const [featureName, index] = field.split('-')
            const prettyFeature = `${featureName} (index ${index})`
            const fieldError = manifestFieldError(prettyFeature, script)

            if (!fs.existsSync(script)) {
              compilation.errors.push(new WebpackError(fieldError))
            }
          } else {
            const fieldError = manifestFieldError(field, script)

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
      'HandleCommonErrorsPlugin',
      (compilation) => {
        compilation.hooks.afterSeal.tapAsync(
          'HandleCommonErrorsPlugin',
          (done) => {
            const WebpackError = webpack.WebpackError
            // Handle HTML errors.
            this.handleHtmlErrors(compilation, WebpackError)

            // Handle icons errors.
            this.handleIconsErrors(compilation, WebpackError)

            // Handle JSON errors.
            this.handleJsonErrors(compilation, WebpackError)

            // Handle scripts errors.
            this.handleScriptsErrors(compilation, WebpackError)

            done()
          }
        )
      }
    )
  }
}

export default CheckManifestFilesPlugin

import type webpack from 'webpack'
import {
  handleMultipleAssetsError,
  handleTopLevelAwaitError
} from './src/compilationErrorHandlers'
import {
  handleInsecureCSPValue,
  handleWrongWebResourceFormatError
} from './src/browserRuntimeErrorHandlers'
import {type CommonErrorsPluginInterface} from './types'

export default class CommonErrorsPlugin {
  public readonly manifestPath: string

  constructor(options: CommonErrorsPluginInterface) {
    this.manifestPath = options.manifestPath
  }

  private handleCompilationErrors(compilation: webpack.Compilation) {
    compilation.errors.forEach((error, index) => {
      const multipleAssetsError = handleMultipleAssetsError(
        this.manifestPath,
        error
      )
      const topLevelAwaitError = handleTopLevelAwaitError(
        this.manifestPath,
        error
      )

      if (multipleAssetsError) {
        compilation.errors[index] = multipleAssetsError
      }

      if (topLevelAwaitError) {
        compilation.errors[index] = topLevelAwaitError
      }
    })
  }

  private handleBrowserRuntimeErrors(compilation: webpack.Compilation) {
    const insecureCSPValueError = handleInsecureCSPValue(this.manifestPath)
    const wrongWebResourceFormatError = handleWrongWebResourceFormatError(
      this.manifestPath
    )

    if (insecureCSPValueError) {
      compilation.errors.push(insecureCSPValueError)
    }

    if (wrongWebResourceFormatError) {
      compilation.errors.push(wrongWebResourceFormatError)
    }
  }

  apply(compiler: webpack.Compiler) {
    compiler.hooks.compilation.tap(
      'CommonErrorsPlugin (module)',
      (compilation) => {
        compilation.hooks.afterSeal.tapAsync(
          'CommonErrorsPlugin (module)',
          (done) => {
            // Handle errors related to compilation such
            // as multiple assets with the same name,
            // or missing dependencies.
            this.handleCompilationErrors(compilation)

            // Handle errors related to the browser
            // runtime such as insecure CSP values.
            this.handleBrowserRuntimeErrors(compilation)

            done()
          }
        )
      }
    )
  }
}

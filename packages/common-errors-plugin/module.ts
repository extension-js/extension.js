import webpack from 'webpack'
import {
  handleMultipleAssetsError
  // handleCantResolveError
} from './src/compilationErrorHandlers'
import {
  handleInsecureCSPValue,
  handleWrongWebResourceFormatError
} from './src/browserRuntimeErrorHandlers'
import {CommonErrorsPluginInterface} from './types'

export default class CommonErrorsPlugin {
  public readonly manifestPath: string

  constructor(options: CommonErrorsPluginInterface) {
    this.manifestPath = options.manifestPath
  }

  private handleCompilations(compilation: webpack.Compilation) {
    compilation.errors.forEach((error, index) => {
      const multipleAssetsError = handleMultipleAssetsError(error)
      // const cantResolveError = handleCantResolveError(error)

      if (multipleAssetsError) {
        compilation.errors[index] = multipleAssetsError
      }

      // if (cantResolveError) {
      // compilation.errors[index] = cantResolveError
      // }
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
      'HandleCommonErrorsPlugin',
      (compilation) => {
        compilation.hooks.afterSeal.tapAsync(
          'HandleCommonErrorsPlugin',
          (done) => {
            // Handle errors related to compilation such
            // as multiple assets with the same name,
            // or missing dependencies.
            this.handleCompilations(compilation)

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

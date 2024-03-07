import type webpack from 'webpack'
import {
  handleMultipleAssetsError,
  handleTopLevelAwaitError,
  handleCantResolveError
} from './steps/compilationErrorHandlers'
import {type CommonErrorsPluginInterface} from './types'

export default class CommonErrorsPlugin {
  public readonly manifestPath: string

  constructor(options: CommonErrorsPluginInterface) {
    this.manifestPath = options.manifestPath
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
            compilation.errors.forEach((error, index) => {
              const multipleAssetsError = handleMultipleAssetsError(
                this.manifestPath,
                error
              )
              const topLevelAwaitError = handleTopLevelAwaitError(
                this.manifestPath,
                error
              )
              const cantResolveError = handleCantResolveError(
                this.manifestPath,
                error
              )

              if (multipleAssetsError) {
                compilation.errors[index] = multipleAssetsError
              }

              if (topLevelAwaitError) {
                compilation.errors[index] = topLevelAwaitError
              }

              if (cantResolveError) {
                compilation.errors[index] = cantResolveError
              }
            })

            done()
          }
        )
      }
    )
  }
}

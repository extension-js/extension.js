import type webpack from 'webpack'
import {
  handleMultipleAssetsError,
  handleTopLevelAwaitError,
  handleCantResolveError
} from './compilation-error-handlers'
import {type PluginInterface} from '../../webpack-types'

export class WebpackCommonErrorsPlugin {
  public readonly manifestPath: string

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
  }

  apply(compiler: webpack.Compiler) {
    compiler.hooks.compilation.tap('develop:common-errors', (compilation) => {
      compilation.hooks.afterSeal.tapAsync('develop:common-errors', (done) => {
        // Handle errors related to compilation such
        // as multiple assets with the same name,
        // or missing dependencies.
        compilation.errors.forEach((error, index) => {
          const manifest = require(this.manifestPath)
          const multipleAssetsError = handleMultipleAssetsError(manifest, error)
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
      })
    })
  }
}

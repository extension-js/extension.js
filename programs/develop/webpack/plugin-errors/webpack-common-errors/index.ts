import fs from 'fs'
import path from 'path'
import {type Compiler} from '@rspack/core'
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

  apply(compiler: Compiler) {
    const packageJsonPath = path.join(
      path.dirname(this.manifestPath),
      'package.json'
    )

    if (!fs.existsSync(packageJsonPath)) {
      return
    }

    const packageName = require(packageJsonPath).name

    compiler.hooks.compilation.tap('develop:common-errors', (compilation) => {
      compilation.hooks.afterSeal.tapAsync('develop:common-errors', (done) => {
        // Handle errors related to compilation such
        // as multiple assets with the same name,
        // or missing dependencies.
        compilation.errors.forEach((error, index) => {
          const multipleAssetsError = handleMultipleAssetsError(
            packageName,
            error
          )
          const topLevelAwaitError = handleTopLevelAwaitError(
            packageName,
            error
          )
          const cantResolveError = handleCantResolveError(packageName, error)

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

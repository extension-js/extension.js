import webpack from 'webpack'
import {IncludeList, type StepPluginInterface} from '../types'
import errors from '../helpers/errors'

export default class CommonErrorsPlugin {
  public readonly manifestPath: string
  public readonly includeList: IncludeList

  constructor(options: StepPluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
  }

  apply(compiler: webpack.Compiler) {
    compiler.hooks.compilation.tap(
      'HtmlPlugin (HandleCommonErrors)',
      (compilation) => {
        compilation.hooks.afterSeal.tapPromise(
          'HtmlPlugin (HandleCommonErrors)',
          async () => {
            compilation.errors.forEach((error, index) => {
              // Handle "Module not found" errors.
              // This is needed because we can't recompile entrypoints at runtime.
              // This does not cover static assets because they are not entrypoints.
              // For that we use the AddAssetsToCompilationPlugin.
              const cantResolveError = errors.handleCantResolveError(
                this.manifestPath,
                this.includeList,
                error
              )
              if (cantResolveError) {
                compilation.errors[index] = cantResolveError
              }
            })
          }
        )
      }
    )
  }
}

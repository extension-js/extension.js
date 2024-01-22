import fs from 'fs'
import webpack from 'webpack'
import manifestFields from 'browser-extension-manifest-fields'

import {fileError} from '../helpers/messages'
import getAssetsFromHtml from '../lib/getAssetsFromHtml'
import {HtmlPluginInterface} from '../types'

export function handleCantResolveError(
  manifestPath: string,
  error: webpack.WebpackError
) {
  const cantResolveMsg = "Module not found: Error: Can't resolve "
  const customError = error.message.replace(cantResolveMsg, '')
  const wrongFilename = customError.split("'")[1]

  if (error.message.includes(cantResolveMsg)) {
    const htmlFields = manifestFields(manifestPath).html

    for (const field of Object.entries(htmlFields)) {
      const [feature, resource] = field

      // Resources from the manifest lib can come as undefined.
      if (resource?.html) {
        if (!fs.existsSync(resource?.html)) return null

        const htmlAssets = getAssetsFromHtml(resource?.html)
        const jsAssets = htmlAssets?.js || []
        const cssAssets = htmlAssets?.css || []

        if (
          jsAssets.includes(wrongFilename) ||
          cssAssets.includes(wrongFilename)
        ) {
          const errorMsg = fileError(resource?.html, wrongFilename)
          return new webpack.WebpackError(errorMsg)
        }
      }
    }
  }

  return null
}

export default class CommonErrorsPlugin {
  public readonly manifestPath: string

  constructor(options: HtmlPluginInterface) {
    this.manifestPath = options.manifestPath
  }

  apply(compiler: webpack.Compiler) {
    compiler.hooks.compilation.tap(
      'HandleCommonErrorsPlugin',
      (compilation) => {
        compilation.hooks.afterSeal.tapPromise(
          'HandleCommonErrorsPlugin',
          async () => {
            compilation.errors.forEach((error, index) => {
              // Handle "Module not found" errors.
              // This is needed because we can't recompile entrypoints at runtime.
              // This does not cover static assets because they are not entrypoints.
              // For that we use the AddAssetsToCompilationPlugin.
              const cantResolveError = handleCantResolveError(
                this.manifestPath,
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

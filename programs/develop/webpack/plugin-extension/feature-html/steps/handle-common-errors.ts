import fs from 'fs'
import {WebpackError, type Compiler} from 'webpack'

import {type FilepathList, type PluginInterface} from '../../../webpack-types'
import {getAssetsFromHtml} from '../html-lib/utils'
import * as messages from '../../../lib/messages'

function handleCantResolveError(
  manifestPath: string,
  includesList: FilepathList,
  error: NodeJS.ErrnoException
) {
  const cantResolveMsg = "Module not found: Error: Can't resolve "
  const customError = error.message.replace(cantResolveMsg, '')
  const wrongFilename = customError.split("'")[1]

  if (error.message.includes(cantResolveMsg)) {
    for (const field of Object.entries(includesList)) {
      const [, resource] = field

      // Resources from the manifest lib can come as undefined.
      if (resource) {
        if (!fs.existsSync(resource as string)) return null

        const htmlAssets = getAssetsFromHtml(resource as string)
        const jsAssets = htmlAssets?.js || []
        const cssAssets = htmlAssets?.css || []

        if (
          jsAssets.includes(wrongFilename) ||
          cssAssets.includes(wrongFilename)
        ) {
          const errorMsg = messages.fileNotFound(
            manifestPath,
            resource as string,
            wrongFilename
          )
          return new WebpackError(errorMsg)
        }
      }
    }
  }

  return null
}

export class HandleCommonErrors {
  public readonly manifestPath: string
  public readonly includeList?: FilepathList

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
  }

  apply(compiler: Compiler) {
    compiler.hooks.compilation.tap(
      'html:handle-common-errors',
      (compilation) => {
        compilation.hooks.afterSeal.tapPromise(
          'html:handle-common-errors',
          async () => {
            compilation.errors.forEach((error, index) => {
              // Handle "Module not found" errors.
              // This is needed because we can't recompile entrypoints at runtime.
              // This does not cover static assets because they are not entrypoints.
              // For that we use the AddAssetsToCompilationPlugin.
              const cantResolveError = handleCantResolveError(
                this.manifestPath,
                this.includeList || {},
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

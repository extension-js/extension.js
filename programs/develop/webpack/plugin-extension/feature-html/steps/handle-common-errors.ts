import * as fs from 'fs'
import {WebpackError, type Compiler, type StatsError} from '@rspack/core'

import {type FilepathList, type PluginInterface} from '../../../webpack-types'
import {getAssetsFromHtml} from '../html-lib/utils'
import * as messages from '../../../lib/messages'

function handleCantResolveError(includesList: FilepathList, error: StatsError) {
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
        // Allow users to define absolute paths without errors.
        const jsAssets =
          htmlAssets?.js?.filter((asset) => !asset.startsWith('/')) || []
        // Allow users to define absolute paths without errors.
        const cssAssets =
          htmlAssets?.css?.filter((asset) => !asset.startsWith('/')) || []

        if (
          jsAssets.includes(wrongFilename) ||
          cssAssets.includes(wrongFilename)
        ) {
          const errorMsg = messages.fileNotFound(
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
                this.includeList || {},
                error as StatsError
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

import path from 'path'
import fs from 'fs'
import type webpack from 'webpack'
import {type FilepathList, type PluginInterface} from '../../../webpack-types'
import * as utils from '../../../lib/utils'
import * as htmlUtils from '../html-lib/utils'

export class AddScriptsAndStylesToCompilation {
  public readonly manifestPath: string
  public readonly includeList?: FilepathList
  public readonly excludeList?: FilepathList

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
    this.excludeList = options.excludeList
  }

  public apply(compiler: webpack.Compiler) {
    const htmlEntries = this.includeList || {}

    for (const field of Object.entries(htmlEntries)) {
      const [feature, resource] = field

      // Resources from the manifest lib can come as undefined.
      if (resource) {
        if (!fs.existsSync(resource as string)) return

        const htmlAssets = htmlUtils.getAssetsFromHtml(resource as string)
        const jsAssets = htmlAssets?.js || []
        const cssAssets = htmlAssets?.css || []
        const fileAssets = [...jsAssets, ...cssAssets].filter(
          (asset) => !utils.shouldExclude(asset, this.excludeList)
        )

        if (compiler.options.mode === 'development') {
          // you can't HMR without a .js file, so we add a minimum script file.
          const hmrScript = path.resolve(__dirname, 'minimum-script-file.mjs')
          fileAssets.push(hmrScript)
        }

        if (fs.existsSync(resource as string)) {
          if (!utils.shouldExclude(resource as string, this.excludeList)) {
            compiler.options.entry = {
              ...compiler.options.entry,
              // https://webpack.js.org/configuration/entry-context/#entry-descriptor
              [feature]: {
                import: fileAssets
              }
            }
          }
        }
      }
    }
  }
}

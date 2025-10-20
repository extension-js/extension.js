import * as path from 'path'
import * as fs from 'fs'
import {type Compiler} from '@rspack/core'
import {type FilepathList, type PluginInterface} from '../../../webpack-types'
import * as utils from '../../../../develop-lib/utils'
import * as htmlUtils from '../html-lib/utils'

export class AddScriptsAndStylesToCompilation {
  public readonly manifestPath: string
  public readonly includeList?: FilepathList
  public readonly excludeList?: FilepathList
  public readonly browser?: string

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
    this.excludeList = options.excludeList
    this.browser = options.browser
  }

  public apply(compiler: Compiler) {
    const htmlEntries = this.includeList || {}

    for (const field of Object.entries(htmlEntries)) {
      const [feature, resource] = field

      // Resources from the manifest lib can come as undefined.
      if (resource) {
        if (!fs.existsSync(resource as string)) continue

        const htmlAssets = htmlUtils.getAssetsFromHtml(resource as string)
        // Treat absolute URL paths that point to files under public/ as public-root assets;
        // do not add them as entries. Absolute filesystem paths should still be bundled.
        const projectPath = path.dirname(this.manifestPath)
        const isPublicRootUrl = (assetPath: string) => {
          if (!assetPath.startsWith('/')) return false
          // Map "/foo/bar" → <project>/public/foo/bar (lowercase only)
          const candidate = path.join(projectPath, 'public', assetPath.slice(1))
          return fs.existsSync(candidate)
        }

        const jsAssets = (htmlAssets?.js || []).filter(
          (asset) => !isPublicRootUrl(asset)
        )
        const cssAssets = (htmlAssets?.css || []).filter(
          (asset) => !isPublicRootUrl(asset)
        )
        const fileAssets = [...jsAssets, ...cssAssets].filter(
          (asset) => !utils.shouldExclude(asset, this.excludeList)
        )

        if (compiler.options.mode === 'development') {
          // you can't HMR without a .js file, so we add a minimum script file.
          const hmrScript = path.resolve(__dirname, 'minimum-script-file')
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

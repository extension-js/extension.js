import * as path from 'path'
import * as fs from 'fs'
import {type Compiler} from '@rspack/core'
import {type FilepathList, type PluginInterface} from '../../../webpack-types'
import * as htmlUtils from '../html-lib/utils'

export class AddScriptsAndStylesToCompilation {
  public readonly manifestPath: string
  public readonly includeList?: FilepathList
  public readonly excludeList?: FilepathList
  public readonly browser?: string

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
    this.excludeList = {}
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
        // Parity with special-folders and @feature-scripts:
        // Exclude only public-root URL references (leading '/') that do NOT
        // exist on disk. Absolute filesystem paths must still be bundled.
        // Remote URLs are excluded as well.
        const isRemoteUrl = (p: string) => /^(https?:)?\/\//i.test(p)
        const looksLikePublicRootUrl = (p: string) =>
          p.startsWith('/') && !fs.existsSync(p)
        const jsAssets = (htmlAssets?.js || []).filter(
          (asset) => !looksLikePublicRootUrl(asset) && !isRemoteUrl(asset)
        )
        const cssAssets = (htmlAssets?.css || []).filter(
          (asset) => !looksLikePublicRootUrl(asset) && !isRemoteUrl(asset)
        )
        const fileAssets = [...jsAssets, ...cssAssets]

        if (compiler.options.mode === 'development') {
          // you can't HMR without a .js file, so we add a minimum script file.
          const hmrScript = path.resolve(__dirname, 'minimum-script-file')
          fileAssets.push(hmrScript)
        }

        if (fs.existsSync(resource as string)) {
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

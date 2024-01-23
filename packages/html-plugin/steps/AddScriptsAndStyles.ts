import path from 'path'
import fs from 'fs'
import webpack from 'webpack'

import {type HtmlPluginInterface} from '../types'

// Manifest fields
import manifestFields from 'browser-extension-manifest-fields'

import {getFilepath} from '../helpers/getResourceName'
import getAssetsFromHtml from '../lib/getAssetsFromHtml'
import shouldEmitFile from '../helpers/shouldEmitFile'
import shouldExclude from '../helpers/shouldExclude'
import getPagesPath from '../helpers/getPagesPath'

export default class AddScriptsAndStyles {
  public readonly manifestPath: string
  public readonly pagesFolder?: string
  public readonly exclude?: string[]

  constructor(options: HtmlPluginInterface) {
    this.manifestPath = options.manifestPath
    this.pagesFolder = options.pagesFolder
    this.exclude = options.exclude || []
  }

  public apply(compiler: webpack.Compiler): void {
    const allEntries = {
      ...manifestFields(this.manifestPath).html,
      ...getPagesPath(this.pagesFolder)
    }

    for (const field of Object.entries(allEntries)) {
      const [feature, resource] = field

      // Resources from the manifest lib can come as undefined.
      if (resource?.html) {
        if (!fs.existsSync(resource?.html)) return

        const htmlAssets = getAssetsFromHtml(resource?.html)
        const jsAssets = htmlAssets?.js || []
        const cssAssets = htmlAssets?.css || []
        const fileAssets = [...jsAssets, ...cssAssets].filter(
          (asset) => !shouldExclude(this.exclude || [], asset)
        )

        if (compiler.options.mode === 'development') {
          const hmrScript = path.resolve(__dirname, 'html-reloader.js')
          fileAssets.push(hmrScript)
        }

        const fileName = getFilepath(feature, resource?.html)
        const context = compiler.options.context || ''
        const fileNameExt = path.extname(fileName)
        const fileNameNoExt = fileName.replace(fileNameExt, '')

        if (fs.existsSync(resource?.html)) {
          if (shouldEmitFile(context, resource?.html, this.exclude)) {
            compiler.options.entry = {
              ...compiler.options.entry,
              // https://webpack.js.org/configuration/entry-context/#entry-descriptor
              [fileNameNoExt]: {
                import: fileAssets
              }
            }
          }
        }
      }
    }
  }
}

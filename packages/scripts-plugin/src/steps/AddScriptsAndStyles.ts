import path from 'path'
import fs from 'fs'
import webpack from 'webpack'

// Manifest fields
import manifestFields from 'browser-extension-manifest-fields'

import {type ScriptsPluginInterface} from '../../types'
import {getFilepath} from '../helpers/getResourceName'
import shouldExclude from '../helpers/shouldExclude'

export default class AddScriptsAndStyles {
  public readonly manifestPath: string
  public readonly exclude?: string[]

  constructor(options: ScriptsPluginInterface) {
    this.manifestPath = options.manifestPath
    this.exclude = options.exclude || []
  }

  public apply(compiler: webpack.Compiler): void {
    const IS_DEV = compiler.options.mode === 'development'
    const scriptFields = manifestFields(this.manifestPath).scripts
    const manifest = require(this.manifestPath)

    for (const field of Object.entries(scriptFields)) {
      const [feature, scriptFilePath] = field

      const scriptEntries = Array.isArray(scriptFilePath)
        ? scriptFilePath || []
        : scriptFilePath
          ? [scriptFilePath]
          : []

      const validJsExtensions = compiler.options.resolve.extensions
      const fileAssets = scriptEntries.filter((asset) => {
        return (
          // File exists
          fs.existsSync(asset) &&
          // Not in some public/ folder
          !shouldExclude(this.exclude || [], asset) &&
          // During development, accept only js-like files
          // for content_scripts. This is to avoid adding
          // the CSS files to the entry point bundle,
          // which would cause the CSS to load but not be
          // hot reloaded. During production, we accept
          // all files as there is no HMR.
          IS_DEV &&
          validJsExtensions?.some((ext) => asset.endsWith(ext))
        )
      })

      if (fileAssets.length) {
        compiler.options.entry = {
          ...compiler.options.entry,
          // https://webpack.js.org/configuration/entry-context/#entry-descriptor
          [getFilepath(feature)]: {
            import: fileAssets
          }
        }
      }

      // During development, ensure we have a background.js file
      // entry point, so that we can hot reload it.
      const isBackgroundMv2 = manifest.manifest_version === 2 && feature === 'background'
      const isBackgroundMv3 = manifest.manifest_version === 3 && feature === 'service_worker'
      if (
        IS_DEV &&
        (isBackgroundMv2 || isBackgroundMv3) &&
        (!scriptEntries || scriptEntries?.length === 0)
      ) {
        const jsEntryPath = `${path.join(__dirname, 'default-background')}.js`
        const manifest = require(this.manifestPath)
        const featureName =
          manifest.manifest_version === 3 ? 'service_worker' : 'background'

        compiler.options.entry = {
          ...compiler.options.entry,
          // https://webpack.js.org/configuration/entry-context/#entry-descriptor
          [getFilepath(featureName)]: {
            import: [jsEntryPath]
          }
        }
      }

      // During development, if all content_scripts are actually css files,
      // add a js file for each of them to the entry point, so that we can
      // hot reload them.
      if (IS_DEV) {
        const fileAssets = scriptEntries.filter((asset) => {
          return (
            // File exists
            fs.existsSync(asset) &&
            // Not in some public/ folder
            !shouldExclude(this.exclude || [], asset)
          )
        })

        const hasOnlyCssLikeFiles = fileAssets.every((asset) => {
          return (
            asset.endsWith('.css') ||
            asset.endsWith('.scss') ||
            asset.endsWith('.sass') ||
            asset.endsWith('.less')
          )
        })

        if (hasOnlyCssLikeFiles && fileAssets.length) {
          const jsEntryPath = `${path.join(__dirname, getFilepath(feature))}.js`
          const cssEntryPath = `${path.join(
            __dirname,
            getFilepath(feature)
          )}.css`

          const dirPath = path.dirname(jsEntryPath)
          if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, {recursive: true})
          }

          fs.writeFileSync(
            jsEntryPath,
            fileAssets.map((css) => `import("${css}");`).join('\n'),
            'utf-8'
          )
          fs.writeFileSync(
            cssEntryPath,
            '/** Nothing to see here... */',
            'utf-8'
          )

          compiler.options.entry = {
            ...compiler.options.entry,
            // https://webpack.js.org/configuration/entry-context/#entry-descriptor
            [getFilepath(feature)]: {
              import: [jsEntryPath, cssEntryPath]
            }
          }
        }
      }
    }
  }
}

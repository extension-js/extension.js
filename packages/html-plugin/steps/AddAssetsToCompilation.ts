import fs from 'fs'
import webpack, {sources, Compilation} from 'webpack'

import {IncludeList, type StepPluginInterface} from '../types'

// Manifest fields
import manifestFields from 'browser-extension-manifest-fields'

import getAssetsFromHtml from '../lib/getAssetsFromHtml'
import errors from '../helpers/errors'
import {shouldExclude} from '../helpers/utils'

export default class AddAssetsToCompilation {
  public readonly manifestPath: string
  public readonly includeList: IncludeList
  public readonly exclude: string[]

  constructor(options: StepPluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
    this.exclude = options.exclude
  }

  public apply(compiler: webpack.Compiler): void {
    compiler.hooks.thisCompilation.tap(
      'HtmlPlugin (AddAssetsToCompilation)',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'AddAssetsToCompilationPlugin',
            // Derive new assets from the existing assets.
            stage: Compilation.PROCESS_ASSETS_STAGE_DERIVED
          },
          (assets) => {
            if (compilation.errors.length > 0) return

            const manifestSource = assets['manifest.json']
              ? JSON.parse(assets['manifest.json'].source().toString())
              : require(this.manifestPath)

            const htmlEntries = {
              ...manifestFields(this.manifestPath, manifestSource).html,
              ...this.includeList
            }

            for (const field of Object.entries(htmlEntries)) {
              const [feature, resource] = field

              // Resources from the manifest lib can come as undefined.
              if (resource?.html) {
                if (!fs.existsSync(resource?.html)) return

                const htmlAssets = getAssetsFromHtml(resource?.html)
                const fileAssets = htmlAssets?.static || []

                for (const asset of [...fileAssets]) {
                  // Handle missing static assets. This is not covered
                  // by HandleCommonErrorsPlugin because static assets
                  // are not entrypoints.
                  if (!fs.existsSync(asset)) {
                    if (!shouldExclude(asset, this.exclude)) {
                      errors.fileNotFoundWarn(
                        compilation,
                        this.manifestPath,
                        resource?.html,
                        asset
                      )
                    }
                    return
                  }

                  if (shouldExclude(asset, this.exclude)) {
                    const source = fs.readFileSync(asset)
                    const rawSource = new sources.RawSource(source)

                    // Pages are handled by AddHtmlFileToCompilation.
                    // Users can reference own pages/ (like an iframe),
                    // but we don't want to emit them as assets again.
                    if (!feature.startsWith('pages')) {
                      // Assume that if the asset is not an HTML file, it should be emitted,
                      // Either by manifest require, pages, or public folder.
                      if (!asset.endsWith('.html')) {
                        if (!compilation.getAsset(feature)) {
                          compilation.emitAsset(feature, rawSource)
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        )
      }
    )
  }
}

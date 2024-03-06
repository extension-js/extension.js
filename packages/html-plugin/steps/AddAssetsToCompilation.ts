import fs from 'fs'
import path from 'path'
import type webpack from 'webpack'
import {sources, Compilation} from 'webpack'

import {type IncludeList, type StepPluginInterface} from '../types'

// Manifest fields
import manifestFields from 'browser-extension-manifest-fields'

import errors from '../helpers/errors'
import {shouldExclude} from '../helpers/utils'
import * as fileUtils from '../helpers/utils'
import getAssetsFromHtml from '../lib/getAssetsFromHtml'

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
            stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL
          },
          () => {
            if (compilation.errors.length > 0) return

            const manifestSource = fileUtils.getManifestContent(
              compilation,
              this.manifestPath
            )

            const manifestEntries = {
              ...manifestFields(this.manifestPath, manifestSource).html,
              ...this.includeList
            }

            for (const field of Object.entries(manifestEntries)) {
              const [feature, resource] = field
              const featureName = feature + '.html'

              // Resources from the manifest lib can come as undefined.
              if (resource?.html) {
                const compilationAsset = compilation.getAsset(featureName)
                if (compilationAsset) {
                  const htmlSource = compilationAsset.source.source().toString()
                  const staticAssets = getAssetsFromHtml(
                    resource?.html,
                    htmlSource
                  )?.static

                  const fileAssets = [...new Set(staticAssets)]

                  for (const asset of fileAssets) {
                    if (!shouldExclude(asset, this.exclude)) {
                      // Handle missing static assets. This is not covered
                      // by HandleCommonErrorsPlugin because static assets
                      // are not entrypoints.
                      if (!fs.existsSync(asset)) {
                        const includeListEntry = fileUtils.isFromIncludeList(
                          this.includeList,
                          asset
                        )

                        // If this asset is an asset emitted by some other plugin,
                        // we don't want to emit it again. This is the case for
                        // HTML or script assets .
                        if (!includeListEntry) {
                          // TODO: cezaraugusto. This is a sensible part
                          // as we would need to skip warning every scenario
                          // where the asset is not found. Let's live with it
                          // for now. Here we are warning the user that the
                          // asset in the HTML is not found, but we're ok
                          // if the path is a hash, as it's a reference to
                          // an in-page asset (like an ID reference for anchors).
                          if (!path.basename(asset).startsWith('#')) {
                            errors.fileNotFoundWarn(
                              compilation,
                              this.manifestPath,
                              resource?.html,
                              asset
                            )
                            return
                          }
                        }
                      }

                      const source = fs.readFileSync(asset)
                      const rawSource = new sources.RawSource(source)

                      const filepath = path.join('assets', path.basename(asset))
                      if (!compilation.getAsset(filepath)) {
                        // If for some reason the HTML file reached this condition,
                        // it means it is not defined in the manifest file nor
                        // in the include list. If the HTML file is treated like
                        // any other resource, it will be emitted as an asset.
                        // Here we also emit the assets referenced in the HTML file.
                        if (asset.endsWith('.html')) {
                          const htmlAssets = getAssetsFromHtml(asset)
                          const assetsFromHtml = [
                            ...(htmlAssets?.js || []),
                            ...(htmlAssets?.css || []),
                            ...(htmlAssets?.static || [])
                          ]

                          // Emit the HTML itself
                          compilation.emitAsset(filepath, rawSource)
                          assetsFromHtml.forEach((assetFromHtml) => {
                            const source = fs.readFileSync(assetFromHtml)
                            const rawSource = new sources.RawSource(source)

                            const filepath = path.join(
                              'assets',
                              path.basename(assetFromHtml)
                            )

                            if (!compilation.getAsset(filepath)) {
                              compilation.emitAsset(filepath, rawSource)
                            }
                          })
                        } else {
                          compilation.emitAsset(filepath, rawSource)
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

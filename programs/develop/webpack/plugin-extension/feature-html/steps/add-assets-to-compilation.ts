import * as fs from 'fs'
import * as path from 'path'
import rspack, {type Compiler, sources, Compilation} from '@rspack/core'
import {type FilepathList, type PluginInterface} from '../../../webpack-types'
import {getAssetsFromHtml, isFromIncludeList} from '../html-lib/utils'
import * as messages from '../../../lib/messages'

export class AddAssetsToCompilation {
  public readonly manifestPath: string
  public readonly includeList?: FilepathList

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
  }

  public apply(compiler: Compiler): void {
    compiler.hooks.thisCompilation.tap(
      'html:add-assets-to-compilation',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'html:add-assets-to-compilation',
            // Derive new assets from the existing assets.
            stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL
          },
          () => {
            if (compilation.errors.length > 0) return

            const htmlFields = Object.entries(this.includeList || {})

            for (const field of htmlFields) {
              const [feature, resource] = field
              const featureWithHtml = feature + '.html'

              // Resources from the manifest lib can come as undefined.
              if (resource) {
                const compilationAsset = compilation.getAsset(featureWithHtml)

                if (compilationAsset) {
                  const htmlSource = compilationAsset.source.source().toString()

                  const staticAssets = getAssetsFromHtml(
                    resource as string,
                    htmlSource
                  )?.static

                  const fileAssets = [...new Set(staticAssets)]

                  for (const asset of fileAssets) {
                    if (!asset.startsWith('/')) {
                      // Handle missing static assets. This is not covered
                      // by HandleCommonErrorsPlugin because static assets
                      // are not entrypoints.
                      if (!fs.existsSync(asset)) {
                        const FilepathListEntry = isFromIncludeList(
                          asset,
                          this.includeList
                        )

                        // If this asset is an asset emitted by some other plugin,
                        // we don't want to emit it again. This is the case for
                        // HTML or script assets .
                        if (!FilepathListEntry) {
                          // TODO: cezaraugusto. This is a sensible part
                          // as we would need to skip warning every scenario
                          // where the asset is not found. Let's live with it
                          // for now. Here we are warning the user that the
                          // asset in the HTML is not found, but we're ok
                          // if the path is a hash, as it's a reference to
                          // an in-page asset (like an ID reference for anchors).
                          if (!path.basename(asset).startsWith('#')) {
                            const errorMessage = messages.fileNotFound(
                              resource as string,
                              asset
                            )

                            if (
                              // Ensure that the asset is not an absolute path,
                              // so users can reference the output directory as the root.
                              !asset.startsWith('/')
                            ) {
                              compilation.warnings.push(
                                new rspack.WebpackError(errorMessage)
                              )
                            }

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

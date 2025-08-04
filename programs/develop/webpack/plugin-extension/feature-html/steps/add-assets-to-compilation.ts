import * as fs from 'fs'
import * as path from 'path'
import rspack, {type Compiler, sources, Compilation} from '@rspack/core'
import {type FilepathList, type PluginInterface} from '../../../webpack-types'
import {getAssetsFromHtml, isFromIncludeList} from '../html-lib/utils'
import * as messages from '../../../lib/messages'

export class AddAssetsToCompilation {
  public readonly manifestPath: string
  public readonly includeList?: FilepathList
  public readonly excludeList?: FilepathList

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
    this.excludeList = options.excludeList
  }

  // Normalize public folder path to handle case sensitivity issues
  // across different operating systems (Windows case-insensitive vs macOS/Linux case-sensitive)
  private normalizePublicPath(assetPath: string): string {
    if (!assetPath.startsWith('public/')) {
      return assetPath
    }

    const projectPath = path.dirname(this.manifestPath)
    const publicFolderPath = path.join(projectPath, 'public')

    // Check if the public folder exists with different cases
    if (fs.existsSync(publicFolderPath)) {
      // Use the actual case of the public folder
      const actualPublicFolder = path.basename(publicFolderPath)
      return assetPath.replace(/^public\//, `${actualPublicFolder}/`)
    }

    // Fallback to lowercase 'public' if folder doesn't exist
    return assetPath.replace(/^public\//, 'public/')
  }

  public apply(compiler: Compiler): void {
    compiler.hooks.thisCompilation.tap(
      'html:add-assets-to-compilation',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'html:add-assets-to-compilation',
            stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONS
          },
          () => {
            if (compilation.errors.length > 0) return

            const allEntries = this.includeList || {}

            for (const field of Object.entries(allEntries)) {
              const [, resource] = field

              if (resource) {
                const compilationAsset = compilation.getAsset(
                  path.basename(resource as string)
                )

                if (compilationAsset) {
                  const htmlSource = compilationAsset.source.source().toString()

                  const staticAssets = getAssetsFromHtml(
                    resource as string,
                    htmlSource
                  )?.static

                  const fileAssets = [...new Set(staticAssets)]

                  for (const asset of fileAssets) {
                    // Handle both relative and public paths
                    const isPublicPath = asset.startsWith('/')
                    let assetPath = isPublicPath
                      ? path.posix.join('public', asset.slice(1))
                      : asset

                    // Normalize the public path to handle case sensitivity issues
                    assetPath = this.normalizePublicPath(assetPath)

                    // Handle missing static assets. This is not covered
                    // by HandleCommonErrorsPlugin because static assets
                    // are not entrypoints.
                    if (!fs.existsSync(assetPath)) {
                      const FilepathListEntry = isFromIncludeList(
                        asset,
                        this.includeList
                      )

                      // If this asset is an asset emitted by some other plugin,
                      // we don't want to emit it again. This is the case for
                      // HTML or script assets.
                      if (!FilepathListEntry) {
                        // Skip warning for hash references and public paths
                        if (!path.basename(asset).startsWith('#')) {
                          const errorMessage = messages.fileNotFound(
                            resource as string,
                            asset
                          )
                          compilation.warnings.push(
                            new rspack.WebpackError(errorMessage)
                          )
                          return
                        }
                      }
                    }

                    const source = fs.readFileSync(assetPath)
                    const rawSource = new sources.RawSource(source)

                    // For public paths, maintain the same structure in output
                    const filepath = isPublicPath
                      ? asset.slice(1) // Remove leading slash
                      : path.join('assets', path.basename(asset))

                    // Check if this is a nested HTML file that exists in the compilation
                    const isNestedHtml = asset.endsWith('.html')
                    const nestedHtmlAsset = isNestedHtml
                      ? compilation.getAsset(path.basename(asset))
                      : null

                    // Skip emitting if the asset is in the include list and is not a nested HTML
                    if (
                      isFromIncludeList(asset, this.includeList) &&
                      !nestedHtmlAsset
                    ) {
                      continue
                    }

                    if (!compilation.getAsset(filepath)) {
                      // If for some reason the HTML file reached this condition,
                      // it means it is not defined in the manifest file nor
                      // in the include list. If the HTML file is treated like
                      // any other resource, it will be emitted as an asset.
                      // Here we also emit the assets referenced in the HTML file.
                      if (asset.endsWith('.html')) {
                        const htmlAssets = getAssetsFromHtml(assetPath)
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

                          const assetFilepath = path.join(
                            'assets',
                            path.basename(assetFromHtml)
                          )

                          if (!compilation.getAsset(assetFilepath)) {
                            compilation.emitAsset(assetFilepath, rawSource)
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
        )
      }
    )
  }
}

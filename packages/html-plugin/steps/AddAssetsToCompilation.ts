import fs from 'fs'
import path from 'path'
import webpack, {sources, Compilation} from 'webpack'

import {IncludeList, type StepPluginInterface} from '../types'

// Manifest fields
import manifestFields from 'browser-extension-manifest-fields'

import errors from '../helpers/errors'
import {shouldExclude} from '../helpers/utils'
import * as fileUtils from '../helpers/utils'

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
            stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONS
          },
          () => {
            if (compilation.errors.length > 0) return

            const manifestSource = fileUtils.getManifestContent(
              compilation,
              this.manifestPath
            )

            const htmlEntries = {
              ...manifestFields(this.manifestPath, manifestSource).html,
              ...this.includeList
            }

            for (const field of Object.entries(htmlEntries)) {
              const [feature, resource] = field

              // Resources from the manifest lib can come as undefined.
              if (resource?.html) {
                if (!fs.existsSync(resource?.html)) return

                const fileAssets = [...new Set(resource?.static || [])]

                for (const asset of fileAssets) {
                  console.log('0', asset)
                  if (!shouldExclude(asset, this.exclude)) {
                    // Handle missing static assets. This is not covered
                    // by HandleCommonErrorsPlugin because static assets
                    // are not entrypoints.
                    if (!fs.existsSync(asset)) {
                      // TODO: cezaraugusto. This is a sensible part
                      // as we would need to skip warning every scenario
                      // where the asset is not found. Let's live with it
                      // for now. Here we are warning the user that the
                      // asset in the HTML is not found, but we're ok
                      // if the path is a hash, as it's a reference to
                      // an in-page asset (like an ID reference for anchors).
                      // if (!asset.startsWith('#')) {
                      errors.fileNotFoundWarn(
                        compilation,
                        this.manifestPath,
                        resource?.html,
                        asset
                      )
                      return
                      // }
                    }

                    const source = fs.readFileSync(asset)
                    const rawSource = new sources.RawSource(source)

                    // Pages are handled by AddHtmlFileToCompilation.
                    // Users can reference own pages/ (like an iframe),
                    // but we don't want to emit them as assets again.
                    // Assume that if the asset is not an HTML file, it should be emitted,
                    // Either by manifest require, pages, or public folder.
                    const filepath = path.join('assets', path.basename(asset))
                    if (!compilation.getAsset(filepath)) {
                      compilation.emitAsset(filepath, rawSource)
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

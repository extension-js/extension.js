import path from 'path'
import fs from 'fs'
import webpack, {sources, Compilation} from 'webpack'

import {type HtmlPluginInterface} from '../types'

// Manifest fields
import manifestFields from 'browser-extension-manifest-fields'

import {getFilepath} from '../helpers/getResourceName'

import getAssetsFromHtml from '../lib/getAssetsFromHtml'
import {fileError} from '../helpers/messages'
import shouldEmitFile from '../helpers/shouldEmitFile'

export default class AddAssetsToCompilation {
  public readonly manifestPath: string
  public readonly exclude?: string[]

  constructor(options: HtmlPluginInterface) {
    this.manifestPath = options.manifestPath
    this.exclude = options.exclude || []
  }

  private fileNotFoundWarn(
    compilation: webpack.Compilation,
    htmlFilePath: string,
    filePath: string
  ) {
    const errorMessage = fileError(htmlFilePath, filePath)

    compilation.warnings.push(new webpack.WebpackError(errorMessage))
  }

  public apply(compiler: webpack.Compiler): void {
    compiler.hooks.thisCompilation.tap(
      'AddAssetsToCompilationPlugin',
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

            const htmlFields = manifestFields(
              this.manifestPath,
              manifestSource
            ).html

            for (const field of Object.entries(htmlFields)) {
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
                    this.fileNotFoundWarn(compilation, resource?.html, asset)
                    return
                  }

                  const source = fs.readFileSync(asset)
                  const rawSource = new sources.RawSource(source)
                  const context = compiler.options.context || ''

                  if (shouldEmitFile(context, asset, this.exclude)) {
                    // check if asset is emitted
                    if (!compilation.getAsset(asset)) {
                      compilation.emitAsset(
                        getFilepath(feature, asset),
                        rawSource
                      )
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

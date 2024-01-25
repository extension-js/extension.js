import path from 'path'
import fs from 'fs'
import webpack, {sources, Compilation} from 'webpack'

import {type HtmlPluginInterface} from '../types'

// Manifest fields
import manifestFields, {getPagesPath} from 'browser-extension-manifest-fields'

import {getFilepath} from '../helpers/getResourceName'
import shouldEmitFile from '../helpers/shouldEmitFile'
import patchHtml from '../lib/patchHtml'
import {manifestFieldError} from '../helpers/messages'

export default class AddHtmlFileToCompilation {
  public readonly manifestPath: string
  public readonly pagesFolder?: string
  public readonly exclude?: string[]

  constructor(options: HtmlPluginInterface) {
    this.manifestPath = options.manifestPath
    this.pagesFolder = options.pagesFolder
    this.exclude = options.exclude || []
  }

  private manifestNotFoundError(compilation: webpack.Compilation) {
    const errorMessage = `A manifest file is required for this plugin to run.`

    compilation.errors.push(
      new webpack.WebpackError(`[manifest.json]: ${errorMessage}`)
    )
  }

  private entryNotFoundWarn(
    compilation: webpack.Compilation,
    feature: string,
    htmlFilePath: string
  ) {
    const errorMessage = manifestFieldError(feature, htmlFilePath)

    compilation.warnings.push(
      new webpack.WebpackError(`[manifest.json]: ${errorMessage}`)
    )
  }

  public apply(compiler: webpack.Compiler): void {
    compiler.hooks.thisCompilation.tap(
      'HtmlPlugin (AddHtmlFileToCompilation)',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'HtmlPlugin (AddHtmlFileToCompilation)4',
            // Add additional assets to the compilation.
            stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONS
          },
          (assets) => {
            // Do not emit if manifest doesn't exist.
            if (!fs.existsSync(this.manifestPath)) {
              this.manifestNotFoundError(compilation)
              return
            }

            if (compilation.errors.length > 0) return

            const manifestSource = assets['manifest.json']
              ? JSON.parse(assets['manifest.json'].source().toString())
              : require(this.manifestPath)

            const allEntries = {
              ...manifestFields(this.manifestPath, manifestSource).html,
              ...getPagesPath(this.pagesFolder)
            }

            for (const field of Object.entries(allEntries)) {
              const [feature, resource] = field

              // Resources from the manifest lib can come as undefined.
              if (resource?.html) {
                // Do not output if file doesn't exist.
                // If the user updates the path, this script runs again
                // and output the file accordingly.
                if (!fs.existsSync(resource?.html)) {
                  this.entryNotFoundWarn(compilation, feature, resource?.html)
                  return
                }

                const updatedHtml = patchHtml(
                  feature,
                  resource?.html,
                  this.exclude!
                )

                const assetName = getFilepath(feature, resource?.html)

                const rawSource = new sources.RawSource(updatedHtml)
                const context = compiler.options.context || ''

                if (shouldEmitFile(context, resource?.html, this.exclude)) {
                  compilation.emitAsset(assetName, rawSource)
                }
              }
            }
          }
        )
      }
    )
  }
}

import type webpack from 'webpack'
import {sources, Compilation} from 'webpack'

import {type IncludeList, type StepPluginInterface} from '../types'

// Manifest fields
import manifestFields from 'browser-extension-manifest-fields'

import patchHtml from '../lib/patchHtml'
import {shouldExclude} from '../helpers/utils'
import getFilePath from '../helpers/getFilePath'
import * as fileUtils from '../helpers/utils'

export default class UpdateHtmlFile {
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
      'HtmlPlugin (UpdateHtmlFile)',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'HtmlPlugin (UpdateHtmlFile)',
            // Summarize the list of existing assets.
            stage: Compilation.PROCESS_ASSETS_STAGE_DERIVED
          },
          () => {
            if (compilation.errors.length > 0) return

            const manifestSource = fileUtils.getManifestContent(
              compilation,
              this.manifestPath
            )

            const htmlEntries: IncludeList = {
              ...manifestFields(this.manifestPath, manifestSource).html,
              ...this.includeList
            }

            for (const field of Object.entries(htmlEntries)) {
              const [feature, resource] = field
              const html = resource?.html

              // Resources from the manifest lib can come as undefined.
              if (html) {
                const updatedHtml: string = patchHtml(
                  compilation,
                  feature,
                  html,
                  htmlEntries,
                  this.exclude
                )

                if (!shouldExclude(html, this.exclude)) {
                  const rawSource = new sources.RawSource(updatedHtml)
                  const filepath = getFilePath(feature, '.html')
                  compilation.updateAsset(filepath, rawSource)
                }
              }
            }
          }
        )
      }
    )
  }
}

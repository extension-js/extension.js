import fs from 'fs'
import webpack, {sources, Compilation} from 'webpack'

import {IncludeList, type StepPluginInterface} from '../types'

// Manifest fields
import manifestFields from 'browser-extension-manifest-fields'

import patchHtml from '../lib/patchHtml'
import {shouldExclude} from '../helpers/utils'
import errors from '../helpers/errors'

export default class AddHtmlFileToCompilation {
  public readonly manifestPath: string
  public readonly includeList: IncludeList
  public readonly exclude: string[]

  constructor(options: StepPluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
    this.exclude = options.exclude
  }

  private getFilePath(feature: string) {
    if (feature.startsWith('sandbox')) {
      const [featureName, index] = feature.split('-')
      return `${featureName}/page-${index}.html`
    }

    return `${feature}/index.html`
  }

  public apply(compiler: webpack.Compiler): void {
    compiler.hooks.thisCompilation.tap(
      'HtmlPlugin (AddHtmlFileToCompilation)',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'HtmlPlugin (AddHtmlFileToCompilation)',
            // Add additional assets to the compilation.
            stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONS
          },
          (assets) => {
            // Do not emit if manifest doesn't exist.
            if (!fs.existsSync(this.manifestPath)) {
              errors.manifestNotFoundError(compilation)
              return
            }

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
              const html = resource?.html

              // Resources from the manifest lib can come as undefined.
              if (html) {
                // Do not output if file doesn't exist.
                // If the user updates the path, this script runs again
                // and output the file accordingly.
                if (!fs.existsSync(html)) {
                  errors.entryNotFoundWarn(compilation, feature, html)
                  return
                }

                const updatedHtml = patchHtml(compilation, html, this.exclude)

                if (!shouldExclude(html, this.exclude)) {
                  const rawSource = new sources.RawSource(updatedHtml)
                  compilation.emitAsset(this.getFilePath(feature), rawSource)
                }
              }
            }
          }
        )
      }
    )
  }
}

import fs from 'fs'
import type webpack from 'webpack'
import {sources} from 'webpack'

import {type IncludeList, type StepPluginInterface} from '../types'

// Manifest fields
import manifestFields from 'browser-extension-manifest-fields'

import {shouldExclude} from '../helpers/utils'
import errors from '../helpers/errors'
import getFilePath from '../helpers/getFilePath'
import * as fileUtils from '../helpers/utils'

export default class EmitHtmlFile {
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
      'HtmlPlugin (EmitHtmlFile)',
      (compilation) => {
        compilation.hooks.seal.tap('HtmlPlugin (EmitHtmlFile)', () => {
          // Do not emit if manifest doesn't exist.
          if (!fs.existsSync(this.manifestPath)) {
            errors.manifestNotFoundError(compilation)
            return
          }

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
              // Do not output if file doesn't exist.
              // If the user updates the path, this script runs again
              // and output the file accordingly.
              if (!fs.existsSync(html)) {
                errors.entryNotFoundWarn(compilation, feature, html)
                return
              }

              const rawHtml = fs.readFileSync(html, 'utf8')
              if (!shouldExclude(html, this.exclude)) {
                const rawSource = new sources.RawSource(rawHtml)
                const filepath = getFilePath(feature, '.html')
                compilation.emitAsset(filepath, rawSource)
              }
            }
          }
        })
      }
    )
  }
}

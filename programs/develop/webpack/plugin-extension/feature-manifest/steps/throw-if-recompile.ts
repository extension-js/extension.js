import fs from 'fs'
import webpack, {Compilation} from 'webpack'
import * as messages from '../../../lib/messages'
import {DevOptions} from '../../../../commands/dev'
import {PluginInterface, FilepathList, Manifest} from '../../../webpack-types'
import {htmlFields} from '../../data/manifest-fields/html-fields'
import {scriptsFields} from '../../data/manifest-fields/scripts-fields'
import * as utils from '../../../lib/utils'

export class ThrowIfRecompileIsNeeded {
  public readonly manifestPath: string
  public readonly browser: DevOptions['browser']
  public readonly includeList?: FilepathList

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
    this.includeList = options.includeList
  }

  private flattenAndSort(arr: any[]): any[] {
    return arr.flat(Infinity).sort()
  }

  public apply(compiler: webpack.Compiler): void {
    compiler.hooks.watchRun.tapAsync(
      'manifest:throw-if-recompile-is-needed',
      (compiler, done) => {
        const files = compiler.modifiedFiles || new Set<string>()
        if (files.has(this.manifestPath)) {
          const context = compiler.options.context || ''
          const packageJsonPath = `${context}/package.json`

          if (!fs.existsSync(packageJsonPath)) {
            done()
            return
          }

          const initialManifest: Manifest = require(this.manifestPath)
          const manifest = utils.filterKeysForThisBrowser(
            initialManifest,
            this.browser
          )
          const initialHtml = this.flattenAndSort(
            Object.values(htmlFields(context, manifest))
          )
          const initialScripts = this.flattenAndSort(
            Object.values(scriptsFields(context, manifest))
          )

          compiler.hooks.thisCompilation.tap(
            'manifest:throw-if-recompile-is-needed',
            (compilation) => {
              compilation.hooks.processAssets.tap(
                {
                  name: 'manifest:check-manifest-files',
                  stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_COMPATIBILITY
                },
                () => {
                  const manifestAsset = compilation.getAsset('manifest.json')
                  const manifestStr = manifestAsset?.source.source().toString()
                  const updatedManifest = JSON.parse(manifestStr || '{}')
                  const updatedHtml = this.flattenAndSort(
                    Object.values(htmlFields(context, updatedManifest))
                  )
                  const updatedScripts = this.flattenAndSort(
                    Object.values(scriptsFields(context, updatedManifest))
                  )

                  if (
                    initialScripts.toString() !== updatedScripts.toString() ||
                    initialHtml.toString() !== updatedHtml.toString()
                  ) {
                    const fileRemoved = initialHtml.filter(
                      (file) => !updatedHtml.includes(file)
                    )[0]
                    const fileAdded = updatedHtml.filter(
                      (file) => !initialHtml.includes(file)
                    )[0]
                    const errorMessage =
                      messages.serverRestartRequiredFromManifestError(
                        fileAdded,
                        fileRemoved
                      )
                    compilation.errors.push(
                      new webpack.WebpackError(errorMessage)
                    )
                  }
                }
              )
            }
          )
        }
        done()
      }
    )
  }
}

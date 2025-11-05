import * as fs from 'fs'
import * as path from 'path'
import {Compiler, Compilation, WebpackError} from '@rspack/core'
import * as messages from '../messages'
import {DevOptions} from '../../../types/options'
import {PluginInterface, FilepathList} from '../../../webpack-types'
import {getManifestFieldsData} from 'browser-extension-manifest-fields'

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

  public apply(compiler: Compiler): void {
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

          const initialFields = getManifestFieldsData({
            manifestPath: this.manifestPath,
            browser: this.browser
          })
          const initialHtml = this.flattenAndSort(
            Object.values(initialFields.html)
          )
          const initialScripts = this.flattenAndSort(
            Object.values(initialFields.scripts)
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
                  let updatedHtml: string[] = []
                  let updatedScripts: string[] = []

                  try {
                    const tempManifestPath = path.join(
                      context || process.cwd(),
                      '.extension-manifest.tmp.json'
                    )
                    fs.writeFileSync(
                      tempManifestPath,
                      JSON.stringify(updatedManifest, null, 2),
                      'utf-8'
                    )
                    const updatedFields = getManifestFieldsData({
                      manifestPath: tempManifestPath,
                      browser: this.browser
                    })
                    updatedHtml = this.flattenAndSort(
                      Object.values(updatedFields.html)
                    )
                    updatedScripts = this.flattenAndSort(
                      Object.values(updatedFields.scripts)
                    )
                    fs.unlinkSync(tempManifestPath)
                  } catch (e) {
                    // If temp write fails, fallback to initial to avoid crash
                    updatedHtml = initialHtml
                    updatedScripts = initialScripts
                  }

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
                    const warnMessage =
                      messages.serverRestartRequiredFromManifestError(
                        fileAdded,
                        fileRemoved
                      )
                    const restartNoticeWarning = new WebpackError(
                      messages.manifestEntrypointChangeRestarting(
                        fileAdded || fileRemoved || 'manifest.json'
                      )
                    )
                    // @ts-expect-error file is not typed
                    restartNoticeWarning.file = 'manifest.json'
                    compilation.warnings.push(restartNoticeWarning)

                    const manifestEntrypointChangeWarning = new WebpackError(
                      warnMessage
                    )
                    // @ts-expect-error file is not typed
                    manifestEntrypointChangeWarning.file = 'manifest.json'
                    compilation.warnings.push(manifestEntrypointChangeWarning)
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

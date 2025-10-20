import * as fs from 'fs'
import {type Compiler, WebpackError} from '@rspack/core'
import {type FilepathList, type PluginInterface} from '../../../webpack-types'
import {getAssetsFromHtml} from '../html-lib/utils'
import * as utils from '../../../../develop-lib/utils'
import * as messages from '../html-lib/messages'

export class ThrowIfRecompileIsNeeded {
  public readonly manifestPath: string
  public readonly includeList?: FilepathList
  public readonly excludeList?: FilepathList
  public readonly browser?: string

  private initialHtmlAssets: Record<string, {js: string[]; css: string[]}> = {}

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
    this.excludeList = options.excludeList
    this.browser = options.browser
  }

  private hasEntriesChanged(
    updatedEntries: string[] | undefined,
    prevEntries: string[] | undefined
  ): boolean {
    if (!prevEntries || !updatedEntries) return true

    if (updatedEntries.length !== prevEntries.length) return true

    for (let i = 0; i < updatedEntries.length; i++) {
      if (updatedEntries[i] !== prevEntries[i]) {
        return true
      }
    }
    return false
  }

  private storeInitialHtmlAssets(htmlFields: Record<string, any>) {
    Object.entries(htmlFields).forEach(([key, resource]) => {
      if (typeof resource !== 'string') {
        return
      }

      const htmlFile = resource

      if (!fs.existsSync(htmlFile)) {
        // Do not exit here; manifest feature is responsible for failing on
        // entrypoint errors. This step should not terminate the process.
        return
      }

      this.initialHtmlAssets[htmlFile] = {
        js: getAssetsFromHtml(htmlFile)?.js || [],
        css: getAssetsFromHtml(htmlFile)?.css || []
      }
    })
  }

  public apply(compiler: Compiler): void {
    const htmlFields = this.includeList || {}

    this.storeInitialHtmlAssets(htmlFields)

    compiler.hooks.make.tapAsync(
      'html:throw-if-recompile-is-needed',
      (compilation, done) => {
        const files = compiler.modifiedFiles || new Set<string>()
        const changedFile = Array.from(files)[0]

        if (changedFile && this.initialHtmlAssets[changedFile]) {
          const updatedJsEntries = (
            getAssetsFromHtml(changedFile)?.js || []
          ).filter((p) => !p.startsWith('/'))
          const updatedCssEntries = (
            getAssetsFromHtml(changedFile)?.css || []
          ).filter((p) => !p.startsWith('/'))

          const {js, css} = this.initialHtmlAssets[changedFile]

          if (
            this.hasEntriesChanged(updatedCssEntries, css) ||
            this.hasEntriesChanged(updatedJsEntries, js)
          ) {
            compilation.warnings.push(
              new WebpackError(
                messages.serverRestartRequiredFromHtml(changedFile)
              )
            )
          }
        }

        done()
      }
    )
  }
}

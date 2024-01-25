import path from 'path'
import webpack from 'webpack'
import manifestFields, {getPagesPath} from 'browser-extension-manifest-fields'

import {type HtmlPluginInterface} from '../types'
import getAssetsFromHtml from '../lib/getAssetsFromHtml'
import {serverRestartRequired} from '../helpers/messages'

export default class ThrowIfRecompileIsNeeded {
  public readonly manifestPath: string
  public readonly pagesFolder?: string
  public readonly exclude?: string[]
  private initialHtmlAssets: Record<string, {js: string[]; css: string[]}> = {}

  constructor(options: HtmlPluginInterface) {
    this.manifestPath = options.manifestPath
    this.pagesFolder = options.pagesFolder
    this.exclude = options.exclude || []
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

  private whichEntryChanged(
    prevEntries: string[] | undefined,
    updatedEntries: string[] | undefined
  ): {prevFile: string; updatedFile: string} | null {
    if (!prevEntries || !updatedEntries) {
      return null
    }

    // Check for added or removed entries in updatedEntries
    if (updatedEntries.length > prevEntries.length) {
      const newEntries = updatedEntries.filter(
        (entry) => !prevEntries.includes(entry)
      )

      return {
        updatedFile: newEntries.join(', '),
        prevFile: prevEntries.join(', ')
      }
    }

    // Compare entries when lengths are the same
    for (let i = 0; i < updatedEntries.length; i++) {
      if (updatedEntries[i] !== prevEntries[i]) {
        return {prevFile: prevEntries[i], updatedFile: updatedEntries[i]}
      }
    }

    return null
  }

  private storeInitialHtmlAssets(htmlFields: Record<string, any>) {
    Object.entries(htmlFields).forEach(([key, resource]) => {
      const htmlFile = resource?.html
      if (htmlFile) {
        this.initialHtmlAssets[htmlFile] = {
          js: getAssetsFromHtml(htmlFile)?.js || [],
          css: getAssetsFromHtml(htmlFile)?.css || []
        }
      }
    })
  }

  public apply(compiler: webpack.Compiler): void {
    const manifest = require(this.manifestPath)
    const htmlFields = manifestFields(this.manifestPath, manifest).html
    const allEntries = {
      ...manifestFields(this.manifestPath, htmlFields).html,
      ...getPagesPath(this.pagesFolder)
    }

    this.storeInitialHtmlAssets(allEntries)

    compiler.hooks.make.tapAsync(
      'HtmlPlugin (RunChromeExtensionPlugin)',
      (compilation, done) => {
        const files = compiler.modifiedFiles || new Set<string>()
        const changedFile = Array.from(files)[0]

        if (changedFile && this.initialHtmlAssets[changedFile]) {
          const updatedJsEntries = getAssetsFromHtml(changedFile)?.js || []
          const updatedCssEntries = getAssetsFromHtml(changedFile)?.css || []

          const {js: initialJsEntries, css: initialCssEntries} =
            this.initialHtmlAssets[changedFile]

          if (this.hasEntriesChanged(updatedJsEntries, initialJsEntries)) {
            const projectDir = path.dirname(this.manifestPath)
            // const contentChanged = this.whichEntryChanged(
            //   initialJsEntries,
            //   updatedJsEntries
            // )

            const errorMessage = serverRestartRequired(
              projectDir,
              changedFile
              // contentChanged
            )
            compilation.errors.push(new webpack.WebpackError(errorMessage))
          }

          if (this.hasEntriesChanged(updatedCssEntries, initialCssEntries)) {
            const projectDir = path.dirname(this.manifestPath)
            // const contentChanged = this.whichEntryChanged(
            //   initialCssEntries,
            //   updatedCssEntries
            // )

            const errorMessage = serverRestartRequired(
              projectDir,
              changedFile
              // contentChanged
            )
            compilation.errors.push(new webpack.WebpackError(errorMessage))
          }
        }

        done()
      }
    )
  }
}

import fs from 'fs'
import type webpack from 'webpack'

// Manifest fields
import manifestFields from 'browser-extension-manifest-fields'

import {type IncludeList, type StepPluginInterface} from '../types'
import {shouldExclude} from '../helpers/utils'

export default class AddScriptsAndStyles {
  public readonly manifestPath: string
  public readonly includeList: IncludeList
  public readonly exclude: string[]

  constructor(options: StepPluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
    this.exclude = options.exclude
  }

  private getScriptImports(
    scriptPath: string | string[] | undefined
  ): string[] {
    const scriptEntries = Array.isArray(scriptPath)
      ? scriptPath || []
      : scriptPath
      ? [scriptPath]
      : []

    const fileAssets = scriptEntries.filter((asset) => {
      return (
        // File exists
        fs.existsSync(asset) &&
        // Not in some public/ folder
        !shouldExclude(asset, this.exclude)
      )
    })

    return fileAssets
  }

  public apply(compiler: webpack.Compiler): void {
    const scriptFields = {
      ...manifestFields(this.manifestPath).scripts,
      ...this.includeList
    }

    for (const field of Object.entries(scriptFields)) {
      const [feature, scriptPath] = field
      let scriptImports = this.getScriptImports(scriptPath)

      // 1 - Add the script entries to the compilation.
      if (scriptImports.length) {
        compiler.options.entry = {
          ...compiler.options.entry,
          // https://webpack.js.org/configuration/entry-context/#entry-descriptor
          [feature]: {import: scriptImports}
        }
      }
    }
  }
}

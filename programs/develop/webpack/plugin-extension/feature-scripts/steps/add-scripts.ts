import type webpack from 'webpack'

import {type FilepathList, type PluginInterface} from '../../../webpack-types'
import {getScriptEntries, getCssEntries} from '../scripts-lib/utils'

export class AddScripts {
  public readonly manifestPath: string
  public readonly includeList: FilepathList
  public readonly excludeList: FilepathList

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList || {}
    this.excludeList = options.excludeList || {}
  }

  public apply(compiler: webpack.Compiler): void {
    const scriptFields = this.includeList || {}

    const newEntries: Record<string, webpack.EntryObject> = {}

    for (const [feature, scriptPath] of Object.entries(scriptFields)) {
      const scriptImports = getScriptEntries(scriptPath, this.excludeList)
      const cssImports = getCssEntries(scriptPath, this.excludeList)
      const entryImports = [...scriptImports, ...cssImports]

      if (cssImports.length || scriptImports.length) {
        newEntries[feature] = {import: entryImports}
      }
    }

    // Add all the new entries to the compilation at once
    compiler.options.entry = {
      ...compiler.options.entry,
      ...newEntries
    }
  }
}

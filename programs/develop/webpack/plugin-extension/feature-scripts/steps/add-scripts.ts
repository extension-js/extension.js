import * as fs from 'fs'
import {type Compiler, type EntryObject} from '@rspack/core'
import {getScriptEntries, getCssEntries} from '../scripts-lib/utils'
import {type FilepathList, type PluginInterface} from '../../../webpack-types'

export class AddScripts {
  public readonly manifestPath: string
  public readonly includeList: FilepathList
  public readonly excludeList: FilepathList

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList || {}
    this.excludeList = options.excludeList || {}
  }

  public apply(compiler: Compiler): void {
    const scriptFields = this.includeList || {}

    const newEntries: Record<string, EntryObject> = {}

    for (const [feature, scriptPath] of Object.entries(scriptFields)) {
      const scriptImports = getScriptEntries(scriptPath, this.excludeList)
      const cssImports = getCssEntries(scriptPath, this.excludeList)
      const entryImports = [...scriptImports, ...cssImports]

      if (cssImports.length || scriptImports.length) {
        // Apply entry-specific configuration for service workers
        if (feature === 'background/service_worker') {
          // Check if this is a module service worker
          const manifest = JSON.parse(
            fs.readFileSync(this.manifestPath, 'utf8')
          )
          const isModuleServiceWorker = manifest.background?.type === 'module'

          newEntries[feature] = {
            import: entryImports,
            // Only apply import-scripts for non-module service workers
            // This ensures non-module service workers work correctly without affecting module ones
            ...(isModuleServiceWorker ? {} : {chunkLoading: 'import-scripts'})
          }
        } else {
          newEntries[feature] = {import: entryImports}
        }
      }
    }

    // Add all the new entries to the compilation at once
    compiler.options.entry = {
      ...compiler.options.entry,
      ...newEntries
    }
  }
}

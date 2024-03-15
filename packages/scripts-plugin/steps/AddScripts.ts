import type webpack from 'webpack'

// Manifest fields
import manifestFields from 'browser-extension-manifest-fields'

import {type IncludeList, type StepPluginInterface} from '../types'
import {getScriptEntries, getCssEntries} from '../helpers/utils'

export default class AddScriptsAndStyles {
  public readonly manifestPath: string
  public readonly includeList: IncludeList
  public readonly exclude: string[]

  constructor(options: StepPluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
    this.exclude = options.exclude
  }

  public apply(compiler: webpack.Compiler): void {
    const scriptFields = {
      ...manifestFields(this.manifestPath).scripts,
      ...this.includeList
    }

    for (const field of Object.entries(scriptFields)) {
      const [feature, scriptPath] = field
      const scriptImports = getScriptEntries(compiler, scriptPath, this.exclude)
      const cssImports = getCssEntries(scriptPath, this.exclude)
      const entryImports = [...scriptImports]

      // During development, we extract the content_scripts css files from
      // content_scripts and inject them as dynamic imports
      // so we can benefit from HMR.
      // In production we don't need that, so we add the files to the entry points
      // along with other content_script files.
      if (compiler.options.mode === 'production') {
        entryImports.push(...cssImports)
      }

      // 1 - Add the script entries to the compilation.
      if (cssImports.length || scriptImports.length) {
        compiler.options.entry = {
          ...compiler.options.entry,
          // https://webpack.js.org/configuration/entry-context/#entry-descriptor
          [feature]: {import: entryImports}
        }
      }
    }
  }
}

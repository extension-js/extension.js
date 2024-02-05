import path from 'path'
import fs from 'fs'
import webpack from 'webpack'

// Manifest fields
import manifestFields from 'browser-extension-manifest-fields'

import {IncludeList, type StepPluginInterface} from '../types'
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

  private addScriptToCssOnlyEntry(feature: string, scriptImports: string[]) {
    if (feature !== 'content_scripts') return null

    const hasOnlyCssLikeFiles = scriptImports.every((asset) => {
      return (
        asset.endsWith('.css') ||
        asset.endsWith('.scss') ||
        asset.endsWith('.sass') ||
        asset.endsWith('.less')
      )
    })

    if (hasOnlyCssLikeFiles) {
      const jsEntryPath = `${path.join(__dirname, feature)}.js`
      const cssEntryPath = `${path.join(__dirname, feature)}.css`

      const dirPath = path.dirname(jsEntryPath)
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, {recursive: true})
      }

      fs.writeFileSync(
        jsEntryPath,
        scriptImports.map((css) => `import("${css}");`).join('\n'),
        'utf-8'
      )
      fs.writeFileSync(cssEntryPath, '/** Nothing to see here... */', 'utf-8')

      return [jsEntryPath, cssEntryPath]
    }

    return null
  }

  private getFilePath(feature: string) {
    if (feature.startsWith('content_scripts')) {
      const [featureName, index] = feature.split('-')
      return `${featureName}/script-${index}`
    }

    if (feature === 'service_worker') {
      return `background/${feature}`
    }

    if (feature === 'background') {
      return `${feature}/script`
    }

    if (feature === 'user_script') {
      return `${feature}/apiscript`
    }

    return `${feature}/script`
  }

  public apply(compiler: webpack.Compiler): void {
    const validJsExtensions = compiler.options.resolve.extensions
    const IS_DEV = compiler.options.mode === 'development'

    const scriptFields = {
      ...manifestFields(this.manifestPath).scripts,
      ...this.includeList
    }

    for (const field of Object.entries(scriptFields)) {
      const [feature, scriptPath] = field
      const scriptImports = this.getScriptImports(scriptPath)

      // 1 - Add the script entries to the compilation along
      // with the CSS entries, if the script is a content_script.
      if (scriptImports.length) {
        const scriptOnlyImports = scriptImports.filter((asset) => {
          return IS_DEV && validJsExtensions?.some((ext) => asset.endsWith(ext))
        })

        compiler.options.entry = {
          ...compiler.options.entry,
          // https://webpack.js.org/configuration/entry-context/#entry-descriptor
          [this.getFilePath(feature)]: {import: scriptOnlyImports}
        }
      }

      // During development, if all content_scripts are actually css files,
      // add a js file for each of them to the entry point, so that we can
      // hot reload them.
      if (IS_DEV) {
        const scriptImportsWithOnlyCss = this.addScriptToCssOnlyEntry(
          feature,
          scriptImports
        )
        if (scriptImportsWithOnlyCss) {
          compiler.options.entry = {
            ...compiler.options.entry,
            // https://webpack.js.org/configuration/entry-context/#entry-descriptor
            [this.getFilePath(feature)]: {import: scriptImportsWithOnlyCss}
          }
        }
      }
    }
  }
}

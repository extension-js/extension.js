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
    if (!feature.startsWith('content_scripts')) return null

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
      fs.writeFileSync(
        cssEntryPath,
        `/**
 * This file is generated during development by ScriptsPlugin.
 * During development, CSS imports work by dynamically importing the CSS files
 * from the content_scripts field in the manifest.json and adding them to the entry point.
 * This entrypoint is built at runtime and is not part of the final build. But for
 * cases where the manifest is expecting a css file, we create this dummy css file to reflect
 * the expected behavior.
 */`,
        'utf-8'
      )

      return [jsEntryPath, cssEntryPath]
    }

    return null
  }

  public apply(compiler: webpack.Compiler): void {
    const validJsExtensions = compiler.options.resolve.extensions || ['.js']
    const IS_DEV = compiler.options.mode === 'development'

    const scriptFields = {
      ...manifestFields(this.manifestPath).scripts,
      ...this.includeList
    }

    for (const field of Object.entries(scriptFields)) {
      const [feature, scriptPath] = field
      let scriptImports = this.getScriptImports(scriptPath)

      // 1 - Add the script entries to the compilation.
      if (scriptImports.length) {
        // During development, we extract the CSS files from the content_scripts
        // and add them later as a dynamic import to the entry point.
        // So we filter out the css files from the scriptImports.
        // This does not apply to production builds, as we want to bundle
        // the css files in the content_scripts.
        if (IS_DEV) {
          scriptImports = scriptImports.filter((asset) =>
            validJsExtensions?.some((ext) => asset.endsWith(ext))
          )
        }

        compiler.options.entry = {
          ...compiler.options.entry,
          // https://webpack.js.org/configuration/entry-context/#entry-descriptor
          [feature]: {import: scriptImports}
        }
      }

      // During development, if all content_scripts are actually css files,
      // add a js file for each of them to the entry point, so that we can
      // hot reload them.
      if (IS_DEV) {
        const scriptImportsWithOnlyCss = this.addScriptToCssOnlyEntry(
          feature,
          this.getScriptImports(scriptPath)
        )

        if (scriptImportsWithOnlyCss && scriptImportsWithOnlyCss.length) {
          compiler.options.entry = {
            ...compiler.options.entry,
            // https://webpack.js.org/configuration/entry-context/#entry-descriptor
            [feature]: {import: scriptImportsWithOnlyCss}
          }
        }
      }
    }
  }
}

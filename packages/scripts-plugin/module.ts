import path from 'path'
import fs from 'fs'
import webpack, {sources, Compilation, type Compiler} from 'webpack'

import {type ScriptsPluginInterface} from './types'

// Manifest fields
import manifestFields from 'browser-extension-manifest-fields'

import {getFilePathSplitByDots} from './helpers/getResourceName'
import shouldExclude from './helpers/shouldExclude'

export default class HtmlPlugin {
  public readonly manifestPath: string
  public readonly exclude?: string[]
  public readonly experimentalHMREnabled?: boolean

  constructor(options: ScriptsPluginInterface) {
    this.manifestPath = options.manifestPath
    this.exclude = options.exclude || []
    this.experimentalHMREnabled = options.experimentalHMREnabled || false
  }

  private entryNotFoundWarn(
    compilation: webpack.Compilation,
    feature: string,
    htmlFilePath: string
  ) {
    const hintMessage = `Check the \`${feature}\` field in your \`manifest.json\` file.`
    const errorMessage = `File path \`${htmlFilePath}\` not found. ${hintMessage}`

    compilation.warnings.push(
      new webpack.WebpackError(`[manifest.json]: ${errorMessage}`)
    )
  }

  private shouldEmitFile(context: string, file: string) {
    if (!this.exclude) return false

    const contextFile = path.relative(context, file)
    const shouldExcludeFile = shouldExclude(this.exclude, contextFile)

    if (shouldExcludeFile) return false

    return true
  }

  private generateScripts(compiler: Compiler) {
    const scriptFields = manifestFields(this.manifestPath).scripts

    for (const field of Object.entries(scriptFields)) {
      const [feature, scriptFilePath] = field

      const scriptEntries = Array.isArray(scriptFilePath)
        ? scriptFilePath
        : [scriptFilePath]

      for (const entry of scriptEntries) {
        // Resources from the manifest lib can come as undefined.
        if (entry) {
          if (!fs.existsSync(entry)) return

          const fileName = getFilePathSplitByDots(feature, entry)
          const context = compiler.options.context || ''
          const fileNameExt = path.extname(fileName)
          const fileNameNoExt = fileName.replace(fileNameExt, '')

          // Specifically for JS entries, we don't warn users
          // at first that the file is missing. Instead, we
          // ignore it and let other plugins throw the error.
          // During watchRun, we can check if the file exists
          // and recompile if it does.
          if (this.shouldEmitFile(context, entry)) {
            compiler.options.entry = {
              ...compiler.options.entry,
              // https://webpack.js.org/configuration/entry-context/#entry-descriptor
              [fileNameNoExt]: {
                import: [entry]
              }
            }
          }
        }
      }
    }
  }

  public apply(compiler: webpack.Compiler): void {
    // Add the manifest scripts to the compilation.
    this.generateScripts(compiler)

    // Add the CSS from content scripts to the compilation.
    compiler.hooks.thisCompilation.tap(
      'BrowserExtensionHtmlPlugin',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'BrowserExtensionScriptsPlugin',
            // Derive new assets from the existing assets.
            stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONS
          },
          (assets) => {
            if (compilation.errors.length > 0) return

            const manifestSource = assets['manifest.json'] != null
            ? assets['manifest.json'].source()
            : require(this.manifestPath)

            const manifest = manifestSource
            const scriptFields = manifestFields(
              this.manifestPath,
              manifest
            ).scripts

            for (const field of Object.entries(scriptFields)) {
              const [, scriptFilePath] = field

              const cssEntries = Array.isArray(scriptFilePath)
                ? scriptFilePath.filter((entry) => entry.endsWith('.css'))
                : [scriptFilePath].filter((entry) => entry?.endsWith('.css'))

              for (const field of Object.entries(cssEntries)) {
                const [feature, resource] = field

                // Resources from the manifest lib can come as undefined.
                if (resource) {
                  if (!fs.existsSync(resource)) return

                  if (!fs.existsSync(resource)) {
                    this.entryNotFoundWarn(compilation, feature, resource)
                    return
                  }

                  if (!fs.existsSync(resource)) {
                    this.entryNotFoundWarn(compilation, feature, resource)
                    return
                  }

                  const source = fs.readFileSync(resource)
                  const rawSource = new sources.RawSource(source)
                  const context = compiler.options.context || ''

                  if (this.shouldEmitFile(context, resource)) {
                    compilation.emitAsset(
                      getFilePathSplitByDots(`content_scripts-${feature}`, resource),
                      rawSource
                    )
                  }
                }
              }
            }
          }
        )
      }
    )

    // Ensure the CSS file is stored as file
    // dependency so webpack can watch and trigger changes.
    compiler.hooks.thisCompilation.tap(
      'BrowserExtensionHtmlPlugin',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'BrowserExtensionScriptsPlugin',
            stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONS
          },
          (assets) => {
            if (compilation.errors?.length) return

            const manifestSource = assets['manifest.json'] != null
              ? assets['manifest.json'].source()
              : require(this.manifestPath)

            const manifest = manifestSource
            const scriptFields = manifestFields(
              this.manifestPath,
              manifest
            ).scripts

            for (const field of Object.entries(scriptFields)) {
              const [, scriptFilePath] = field

              const cssEntries = Array.isArray(scriptFilePath)
                ? scriptFilePath.filter((entry) => entry.endsWith('.css'))
                : [scriptFilePath].filter((entry) => entry?.endsWith('.css'))

              for (const field of Object.entries(cssEntries)) {
                const [, resource] = field

                if (resource) {
                  const fileDependencies = new Set(compilation.fileDependencies)

                  if (fs.existsSync(resource)) {
                    if (!fileDependencies.has(resource)) {
                      fileDependencies.add(resource)
                      compilation.fileDependencies.add(resource)
                    }
                  }
                }
              }
            }
          }
        )
      }
    )
  }
}

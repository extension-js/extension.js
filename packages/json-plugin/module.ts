import path from 'path'
import fs from 'fs'
import webpack, {sources, Compilation} from 'webpack'
import {type JsonPluginInterface} from './types'
import {getFileOutputPath} from './helpers/getResourceName'
import manifestFields from 'browser-extension-manifest-fields'
import shouldExclude from './helpers/shouldExclude'

export default class JsonPlugin {
  public readonly manifestPath: string
  public readonly exclude?: string[]

  constructor(options: JsonPluginInterface) {
    this.manifestPath = options.manifestPath
    this.exclude = options.exclude
  }

  private manifestNotFoundError(compilation: webpack.Compilation) {
    const errorMessage = `A manifest file is required for this plugin to run.`

    compilation.errors.push(
      new webpack.WebpackError(`[manifest.json]: ${errorMessage}`)
    )
  }

  private entryNotFoundWarn(
    compilation: webpack.Compilation,
    feature: string,
    jsonFilePath: string
  ) {
    const hintMessage = `Check the \`${feature}\` field in your \`manifest.json\` file.`
    const errorMessage = `File path \`${jsonFilePath}\` not found. ${hintMessage}`

    compilation.warnings.push(
      new webpack.WebpackError(`[manifest.json]: ${errorMessage}`)
    )
  }

  private shouldEmitFile(context: string, file: string) {
    if (!this.exclude) return false

    const contextFile = path.relative(context, file)
    const shouldExcludeFile = shouldExclude(this.exclude, contextFile)

    // if there are no exclude folder, exclude nothing
    if (shouldExcludeFile) return false

    return true
  }

  public apply(compiler: webpack.Compiler): void {
    // Add the JSON to the compilation. This is important so other
    // plugins can get it via the compilation.assets object,
    // allowing them to modify it.
    compiler.hooks.thisCompilation.tap(
      'BrowserExtensionJsonPlugin',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'BrowserExtensionJsonPlugin',
            // Add additional assets to the compilation.
            stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONS
          },
          (assets) => {
            // Do not emit if manifest doesn't exist.
            if (!fs.existsSync(this.manifestPath)) {
              this.manifestNotFoundError(compilation)
              return
            }

            if (compilation.errors.length > 0) return

            const manifest = assets['manifest.json']
              ? JSON.parse(assets['manifest.json'].source().toString())
              : require(this.manifestPath)

            const jsonFields = manifestFields(this.manifestPath, manifest).json

            for (const field of Object.entries(jsonFields)) {
              const [feature, resource] = field

              const resourceArr = Array.isArray(resource)
                ? resource
                : [resource]

              for (const thisResource of resourceArr) {
                // Resources from the manifest lib can come as undefined.
                if (thisResource) {
                  // Do not output if file doesn't exist.
                  // If the user updates the path, this script runs again
                  // and output the file accordingly.
                  if (!fs.existsSync(thisResource)) {
                    this.entryNotFoundWarn(compilation, feature, thisResource)
                    return
                  }

                  const source = fs.readFileSync(thisResource)
                  const rawSource = new sources.RawSource(source)
                  const context = compiler.options.context || ''

                  if (this.shouldEmitFile(context, thisResource)) {
                    compilation.emitAsset(
                      getFileOutputPath(feature, thisResource),
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

    // Ensure this JSON file and its assets are stored as file
    // dependencies so webpack can watch and trigger changes.
    compiler.hooks.thisCompilation.tap(
      'BrowserExtensionJsonPlugin',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'BrowserExtensionJsonPlugin',
            stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONS
          },
          (assets) => {
            if (compilation.errors?.length) return

            const manifest = assets['manifest.json']
              ? JSON.parse(assets['manifest.json'].source().toString())
              : require(this.manifestPath)
            const jsonFields = manifestFields(this.manifestPath, manifest).json

            for (const field of Object.entries(jsonFields)) {
              const [, resource] = field

              const resourceArr = Array.isArray(resource)
                ? resource
                : [resource]

              for (const thisResource of resourceArr) {
                if (thisResource) {
                  const fileDependencies = new Set(compilation.fileDependencies)

                  if (fs.existsSync(thisResource)) {
                    if (!fileDependencies.has(thisResource)) {
                      fileDependencies.add(thisResource)
                      compilation.fileDependencies.add(thisResource)
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

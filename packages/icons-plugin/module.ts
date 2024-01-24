import path from 'path'
import fs from 'fs'
import webpack, {sources, Compilation} from 'webpack'
import {getFileOutputPath} from './helpers/getResourceName'
import {type IconsPluginInterface} from './types'
import shouldExclude from './helpers/shouldExclude'

// Manifest fields
import manifestFields from 'browser-extension-manifest-fields'

export default class ScriptsPlugin {
  private readonly manifestPath: string
  public readonly exclude?: string[]

  constructor(options: IconsPluginInterface) {
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
    iconFilePath: string
  ) {
    const hintMessage = `Check the \`${feature}\` field in your \`manifest.json\` file.`
    const errorMessage = `File path \`${iconFilePath}\` not found. ${hintMessage}`

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
    // Add the icon to the compilation. This is important so other
    // plugins can get it via the compilation.assets object,
    // allowing them to modify it.
    compiler.hooks.thisCompilation.tap(
      'ScriptsPlugin (module)',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'ScriptsPlugin (module)',
            stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_TRANSFER
          },
          () => {
            // Do not emit if manifest doesn't exist.
            if (!fs.existsSync(this.manifestPath)) {
              this.manifestNotFoundError(compilation)
            }

            if (compilation.errors.length > 0) return

            const iconFields = manifestFields(this.manifestPath).icons

            for (const field of Object.entries(iconFields)) {
              const [feature, resource] = field

              const iconEntries = Array.isArray(resource)
                ? typeof resource[0] === 'string'
                  ? resource
                  : resource.map(Object.values).flat()
                : [resource]

              for (const entry of iconEntries) {
                // Resources from the manifest lib can come as undefined.
                if (entry) {
                  // Do not output if file doesn't exist.
                  // If the user updates the path, this script runs again
                  // and output the file accordingly.
                  if (!fs.existsSync(entry)) {
                    this.entryNotFoundWarn(compilation, feature, entry)
                    return
                  }

                  const source = fs.readFileSync(entry)
                  const rawSource = new sources.RawSource(source)
                  const context = compiler.options.context || ''

                  if (this.shouldEmitFile(context, entry)) {
                    compilation.emitAsset(
                      getFileOutputPath(feature, entry),
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

    compiler.hooks.thisCompilation.tap(
      'ScriptsPlugin (module)',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'ScriptsPlugin (module)',
            stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONS
          },
          (assets) => {
            if (compilation.errors?.length) return

            const manifest = assets['manifest.json']
              ? JSON.parse(assets['manifest.json'].source().toString())
              : require(this.manifestPath)

            const iconFields = manifestFields(this.manifestPath, manifest).icons

            for (const field of Object.entries(iconFields)) {
              const [, resource] = field

              const iconEntries = Array.isArray(resource)
                ? typeof resource[0] === 'string'
                  ? resource
                  : resource.map(Object.values).flat()
                : [resource]

              for (const entry of iconEntries) {
                if (entry) {
                  const fileDependencies = new Set(compilation.fileDependencies)

                  if (fs.existsSync(entry)) {
                    if (!fileDependencies.has(entry)) {
                      fileDependencies.add(entry)
                      compilation.fileDependencies.add(entry)
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

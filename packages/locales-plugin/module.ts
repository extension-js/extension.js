import path from 'path'
import fs from 'fs'
import webpack, {sources, Compilation} from 'webpack'
import {type LocalesPluginInterface} from './types'
import manifestFields from 'browser-extension-manifest-fields'
import errors from './helpers/errors'
import * as utils from './helpers/utils'

/**
 * LocalesPlugin is responsible for emitting the locales files
 * to the output directory.
 */
export default class LocalesPlugin {
  public readonly manifestPath: string
  public readonly exclude?: string[]

  constructor(options: LocalesPluginInterface) {
    this.manifestPath = options.manifestPath
  }
  public apply(compiler: webpack.Compiler): void {
    // Add the locales to the compilation. This is important so other
    // plugins can get it via the compilation.assets object,
    // allowing them to modify it.
    compiler.hooks.thisCompilation.tap(
      'LocalesPlugin (module)',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'LocalesPlugin (module)',
            // Add additional assets to the compilation.
            stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONS
          },
          (assets) => {
            // Do not emit if manifest doesn't exist.
            if (!fs.existsSync(this.manifestPath)) {
              errors.manifestNotFoundError(compilation)
              return
            }

            if (compilation.errors.length > 0) return

            const manifest = assets['manifest.json']
              ? JSON.parse(assets['manifest.json'].source().toString())
              : require(this.manifestPath)

            const localesFields = manifestFields(
              this.manifestPath,
              manifest
            ).locales

            if (manifest.default_locale && !localesFields?.length) {
              errors.noValidFolderError(compilation)
              return
            }

            for (const field of Object.entries(localesFields || [])) {
              const [feature, resource] = field
              const thisResource = resource as string

              // Resources from the manifest lib can come as undefined.
              if (thisResource) {
                // Do not output if file doesn't exist.
                // If the user updates the path, this script runs again
                // and output the file accordingly.
                if (!fs.existsSync(thisResource)) {
                  errors.entryNotFoundWarn(compilation, feature, thisResource)
                  return
                }

                const source = fs.readFileSync(thisResource)
                const rawSource = new sources.RawSource(source)
                const context =
                  compiler.options.context || path.dirname(this.manifestPath)

                if (!utils.shouldExclude(thisResource, this.exclude || [])) {
                  const filename = path.relative(context, thisResource)

                  compilation.emitAsset(filename, rawSource)
                }
              }
            }
          }
        )
      }
    )

    // Ensure this locales file and its assets are stored as file
    // dependencies so webpack can watch and trigger changes.
    compiler.hooks.thisCompilation.tap(
      'LocalesPlugin (module)',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'LocalesPlugin (module)',
            stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONS
          },
          (assets) => {
            if (compilation.errors?.length) return

            const manifest = assets['manifest.json']
              ? JSON.parse(assets['manifest.json'].source().toString())
              : require(this.manifestPath)

            const localesFields = manifestFields(
              this.manifestPath,
              manifest
            ).locales

            for (const field of Object.entries(localesFields || [])) {
              const [, resource] = field

              if (resource) {
                const fileDependencies = new Set(compilation.fileDependencies)

                const fileResources = localesFields || []

                for (const thisResource of fileResources) {
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

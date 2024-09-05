import path from 'path'
import fs from 'fs'
import webpack from 'webpack'
import {sources, Compilation} from 'webpack'
import {type FilepathList, type PluginInterface} from '../../webpack-types'
import * as messages from '../../lib/messages'
import * as utils from '../../lib/utils'
import {getLocales} from './get-locales'

/**
 * LocalesPlugin is responsible for emitting the locales files
 * to the output directory.
 */
export class LocalesPlugin {
  public readonly manifestPath: string
  public readonly includeList?: FilepathList
  public readonly excludeList?: FilepathList

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
    this.excludeList = options.excludeList
  }

  public apply(compiler: webpack.Compiler): void {
    // Add the locales to the compilation. This is important so other
    // plugins can get it via the compilation.assets object,
    // allowing them to modify it.
    compiler.hooks.thisCompilation.tap('locales:module', (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: 'locales:module',
          // Add additional assets to the compilation.
          stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONS
        },
        () => {
          const manifest = require(this.manifestPath)
          const manifestName = manifest.name || 'Extension.js'

          // Do not emit if manifest doesn't exist.
          if (!fs.existsSync(this.manifestPath)) {
            compilation.errors.push(
              new webpack.WebpackError(
                messages.manifestNotFoundError(manifestName, this.manifestPath)
              )
            )
            return
          }

          if (compilation.errors.length > 0) return

          const localesFields = getLocales(this.manifestPath)

          for (const field of Object.entries(localesFields || [])) {
            const [feature, resource] = field
            const thisResource = resource

            // Resources from the manifest lib can come as undefined.
            if (thisResource) {
              // Do not output if file doesn't exist.
              // If the user updates the path, this script runs again
              // and output the file accordingly.
              if (!fs.existsSync(thisResource)) {
                compilation.warnings.push(
                  new webpack.WebpackError(
                    messages.entryNotFoundWarn(
                      manifestName,
                      feature,
                      thisResource
                    )
                  )
                )
                return
              }

              const source = fs.readFileSync(thisResource)
              const rawSource = new sources.RawSource(source)
              const context =
                compiler.options.context || path.dirname(this.manifestPath)

              if (!utils.shouldExclude(thisResource, this.excludeList)) {
                const filename = path.relative(context, thisResource)

                compilation.emitAsset(filename, rawSource)
              }
            }
          }
        }
      )
    })

    // Ensure this locales file and its assets are stored as file
    // dependencies so webpack can watch and trigger changes.
    compiler.hooks.thisCompilation.tap('locales:module', (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: 'locales:module',
          stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONS
        },
        () => {
          if (compilation.errors?.length) return

          const localesFields = getLocales(this.manifestPath)

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
    })
  }
}

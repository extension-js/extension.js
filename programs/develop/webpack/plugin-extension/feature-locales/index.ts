import * as path from 'path'
import * as fs from 'fs'
import {Compiler, sources, Compilation} from '@rspack/core'
import {type FilepathList, type PluginInterface} from '../../webpack-types'
import * as messages from './messages'
import * as utils from '../../../develop-lib/utils'
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

  public apply(compiler: Compiler): void {
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
          // Do not emit if manifest doesn't exist.
          if (!fs.existsSync(this.manifestPath)) {
            const ErrorConstructor = compiler?.rspack?.WebpackError || Error
            const error = new ErrorConstructor(
              messages.manifestNotFoundMessageOnly()
            )

            error.name = 'ManifestNotFoundError'
            // @ts-expect-error - file is not a property of Error
            error.file = this.manifestPath

            if (!compilation.errors) {
              compilation.errors = []
            }

            compilation.errors.push(error)
            return
          }

          if (compilation.errors.length > 0) return

          const localesFields = getLocales(this.manifestPath)

          for (const field of Object.entries(localesFields || [])) {
            const [feature, resource] = field
            const thisResource = resource

            // Resources from the manifest lib can come as undefined.
            if (thisResource) {
              // Only process .json files
              if (path.extname(thisResource) !== '.json') {
                continue
              }

              if (!fs.existsSync(thisResource)) {
                const ErrorConstructor = compiler?.rspack?.WebpackError || Error
                const warning = new ErrorConstructor(
                  messages.entryNotFoundMessageOnly(feature)
                )

                // @ts-expect-error - file is not a property of Error
                warning.file = thisResource
                ;(warning as any).name = 'LocalesPluginMissingFile'

                if (!compilation.warnings) {
                  compilation.warnings = []
                }

                compilation.warnings.push(warning)
                continue
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
                // Only add JSON files to the dependencies
                if (
                  fs.existsSync(thisResource) &&
                  path.extname(thisResource) === '.json'
                ) {
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

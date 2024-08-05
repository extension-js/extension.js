import fs from 'fs'
import webpack from 'webpack'
import {sources, Compilation} from 'webpack'
import {type FilepathList, type PluginInterface} from '../../webpack-types'
import * as utils from '../../lib/utils'
import * as messages from '../../lib/messages'

/**
 * JsonPlugin is responsible for handling the JSON files defined
 * in the manifest.json. It emits the JSON files to the output
 * directory and adds them to the file dependencies of the compilation.
 *
 * Features supported:
 * - declarative_net_request.ruleset
 * - storage.managed_schema
 */
export class JsonPlugin {
  public readonly manifestPath: string
  public readonly includeList?: FilepathList
  public readonly excludeList?: FilepathList

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
    this.excludeList = options.excludeList
  }

  public apply(compiler: webpack.Compiler): void {
    // Add the JSON to the compilation. This is important so other
    // plugins can get it via the compilation.assets object,
    // allowing them to modify it.
    compiler.hooks.thisCompilation.tap('json:module', (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: 'json:module',
          // Add additional assets to the compilation.
          stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONS
        },
        () => {
          if (compilation.errors.length > 0) return

          const jsonFields = this.includeList || {}

          for (const field of Object.entries(jsonFields)) {
            const [feature, resource] = field

            const resourceArr: Array<string | undefined> = Array.isArray(
              resource
            )
              ? resource
              : [resource]

            for (const thisResource of resourceArr) {
              // Resources from the manifest lib can come as undefined.
              if (thisResource) {
                // Do not output if file doesn't exist.
                // If the user updates the path, this script runs again
                // and output the file accordingly.
                if (!utils.shouldExclude(thisResource, this.excludeList)) {
                  if (!fs.existsSync(thisResource)) {
                    const manifest = require(this.manifestPath)
                    const manifestName = manifest.name || 'Extension.js'

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

                  compilation.emitAsset(feature + '.json', rawSource)
                }
              }
            }
          }
        }
      )
    })

    // Ensure this JSON file and its assets are stored as file
    // dependencies so webpack can watch and trigger changes.
    compiler.hooks.thisCompilation.tap('json:module', (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: 'json:module',
          stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONS
        },
        () => {
          if (compilation.errors?.length) return

          const jsonFields = this.includeList || {}

          for (const field of Object.entries(jsonFields)) {
            const [, resource] = field

            const resourceArr: Array<string | undefined> = Array.isArray(
              resource
            )
              ? resource
              : [resource]

            for (const thisResource of resourceArr) {
              if (thisResource) {
                const fileDependencies = new Set(compilation.fileDependencies)

                if (!utils.shouldExclude(thisResource, this.excludeList)) {
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
        }
      )
    })
  }
}

import fs from 'fs'
import type webpack from 'webpack'
import {sources, Compilation} from 'webpack'
import manifestFields from 'browser-extension-manifest-fields'
import {type JsonPluginInterface, type Manifest} from './types'
import utils from './helpers/utils'
import errors from './helpers/errors'

/**
 * JsonPlugin is responsible for handling the JSON files defined
 * in the manifest.json. It emits the JSON files to the output
 * directory and adds them to the file dependencies of the compilation.
 *
 * Features supported:
 * - declarative_net_request.ruleset
 * - storage.managed_schema
 */
export default class JsonPlugin {
  public readonly manifestPath: string
  public readonly exclude?: string[]

  constructor(options: JsonPluginInterface) {
    this.manifestPath = options.manifestPath
    this.exclude = options.exclude
  }

  public apply(compiler: webpack.Compiler): void {
    // Add the JSON to the compilation. This is important so other
    // plugins can get it via the compilation.assets object,
    // allowing them to modify it.
    compiler.hooks.thisCompilation.tap('JsonPlugin (module)', (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: 'JsonPlugin (module)',
          // Add additional assets to the compilation.
          stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONS
        },
        (assets) => {
          if (compilation.errors.length > 0) return

          const manifest: Manifest = assets['manifest.json']
            ? JSON.parse(assets['manifest.json'].source().toString())
            : require(this.manifestPath)

          const jsonFields = manifestFields(this.manifestPath, manifest).json

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
                if (!utils.shouldExclude(thisResource, this.exclude || [])) {
                  if (!fs.existsSync(thisResource)) {
                    errors.entryNotFoundWarn(compilation, feature, thisResource)
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
    compiler.hooks.thisCompilation.tap('JsonPlugin (module)', (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: 'JsonPlugin (module)',
          stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONS
        },
        (assets) => {
          if (compilation.errors?.length) return

          const manifest: Manifest = assets['manifest.json']
            ? JSON.parse(assets['manifest.json'].source().toString())
            : require(this.manifestPath)
          const jsonFields = manifestFields(this.manifestPath, manifest).json

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

                if (!utils.shouldExclude(thisResource, this.exclude || [])) {
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

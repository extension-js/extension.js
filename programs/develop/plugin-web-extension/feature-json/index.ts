//      ██╗███████╗ ██████╗ ███╗   ██╗
//      ██║██╔════╝██╔═══██╗████╗  ██║
//      ██║███████╗██║   ██║██╔██╗ ██║
// ██   ██║╚════██║██║   ██║██║╚██╗██║
// ╚█████╔╝███████║╚██████╔╝██║ ╚████║
//  ╚════╝ ╚══════╝ ╚═════╝ ╚═╝  ╚═══╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import {Compiler, Compilation} from '@rspack/core'
import {processJsonAssets} from './process-assets'
import {trackJsonDependencies} from './track-dependencies'
import type {FilepathList, PluginInterface, DevOptions} from '../../types'

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
  public readonly browser?: DevOptions['browser'] | 'chrome'

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
    this.browser = options.browser
  }

  public apply(compiler: Compiler): void {
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
          processJsonAssets(
            compilation,
            this.manifestPath,
            this.includeList || {}
          )
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
          trackJsonDependencies(
            compilation,
            this.manifestPath,
            this.includeList || {}
          )
        }
      )
    })
  }
}

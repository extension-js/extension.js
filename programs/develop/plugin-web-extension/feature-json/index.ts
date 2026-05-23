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
    compiler.hooks.thisCompilation.tap('json:module', (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: 'json:module',
          stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONS
        },
        () => {
          // 1) Emit the JSON to the compilation so other plugins can read and
          //    modify it via compilation.assets.
          processJsonAssets(
            compilation,
            this.manifestPath,
            this.includeList || {}
          )

          // 2) Register the JSON file and its assets as file dependencies so
          // watch mode recompiles when they change. Runs in the same tap
          // (previously two taps shared the name "json:module" at the same
          // stage, making profiling and hook tracing ambiguous)
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

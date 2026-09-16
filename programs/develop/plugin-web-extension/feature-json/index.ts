//      ██╗███████╗ ██████╗ ███╗   ██╗
//      ██║██╔════╝██╔═══██╗████╗  ██║
//      ██║███████╗██║   ██║██╔██╗ ██║
// ██   ██║╚════██║██║   ██║██║╚██╗██║
// ╚█████╔╝███████║╚██████╔╝██║ ╚████║
//  ╚════╝ ╚══════╝ ╚═════╝ ╚═╝  ╚═══╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {Compilation, type Compiler} from '@rspack/core'
import type {DevOptions, FilepathList, PluginInterface} from '../../types'
import {processJsonAssets} from './process-assets'
import {trackJsonDependencies} from './track-dependencies'

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

          // Register the JSON file and its assets as file dependencies so watch mode
          // recompiles on change; one tap, previously two shared the same name.
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

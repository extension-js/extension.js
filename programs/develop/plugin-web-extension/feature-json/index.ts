//      ██╗███████╗ ██████╗ ███╗   ██╗
//      ██║██╔════╝██╔═══██╗████╗  ██║
//      ██║███████╗██║   ██║██╔██╗ ██║
// ██   ██║╚════██║██║   ██║██║╚██╗██║
// ╚█████╔╝███████║╚██████╔╝██║ ╚████║
//  ╚════╝ ╚══════╝ ╚═════╝ ╚═╝  ╚═══╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {Compilation, type Compiler} from '@rspack/core'
import type {DevOptions} from '../../types'
import * as messages from './messages'
import {processJsonAssets} from './process-assets'
import {trackJsonDependencies} from './track-dependencies'

// One output file per key: the key is the output path and the value its
// source. A list had every file write the same output, the last one kept.
export type JsonIncludeList = Record<string, string | undefined>

export interface JsonPluginOptions {
  manifestPath: string
  includeList?: JsonIncludeList
  browser?: DevOptions['browser']
}

export class JsonPlugin {
  public readonly manifestPath: string
  public readonly includeList?: JsonIncludeList
  public readonly browser?: DevOptions['browser'] | 'chrome'

  constructor(options: JsonPluginOptions) {
    for (const [key, value] of Object.entries(options.includeList || {})) {
      if (value !== undefined && typeof value !== 'string') {
        throw new TypeError(messages.jsonIncludeValueNotOneString(key, value))
      }
    }

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
            this.includeList || {},
            this.browser ? String(this.browser) : undefined
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

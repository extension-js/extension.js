// ██╗    ██╗ █████╗ ███████╗███╗   ███╗
// ██║    ██║██╔══██╗██╔════╝████╗ ████║
// ██║ █╗ ██║███████║███████╗██╔████╔██║
// ██║███╗██║██╔══██║╚════██║██║╚██╔╝██║
// ╚███╔███╔╝██║  ██║███████║██║ ╚═╝ ██║
//  ╚══╝╚══╝ ╚═╝  ╚═╝╚══════╝╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {Compiler} from '@rspack/core'
import type {DevOptions, PluginInterface} from '../types'

export class WasmPlugin {
  public static readonly name: string = 'plugin-wasm'

  // biome-ignore lint/complexity/noUselessConstructor: rspack-config.ts passes the shared options, nothing here reads them
  constructor(_options?: PluginInterface & {mode?: DevOptions['mode']}) {}

  public apply(compiler: Compiler): void {
    compiler.options.resolve = compiler.options.resolve || {}
    const extensions = compiler.options.resolve.extensions || []

    if (!extensions.includes('.wasm')) {
      compiler.options.resolve.extensions = [...extensions, '.wasm']
    }
  }
}

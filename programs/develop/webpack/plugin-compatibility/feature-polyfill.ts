import rspack, {Compiler} from '@rspack/core'
import path from 'path'

import {PluginInterface} from '../webpack-types'

/**
 * PolyfillPlugin is responsible for providing the `browser`
 * global variable to the extension's codebase.
 */
export class PolyfillPlugin {
  public readonly manifestPath: string
  public readonly browser?: string

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser
  }

  apply(compiler: Compiler) {
    // webextension-polyfill path
    new rspack.ProvidePlugin({
      browser: path.resolve(
        'node_modules/webextension-polyfill/dist/browser-polyfill.js'
      )
    }).apply(compiler)
  }
}

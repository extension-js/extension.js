import * as path from 'path'
import rspack, {Compiler} from '@rspack/core'
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
    new rspack.ProvidePlugin({
      browser: path.resolve(
        __dirname,
        '..',
        'node_modules/webextension-polyfill/dist/browser-polyfill.js'
      )
    }).apply(compiler)
  }
}

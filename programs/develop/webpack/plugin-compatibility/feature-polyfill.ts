import * as path from 'path'
import rspack, {Compiler} from '@rspack/core'
import {PluginInterface} from '../webpack-types'
import * as messages from '../lib/messages'

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
    try {
      const polyfillPath = require.resolve(
        'webextension-polyfill/dist/browser-polyfill.js'
      )

      new rspack.ProvidePlugin({
        browser: polyfillPath
      }).apply(compiler)
    } catch (error) {
      console.warn(messages.webextensionPolyfillNotFound())
    }
  }
}

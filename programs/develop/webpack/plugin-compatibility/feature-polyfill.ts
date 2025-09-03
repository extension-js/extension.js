import rspack, {Compiler} from '@rspack/core'
import {PluginInterface} from '../webpack-types'
import * as messages from '../webpack-lib/messages'

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
      // Resolve the polyfill relative to this plugin's own package/dist
      // because `webextension-polyfill` is a dependency of this package
      const polyfillPath = require.resolve(
        'webextension-polyfill/dist/browser-polyfill.js',
        {paths: [__dirname]}
      )

      new rspack.ProvidePlugin({
        browser: polyfillPath
      }).apply(compiler)
    } catch (error) {
      console.warn(messages.webextensionPolyfillNotFound())
    }
  }
}

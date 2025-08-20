import * as path from 'path'
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
      // The polyfill should be resolved from the
      // rspack context (package.json directory)
      // since it's a dependency of that package
      const context = compiler.options.context as string
      const polyfillPath = require.resolve(
        'webextension-polyfill/dist/browser-polyfill.js',
        {paths: [context]}
      )

      new rspack.ProvidePlugin({
        browser: polyfillPath
      }).apply(compiler)
    } catch (error) {
      console.warn(messages.webextensionPolyfillNotFound())
    }
  }
}

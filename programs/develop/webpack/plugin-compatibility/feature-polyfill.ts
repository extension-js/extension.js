import rspack, {Compiler} from '@rspack/core'
import {PluginInterface} from '../webpack-types'
import * as messages from './compatibility-lib/messages'

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

      // Ensure the module specifier resolves to our absolute polyfill path,
      // regardless of the consumer project's node_modules layout
      const currentResolve = compiler.options.resolve || {}
      const existingAlias = currentResolve.alias || {}

      compiler.options.resolve = {
        ...currentResolve,
        alias: {
          ...existingAlias,
          // Use `$` to exactly match the package name
          'webextension-polyfill$': polyfillPath
        }
      }

      // Provide `browser` by importing the aliased module
      new rspack.ProvidePlugin({
        browser: 'webextension-polyfill'
      }).apply(compiler)
    } catch (error) {
      console.warn(messages.webextensionPolyfillNotFound())
    }
  }
}

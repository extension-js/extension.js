//  ██████╗ ██████╗ ███╗   ███╗██████╗  █████╗ ████████╗██╗██████╗ ██╗██╗     ██╗████████╗██╗   ██╗
// ██╔════╝██╔═══██╗████╗ ████║██╔══██╗██╔══██╗╚══██╔══╝██║██╔══██╗██║██║     ██║╚══██╔══╝╚██╗ ██╔╝
// ██║     ██║   ██║██╔████╔██║██████╔╝███████║   ██║   ██║██████╔╝██║██║     ██║   ██║    ╚████╔╝
// ██║     ██║   ██║██║╚██╔╝██║██╔═══╝ ██╔══██║   ██║   ██║██╔══██╗██║██║     ██║   ██║     ╚██╔╝
// ╚██████╗╚██████╔╝██║ ╚═╝ ██║██║     ██║  ██║   ██║   ██║██████╔╝██║███████╗██║   ██║      ██║
//  ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝     ╚═╝  ╚═╝   ╚═╝   ╚═╝╚═════╝ ╚═╝╚══════╝╚═╝   ╚═╝      ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import rspack, {Compiler} from '@rspack/core'
import * as compatMessages from './compatibility-lib/messages'
import * as compatDevMessages from './compatibility-lib/messages'
import type {PluginInterface, DevOptions} from '../webpack-types'

/**
 * PolyfillPlugin is responsible for providing the `browser`
 * global variable to the extension's codebase.
 */
export class PolyfillPlugin {
  public readonly browser: DevOptions['browser']

  constructor(options: PluginInterface) {
    this.browser = options.browser || 'chrome'
  }

  apply(compiler: Compiler) {
    try {
      // Resolve the polyfill preferring the consumer project first.
      //
      // Why: some package managers hoist dependencies to the project root
      // (or otherwise do not place them under extension-develop/node_modules).
      // Resolving from `compiler.options.context` avoids hard-coding a nested path
      // that the bundler may not be able to resolve in all layouts.
      const polyfillPath = require.resolve(
        'webextension-polyfill/dist/browser-polyfill.js',
        {
          paths: [compiler.options.context as string, __dirname].filter(Boolean)
        }
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

      if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
        console.log(
          compatDevMessages.compatibilityPolyfillEnabled(
            this.browser,
            polyfillPath
          )
        )
      }
    } catch (error) {
      console.warn(compatMessages.webextensionPolyfillNotFound())
    }
  }
}

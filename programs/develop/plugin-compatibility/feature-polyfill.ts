//  ██████╗ ██████╗ ███╗   ███╗██████╗  █████╗ ████████╗██╗██████╗ ██╗██╗     ██╗████████╗██╗   ██╗
// ██╔════╝██╔═══██╗████╗ ████║██╔══██╗██╔══██╗╚══██╔══╝██║██╔══██╗██║██║     ██║╚══██╔══╝╚██╗ ██╔╝
// ██║     ██║   ██║██╔████╔██║██████╔╝███████║   ██║   ██║██████╔╝██║██║     ██║   ██║    ╚████╔╝
// ██║     ██║   ██║██║╚██╔╝██║██╔═══╝ ██╔══██║   ██║   ██║██╔══██╗██║██║     ██║   ██║     ╚██╔╝
// ╚██████╗╚██████╔╝██║ ╚═╝ ██║██║     ██║  ██║   ██║   ██║██████╔╝██║███████╗██║   ██║      ██║
//  ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝     ╚═╝  ╚═╝   ╚═╝   ╚═╝╚═════╝ ╚═╝╚══════╝╚═╝   ╚═╝      ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {createRequire} from 'node:module'
import rspack, {type Compiler} from '@rspack/core'
import type {DevOptions, PluginInterface} from '../types'
import * as messages from './compatibility-lib/messages'

const cjsRequire = createRequire(import.meta.url)

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
      // Resolve the polyfill preferring the consumer project first: package
      // managers may hoist it to the project root, not under extension-develop.
      const polyfillPath = cjsRequire.resolve(
        'webextension-polyfill/dist/browser-polyfill.js',
        {
          paths: [compiler.options.context as string, __dirname].filter(Boolean)
        }
      )

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

      new rspack.ProvidePlugin({
        browser: 'webextension-polyfill'
      }).apply(compiler)

      if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
        console.log(
          messages.compatibilityPolyfillEnabled(this.browser, polyfillPath)
        )
      }
    } catch (error) {
      console.warn(messages.webextensionPolyfillNotFound())
    }
  }
}

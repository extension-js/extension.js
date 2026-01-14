//  ██████╗ ██████╗ ███╗   ███╗██████╗  █████╗ ████████╗██╗██████╗ ██╗██╗     ██╗████████╗██╗   ██╗
// ██╔════╝██╔═══██╗████╗ ████║██╔══██╗██╔══██╗╚══██╔══╝██║██╔══██╗██║██║     ██║╚══██╔══╝╚██╗ ██╔╝
// ██║     ██║   ██║██╔████╔██║██████╔╝███████║   ██║   ██║██████╔╝██║██║     ██║   ██║    ╚████╔╝
// ██║     ██║   ██║██║╚██╔╝██║██╔═══╝ ██╔══██║   ██║   ██║██╔══██╗██║██║     ██║   ██║     ╚██╔╝
// ╚██████╗╚██████╔╝██║ ╚═╝ ██║██║     ██║  ██║   ██║   ██║██████╔╝██║███████╗██║   ██║      ██║
//  ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝     ╚═╝  ╚═╝   ╚═╝   ╚═╝╚═════╝ ╚═╝╚══════╝╚═╝   ╚═╝      ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import {type Compiler} from '@rspack/core'
import {PolyfillPlugin} from './feature-polyfill'
import {BrowserSpecificFieldsPlugin} from './feature-browser-specific-fields'
import type {PluginInterface, DevOptions} from '../webpack-types'
import * as messages from './compatibility-lib/messages'

export class CompatibilityPlugin {
  public static readonly name: string = 'plugin-compatibility'

  public readonly manifestPath: string
  public readonly browser: DevOptions['browser']
  public readonly polyfill: DevOptions['polyfill']

  constructor(options: PluginInterface & {polyfill: DevOptions['polyfill']}) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
    this.polyfill = options.polyfill || false
  }

  public async apply(compiler: Compiler) {
    // Allow browser polyfill as needed
    if (this.polyfill) {
      if (this.browser !== 'firefox') {
        if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
          console.log(
            messages.compatibilityPolyfillEnabled(
              this.browser,
              'webextension-polyfill'
            )
          )
        }

        new PolyfillPlugin({
          manifestPath: this.manifestPath,
          browser: this.browser || 'chrome'
        }).apply(compiler)
      } else {
        if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
          console.log(
            messages.compatibilityPolyfillSkipped(
              'Firefox bundles browser.* APIs',
              this.browser
            )
          )
        }
      }
    } else {
      if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
        console.log(messages.compatibilityPolyfillDisabled(this.browser))
      }
    }

    // Handle manifest compatibilities across browser vendors.
    new BrowserSpecificFieldsPlugin({
      manifestPath: this.manifestPath,
      browser: this.browser || 'chrome'
    }).apply(compiler)
  }
}

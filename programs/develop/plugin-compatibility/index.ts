//  ██████╗ ██████╗ ███╗   ███╗██████╗  █████╗ ████████╗██╗██████╗ ██╗██╗     ██╗████████╗██╗   ██╗
// ██╔════╝██╔═══██╗████╗ ████║██╔══██╗██╔══██╗╚══██╔══╝██║██╔══██╗██║██║     ██║╚══██╔══╝╚██╗ ██╔╝
// ██║     ██║   ██║██╔████╔██║██████╔╝███████║   ██║   ██║██████╔╝██║██║     ██║   ██║    ╚████╔╝
// ██║     ██║   ██║██║╚██╔╝██║██╔═══╝ ██╔══██║   ██║   ██║██╔══██╗██║██║     ██║   ██║     ╚██╔╝
// ╚██████╗╚██████╔╝██║ ╚═╝ ██║██║     ██║  ██║   ██║   ██║██████╔╝██║███████╗██║   ██║      ██║
//  ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝     ╚═╝  ╚═╝   ╚═╝   ╚═╝╚═════╝ ╚═╝╚══════╝╚═╝   ╚═╝      ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {Compiler} from '@rspack/core'
import {isGeckoBasedBrowser} from '../lib/constants'
import {isDebug} from '../lib/messaging'
import type {DevOptions, PluginInterface} from '../types'
import * as messages from './compatibility-lib/messages'
import {PolyfillPlugin} from './feature-polyfill'

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

  public apply(compiler: Compiler) {
    const isGeckoFamily = isGeckoBasedBrowser(String(this.browser))

    if (this.polyfill) {
      if (!isGeckoFamily) {
        if (isDebug()) {
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
        if (isDebug()) {
          console.log(
            messages.compatibilityPolyfillSkipped(
              'Firefox bundles browser.* APIs',
              this.browser
            )
          )
        }
      }
    } else {
      if (isDebug()) {
        console.log(messages.compatibilityPolyfillDisabled(this.browser))
      }
    }
  }
}

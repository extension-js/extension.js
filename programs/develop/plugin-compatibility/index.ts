//  ██████╗ ██████╗ ███╗   ███╗██████╗  █████╗ ████████╗██╗██████╗ ██╗██╗     ██╗████████╗██╗   ██╗
// ██╔════╝██╔═══██╗████╗ ████║██╔══██╗██╔══██╗╚══██╔══╝██║██╔══██╗██║██║     ██║╚══██╔══╝╚██╗ ██╔╝
// ██║     ██║   ██║██╔████╔██║██████╔╝███████║   ██║   ██║██████╔╝██║██║     ██║   ██║    ╚████╔╝
// ██║     ██║   ██║██║╚██╔╝██║██╔═══╝ ██╔══██║   ██║   ██║██╔══██╗██║██║     ██║   ██║     ╚██╔╝
// ╚██████╗╚██████╔╝██║ ╚═╝ ██║██║     ██║  ██║   ██║   ██║██████╔╝██║███████╗██║   ██║      ██║
//  ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝     ╚═╝  ╚═╝   ╚═╝   ╚═╝╚═════╝ ╚═╝╚══════╝╚═╝   ╚═╝      ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {Compiler} from '@rspack/core'
import {isGeckoBasedBrowser, isWebkitBasedBrowser} from '../lib/constants'
import {isDebug} from '../lib/messaging'
import type {DevOptions, PluginInterface} from '../types'
import * as messages from './compatibility-lib/messages'
import {PolyfillPlugin} from './feature-polyfill'

function polyfillSkipReason(browser: DevOptions['browser']): string | null {
  if (isGeckoBasedBrowser(String(browser))) {
    return 'Firefox bundles browser.* APIs'
  }
  if (isWebkitBasedBrowser(String(browser))) {
    return 'Safari ships a native promise-based browser.* namespace'
  }
  return null
}

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
    const skipReason = polyfillSkipReason(this.browser)

    if (this.polyfill) {
      if (!skipReason) {
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
            messages.compatibilityPolyfillSkipped(skipReason, this.browser)
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

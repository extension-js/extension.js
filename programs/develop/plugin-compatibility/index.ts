//  ██████╗ ██████╗ ███╗   ███╗██████╗  █████╗ ████████╗██╗██████╗ ██╗██╗     ██╗████████╗██╗   ██╗
// ██╔════╝██╔═══██╗████╗ ████║██╔══██╗██╔══██╗╚══██╔══╝██║██╔══██╗██║██║     ██║╚══██╔══╝╚██╗ ██╔╝
// ██║     ██║   ██║██╔████╔██║██████╔╝███████║   ██║   ██║██████╔╝██║██║     ██║   ██║    ╚████╔╝
// ██║     ██║   ██║██║╚██╔╝██║██╔═══╝ ██╔══██║   ██║   ██║██╔══██╗██║██║     ██║   ██║     ╚██╔╝
// ╚██████╗╚██████╔╝██║ ╚═╝ ██║██║     ██║  ██║   ██║   ██║██████╔╝██║███████╗██║   ██║      ██║
//  ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝     ╚═╝  ╚═╝   ╚═╝   ╚═╝╚═════╝ ╚═╝╚══════╝╚═╝   ╚═╝      ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {Compiler} from '@rspack/core'
import {isGeckoBasedBrowser, isWebkitBasedBrowser} from '../lib/constants'
import {debugLine, isDebug} from '../lib/messaging'
import type {DevOptions, PluginInterface} from '../types'
import * as messages from './compatibility-lib/messages'
import {WarnBrowserGlobalWithoutPolyfill} from './feature-browser-global'
import {PolyfillPlugin, resolvePolyfillPath} from './feature-polyfill'

function polyfillSkipReason(browser: DevOptions['browser']): string | null {
  if (isGeckoBasedBrowser(String(browser))) {
    return 'Firefox bundles browser.* APIs'
  }

  if (isWebkitBasedBrowser(String(browser))) {
    return 'Safari ships a native promise-based browser.* namespace'
  }

  return null
}

// The alias an import of the package resolves through, for the static
// config, so a project's config hook sees it and its own alias wins.
export function polyfillAlias(options: {
  polyfill: DevOptions['polyfill']
  browser: DevOptions['browser']
  context?: string
}): Record<string, string> {
  if (!options.polyfill || polyfillSkipReason(options.browser || 'chrome')) {
    return {}
  }

  const polyfillPath = resolvePolyfillPath(options.context)

  // Use `$` to exactly match the package name
  return polyfillPath ? {'webextension-polyfill$': polyfillPath} : {}
}

export class CompatibilityPlugin {
  public static readonly name: string = 'plugin-compatibility'

  public readonly manifestPath: string
  public readonly browser: DevOptions['browser']
  public readonly polyfill: DevOptions['polyfill']
  public readonly devSession?: boolean
  public readonly command?: 'dev' | 'start' | 'build'

  constructor(
    options: PluginInterface & {
      polyfill?: DevOptions['polyfill']
      command?: 'dev' | 'start' | 'build'
    }
  ) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
    this.polyfill = options.polyfill || false
    this.devSession = options.devSession
    this.command = options.command
  }

  public apply(compiler: Compiler) {
    const skipReason = polyfillSkipReason(this.browser)

    if (this.polyfill) {
      if (!skipReason) {
        if (isDebug()) {
          debugLine(
            messages.compatibilityPolyfillEnabled(
              this.browser,
              'webextension-polyfill'
            )
          )
        }

        new PolyfillPlugin({
          browser: this.browser,
          manifestPath: this.manifestPath
        }).apply(compiler)
      } else {
        if (isDebug()) {
          debugLine(
            messages.compatibilityPolyfillSkipped(skipReason, this.browser)
          )
        }
      }
    } else {
      if (isDebug()) {
        debugLine(messages.compatibilityPolyfillDisabled(this.browser))
      }

      if (!skipReason) {
        new WarnBrowserGlobalWithoutPolyfill({
          manifestPath: this.manifestPath,
          browser: this.browser,
          devSession: this.devSession,
          command: this.command
        }).apply(compiler)
      }
    }
  }
}

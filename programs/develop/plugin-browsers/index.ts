import os from 'os'
import path from 'path'
import {type Compiler} from 'webpack'
import {type PluginInterface} from './browsers-types'
import {RunChromiumPlugin} from './run-chromium'
import {RunFirefoxPlugin} from './run-firefox'
import {DevOptions} from '../commands/commands-lib/config-types'
import {loadBrowserConfig} from '../commands/commands-lib/get-extension-config'
import * as messages from './browsers-lib/messages'
/**
 * BrowsersPlugin works by finding the binary for the browser specified in the
 * options and running it with the extension loaded.
 *
 * Supports:
 * - User profile - a custom profile can be specified for the target browser
 * - Preferences - a set of preferences can be specified for the target browser
 * - Starting URL - a custom URL can be specified for the target browser
 * - Browser flags - a set of flags can be specified for the target browser
 * - Chromium binary - a custom path to the Chromium binary can be specified
 * - Gecko binary - a custom path to the Gecko binary can be specified
 *
 * Browsers supported:
 * - Chrome
 * - Edge
 * - Firefox
 */
export class BrowsersPlugin {
  public static readonly name: string = 'plugin-browsers'

  public readonly extension: string | string[]
  public readonly browser: DevOptions['browser']
  public readonly open?: boolean
  public readonly browserFlags?: string[]
  public readonly profile?: string
  public readonly preferences?: Record<string, any>
  public readonly startingUrl?: string
  public readonly chromiumBinary?: string
  public readonly geckoBinary?: string

  constructor(options: PluginInterface) {
    this.extension = [
      ...options.extension,
      ...(options.browserFlags?.filter(
        (flag) => !flag.startsWith('--load-extension=')
      ) || [])
    ]
    this.browser = options.browser || 'chrome'
    this.browserFlags =
      options.browserFlags?.filter(
        (flag) => !flag.startsWith('--load-extension=')
      ) || []
    this.profile = options.profile
    this.preferences = options.preferences || {}
    this.startingUrl = options.startingUrl || ''
    this.chromiumBinary = options.chromiumBinary
    this.geckoBinary = options.geckoBinary
  }

  private getProfilePath(
    compiler: Compiler,
    browser: DevOptions['browser'],
    profile: string | undefined
  ) {
    if (profile) {
      return profile
    }

    // Ensure `start` runs in a fresh profile by default.
    if (compiler.options.mode === 'production') {
      return path.join(os.tmpdir(), 'extension-js', browser, 'profile')
    }

    return path.resolve(__dirname, `run-${browser}-profile`)
  }

  async apply(compiler: Compiler) {
    const config = {
      stats: true,
      extension: this.extension,
      browser: this.browser,
      browserFlags: this.browserFlags || [],
      profile: this.getProfilePath(
        compiler,
        this.browser,
        this.profile || this.profile
      ),
      preferences: this.preferences,
      startingUrl: this.startingUrl,
      chromiumBinary: this.chromiumBinary,
      geckoBinary: this.geckoBinary
    }

    const customUserConfig = await loadBrowserConfig(
      compiler.context,
      this.browser
    )
    const browserConfig = {
      ...config,
      ...customUserConfig
    }

    if (browserConfig?.chromiumBinary) {
      console.log(
        messages.isUsingBrowserBinary('chromium', browserConfig?.chromiumBinary)
      )
    }

    if (typeof browserConfig?.open !== 'undefined') {
      console.log(
        messages.isBrowserLauncherOpen(this.browser, browserConfig?.open)
      )
    }

    // if (process.env.EXTENSION_ENV === 'development') {
    if (browserConfig?.startingUrl) {
      console.log(
        messages.isUsingStartingUrl(
          browserConfig?.browser,
          browserConfig?.startingUrl
        )
      )
    }
    if (browserConfig?.chromiumBinary) {
      console.log(
        messages.isUsingBrowserBinary('chromium', browserConfig?.chromiumBinary)
      )
    }
    if (browserConfig?.geckoBinary) {
      console.log(
        messages.isUsingBrowserBinary('gecko', browserConfig?.geckoBinary)
      )
    }
    if (browserConfig?.profile) {
      console.log(
        messages.isUsingProfile(browserConfig?.browser, browserConfig?.profile)
      )
    }
    if (browserConfig?.preferences) {
      console.log(messages.isUsingPreferences(browserConfig?.browser))
    }
    if (browserConfig?.browserFlags && browserConfig?.browserFlags.length > 0) {
      console.log(messages.isUsingBrowserFlags(browserConfig?.browser))
    }
    // }

    // Do not call any browser runner if user decides not to.
    if (browserConfig.open === false) return

    switch (this.browser) {
      case 'chrome':
      case 'edge':
      case 'chromium-based': {
        new RunChromiumPlugin(browserConfig).apply(compiler)
        break
      }

      case 'firefox':
      case 'gecko-based':
        new RunFirefoxPlugin(browserConfig).apply(compiler)
        break

      default: {
        new RunChromiumPlugin({
          ...browserConfig,
          browser: 'chrome'
        }).apply(compiler)
        break
      }
    }
  }
}

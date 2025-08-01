import os from 'os'
import * as path from 'path'
import {type Compiler} from '@rspack/core'
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
  public readonly instanceId?: string
  public readonly port?: number | string
  public readonly enableCDP?: boolean

  constructor(options: PluginInterface) {
    console.log('🔍 BrowsersPlugin constructor called with options:', options)
    console.log('🔍 BrowsersPlugin port from options:', options.port)

    // Include extensions and filter out any duplicate load-extension flags
    this.extension = [
      ...options.extension,
      ...(options.browserFlags?.filter(
        (flag) => !flag.startsWith('--load-extension=')
      ) || [])
    ]

    // Determine browser based on binary flags or fall back to the provided option
    if (options.chromiumBinary) {
      this.browser = 'chromium-based'
    } else if (options.geckoBinary) {
      this.browser = 'gecko-based'
    } else {
      this.browser = options.browser || 'chrome'
    }

    this.open = options.open
    this.browserFlags =
      options.browserFlags?.filter(
        (flag) => !flag.startsWith('--load-extension=')
      ) || []
    this.profile = options.profile
    this.preferences = options.preferences
    this.startingUrl = options.startingUrl || ''
    this.chromiumBinary = options.chromiumBinary
    this.geckoBinary = options.geckoBinary
    this.instanceId = options.instanceId
    this.port = options.port
    this.enableCDP = (options as any)?.enableCDP !== false

    console.log('🔍 BrowsersPlugin constructor finished, this.port:', this.port)
  }

  private getProfilePath(
    compiler: Compiler,
    browser: DevOptions['browser'],
    profile: string | undefined
  ) {
    // If user provided a profile path, use it
    if (profile) {
      return profile
    }

    // Always use the extension-js/profiles directory in the project
    const distPath = path.dirname(compiler.options.output.path!)
    return path.resolve(
      distPath,
      'extension-js',
      'profiles',
      `${browser}-profile`
    )
  }

  async apply(compiler: Compiler) {
    const config = {
      stats: true,
      // @ts-expect-error it comes as a string from the CLI
      open: this.open === 'false' ? false : true,
      extension: this.extension,
      browser: this.browser,
      browserFlags: this.browserFlags || [],
      profile: this.profile,
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

    if (browserConfig?.open === false) {
      console.log(messages.isBrowserLauncherOpen(this.browser, false))
    }

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

    // Do not call any browser runner if user decides not to.
    if (browserConfig.open === false) return

    const profile = this.getProfilePath(
      compiler,
      this.browser,
      this.profile || this.profile
    )

    // Get port from dev server config if not provided
    const port =
      this.port || (compiler.options.devServer as any)?.port || 'auto'

    // Pass port to browser specific plugins
    switch (this.browser) {
      case 'chrome':
      case 'edge':
      case 'chromium-based': {
        new RunChromiumPlugin({
          ...browserConfig,
          browser: this.browser,
          profile,
          port,
          instanceId: this.instanceId,
          enableCDP: this.enableCDP
        }).apply(compiler)
        break
      }

      case 'firefox':
      case 'gecko-based':
        new RunFirefoxPlugin({
          ...browserConfig,
          browser: this.browser,
          profile,
          port,
          instanceId: this.instanceId
        }).apply(compiler)
        break

      default: {
        new RunChromiumPlugin({
          ...browserConfig,
          browser: 'chrome',
          profile,
          port,
          instanceId: this.instanceId,
          enableCDP: this.enableCDP
        }).apply(compiler)
        break
      }
    }
  }
}

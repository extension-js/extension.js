import {type Compiler} from '@rspack/core'
import {type PluginInterface} from './browsers-types'
import {DevOptions} from '../../develop-lib/config-types'
import * as messages from '../webpack-lib/messages'
import {SetupChromeInspectionStep} from './run-chromium/setup-chrome-inspection'
import {SetupFirefoxInspectionStep} from './run-firefox/remote-firefox/setup-firefox-inspection'

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
 * First-class browsers supported:
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
  public readonly excludeBrowserFlags?: string[]
  public readonly profile?: string | false
  public readonly preferences?: Record<string, any>
  public readonly startingUrl?: string
  public readonly chromiumBinary?: string
  public readonly geckoBinary?: string
  public readonly instanceId?: string
  public readonly port?: number | string
  public readonly source?: string
  public readonly watchSource?: boolean
  public readonly reuseProfile?: boolean
  public readonly dryRun?: boolean

  constructor(options: PluginInterface) {
    // Environment overrides removed

    // Preserve provided extension paths as-is (do not mix flags)
    this.extension = options.extension

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
    this.excludeBrowserFlags = options.excludeBrowserFlags
    // Normalize profile option to avoid accidental string "false" directories
    if (typeof options.profile === 'string') {
      const trimmed = options.profile.trim()
      if (
        /^(false|null|undefined|off|0)$/i.test(trimmed) ||
        trimmed.length === 0
      ) {
        this.profile = false
        console.warn(
          '[plugin-browsers] Normalized profile option from string to false; no managed profile will be used.'
        )
      } else {
        this.profile = trimmed
      }
    } else {
      this.profile = options.profile
    }
    this.preferences = options.preferences
    this.startingUrl = options.startingUrl || ''
    this.chromiumBinary = options.chromiumBinary
    this.geckoBinary = options.geckoBinary
    this.instanceId = options.instanceId
    this.port = options.port
    // Add source inspection options
    this.source = options.source
    this.watchSource = options.watchSource
    this.reuseProfile = options.reuseProfile
    this.dryRun = (options as any).dryRun as any

    if (this.profile === false) {
      console.warn(
        '[plugin-browsers] You are using the system profile (profile: false). This may alter your personal browser data. Consider using managed profiles or backups.'
      )
    }
  }

  apply(compiler: Compiler) {
    try {
      let UserDefinedBrowserPlugin: any

      // Synchronously import the appropriate browser plugin
      switch (this.browser) {
        case 'chrome':
        case 'edge':
        case 'chromium-based':
          const {RunChromiumPlugin} = require('./run-chromium')
          UserDefinedBrowserPlugin = RunChromiumPlugin
          break
        case 'firefox':
        case 'gecko-based':
          const {RunFirefoxPlugin} = require('./run-firefox')
          UserDefinedBrowserPlugin = RunFirefoxPlugin
          break
        default:
          throw new Error(`Unsupported browser: ${this.browser}`)
      }

      // Create instance with current options
      const browserConfig = {
        extension: this.extension,
        browser: this.browser,
        open: this.open,
        browserFlags: this.browserFlags,
        excludeBrowserFlags: this.excludeBrowserFlags,
        profile: this.profile,
        preferences: this.preferences,
        startingUrl: this.startingUrl,
        chromiumBinary: this.chromiumBinary,
        geckoBinary: this.geckoBinary,
        instanceId: this.instanceId,
        port: this.port,
        source: this.source,
        watchSource: this.watchSource,
        reuseProfile: this.reuseProfile,
        dryRun: this.dryRun
      }

      // Apply the browser-specific plugin immediately
      new UserDefinedBrowserPlugin(browserConfig).apply(compiler)
    } catch (error) {
      console.error(messages.browserPluginFailedToLoad(this.browser, error))
      throw error
    }

    // 3 - Sets up source inspection for real-time HTML monitoring
    // This allows developers to see the full HTML output including
    // Shadow DOM content from content scripts
    if (compiler.options.mode !== 'development') return

    if (this.browser === 'firefox' || this.browser === 'gecko-based') {
      new SetupFirefoxInspectionStep({
        browser: this.browser,
        mode: compiler.options.mode || 'development',
        source: this.source,
        watchSource: this.watchSource,
        startingUrl: this.startingUrl,
        port: this.port,
        instanceId: this.instanceId
      }).apply(compiler)
    }

    if (
      this.browser === 'chrome' ||
      this.browser === 'edge' ||
      this.browser === 'chromium-based'
    ) {
      new SetupChromeInspectionStep({
        browser: this.browser,
        mode: compiler.options.mode || 'development',
        source: this.source,
        watchSource: this.watchSource,
        startingUrl: this.startingUrl,
        port: this.port,
        instanceId: this.instanceId
      } as any).apply(compiler)
    }
  }
}

import {type Compiler} from '@rspack/core'
import {type PluginInterface} from './browsers-types'
import {DevOptions} from '../types/options'
import * as messages from './browsers-lib/messages'
import {SetupChromeInspectionStep} from './run-chromium/setup-chrome-inspection'
import {SetupFirefoxInspectionStep} from './run-firefox/remote-firefox/setup-firefox-inspection'
import {RunChromiumPlugin} from './run-chromium'
import {RunFirefoxPlugin} from './run-firefox'
import {normalizePluginOptions} from './browsers-lib/normalize-options'

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
  public readonly preferences?: Record<string, unknown>
  public readonly startingUrl?: string
  public readonly chromiumBinary?: string
  public readonly geckoBinary?: string
  public readonly instanceId?: string
  public readonly port?: number | string
  public readonly source?: string
  public readonly watchSource?: boolean
  public readonly dryRun?: boolean
  // Unified logger options (for CDP streaming in Chromium path)
  public readonly logLevel?:
    | 'off'
    | 'error'
    | 'warn'
    | 'info'
    | 'debug'
    | 'trace'
    | 'all'
  public readonly logContexts?: Array<
    | 'background'
    | 'content'
    | 'page'
    | 'sidebar'
    | 'popup'
    | 'options'
    | 'devtools'
  >
  public readonly logFormat?: 'pretty' | 'json' | 'ndjson'
  public readonly logTimestamps?: boolean
  public readonly logColor?: boolean
  public readonly logUrl?: string
  public readonly logTab?: number | string

  constructor(options: PluginInterface) {
    const normalized = normalizePluginOptions(options)
    this.extension = normalized.extension
    this.browser = normalized.browser
    this.open = normalized.open
    this.browserFlags =
      normalized.browserFlags?.filter(
        (flag) => !flag.startsWith('--load-extension=')
      ) || []
    this.excludeBrowserFlags = normalized.excludeBrowserFlags
    this.profile = normalized.profile
    this.preferences = normalized.preferences
    this.startingUrl = normalized.startingUrl
    this.chromiumBinary = normalized.chromiumBinary
    this.geckoBinary = normalized.geckoBinary
    this.instanceId = normalized.instanceId
    this.port = normalized.port
    this.source = normalized.source
    this.watchSource = normalized.watchSource
    this.dryRun = normalized.dryRun
    this.logLevel = normalized.logLevel
    this.logContexts = normalized.logContexts
    this.logFormat = normalized.logFormat
    this.logTimestamps = normalized.logTimestamps
    this.logColor = normalized.logColor
    this.logUrl = normalized.logUrl
    this.logTab = normalized.logTab

    if (this.profile === false && process.env.EXTENSION_ENV === 'development') {
      console.warn(
        messages.profileFallbackWarning(
          this.browser,
          'system profile in use (profile: false)'
        )
      )
    }
  }

  apply(compiler: Compiler) {
    try {
      let UserDefinedBrowserPlugin: new (options: PluginInterface) => {
        apply: (c: Compiler) => void
      }

      switch (this.browser) {
        case 'chrome':
        case 'edge':
        case 'chromium-based':
          UserDefinedBrowserPlugin = RunChromiumPlugin
          break
        case 'firefox':
        case 'gecko-based':
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
        dryRun: this.dryRun,
        // Logger flags forwarded into browser plugin (Chromium consumes for CDP logs)
        logLevel: this.logLevel,
        logContexts: this.logContexts,
        logFormat: this.logFormat,
        logTimestamps: this.logTimestamps,
        logColor: this.logColor,
        logUrl: this.logUrl,
        logTab: this.logTab
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
      }).apply(compiler)
    }
  }
}

import {type Compiler} from '@rspack/core'
import {normalizePluginOptions} from './browsers-lib/normalize-options'
import * as messages from './browsers-lib/messages'
import {RunChromiumPlugin} from './run-chromium'
import {RunFirefoxPlugin} from './run-firefox'
import {
  type PluginInterface,
  type LogLevel,
  type LogContext,
  type LogFormat
} from './browsers-types'
import {DevOptions} from '../types/options'

/**
 * BrowsersPlugin responsibilities and supported capabilities:
 * - Supported browsers:
 *   - Chrome, Edge, generic Chromium-based
 *   - Firefox, generic Gecko-based
 *
 * - Core features:
 *   - Launch target browser with one or more unpacked extensions
 *   - Custom browser flags and the ability to exclude default flags
 *   - Profile management:
 *     - System profile, explicit custom profile, or managed dev profiles
 *     - Ephemeral (temp) or persistent profiles
 *   - Custom binary paths (Chromium / Gecko)
 *   - Optional starting URL
 *   - Instance/port coordination for remote debugging and multi-instance runs
 *   - Dry run mode (no browser launch) for CI and diagnostics
 *
 * - Developer experience:
 *   - Source inspection (development mode):
 *     - For Chromium/Firefox: open a page and extract full HTML (incl. content-script Shadow DOM)
 *     - Optional watch mode to re-print HTML on file changes
 *   - Unified logging for Chromium via CDP (levels, contexts, formatting, timestamps, color)
 *   - One-time development banner with extension id and metadata
 */
export class BrowsersPlugin {
  public static readonly name: string = 'plugin-browsers'

  public readonly extension: string | string[]
  public readonly browser: DevOptions['browser']
  public readonly noOpen?: boolean
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
  public readonly logLevel?: LogLevel
  public readonly logContexts?: Array<LogContext>
  public readonly logFormat?: LogFormat
  public readonly logTimestamps?: boolean
  public readonly logColor?: boolean
  public readonly logUrl?: string
  public readonly logTab?: number | string

  constructor(options: PluginInterface) {
    const normalized = normalizePluginOptions(options)

    // Path(s) to the extension(s) to load.
    // In our case, it's always 'dist/<browser>'
    this.extension = normalized.extension

    // Browser binary-related kung fu
    this.browser = normalized.browser
    this.startingUrl = normalized.startingUrl
    this.preferences = normalized.preferences
    this.profile = normalized.profile
    this.browserFlags = normalized.browserFlags
    this.excludeBrowserFlags = normalized.excludeBrowserFlags
    this.noOpen = normalized.noOpen

    // Supplementary browser binary paths. Will
    // override the browser setting if provided.
    this.chromiumBinary = normalized.chromiumBinary
    this.geckoBinary = normalized.geckoBinary

    // Instance/port coordination for remote debugging and multi-instance runs
    this.instanceId = normalized.instanceId
    this.port = normalized.port

    // Source inspection (development mode):
    // For Chromium/Firefox: open a page and extract full HTML
    // (incl. content-script Shadow DOM)
    // Optional watch mode to re-print HTML on file changes
    this.source = normalized.source
    this.watchSource = normalized.watchSource

    // Unified logging for Chromium via CDP
    // (levels, contexts, formatting, timestamps, color)
    this.logLevel = normalized.logLevel
    this.logContexts = normalized.logContexts
    this.logFormat = normalized.logFormat
    this.logTimestamps = normalized.logTimestamps
    this.logColor = normalized.logColor
    this.logUrl = normalized.logUrl
    this.logTab = normalized.logTab

    // Dry run mode (no browser launch) for CI and diagnostics
    this.dryRun = normalized.dryRun

    // Validate required binaries for engine-based selections
    if (this.browser === 'chromium-based' && !this.chromiumBinary) {
      console.error(messages.requireChromiumBinaryForChromiumBased())
      process.exit(1)
    }

    if (
      (this.browser === 'gecko-based' || this.browser === 'firefox-based') &&
      !this.geckoBinary
    ) {
      console.error(messages.requireGeckoBinaryForGeckoBased())
      process.exit(1)
    }

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
    if (
      this.browser === 'chrome' ||
      this.browser === 'edge' ||
      this.browser === 'chromium' ||
      this.browser === 'chromium-based'
    ) {
      new RunChromiumPlugin(this).apply(compiler)
    } else if (
      this.browser === 'firefox' ||
      this.browser === 'gecko-based' ||
      this.browser === 'firefox-based'
    ) {
      new RunFirefoxPlugin(this).apply(compiler)
    } else {
      throw new Error(messages.unsupportedBrowser(String(this.browser)))
    }
  }
}

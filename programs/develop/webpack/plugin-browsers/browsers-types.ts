import {DevOptions} from '../types/options'

/**
 * List of default browser flags used by extension.js.
 * These can be excluded using the `excludeBrowserFlags` option.
 *
 * Each flag disables or modifies a specific browser feature for a more controlled development environment.
 */
export type DefaultBrowserFlags =
  | '--no-first-run' // Disable Chrome's native first run experience
  | '--disable-client-side-phishing-detection' // Disable client-side phishing detection
  | '--disable-component-extensions-with-background-pages' // Disable some built-in extensions not affected by '--disable-extensions'
  | '--disable-default-apps' // Disable installation of default apps
  | '--disable-features=InterestFeedContentSuggestions' // Disable the Discover feed on NTP
  | '--disable-features=Translate' // Disable Chrome translation
  | '--hide-scrollbars' // Hide scrollbars from screenshots
  | '--mute-audio' // Mute all audio in the browser
  | '--no-default-browser-check' // Disable the default browser check
  | '--ash-no-nudges' // Avoid blue bubble "user education" nudges
  | '--disable-search-engine-choice-screen' // Disable the 2023+ search engine choice screen
  | '--disable-features=MediaRoute' // Disable Chrome Media Router
  | '--use-mock-keychain' // Use mock keychain on Mac to prevent permissions dialog
  | '--disable-background-networking' // Disable various background network services
  | '--disable-breakpad' // Disable crashdump collection
  | '--disable-component-update' // Don't update browser components
  | '--disable-domain-reliability' // Disable Domain Reliability Monitoring
  | '--disable-features=AutofillServerCommunicatio' // Disable autofill server communication
  | '--disable-features=CertificateTransparencyComponentUpdate' // Disable certificate transparency component updates
  | '--disable-sync' // Disable syncing to a Google account
  | '--disable-features=OptimizationHints' // Disable the Chrome Optimization Guide
  | '--disable-features=DialMediaRouteProvider' // Disable the MediaRouter feature (lighter version)
  | '--no-pings' // Don't send hyperlink auditing pings
  | '--enable-features=SidePanelUpdates' // Ensure the side panel is visible for testing

/**
 * Options for the browser plugin.
 */
export interface PluginOptions {
  /**
   * Do not open the browser automatically after launch.
   * @default false
   */
  noOpen?: boolean

  /**
   * Additional browser flags to pass to the browser process.
   * Example: ['--disable-extensions', '--disable-gpu']
   */
  browserFlags?: string[]

  /**
   * Array of browser flags to exclude from the default set.
   * Example: ['--hide-scrollbars', '--mute-audio']
   */
  excludeBrowserFlags?: Array<DefaultBrowserFlags | string>

  /**
   * Path to the browser profile directory, or false for a temporary profile.
   * Example: 'dist/extension' or false
   */
  profile?: string | false

  /**
   * Use a persistent managed profile for development.
   * Defaults to false (ephemeral temp profiles are used).
   */
  persistProfile?: boolean

  /**
   * Browser preferences object.
   * Example: { extensions: ['dist/extension', 'dist/extension2'] }
   */
  preferences?: Record<string, unknown>

  /**
   * Firefox only: persist changes made to the profile directory.
   */
  keepProfileChanges?: boolean

  /**
   * Firefox only: copy an existing profile before launching.
   */
  copyFromProfile?: string

  /**
   * URL to open when the browser starts.
   * Example: 'http://localhost:3000'
   */
  startingUrl?: string

  /**
   * Enable the browser console.
   * @default false
   */
  browserConsole?: boolean

  /**
   * Open DevTools automatically.
   * @default false
   */
  devtools?: boolean

  /**
   * Path to the Chromium binary.
   * Example: '/path/to/chromium'
   */
  chromiumBinary?: string

  /**
   * Path to the Gecko (Firefox) binary.
   * Example: '/path/to/gecko'
   */
  geckoBinary?: string
}

/**
 * Main interface for the browser plugin.
 */
export interface PluginInterface extends PluginOptions {
  /**
   * Browser type to launch.
   * @default 'chrome'
   * @see DevOptions['browser']
   * Example: 'chrome' | 'edge' | 'firefox'
   */
  browser: DevOptions['browser']

  /**
   * Path(s) to the extension(s) to load.
   * Example: 'dist/extension' or ['dist/extension', 'dist/extension2']
   */
  extension: string | string[]
  /** Optional precomputed list of extensions to load (Firefox helper). */
  extensionsToLoad?: string[]

  /**
   * Port to use for the extension or debugging.
   * Example: 12345 or '12345'
   */
  port?: string | number

  /**
   * Internal auto-generated instance ID (not user-configurable).
   * Example: '1234567890'
   */
  instanceId?: string

  /**
   * Path to source files for inspection.
   * Example: 'dist/extension'
   */
  source?: string

  /**
   * Whether to watch the source directory for changes.
   * @default false
   */
  watchSource?: boolean

  /**
   * Log level for unified logger (Chromium CDP logging).
   * One of: 'off', 'error', 'warn', 'info', 'debug', 'trace', 'all'
   */
  logLevel?: 'off' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'all'

  /**
   * Log contexts to enable.
   * Example: ['background', 'content', 'page']
   */
  logContexts?: Array<
    | 'background'
    | 'content'
    | 'page'
    | 'sidebar'
    | 'popup'
    | 'options'
    | 'devtools'
  >

  /**
   * Log output format.
   * One of: 'pretty', 'json'
   */
  logFormat?: 'pretty' | 'json' | 'ndjson'

  /**
   * Include timestamps in logs.
   * @default true
   */
  logTimestamps?: boolean

  /**
   * Enable colored log output.
   * @default false
   */
  logColor?: boolean

  /**
   * URL to send logs to.
   * Example: 'http://localhost:3000'
   */
  logUrl?: string

  /**
   * Tab ID or index for logging context.
   */
  logTab?: number | string

  /**
   * Perform a dry run without launching the browser.
   * @default false
   */
  dryRun?: boolean
}

/**
 * Runtime state shared with post-launch setup helpers (CDP/RDP).
 * Extends the main PluginInterface with transient fields used during runtime.
 */
export interface PluginRuntime extends PluginInterface {
  /** One-time banner printed flag (Chromium flow). */
  bannerPrintedOnce?: boolean
  /** Controller instance set after CDP connects (Chromium flow). */
  cdpController?: unknown
}

export type LogLevel =
  | 'off'
  | 'error'
  | 'warn'
  | 'info'
  | 'debug'
  | 'trace'
  | 'all'

export type LogContext =
  | 'background'
  | 'content'
  | 'page'
  | 'sidebar'
  | 'popup'
  | 'options'
  | 'devtools'

export type LogFormat = 'pretty' | 'json' | 'ndjson'

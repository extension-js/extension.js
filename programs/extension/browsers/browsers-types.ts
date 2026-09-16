// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

export type BrowserType =
  | 'chrome'
  | 'edge'
  | 'firefox'
  | 'chromium'
  | 'brave'
  | 'opera'
  | 'vivaldi'
  | 'yandex'
  | 'waterfox'
  | 'librewolf'
  | 'chromium-based'
  | 'gecko-based'
  | 'firefox-based'
  | 'safari'
  | 'webkit-based'

// Lightweight stand-in for rspack's Compilation used by browser-launching code;
// only properties actually read by launch/reload/inspection flows.
export interface CompilationLike {
  options: {
    mode?: string
    output?: {path?: string}
    context?: string
  }
  outputOptions?: {path?: string}
  getAsset?: (name: string) => {source: {source: () => string}} | undefined
}

// Minimal logger interface mirroring rspack's getInfrastructureLogger() shape.
export interface BrowserLogger {
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
  debug: (...args: unknown[]) => void
}

// Stand-in for rspack's BrowserConfig, the subset used by browser-config helpers.
export interface BrowserConfig {
  extensionPath: string
  profilePath: string | false
  preferences: Record<string, unknown>
  browserFlags: string[]
  startingUrl: string | undefined
}

export type DefaultBrowserFlags =
  | '--no-first-run'
  | '--disable-client-side-phishing-detection'
  | '--disable-component-extensions-with-background-pages' // Disable some built-in extensions not affected by '--disable-extensions'
  | '--disable-default-apps'
  | '--disable-features=InterestFeedContentSuggestions' // Disable the Discover feed on NTP
  | '--disable-features=Translate'
  | '--hide-scrollbars' // Hide scrollbars from screenshots
  | '--mute-audio'
  | '--no-default-browser-check'
  | '--ash-no-nudges' // Avoid blue bubble "user education" nudges
  | '--disable-search-engine-choice-screen'
  | '--disable-features=MediaRoute'
  | '--use-mock-keychain' // Use mock keychain on Mac to prevent permissions dialog
  | '--disable-background-networking'
  | '--disable-breakpad' // Disable crashdump collection
  | '--disable-component-update'
  | '--disable-domain-reliability'
  | '--disable-features=AutofillServerCommunicatio'
  | '--disable-features=CertificateTransparencyComponentUpdate'
  | '--disable-sync'
  | '--disable-features=OptimizationHints' // Disable the Chrome Optimization Guide
  | '--disable-features=DialMediaRouteProvider'
  | '--no-pings' // Don't send hyperlink auditing pings
  | '--enable-features=SidePanelUpdates' // Ensure the side panel is visible for testing
  | '--disable-features=DisableLoadExtensionCommandLineSwitch' // Keep --load-extension working
  | '--disable-features=ExtensionDisableUnsupportedDeveloper' // Chromium 152+ kills unpacked extensions on runtime.reload()
  | '--enable-unsafe-extension-debugging' // Allow CDP-based extension management (Chrome 126+)
  | '--silent-debugger-extension-api' // Suppress the "X is debugging this browser" infobar

export interface PluginOptions {
  /**
   * @default false
   */
  noOpen?: boolean

  browserFlags?: string[]

  excludeBrowserFlags?: Array<DefaultBrowserFlags | string>

  profile?: string | false

  persistProfile?: boolean

  preferences?: Record<string, unknown>

  keepProfileChanges?: boolean

  copyFromProfile?: string

  startingUrl?: string

  /**
   * @default false
   */
  browserConsole?: boolean

  /**
   * @default false
   */
  devtools?: boolean

  chromiumBinary?: string

  geckoBinary?: string
}

export interface PluginInterface extends PluginOptions {
  /**
   * @default 'chrome'
   * @see DevOptions['browser']
   * Example: 'chrome' | 'edge' | 'firefox'
   */
  browser: BrowserType

  extension: string | string[]

  port?: string | number

  instanceId?: string

  logLevel?: 'off' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'all'

  logContexts?: Array<
    | 'background'
    | 'content'
    | 'page'
    | 'sidebar'
    | 'popup'
    | 'options'
    | 'devtools'
  >

  logFormat?: 'pretty' | 'json' | 'ndjson'

  /**
   * @default true
   */
  logTimestamps?: boolean

  /**
   * @default false
   */
  logColor?: boolean

  logUrl?: string

  logTab?: number | string

  /**
   * @default false
   */
  dryRun?: boolean
}

// Runtime state shared with post-launch setup helpers (CDP/RDP); extends
// PluginInterface with transient runtime fields.
export interface PluginRuntime extends PluginInterface {
  // Intentionally empty for shared runtime; per-run runtime fields live in
  // run-chromium/chromium-types.ts and run-firefox/firefox-types.ts
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

// A browser-generated log entry (CDP Log.entryAdded) normalized for the host's
// log pipeline; these never pass the page console hook, so they need a sink.
export interface BrowserLogSinkEvent {
  level: 'log' | 'info' | 'warn' | 'error' | 'debug'
  text: string
  source?: string
  url?: string
  lineNumber?: number
  timestamp?: number
}

export type BrowserLogSink = (event: BrowserLogSinkEvent) => void

// What the browser answered when the dist was re-offered after a refusal.
// 'unknown' means the question could not be asked - never a verdict.
export interface ExtensionLoadRetryResult {
  status: 'loaded' | 'refused' | 'unknown'
  reason?: string
  extensionId?: string
}

// Unified controller interface used by post-launch logging flows;
// implemented by both CDP and RDP controllers.
export interface Controller {
  enableUnifiedLogging: (opts: {
    level?: string
    contexts?: string[] | undefined
    urlFilter?: string | undefined
    tabFilter?: number | string | undefined
    format?: 'pretty' | 'json' | 'ndjson'
    timestamps?: boolean
    color?: boolean
  }) => Promise<void>
  // Optional protocol-event subscription hook; present in Chromium CDP flows,
  // Firefox may omit it.
  onProtocolEvent?: (
    cb: (evt: {method?: string; params?: unknown}) => void
  ) => void
  // Asks the browser whether it holds this dist, loading it when absent.
  // Chromium CDP only; the Gecko install is driven from the launcher.
  verifyGuestLoaded?: () => Promise<ExtensionLoadRetryResult>
}

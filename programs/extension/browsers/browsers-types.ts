// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {BrowserType} from '../config-types'
import type {LogContext} from '../helpers/log-contexts'
import type {LogLevel} from '../helpers/normalize-options'

// One list of targets for the config type and the launchers.
export type {BrowserType} from '../config-types'

// Lightweight stand-in for rspack's Compilation used by browser-launching code;
// only properties actually read by launch/reload/inspection flows.
export interface CompilationLike {
  options: {
    mode?: string
    output?: {path?: string}
    context?: string
    // Read as a fallback RDP base port. Wide enough for rspack's own type,
    // whose 'auto' and string ports the port helper parses away.
    devServer?: {port?: number | string}
  }
  outputOptions?: {path?: string}
  // Read to skip a launch after a failed compile.
  errors?: unknown[]
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
  | '--disable-features=SafetyHubExtensionsOffStoreTrigger' // Chromium 126+ flags reloaded unpacked extensions as unsafe
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

  // Where a false profile came from, so a refusal can name it.
  profileSource?: 'flag' | 'config'

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

  // The config key that named each binary, as "<key> in <config file>".
  // Unset when the flag did, so a message never blames the wrong place.
  chromiumBinarySource?: string

  geckoBinarySource?: string
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

  logLevel?: LogLevel

  logContexts?: LogContext[]

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

export type {LogContext} from '../helpers/log-contexts'
export type {LogLevel} from '../helpers/normalize-options'

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

// Resolves 'settled' once the background's boot registry calls answered,
// or 'timeout' when the dev server heard nothing inside the wait.
export type BootRegistrationsWait = (
  timeoutMs: number
) => Promise<'settled' | 'timeout'>

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

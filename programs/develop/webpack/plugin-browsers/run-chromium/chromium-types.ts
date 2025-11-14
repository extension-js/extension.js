import type {Compiler} from '@rspack/core'
import type {
  LogFormat,
  LogLevel,
  PluginInterface,
  Controller
} from '../browsers-types'

export interface ConsoleAPICalledEvent {
  method: 'Runtime.consoleAPICalled'
  params?: {
    type?: string
    args?: Array<{value?: unknown; description?: string}>
    stackTrace?: {
      callFrames?: Array<{
        url?: string
        lineNumber?: number
        columnNumber?: number
      }>
    }
  }
}

export interface LogEntryAddedEvent {
  method: 'Log.entryAdded'
  params?: {
    entry?: {
      level?: string
      text?: string
      url?: string
      lineNumber?: number
      columnNumber?: number
    }
  }
}

export type CdpEvent =
  | ConsoleAPICalledEvent
  | LogEntryAddedEvent
  | {method: string; params?: unknown}

export type PendingReason = 'manifest' | 'locales' | 'sw'

export type Logger = ReturnType<Compiler['getInfrastructureLogger']>

/**
 * Options consumed by Chromium plugins (launch/logger/reload/inspection).
 * Narrowed from PluginInterface and specialized for Chromium path.
 */
export interface ChromiumLaunchOptions
  extends Pick<
    PluginInterface,
    | 'extension'
    | 'browser'
    | 'noOpen'
    | 'browserFlags'
    | 'excludeBrowserFlags'
    | 'profile'
    | 'preferences'
    | 'startingUrl'
    | 'chromiumBinary'
    | 'instanceId'
    | 'port'
    | 'source'
    | 'watchSource'
    | 'dryRun'
    | 'logLevel'
    | 'logContexts'
    | 'logFormat'
    | 'logTimestamps'
    | 'logColor'
    | 'logUrl'
    | 'logTab'
  > {}

/**
 * Runtime state in Chromium flow.
 * Kept Chromium-specific to avoid polluting shared browser types.
 */
export interface ChromiumPluginRuntime extends ChromiumLaunchOptions {
  bannerPrintedOnce?: boolean
  cdpController?: Controller | unknown
}

import type {Compiler} from '@rspack/core'

export type LogLevel =
  | 'off'
  | 'error'
  | 'warn'
  | 'info'
  | 'debug'
  | 'trace'
  | 'all'

export type LogFormat = 'pretty' | 'json' | 'ndjson'

export interface ChromiumLogger {
  level?: LogLevel
  contexts?: string[]
  urlFilter?: string
  tabFilter?: number | string
  format?: LogFormat
  timestamps?: boolean
  color?: boolean
}

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

export interface Controller {
  enableUnifiedLogging: (opts: ChromiumLogger) => Promise<void>
  onProtocolEvent: (cb: (evt: CdpEvent) => void) => void
}

export type PendingReason = 'manifest' | 'locales' | 'sw'

export type Logger = ReturnType<Compiler['getInfrastructureLogger']>

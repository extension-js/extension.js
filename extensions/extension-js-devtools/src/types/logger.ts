export type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug' | 'trace'

export type LoggerContext =
  | 'background'
  | 'content'
  | 'page'
  | 'sidebar'
  | 'popup'
  | 'options'
  | 'devtools'

export type DxSignalStatus = 'ok' | 'warn' | 'fail'

export type LogEventType = 'log' | 'dx.signal'

export interface LogEvent {
  id: string
  timestamp: number
  level: LogLevel
  context: LoggerContext
  messageParts: unknown[]
  eventType?: LogEventType
  code?: string
  status?: DxSignalStatus
  data?: Record<string, unknown>
  remediation?: string
  url?: string
  stack?: string
  errorName?: string
  tabId?: number
  frameId?: number
  title?: string
  hostname?: string
  sourceExtensionId?: string
  incognito?: boolean
  windowId?: number
}

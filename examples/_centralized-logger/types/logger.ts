export type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug' | 'trace'

export type LoggerContext =
  | 'background'
  | 'content'
  | 'page'
  | 'sidebar'
  | 'popup'
  | 'options'
  | 'devtools'

export interface LogEvent {
  id: string
  timestamp: number
  level: LogLevel
  context: LoggerContext
  messageParts: unknown[]
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

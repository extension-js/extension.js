export const LOG_EVENT_VERSION = 1 as const
export const CONTROL_ENVELOPE_VERSION = 1 as const

export type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug' | 'trace'

export type LogContext =
  | 'background'
  | 'content'
  | 'page'
  | 'sidebar'
  | 'popup'
  | 'options'
  | 'devtools'

export type LogEventType = 'log' | 'dx.signal'
export type DxSignalStatus = 'ok' | 'warn' | 'fail'

export interface LogEvent {
  v: typeof LOG_EVENT_VERSION
  id: string
  seq: number
  timestamp: number
  level: LogLevel
  context: LogContext
  messageParts: unknown[]
  eventType?: LogEventType
  code?: string
  status?: DxSignalStatus
  remediation?: string
  data?: Record<string, unknown>
  url?: string
  hostname?: string
  tabId?: number
  frameId?: number
  windowId?: number
  title?: string
  stack?: string
  errorName?: string
  sourceExtensionId?: string
  incognito?: boolean
  runId: string
  repeat?: number
}

export type IncomingLogEvent = Omit<LogEvent, 'seq'> & {seq?: number}

export type BridgeRole = 'producer' | 'consumer' | 'controller'

export interface BridgeTarget {
  context:
    | 'background'
    | 'popup'
    | 'options'
    | 'sidebar'
    | 'devtools'
    | 'content'
    | 'page'
  url?: string
  tabId?: number
}

export type CommandOp =
  | 'eval'
  | 'storage.get'
  | 'storage.set'
  | 'reload'
  | 'open'
  | 'tabs.query'
  | 'inspect'

export type GapReason =
  | 'ring_overflow'
  | 'rate_limit'
  | 'disk_slow'
  | 'slow_consumer'

export interface HelloFrame {
  type: 'hello'
  v: typeof CONTROL_ENVELOPE_VERSION
  role: BridgeRole
  instanceId: string
  token?: string
}

export interface ReadyFrame {
  type: 'ready'
  runId: string
  bufferedFrom?: number
  engine?: 'chromium' | 'firefox'
  capabilities?: {
    eval?: boolean
    storage?: boolean
    reload?: boolean
    open?: Array<'popup' | 'options' | 'sidebar' | 'action' | 'command'>
    deepDom?: boolean
  }
}

export interface LogFrame {
  type: 'log'
  event: LogEvent
}

export interface GapFrame {
  type: 'gap'
  dropped: number
  reason: GapReason
  sinceSeq: number
}

export interface CommandFrame {
  type: 'command'
  cmdId: string
  op: CommandOp
  target: BridgeTarget
  args?: Record<string, unknown>
  timeoutMs?: number
}

export interface ResultFrame {
  type: 'result'
  cmdId: string
  ok: boolean
  value?: unknown
  truncated?: boolean
  durationMs?: number
  error?: {
    name: string
    message: string
    stack?: string
    engine?: string
  }
}

export type ClientFrame = HelloFrame | LogFrame | CommandFrame
export type ServerFrame = ReadyFrame | LogFrame | GapFrame | ResultFrame
export type AnyFrame = ClientFrame | ServerFrame

export const CONTROL_WS_PATH = '/extjs-control'

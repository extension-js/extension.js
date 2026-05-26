/**
 * Agent-bridge wire contracts (TypeScript mirror of the JSON Schemas in
 * docs/agent-bridge/). Hand-written for now; a schema→type generation step
 * will replace this later so the schema stays the single source of truth.
 *
 * - LogEvent           ← docs/agent-bridge/log-event.schema.json (v1)
 * - Control envelope   ← docs/agent-bridge/control-envelope.schema.json (v1)
 *
 * Change these only alongside a schema version bump.
 */

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

/** One log line — identical on the wire, in logs.ndjson, and in the sidebar. */
export interface LogEvent {
  /** Schema version. Always first, never reordered. */
  v: typeof LOG_EVENT_VERSION
  id: string
  /** Monotonic per-session counter assigned by the broker at ingest. */
  seq: number
  /** Producer-side epoch milliseconds (display only; order by `seq`). */
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
  /** Ties the event to a session in ready-contract.json. */
  runId: string
  /** Set only when the broker coalesced N identical consecutive events. */
  repeat?: number
}

/**
 * An event as produced before the broker assigns `seq` (the producer does not
 * own ordering). The broker stamps `seq` on ingest.
 */
export type IncomingLogEvent = Omit<LogEvent, 'seq'> & {seq?: number}

export type BridgeRole = 'producer' | 'consumer' | 'controller'

/** Context-addressing model shared by commands and source inspection. */
export interface BridgeTarget {
  context:
    | 'background'
    | 'popup'
    | 'options'
    | 'sidebar'
    | 'devtools'
    | 'content'
    | 'page'
  /** For context=content|page: glob/substring matching the document(s). */
  url?: string
  /** For context=content|page: a specific tab. */
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
  /** Required for controller role issuing `eval`. */
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
    open?: Array<'popup' | 'options' | 'sidebar'>
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

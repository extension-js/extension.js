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

/**
 * Granularity of a dev-loop reload. Mirrors `ReloadType` in
 * plugin-browsers/index.ts: the launched-browser path feeds this decision to
 * the CDP controller; the `--no-browser` path feeds the same decision to the
 * broker, which broadcasts a {@link ReloadFrame} to the SW producer.
 */
export type ReloadType = 'full' | 'service-worker' | 'content-scripts'

/**
 * Everything a {@link ReloadFrame} can carry in `reloadType`: the extension
 * reload granularities plus `'page'` — a notify-only signal for page-only
 * edits (popup/options/sidebar/devtools/newtab). For `'page'` the producer
 * performs NO reload (livereload owns the refresh); it only forwards the
 * announcement so the devtools pill mirrors the dev loop.
 */
export type DevReloadKind = ReloadType | 'page'

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

/**
 * Dev-loop reload broadcast, server → producer. Sent by the broker on a compile
 * that completed without a CDP controller (`--no-browser`, headless/CI, remote)
 * so the service-worker producer can self-reload. Unlike a `reload` CommandFrame
 * (a controller-issued, `--allow-control`-gated act verb that expects a result),
 * this is a fire-and-forget dev-server signal — no cmdId, no result.
 */
export interface ReloadFrame {
  type: 'reload'
  reloadType: DevReloadKind
  changedContentScriptEntries?: string[]
  /**
   * Server-built human context label, e.g. "content_script (content/scripts.tsx)".
   * Shown VERBATIM by every announcement surface (CLI stdout, the page's
   * devtools console line, the devtools-extension pill) so the three can
   * never disagree about what is reloading.
   */
  label?: string
  /** Project-relative source files that triggered this reload. */
  changedFiles?: string[]
}

export type ClientFrame = HelloFrame | LogFrame | CommandFrame
export type ServerFrame =
  | ReadyFrame
  | LogFrame
  | GapFrame
  | ResultFrame
  | ReloadFrame
export type AnyFrame = ClientFrame | ServerFrame

export const CONTROL_WS_PATH = '/extjs-control'

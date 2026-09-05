// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

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
  // The session identity, equal to ready.json's `runId` (the broker normalizes
  // producer-stamped ids on ingest) so consumers can join rows to the contract.
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
 * plugin-reload/classify-reload.ts: the launched-browser path feeds this
 * decision to the CDP controller; the `--no-browser` path feeds the same
 * decision to the broker, which broadcasts a {@link ReloadFrame} to the SW
 * producer.
 */
export type ReloadType = 'full' | 'service-worker' | 'content-scripts'

/**
 * Everything a {@link ReloadFrame} can carry in `reloadType`: the extension
 * reload granularities plus `'page'`, a notify-only signal for page-only
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

// Machine names for a refused command. The guest sets one beside the
// browser's own sentence so a consumer branches on it, never on the prose.
export const REFUSAL_NEEDS_HEADED_WINDOW = 'needs_headed_window'
export const REFUSAL_NEEDS_USER_GESTURE = 'needs_user_gesture'
export const REFUSAL_SURFACE_NOT_OPEN = 'surface_not_open'
export const REFUSAL_API_UNAVAILABLE = 'api_unavailable'

export type BridgeRefusalCode =
  | typeof REFUSAL_NEEDS_HEADED_WINDOW
  | typeof REFUSAL_NEEDS_USER_GESTURE
  | typeof REFUSAL_SURFACE_NOT_OPEN
  | typeof REFUSAL_API_UNAVAILABLE

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
    code?: BridgeRefusalCode
  }
}

/**
 * Dev-loop reload broadcast, server → producer. Sent by the broker on a compile
 * that completed without a CDP controller (`--no-browser`, headless/CI, remote)
 * so the service-worker producer can self-reload. Unlike a `reload` CommandFrame
 * (a controller-issued, `--allow-control`-gated act verb that expects a result),
 * this is a fire-and-forget dev-server signal, no cmdId, no result.
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
  /** Emitted scripts/ bundles the SW should replay its executeScript calls for. */
  changedScriptFiles?: string[]
}

// Producer-to-server receipt confirmation for a ReloadFrame: a socket write
// proves nothing when the SW is wedged; the broker latches cs reloads until this ack.
export interface ReloadAckFrame {
  type: 'reload-ack'
  reloadType: DevReloadKind
  label?: string
}

/**
 * Server → producer keepalive. An MV3 service worker idles out after ~30s
 * without events, and a stopped SW holds no control socket, reload
 * broadcasts would reach zero producers and silently apply to nothing
 * (quiet extensions lost SW/manifest reloads once >30s passed between
 * edits). Receiving any WebSocket message resets the SW idle timer
 * (Chrome 116+), so a periodic ping keeps the dev extension's SW
 * responsive for the whole dev session. Producers ignore the frame.
 */
export interface PingFrame {
  type: 'ping'
}

export type ClientFrame = HelloFrame | LogFrame | CommandFrame | ReloadAckFrame
export type ServerFrame =
  | ReadyFrame
  | LogFrame
  | GapFrame
  | ResultFrame
  | ReloadFrame
  | PingFrame
export type AnyFrame = ClientFrame | ServerFrame

export const CONTROL_WS_PATH = '/extjs-control'

// Why the server hung up. These live with the wire constants rather than in
// the broker so a client can name a refusal without importing the server, and
// so it never has to spell 4002 in its own source. A close in this range is
// always a deliberate refusal, never a transport failure.

/** The hello named an instanceId from a previous dev session. */
export const CLOSE_BAD_INSTANCE = 4001
/** The hello was malformed: wrong envelope version, or an unknown role. */
export const CLOSE_BAD_HELLO = 4002
/** A controller dialed a session started without `--allow-control`. */
export const CLOSE_CONTROL_UNAVAILABLE = 4003
/** The socket fell far enough behind that it was dropped to protect the broker. */
export const CLOSE_SLOW_CONSUMER = 4008

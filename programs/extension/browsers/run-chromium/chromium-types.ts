// ██████╗ ██╗   ██╗███╗   ██╗       ██████╗██╗  ██╗██████╗  ██████╗ ███╗   ███╗██╗██╗   ██╗███╗   ███╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║  ██║██╔══██╗██╔═══██╗████╗ ████║██║██║   ██║████╗ ████║
// ██████╔╝██║   ██║██╔██╗ ██║█████╗██║     ███████║██████╔╝██║   ██║██╔████╔██║██║██║   ██║██╔████╔██║
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██║     ██╔══██║██╔══██╗██║   ██║██║╚██╔╝██║██║██║   ██║██║╚██╔╝██║
// ██║  ██║╚██████╔╝██║ ╚████║      ╚██████╗██║  ██║██║  ██║╚██████╔╝██║ ╚═╝ ██║██║╚██████╔╝██║ ╚═╝ ██║
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝       ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {
  BrowserLogger,
  BrowserLogSink,
  Controller,
  LogLevel,
  PluginInterface
} from '../browsers-types'

export type {
  Controller,
  LogFormat,
  LogLevel,
  PluginInterface
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

export type Logger = BrowserLogger

// Options consumed by Chromium plugins (launch/logger/inspection);
// narrowed from PluginInterface for the Chromium path.
export interface ChromiumLaunchOptions
  extends Pick<
    PluginInterface,
    | 'extension'
    | 'browser'
    | 'noOpen'
    | 'browserFlags'
    | 'excludeBrowserFlags'
    | 'profile'
    | 'persistProfile'
    | 'keepProfileChanges'
    | 'copyFromProfile'
    | 'preferences'
    | 'startingUrl'
    | 'chromiumBinary'
    | 'instanceId'
    | 'port'
    | 'dryRun'
    | 'logLevel'
    | 'logContexts'
    | 'logFormat'
    | 'logTimestamps'
    | 'logColor'
    | 'logUrl'
    | 'logTab'
  > {
  // Host log pipeline for browser-generated CDP Log.entryAdded entries. Wired by
  // the dev server through the launcher; absent in preview/run-only flows.
  logSink?: BrowserLogSink
}

// Runtime state in Chromium flow, kept Chromium-specific to avoid polluting
// shared browser types.
export interface ChromiumPluginRuntime extends ChromiumLaunchOptions {
  bannerPrintedOnce?: boolean
  cdpController?: Controller
  browserVersionLine?: string
  // The resolved binary and how it was chosen, rendered on the identity card
  // so a non-default binary is never invisible in dev output.
  binaryPath?: string
  binaryProvenance?: 'managed' | 'pinned' | 'system' | 'snapshot'
  // Set by the post-launch CDP flow when the browser answered that it refused
  // the guest, so the launch path can withhold the "ready" claim.
  extensionLoadRefused?: string
  // Bound alongside it: prints the banner the refusal withheld, once the
  // browser accepts the dist on a later compile.
  printBannerOnRecovery?: () => Promise<void>
}

export interface ChromiumLogger {
  level?: LogLevel | 'off' | string
  contexts?: string[]
  urlFilter?: string
  tabFilter?: number | string
  format?: 'pretty' | 'json' | 'ndjson' | string
  timestamps?: boolean
  color?: boolean
}

// CDP wire-boundary shapes, recovered from how run-chromium READS each value;
// all optional because the runtime code guards each access.

export interface CdpTargetInfo {
  type?: string
  targetId?: string
  url?: string
}

// CDP Runtime.ExecutionContextDescription fields read when matching the page /
// isolated world for content-script reinjection.
export interface CdpExecutionContextDescription {
  id?: number
  origin?: string
  auxData?: {
    type?: string
    isDefault?: boolean
    frameId?: string
  }
}

export interface CdpRemoteObject {
  value?: unknown
  description?: string
}

export interface CdpLogEntry {
  source?: string
  level?: string
  text?: string
  url?: string
  lineNumber?: number
  columnNumber?: number
  timestamp?: number
}

export interface CdpStackTrace {
  callFrames?: Array<{
    url?: string
    lineNumber?: number
    columnNumber?: number
  }>
}

export interface CdpProtocolParams {
  targetInfo?: CdpTargetInfo
  context?: CdpExecutionContextDescription
  sessionId?: string
  executionContextId?: number
  entry?: CdpLogEntry
  type?: string
  args?: CdpRemoteObject[]
  stackTrace?: CdpStackTrace
}

// The parsed JSON envelope delivered to onProtocolEvent subscribers, typed at
// the wire boundary so consumers read fields without casts.
export interface CdpProtocolMessage {
  method?: string
  params?: CdpProtocolParams
  sessionId?: string
  id?: number
}

export interface CdpDomNode {
  localName?: string
  nodeName?: string
  nodeId?: number
  shadowRootType?: string
  shadowRoots?: CdpDomNode[]
  children?: CdpDomNode[]
  contentDocument?: CdpDomNode
}

export interface CdpFrameNode {
  id?: string
  url?: string
}

export interface CdpFrameTreeResult {
  frameTree?: {frame?: CdpFrameNode}
  frame?: CdpFrameNode
}

export type ConsoleCountKey = 'error' | 'warn' | 'info' | 'log' | 'debug'

// A page-meta snapshot evaluated in the inspected page; a type alias (not an
// interface) so it keeps an implicit index signature for the event sink.
export type PageMetaSnapshot = {
  readyState?: string
  viewport?: {width: number; height: number; devicePixelRatio: number}
  frameCount?: number
}

export interface SelectorProbeSample {
  tag: string
  id?: string
  classes?: string
  role?: string
  ariaLabel?: string
  textLength?: number
  textSnippet?: string
}

export interface SelectorProbeResult {
  selector: string
  count: number
  samples: SelectorProbeSample[]
}

// The extension-root tree snapshot evaluated in the inspected page; a type
// alias so it keeps an implicit index signature for the event sink.
export type ExtensionRootTreeResult = {
  rootMode: 'shadow' | 'element'
  depthLimit: number
  nodeLimit: number
  truncated: boolean
  tree: unknown
}

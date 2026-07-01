// ██████╗ ██╗   ██╗███╗   ██╗       ██████╗██╗  ██╗██████╗  ██████╗ ███╗   ███╗██╗██╗   ██╗███╗   ███╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║  ██║██╔══██╗██╔═══██╗████╗ ████║██║██║   ██║████╗ ████║
// ██████╔╝██║   ██║██╔██╗ ██║█████╗██║     ███████║██████╔╝██║   ██║██╔████╔██║██║██║   ██║██╔████╔██║
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██║     ██╔══██║██╔══██╗██║   ██║██║╚██╔╝██║██║██║   ██║██║╚██╔╝██║
// ██║  ██║╚██████╔╝██║ ╚████║      ╚██████╗██║  ██║██║  ██║╚██████╔╝██║ ╚═╝ ██║██║╚██████╔╝██║ ╚═╝ ██║
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝       ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import type {
  BrowserLogger,
  LogFormat,
  LogLevel,
  PluginInterface,
  Controller
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

export type PendingReason = 'manifest' | 'locales' | 'sw'

export type Logger = BrowserLogger

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
  > {}

/**
 * Runtime state in Chromium flow.
 * Kept Chromium-specific to avoid polluting shared browser types.
 */
export interface ChromiumPluginRuntime extends ChromiumLaunchOptions {
  bannerPrintedOnce?: boolean
  cdpController?: Controller
  browserVersionLine?: string
}

/**
 * Configuration for the unified logger in Chromium flows.
 * Mirrors CLI flags and shared logging options.
 */
export interface ChromiumLogger {
  level?: LogLevel | 'off' | string
  contexts?: string[]
  urlFilter?: string
  tabFilter?: number | string
  format?: 'pretty' | 'json' | 'ndjson' | string
  timestamps?: boolean
  color?: boolean
}

// ─────────────────────────────────────────────────────────────────────────
// CDP wire-boundary shapes
//
// Recovered from how the run-chromium code actually READS each value off the
// Chrome DevTools Protocol (getTargets results, the protocol event stream,
// DOM documents, remote objects). Every field below is one the code touches;
// all are optional because the runtime code already guards each access with
// `?.` / `|| ''` and must keep doing so.
// ─────────────────────────────────────────────────────────────────────────

/** CDP `Target.TargetInfo` — the fields read off `Target.getTargets` results. */
export interface CdpTargetInfo {
  type?: string
  targetId?: string
  url?: string
}

/**
 * CDP `Runtime.ExecutionContextDescription` — the fields read when matching the
 * page / isolated world for content-script reinjection.
 */
export interface CdpExecutionContextDescription {
  id?: number
  origin?: string
  auxData?: {
    type?: string
    isDefault?: boolean
    frameId?: string
  }
}

/** A CDP `Runtime.RemoteObject` as seen in console-call args. */
export interface CdpRemoteObject {
  value?: unknown
  description?: string
}

/** A CDP `Log.LogEntry` as delivered by `Log.entryAdded`. */
export interface CdpLogEntry {
  level?: string
  text?: string
  url?: string
  lineNumber?: number
  columnNumber?: number
}

/** A CDP `Runtime.StackTrace` — only the top call frame fields are read. */
export interface CdpStackTrace {
  callFrames?: Array<{
    url?: string
    lineNumber?: number
    columnNumber?: number
  }>
}

/** The `params` bag carried on a raw CDP protocol message. */
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

/**
 * The parsed JSON envelope delivered to `onProtocolEvent` subscribers — typed
 * at the wire boundary so consumers read fields without casts.
 */
export interface CdpProtocolMessage {
  method?: string
  params?: CdpProtocolParams
  sessionId?: string
  id?: number
}

/** A CDP `DOM.Node` subtree as returned by `DOM.getDocument` (fields walked). */
export interface CdpDomNode {
  localName?: string
  nodeName?: string
  nodeId?: number
  shadowRootType?: string
  shadowRoots?: CdpDomNode[]
  children?: CdpDomNode[]
  contentDocument?: CdpDomNode
}

/** A frame node read off a CDP `Page.getFrameTree` result. */
export interface CdpFrameNode {
  id?: string
  url?: string
}

/** A CDP `Page.getFrameTree` result (only the frame id/url are read). */
export interface CdpFrameTreeResult {
  frameTree?: {frame?: CdpFrameNode}
  frame?: CdpFrameNode
}

/** The console-count buckets keyed by normalized console level. */
export type ConsoleCountKey = 'error' | 'warn' | 'info' | 'log' | 'debug'

/**
 * A page-meta snapshot evaluated in the inspected page.
 * Declared as a type alias (not an interface) so it keeps an implicit index
 * signature and stays assignable to the `Record<string, unknown>` event sink.
 */
export type PageMetaSnapshot = {
  readyState?: string
  viewport?: {width: number; height: number; devicePixelRatio: number}
  frameCount?: number
}

/** One selector-probe sample collected from the inspected page. */
export interface SelectorProbeSample {
  tag: string
  id?: string
  classes?: string
  role?: string
  ariaLabel?: string
  textLength?: number
  textSnippet?: string
}

/** A single selector-probe result (selector + match count + samples). */
export interface SelectorProbeResult {
  selector: string
  count: number
  samples: SelectorProbeSample[]
}

/**
 * The extension-root tree snapshot evaluated in the inspected page.
 * Declared as a type alias (not an interface) so it keeps an implicit index
 * signature and stays assignable to the `Record<string, unknown>` event sink.
 */
export type ExtensionRootTreeResult = {
  rootMode: 'shadow' | 'element'
  depthLimit: number
  nodeLimit: number
  truncated: boolean
  tree: unknown
}

declare global {
  /**
   * Dev-only hooks the Chromium inspection flow installs on `globalThis` to
   * coordinate content-reload snapshots across the watch loop.
   */
  // eslint-disable-next-line no-var
  var __EXTJS_ON_CHROMIUM_CONTENT_RELOADED__:
    | (() => Promise<void> | void)
    | undefined
  // eslint-disable-next-line no-var
  var __EXTJS_PENDING_CHROMIUM_CONTENT_RELOAD__: unknown
}

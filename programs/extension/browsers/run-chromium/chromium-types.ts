// ██████╗ ██╗   ██╗███╗   ██╗       ██████╗██╗  ██╗██████╗  ██████╗ ███╗   ███╗██╗██╗   ██╗███╗   ███╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║  ██║██╔══██╗██╔═══██╗████╗ ████║██║██║   ██║████╗ ████║
// ██████╔╝██║   ██║██╔██╗ ██║█████╗██║     ███████║██████╔╝██║   ██║██╔████╔██║██║██║   ██║██╔████╔██║
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██║     ██╔══██║██╔══██╗██║   ██║██║╚██╔╝██║██║██║   ██║██║╚██╔╝██║
// ██║  ██║╚██████╔╝██║ ╚████║      ╚██████╗██║  ██║██║  ██║╚██████╔╝██║ ╚═╝ ██║██║╚██████╔╝██║ ╚═╝ ██║
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝       ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {HeldRefusalPredictions} from '../browsers-lib/manifest-refusal'
import type {
  BootRegistrationsWait,
  BrowserLogger,
  BrowserLogSink,
  Controller,
  PluginInterface
} from '../browsers-types'

export type {
  Controller,
  LogLevel,
  PluginInterface
} from '../browsers-types'

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
  // The dev server's word that the background's boot registrations answered.
  awaitBootRegistrations?: BootRegistrationsWait
  // A production run whose built background names a registration: no dev
  // server answers for it, so the launcher asks the background itself.
  bootRegistrationsFromBackground?: boolean
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
  binaryPinnedBy?: string
  // Set by the post-launch CDP flow when the browser answered that it refused
  // the guest, so the launch path can withhold the "ready" claim.
  extensionLoadRefused?: string
  // Set when the session already said this browser refuses Manifest V2, so
  // the browser's matching answer is recorded and not printed a second time.
  manifestV2RefusalSaid?: boolean
  // Predicted refusals not printed yet. The browser's own refusal drops them.
  heldRefusalPredictions?: HeldRefusalPredictions
  // Set when the preflight predicted a refusal, so only a guest the browser
  // took keeps the run and no page is opened for any other answer.
  loadRefusalEndsRun?: boolean
  // The run the launch belongs to, carried so a post-launch stamp cannot land
  // on a contract a restart has since taken over.
  launchRunId?: string
  // Bound alongside it: prints the banner the refusal withheld, once the
  // browser accepts the dist on a later compile.
  printBannerOnRecovery?: () => Promise<void>
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
  targetId?: string
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

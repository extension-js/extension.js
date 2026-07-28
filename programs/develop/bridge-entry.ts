// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

export {
  BridgeConsumer,
  type ConsumerCloseInfo,
  type ConsumerOptions,
  type ReadyContractDocument,
  type ReadyContractInfo,
  readReadyContract,
  readReadyContractDocument
} from './dev-server/control-bridge/consumer-client'
export type {
  BridgeRefusalCode,
  BridgeTarget,
  CommandOp,
  GapFrame,
  LogContext,
  LogEvent,
  LogLevel,
  ReadyFrame,
  ResultFrame
} from './dev-server/control-bridge/contracts'
// The wire constants a consumer needs to dial the channel by hand, instead of
// copying '/extjs-control' and the envelope version into its own source. The
// CLOSE_ codes are why the server hung up: without them a client is left
// inferring "anything >= 4000 was probably deliberate", which reports an
// envelope-version refusal as "no logs" rather than as a refusal.
export {
  CLOSE_BAD_HELLO,
  CLOSE_BAD_INSTANCE,
  CLOSE_CONTROL_UNAVAILABLE,
  CLOSE_SLOW_CONSUMER,
  CONTROL_ENVELOPE_VERSION,
  CONTROL_WS_PATH,
  LOG_EVENT_VERSION,
  REFUSAL_API_UNAVAILABLE,
  REFUSAL_NEEDS_HEADED_WINDOW,
  REFUSAL_NEEDS_USER_GESTURE,
  REFUSAL_SURFACE_NOT_OPEN
} from './dev-server/control-bridge/contracts'
export {
  controlPortFilePath,
  readPersistedControlPort
} from './dev-server/control-bridge/control-port-store'
export {
  BridgeController,
  type CommandInput,
  type ControllerOptions
} from './dev-server/control-bridge/controller-client'
// matchesLogQuery answers one yes/no per event against a whole query. Ranking
// is the separate question a consumer asks when it sorts, groups or picks the
// worst level in a batch, and it carries the rule that 'log' ranks as 'info'.
export {
  LOG_LEVEL_ORDER,
  type LogQuery,
  logLevelRank,
  matchesLogQuery,
  readLogEvents
} from './dev-server/control-bridge/logs-query'
export {
  controlTokenPath,
  readControlToken
} from './dev-server/control-bridge/session-token'
// Session-state paths. Every consumer that hardcodes
// `dist/extension-js/<browser>/ready.json` is one layout change away from
// silently reading nothing, so the layout is published rather than implied.
export {
  actionsPath,
  browserArtifactsDir,
  browserDistDir,
  browserProfileRootDir,
  buildSummaryPath,
  eventsPath,
  logsPath,
  readyContractPath,
  sessionArtifactsRootDir,
  sessionStateDir
} from './lib/session-paths'
// The writer's own type for ready.json, so a consumer names the contract the
// engine maintains instead of hand-declaring a twenty-field mirror of it.
export type {
  PlaywrightAutomationCommand,
  ReadyMetadata,
  ReadyStatus
} from './plugin-playwright'

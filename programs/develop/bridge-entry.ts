// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

export {
  BridgeConsumer,
  type ConsumerOptions,
  type ReadyContractInfo,
  readReadyContract
} from './dev-server/control-bridge/consumer-client'
export type {
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
// copying '/extjs-control' and the envelope version into its own source.
export {
  CONTROL_ENVELOPE_VERSION,
  CONTROL_WS_PATH,
  LOG_EVENT_VERSION
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
export {
  type LogQuery,
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
  buildSummaryPath,
  eventsPath,
  logsPath,
  readyContractPath,
  sessionArtifactsRootDir,
  sessionStateDir
} from './lib/session-paths'

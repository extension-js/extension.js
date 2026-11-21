// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {ReadyContract} from './types'

export {
  BridgeConsumer,
  type ConsumerCloseInfo,
  type ConsumerOptions,
  type ReadyContractDocument,
  type ReadyContractInfo,
  readReadyContract,
  readReadyContractDocument
} from './dev-server/control-bridge/consumer-client'
// Every wire constant and frame type, straight from the file that defines
// them, so a new REFUSAL_ or CLOSE_ code is public the day it is added.
export * from './dev-server/control-bridge/contracts'
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
  isAfterSince,
  LOG_LEVEL_FILTERS,
  LOG_LEVEL_ORDER,
  type LogQuery,
  type LogSince,
  logLevelRank,
  logQueryProblem,
  matchesLogQuery,
  parseLogLevelFilter,
  parseLogSince,
  readLogEvents,
  unknownLogContexts
} from './dev-server/control-bridge/logs-query'
export {
  controlTokenPath,
  readControlToken
} from './dev-server/control-bridge/session-token'
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
// Session-state paths. Every consumer that hardcodes
// `dist/extension-js/<browser>/ready.json` is one layout change away from
// silently reading nothing, so the layout is published rather than implied.
export {resolveSessionProjectRoot} from './lib/session-project-root'
export type {ReadyStatus} from './plugin-ready-contract'
// ready.json with every field the engine writes, launcher stamps it carries
// across a recompile included, so a consumer never hand-declares a mirror.
export type {ReadyContract}
/** @deprecated Use `ReadyContract`, which this now is. */
export type ReadyMetadata = ReadyContract
/** @deprecated Use `ReadyContract['command']`, which this now is. */
export type PlaywrightAutomationCommand = ReadyContract['command']

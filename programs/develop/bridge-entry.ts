// ██████╗ ██████╗ ██╗██████╗  ██████╗ ███████╗
// ██╔══██╗██╔══██╗██║██╔══██╗██╔════╝ ██╔════╝
// ██████╔╝██████╔╝██║██║  ██║██║  ███╗█████╗
// ██╔══██╗██╔══██╗██║██║  ██║██║   ██║██╔══╝
// ██████╔╝██║  ██║██║██████╔╝╚██████╔╝███████╗
// ╚═════╝ ╚═╝  ╚═╝╚═╝╚═════╝  ╚═════╝ ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

export {
  BridgeConsumer,
  readReadyContract,
  type ConsumerOptions,
  type ReadyContractInfo
} from './dev-server/control-bridge/consumer-client'

export {
  BridgeController,
  type ControllerOptions,
  type CommandInput
} from './dev-server/control-bridge/controller-client'

export {
  readControlToken,
  controlTokenPath
} from './dev-server/control-bridge/session-token'

export type {
  LogEvent,
  LogLevel,
  LogContext,
  GapFrame,
  ReadyFrame,
  ResultFrame,
  BridgeTarget,
  CommandOp
} from './dev-server/control-bridge/contracts'

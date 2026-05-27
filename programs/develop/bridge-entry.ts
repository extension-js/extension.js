// ██████╗ ██████╗ ██╗██████╗  ██████╗ ███████╗
// ██╔══██╗██╔══██╗██║██╔══██╗██╔════╝ ██╔════╝
// ██████╔╝██████╔╝██║██║  ██║██║  ███╗█████╗
// ██╔══██╗██╔══██╗██║██║  ██║██║   ██║██╔══╝
// ██████╔╝██║  ██║██║██████╔╝╚██████╔╝███████╗
// ╚═════╝ ╚═╝  ╚═╝╚═╝╚═════╝  ╚═════╝ ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

// Lightweight entry for agent-bridge consumers (the `extension logs` command).
// Intentionally avoids importing rspack / the build toolchain so it starts fast.

export {
  BridgeConsumer,
  readReadyContract,
  type ConsumerOptions,
  type ReadyContractInfo
} from './dev-server/control-bridge/consumer-client'

// Slice 2 (act): the controller client + the eval-token reader, used by the
// `extension eval|storage|reload|open` verbs (and, via the CLI, the MCP tools).
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

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

export type {
  LogEvent,
  LogLevel,
  LogContext,
  GapFrame,
  ReadyFrame
} from './dev-server/control-bridge/contracts'

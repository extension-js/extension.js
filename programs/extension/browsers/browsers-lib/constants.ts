// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

// Default ports
export const DEFAULT_DEBUG_PORT = 9222
export const PORT_OFFSET = 100

// Timeout helpers — each can be overridden via env var for CI or slow machines.
function envMs(envKey: string, fallback: number): number {
  const raw = process.env[envKey]
  if (!raw) return fallback
  const parsed = parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/** CDP sendCommand default timeout (ms). Override: EXTENSION_CDP_COMMAND_TIMEOUT_MS */
export const CDP_COMMAND_TIMEOUT_MS = envMs(
  'EXTENSION_CDP_COMMAND_TIMEOUT_MS',
  12_000
)

/** CDP HTTP endpoint timeout for /json discovery (ms). Override: EXTENSION_CDP_HTTP_TIMEOUT_MS */
export const CDP_HTTP_TIMEOUT_MS = envMs('EXTENSION_CDP_HTTP_TIMEOUT_MS', 1_200)

/** Firefox RDP evaluation timeout (ms). Override: EXTENSION_RDP_EVAL_TIMEOUT_MS */
export const RDP_EVAL_TIMEOUT_MS = envMs('EXTENSION_RDP_EVAL_TIMEOUT_MS', 8_000)

/** Firefox RDP connect retry count. Override: EXTENSION_RDP_MAX_RETRIES */
export const RDP_MAX_RETRIES = envMs('EXTENSION_RDP_MAX_RETRIES', 150)

/** Firefox RDP connect retry interval (ms). Override: EXTENSION_RDP_RETRY_INTERVAL_MS */
export const RDP_RETRY_INTERVAL_MS = envMs(
  'EXTENSION_RDP_RETRY_INTERVAL_MS',
  1_000
)

/** CDP WebSocket heartbeat interval (ms). Override: EXTENSION_CDP_HEARTBEAT_INTERVAL_MS */
export const CDP_HEARTBEAT_INTERVAL_MS = envMs(
  'EXTENSION_CDP_HEARTBEAT_INTERVAL_MS',
  30_000
)

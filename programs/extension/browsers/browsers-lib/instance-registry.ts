// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

export type InstanceRecord = {
  cdpPort?: number
  rdpPort?: number
}

export type DebugProtocol = 'cdp' | 'rdp'

/**
 * Raised when a piece of tooling (a reload, a readiness check, a source
 * inspection) is asked to resolve the debug port for an instance it cannot
 * identify, and no caller-supplied fallback is available. Historically the
 * registry answered this case with the process-wide last-launched port, which
 * silently attached the request to whichever browser launched most recently —
 * so with two live instances in one process (e.g. chrome + edge from one `dev`
 * command) the earlier instance's tooling crossed over to the later browser.
 * Signalling instead of guessing keeps every consumer faithful to its own
 * instance.
 */
export class AmbiguousInstanceError extends Error {
  public readonly protocol: DebugProtocol
  public readonly instanceId: string | undefined

  constructor(protocol: DebugProtocol, instanceId?: string) {
    super(
      instanceId
        ? `Cannot resolve the ${protocol.toUpperCase()} port for instance ` +
          `"${instanceId}": it has not registered a port and no fallback was ` +
          `provided. Refusing to fall back to the most recently launched ` +
          `browser to avoid crossing instance streams.`
        : `Cannot resolve a ${protocol.toUpperCase()} port without an instance ` +
          `id and no fallback was provided. Refusing to fall back to the most ` +
          `recently launched browser to avoid crossing instance streams.`
    )
    this.name = 'AmbiguousInstanceError'
    this.protocol = protocol
    this.instanceId = instanceId
  }
}

const instanceIdToRecord = new Map<string, InstanceRecord>()
let lastCDPPort: number | undefined
let lastRDPPort: number | undefined

export function setInstancePorts(
  instanceId: string | undefined,
  ports: InstanceRecord
) {
  try {
    if (typeof ports.cdpPort === 'number') lastCDPPort = ports.cdpPort
    if (typeof ports.rdpPort === 'number') lastRDPPort = ports.rdpPort
    if (!instanceId) return
    const prev = instanceIdToRecord.get(instanceId) || {}
    instanceIdToRecord.set(instanceId, {...prev, ...ports})
  } catch {}
}

export function getInstancePorts(
  instanceId: string | undefined
): InstanceRecord | undefined {
  if (!instanceId) return undefined
  return instanceIdToRecord.get(instanceId)
}

export function getLastCDPPort(): number | undefined {
  return lastCDPPort
}

export function getLastRDPPort(): number | undefined {
  return lastRDPPort
}

/**
 * The single instance-to-port contract every consumer must go through, instead
 * of each caller re-implementing `(id && getInstancePorts(id)?.port) ||
 * getLast*()`. Resolution is strictly per-instance:
 *
 *  - if `instanceId` is known and has a registered port, return that port —
 *    this is the faithful path and is what a single-browser run already hits;
 *  - if `instanceId` is known but has not registered a port yet (the launcher
 *    may register it slightly after a waiter starts), return `undefined` so the
 *    caller can keep polling or apply its own deterministic, per-instance
 *    default (e.g. the derived debug port) — never another instance's port;
 *  - if the instance genuinely cannot be told apart (no id, or an unknown id)
 *    and the caller passes a `fallback`, use it; otherwise throw
 *    {@link AmbiguousInstanceError} rather than silently picking the most
 *    recently launched browser.
 *
 * The process-wide `lastCDPPort`/`lastRDPPort` are never consulted here — they
 * remain only for the readiness-producer telemetry that reports the most recent
 * launch, and are no longer part of any resolution path.
 */
export function resolvePortForInstance(
  instanceId: string | undefined,
  protocol: DebugProtocol,
  fallback?: number
): number | undefined {
  const key: keyof InstanceRecord = protocol === 'cdp' ? 'cdpPort' : 'rdpPort'

  if (instanceId) {
    const record = instanceIdToRecord.get(instanceId)
    const port = record?.[key]
    if (typeof port === 'number' && port > 0) return port
    // Known instance, no port registered yet: defer to the caller's own
    // per-instance default rather than another instance's last port.
    if (typeof fallback === 'number' && fallback > 0) return fallback
    return undefined
  }

  // No instance id at all — the cannot-tell case.
  if (typeof fallback === 'number' && fallback > 0) return fallback
  throw new AmbiguousInstanceError(protocol, instanceId)
}

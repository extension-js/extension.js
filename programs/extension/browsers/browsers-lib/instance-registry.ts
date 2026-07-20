// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

export type InstanceRecord = {
  cdpPort?: number
  rdpPort?: number
}

export type DebugProtocol = 'cdp' | 'rdp'

// Raised when tooling asks for the debug port of an instance it cannot
// identify; signalling instead of guessing keeps consumers on their own instance.
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
  } catch {
    // Ignore
  }
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

// The single instance-to-port contract: exact id wins; known-but-unregistered
// returns undefined; ambiguous uses fallback or throws AmbiguousInstanceError.
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

  if (typeof fallback === 'number' && fallback > 0) return fallback
  throw new AmbiguousInstanceError(protocol, instanceId)
}

export type InstanceRecord = {
  cdpPort?: number
  rdpPort?: number
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

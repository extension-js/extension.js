// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

export interface DevSessionCoordinates {
  protocol: string
  host: string
  connectableHost: string
  port: number
  path: string
  instanceId: string
  controlPort: number | null
  launchEnabled: boolean
}

export function devSessionCoordinates(
  coordinates: DevSessionCoordinates
): Readonly<DevSessionCoordinates> {
  const port = Number(coordinates.port)
  const controlPort =
    coordinates.controlPort == null ? null : Number(coordinates.controlPort)

  return Object.freeze({
    protocol: String(coordinates.protocol || 'ws'),
    host: String(coordinates.host || ''),
    connectableHost: String(coordinates.connectableHost || ''),
    port,
    path: String(coordinates.path || '/ws'),
    instanceId: String(coordinates.instanceId || ''),
    controlPort:
      controlPort !== null && Number.isFinite(controlPort) && controlPort > 0
        ? controlPort
        : null,
    launchEnabled: coordinates.launchEnabled !== false
  })
}

import {
  type DevSessionCoordinates,
  devSessionCoordinates
} from '../../lib/dev-session-coordinates'

// The record a dev session hands the config it builds, with a loopback
// session for whatever a spec does not name.
export function sessionOf(
  part: Partial<DevSessionCoordinates> = {}
): Readonly<DevSessionCoordinates> {
  const instanceId = part.instanceId ?? 'spec-session'

  return devSessionCoordinates({
    protocol: 'ws',
    host: '127.0.0.1',
    connectableHost: '127.0.0.1',
    port: 8080,
    path: `/ws/${instanceId}`,
    controlPort: null,
    launchEnabled: true,
    ...part,
    instanceId
  })
}

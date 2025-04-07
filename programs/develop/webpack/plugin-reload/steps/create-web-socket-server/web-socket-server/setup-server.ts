import WebSocket from 'ws'
import {DevOptions} from '../../../../../commands/commands-lib/config-types'

export function setupServer(
  port: number | string,
  browser: DevOptions['browser']
) {
  // Convert 'auto' to a default port if needed
  const serverPort = port === 'auto' ? 8000 : port

  return new WebSocket.Server({
    port: serverPort as number,
    perMessageDeflate: false
  })
}

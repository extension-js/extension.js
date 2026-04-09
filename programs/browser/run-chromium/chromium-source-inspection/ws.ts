// ██████╗ ██╗   ██╗███╗   ██╗       ██████╗██╗  ██╗██████╗  ██████╗ ███╗   ███╗██╗██╗   ██╗███╗   ███╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║  ██║██╔══██╗██╔═══██╗████╗ ████║██║██║   ██║████╗ ████║
// ██████╔╝██║   ██║██╔██╗ ██║█████╗██║     ███████║██████╔╝██║   ██║██╔████╔██║██║██║   ██║██╔████╔██║
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██║     ██╔══██║██╔══██╗██║   ██║██║╚██╔╝██║██║██║   ██║██║╚██╔╝██║
// ██║  ██║╚██████╔╝██║ ╚████║      ╚██████╗██║  ██║██║  ██║╚██████╔╝██║ ╚═╝ ██║██║╚██████╔╝██║ ╚═╝ ██║
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝       ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import WebSocket from 'ws'
import * as messages from '../../browsers-lib/messages'

export function establishBrowserConnection(
  url: string,
  isDev: boolean,
  onMessage: (data: string) => void,
  onRejectPending: (reason: string) => void
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)

    ws.on('open', () => {
      if (isDev) {
        console.log(messages.cdpClientBrowserConnectionEstablished())
      }
      resolve(ws)
    })

    ws.on('message', (data: WebSocket.Data) => {
      onMessage(data.toString())
    })

    ws.on('error', (error: Error) => {
      if (isDev) {
        console.error(messages.cdpClientConnectionError(error.message))
      }
      onRejectPending(error.message)
      reject(error)
    })

    ws.on('close', () => {
      if (isDev) console.log(messages.cdpClientConnectionClosed())
      onRejectPending('CDP connection closed')
    })
  })
}

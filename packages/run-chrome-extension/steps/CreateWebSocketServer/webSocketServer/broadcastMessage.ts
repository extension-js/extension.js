import WebSocket from 'ws'

export default function (
  server: WebSocket.Server<typeof WebSocket, any>,
  message: string
) {
  server.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message))
    }
  })
}

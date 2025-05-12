import WebSocket, {Server} from 'ws'

export default function (
  server: Server<typeof WebSocket, any>,
  message: string
) {
  server.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message))
    }
  })
}

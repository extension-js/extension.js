// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import {type RawData, WebSocket, WebSocketServer} from 'ws'
import type {BridgeBroker, BridgeConnection} from './broker'
import {type AnyFrame, CONTROL_WS_PATH, type ServerFrame} from './contracts'

const SLOW_CONSUMER_BYTES = 8 * 1024 * 1024
const CLOSE_SLOW_CONSUMER = 4008

// MV3 service workers idle out after ~30s without events; receiving a
// WebSocket message resets that timer (Chrome 116+). Ping producers on a
// shorter cadence so the dev extension's SW stays reachable for reload
// broadcasts however long the developer pauses between edits.
const PRODUCER_KEEPALIVE_INTERVAL_MS = 20_000

export interface ControlServer {
  port: number
  broker: BridgeBroker
  close(): Promise<void>
}

export interface StartControlServerOptions {
  broker: BridgeBroker
  host?: string
  port?: number
  path?: string
}

let connSeq = 0

export function startControlServer(
  options: StartControlServerOptions
): Promise<ControlServer> {
  const {broker} = options
  const host = options.host ?? '127.0.0.1'
  const path = options.path ?? CONTROL_WS_PATH

  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({host, port: options.port ?? 0, path})

    wss.on('error', reject)

    wss.on('connection', (socket: WebSocket) => {
      const conn: BridgeConnection = {
        id: `c${++connSeq}`,
        send(frame: ServerFrame) {
          if (socket.readyState !== WebSocket.OPEN) return
          if (socket.bufferedAmount > SLOW_CONSUMER_BYTES) {
            // Isolate a slow reader so it can't backpressure the broker
            try {
              socket.close(CLOSE_SLOW_CONSUMER, 'slow consumer')
            } catch {
              // ignore
            }
            return
          }
          try {
            socket.send(JSON.stringify(frame))
          } catch {
            // Ignore. Adapter tears the socket down on error/close
          }
        },
        close(code, reason) {
          try {
            socket.close(code, reason)
          } catch {
            // ignore
          }
        }
      }

      socket.on('message', (data: RawData) => {
        let frame: AnyFrame
        try {
          frame = JSON.parse(data.toString())
        } catch {
          return // ignore malformed frames
        }
        broker.onFrame(conn, frame)
      })

      socket.on('close', () => broker.onClose(conn))
      socket.on('error', () => broker.onClose(conn))
    })

    wss.on('listening', () => {
      const address = wss.address()
      const port = typeof address === 'object' && address ? address.port : 0
      const keepalive = setInterval(
        () => broker.pingProducers(),
        PRODUCER_KEEPALIVE_INTERVAL_MS
      )
      keepalive.unref?.()
      resolve({
        port,
        broker,
        close: () =>
          new Promise<void>((res) => {
            clearInterval(keepalive)
            for (const client of wss.clients) {
              try {
                client.terminate()
              } catch {
                // ignore
              }
            }
            wss.close(() => res())
          })
      })
    })
  })
}

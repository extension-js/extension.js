/**
 * WebSocket adapter for the agent-bridge control channel.
 *
 * The ONLY file that imports `ws`. It binds a dedicated control-WS server
 * (separate from rspack's broadcast-only /ws), wraps each socket as a
 * BridgeConnection, and forwards parsed frames to the transport-agnostic
 * BridgeBroker. Keep it thin: all logic lives in broker.ts.
 */

import {WebSocketServer, WebSocket, type RawData} from 'ws'
import {BridgeBroker, type BridgeConnection} from './broker'
import {CONTROL_WS_PATH, type AnyFrame, type ServerFrame} from './contracts'

/** Drop a consumer whose outbound buffer grows past this (a wedged reader). */
const SLOW_CONSUMER_BYTES = 8 * 1024 * 1024
const CLOSE_SLOW_CONSUMER = 4008

export interface ControlServer {
  port: number
  broker: BridgeBroker
  close(): Promise<void>
}

export interface StartControlServerOptions {
  broker: BridgeBroker
  host?: string
  /** 0 (default) lets the OS assign a free port. */
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
            // Isolate a slow reader so it can't backpressure the broker.
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
            // ignore — adapter tears the socket down on error/close
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
      resolve({
        port,
        broker,
        close: () =>
          new Promise<void>((res) => {
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

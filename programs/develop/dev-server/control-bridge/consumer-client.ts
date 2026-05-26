/**
 * Node-side consumer client for the agent-bridge control WS (Slice 1, read side).
 *
 * Connects as a `consumer`, replays + streams log/gap frames, and reconnects
 * with backoff (the dev server may still be starting). Used by the
 * `extension logs` CLI and, later, the MCP `extension_logs` tool — one client,
 * many front-ends.
 */

import * as fs from 'fs'
import * as path from 'path'
import {WebSocket} from 'ws'
import {
  CONTROL_ENVELOPE_VERSION,
  CONTROL_WS_PATH,
  type GapFrame,
  type LogEvent,
  type ReadyFrame,
  type ServerFrame
} from './contracts'

export interface ReadyContractInfo {
  controlPort: number
  instanceId: string
  runId: string
  logsPath?: string
  status?: string
}

/** Read controlPort/instanceId from dist/extension-js/<browser>/ready.json. */
export function readReadyContract(
  projectPath: string,
  browser = 'chrome'
): ReadyContractInfo | null {
  const readyPath = path.resolve(
    projectPath,
    'dist',
    'extension-js',
    browser,
    'ready.json'
  )
  try {
    const c = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    if (typeof c.controlPort !== 'number' || !c.instanceId) return null
    return {
      controlPort: c.controlPort,
      instanceId: String(c.instanceId),
      runId: String(c.runId || ''),
      logsPath: c.logsPath,
      status: c.status
    }
  } catch {
    return null
  }
}

export interface ConsumerOptions {
  controlPort: number
  instanceId: string
  host?: string
  path?: string
  reconnect?: boolean
  onReady?: (frame: ReadyFrame) => void
  onLog?: (event: LogEvent) => void
  onGap?: (frame: GapFrame) => void
  onClose?: () => void
}

export class BridgeConsumer {
  private readonly opts: ConsumerOptions
  private socket: WebSocket | null = null
  private backoff = 250
  private readonly maxBackoff = 5000
  private closed = false
  private timer: NodeJS.Timeout | null = null

  constructor(options: ConsumerOptions) {
    this.opts = options
  }

  start(): void {
    this.closed = false
    this.connect()
  }

  close(): void {
    this.closed = true
    if (this.timer) clearTimeout(this.timer)
    try {
      this.socket?.close()
    } catch {
      // ignore
    }
    this.socket = null
  }

  private url(): string {
    const host = this.opts.host ?? '127.0.0.1'
    const p = this.opts.path ?? CONTROL_WS_PATH
    return `ws://${host}:${this.opts.controlPort}${p}`
  }

  private connect(): void {
    if (this.closed) return
    let socket: WebSocket
    try {
      socket = new WebSocket(this.url())
    } catch {
      this.scheduleReconnect()
      return
    }
    this.socket = socket

    socket.on('open', () => {
      this.backoff = 250
      try {
        socket.send(
          JSON.stringify({
            type: 'hello',
            v: CONTROL_ENVELOPE_VERSION,
            role: 'consumer',
            instanceId: this.opts.instanceId
          })
        )
      } catch {
        // ignore
      }
    })

    socket.on('message', (data) => {
      let frame: ServerFrame
      try {
        frame = JSON.parse(data.toString())
      } catch {
        return
      }
      if (frame.type === 'ready') this.opts.onReady?.(frame)
      else if (frame.type === 'log') this.opts.onLog?.(frame.event)
      else if (frame.type === 'gap') this.opts.onGap?.(frame)
    })

    socket.on('close', () => {
      this.socket = null
      this.opts.onClose?.()
      if (this.opts.reconnect) this.scheduleReconnect()
    })
    socket.on('error', () => {
      try {
        socket.close()
      } catch {
        // ignore
      }
    })
  }

  private scheduleReconnect(): void {
    if (this.closed || !this.opts.reconnect) return
    const delay = this.backoff
    this.backoff = Math.min(this.backoff * 2, this.maxBackoff)
    this.timer = setTimeout(() => this.connect(), delay)
  }
}

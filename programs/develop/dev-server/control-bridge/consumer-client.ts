// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import {WebSocket} from 'ws'
import {readyContractPath} from '../../lib/session-paths'
import type {ReadyMetadata} from '../../plugin-playwright'
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
  /** Ready-contract version, `ReadyMetadata['schemaVersion']` on current engines. */
  schemaVersion?: number
  /** Result-envelope capability advertisement, `1` on current engines. */
  schema?: number
  logsPath?: string
  status?: string
  /** Dev-server pid; absent in pre-4.1 contracts. */
  pid?: number
  /** Browser CDP port, stamped post-launch, may lag `status: 'ready'`. */
  cdpPort?: number
  /** Stamped when the launched browser exits while the server keeps running. */
  browserExitedAt?: string
  browserExitCode?: number
  /** When the compile finished (ISO), the meaning of `status: 'ready'`. */
  compiledAt?: string
  /** When the extension's service worker attached to the control channel (ISO). */
  executorAttachedAt?: string
  /** `'attached'` once the SW has connected; absent while still launching. */
  runtime?: string
  /** Last contract write time (ISO). */
  ts?: string
}

// The whole ready contract, exactly as the engine wrote it. Optional because a
// reader may hold a file an older or newer engine produced.
export type ReadyContractDocument = Partial<ReadyMetadata> &
  Record<string, unknown>

// The documented reader: passes the whole document through so no field the
// engine stamps (errors, code, message, rdpPort, distPath, ...) is dropped.
export function readReadyContractDocument(
  projectPath: string,
  browser = 'chrome'
): ReadyContractDocument | null {
  const readyPath = readyContractPath(projectPath, browser)

  try {
    const parsed = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }
    return parsed as ReadyContractDocument
  } catch {
    return null
  }
}

export function readReadyContract(
  projectPath: string,
  browser = 'chrome'
): ReadyContractInfo | null {
  const readyPath = readyContractPath(projectPath, browser)

  try {
    const c = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    if (typeof c.controlPort !== 'number' || !c.instanceId) return null

    return {
      controlPort: c.controlPort,
      instanceId: String(c.instanceId),
      runId: String(c.runId || ''),
      schemaVersion:
        typeof c.schemaVersion === 'number' ? c.schemaVersion : undefined,
      schema: typeof c.schema === 'number' ? c.schema : undefined,
      logsPath: c.logsPath,
      status: c.status,
      pid: typeof c.pid === 'number' ? c.pid : undefined,
      cdpPort: typeof c.cdpPort === 'number' ? c.cdpPort : undefined,
      browserExitedAt:
        typeof c.browserExitedAt === 'string' ? c.browserExitedAt : undefined,
      browserExitCode:
        typeof c.browserExitCode === 'number' ? c.browserExitCode : undefined,
      compiledAt: typeof c.compiledAt === 'string' ? c.compiledAt : undefined,
      executorAttachedAt:
        typeof c.executorAttachedAt === 'string'
          ? c.executorAttachedAt
          : undefined,
      runtime: typeof c.runtime === 'string' ? c.runtime : undefined,
      ts: typeof c.ts === 'string' ? c.ts : undefined
    }
  } catch {
    return null
  }
}

// The close code names a deliberate refusal (the CLOSE_ constants), so the
// client hands it to the caller instead of reducing every close to a void.
export interface ConsumerCloseInfo {
  code: number
  reason: string
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
  onClose?: (info: ConsumerCloseInfo) => void
}

export class BridgeConsumer {
  private readonly opts: ConsumerOptions
  private socket: WebSocket | null = null
  private backoff = 250
  private readonly maxBackoff = 5000
  private closed = false
  private timer: NodeJS.Timeout | null = null
  private lastCloseInfo: ConsumerCloseInfo | null = null

  constructor(options: ConsumerOptions) {
    this.opts = options
  }

  /** Why the last socket closed; null until a close has happened. */
  get lastClose(): ConsumerCloseInfo | null {
    return this.lastCloseInfo
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
      // Ignore
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
        // Ignore
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

    socket.on('close', (code: number, reason: Buffer) => {
      this.socket = null
      this.lastCloseInfo = {code, reason: reason?.toString() ?? ''}
      this.opts.onClose?.(this.lastCloseInfo)
      if (this.opts.reconnect) this.scheduleReconnect()
    })

    socket.on('error', () => {
      try {
        socket.close()
      } catch {
        // Ignore
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

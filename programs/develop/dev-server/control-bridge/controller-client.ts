/**
 * Node-side controller client for the agent-bridge control WS (Slice 2, act).
 *
 * Connects as a `controller`, performs the hello (with the eval token when
 * present), waits for the broker's `ready` (which carries negotiated
 * capabilities), then issues `command` frames and resolves each by cmdId when
 * the matching `result` arrives. Used by the `extension eval|storage|reload|open`
 * CLI verbs and, transitively, the MCP act tools (which shell out to the CLI).
 *
 * One command at a time is the common case, but multiple in-flight commands are
 * correlated independently by cmdId.
 */

import {WebSocket} from 'ws'
import {
  CONTROL_ENVELOPE_VERSION,
  CONTROL_WS_PATH,
  type BridgeTarget,
  type CommandOp,
  type ReadyFrame,
  type ResultFrame
} from './contracts'

export interface ControllerOptions {
  controlPort: number
  instanceId: string
  /** Required to issue `eval`; ignored by the broker for other ops. */
  token?: string
  host?: string
  path?: string
  /** Time to wait for the broker's ready handshake. */
  connectTimeoutMs?: number
}

export interface CommandInput {
  op: CommandOp
  target: BridgeTarget
  args?: Record<string, unknown>
  /** Per-command timeout; the broker clamps to [1, 30000]. */
  timeoutMs?: number
}

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000

let cmdSeq = 0

export class BridgeController {
  private readonly opts: ControllerOptions
  private socket: WebSocket | null = null
  private ready: ReadyFrame | null = null
  private connectPromise: Promise<ReadyFrame> | null = null
  private readonly pending = new Map<
    string,
    {
      resolve: (r: ResultFrame) => void
      reject: (e: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()

  constructor(options: ControllerOptions) {
    this.opts = options
  }

  get capabilities(): ReadyFrame['capabilities'] | undefined {
    return this.ready?.capabilities
  }

  /** Open the socket and resolve once the broker accepts the controller hello. */
  connect(): Promise<ReadyFrame> {
    if (this.connectPromise) return this.connectPromise
    const host = this.opts.host ?? '127.0.0.1'
    const wsPath = this.opts.path ?? CONTROL_WS_PATH
    const url = `ws://${host}:${this.opts.controlPort}${wsPath}`

    this.connectPromise = new Promise<ReadyFrame>((resolve, reject) => {
      let settled = false
      const connectTimer = setTimeout(() => {
        if (settled) return
        settled = true
        this.close()
        reject(new Error(`control channel handshake timed out at ${url}`))
      }, this.opts.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS)

      let socket: WebSocket
      try {
        socket = new WebSocket(url)
      } catch (err) {
        clearTimeout(connectTimer)
        reject(err instanceof Error ? err : new Error(String(err)))
        return
      }
      this.socket = socket

      socket.on('open', () => {
        socket.send(
          JSON.stringify({
            type: 'hello',
            v: CONTROL_ENVELOPE_VERSION,
            role: 'controller',
            instanceId: this.opts.instanceId,
            ...(this.opts.token ? {token: this.opts.token} : {})
          })
        )
      })

      socket.on('message', (data) => {
        let frame: any
        try {
          frame = JSON.parse(data.toString())
        } catch {
          return
        }
        if (frame.type === 'ready') {
          this.ready = frame as ReadyFrame
          if (!settled) {
            settled = true
            clearTimeout(connectTimer)
            resolve(this.ready)
          }
          return
        }
        if (frame.type === 'result') this.resolveResult(frame as ResultFrame)
      })

      socket.on('close', (code: number, reasonBuf: Buffer) => {
        const reason = reasonBuf?.toString() || ''
        if (!settled) {
          settled = true
          clearTimeout(connectTimer)
          reject(
            new Error(
              `control channel refused the controller (code ${code}${
                reason ? `: ${reason}` : ''
              }). Is the session started with --allow-control?`
            )
          )
        }
        this.failAllPending(
          new Error(`control channel closed (code ${code})`)
        )
        this.socket = null
      })

      socket.on('error', () => {
        // 'close' follows and handles rejection/cleanup.
      })
    })

    return this.connectPromise
  }

  /** Issue a command and resolve with the broker-routed result. */
  async command(input: CommandInput): Promise<ResultFrame> {
    await this.connect()
    const socket = this.socket
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error('control channel is not open')
    }
    const cmdId = `c-${Date.now()}-${++cmdSeq}`
    const timeoutMs = input.timeoutMs ?? 5000
    // Client-side backstop slightly above the broker's own timeout.
    const backstopMs = Math.min(timeoutMs, 30_000) + 2000

    return new Promise<ResultFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(cmdId)
        reject(new Error(`command ${input.op} timed out after ${backstopMs}ms`))
      }, backstopMs)
      this.pending.set(cmdId, {resolve, reject, timer})

      socket.send(
        JSON.stringify({
          type: 'command',
          cmdId,
          op: input.op,
          target: input.target,
          args: input.args,
          timeoutMs
        })
      )
    })
  }

  close(): void {
    this.failAllPending(new Error('controller closed'))
    try {
      this.socket?.close()
    } catch {
      // ignore
    }
    this.socket = null
  }

  // --- internals ---

  private resolveResult(result: ResultFrame): void {
    const p = this.pending.get(result.cmdId)
    if (!p) return
    clearTimeout(p.timer)
    this.pending.delete(result.cmdId)
    p.resolve(result)
  }

  private failAllPending(err: Error): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(err)
    }
    this.pending.clear()
  }
}

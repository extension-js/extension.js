// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {WebSocket} from 'ws'
import {
  type BridgeTarget,
  CLOSE_BAD_HELLO,
  CLOSE_BAD_INSTANCE,
  CLOSE_CONTROL_UNAVAILABLE,
  CONTROL_ENVELOPE_VERSION,
  CONTROL_WS_PATH,
  type CommandOp,
  type ReadyFrame,
  type ResultFrame
} from './contracts'

export interface ControllerOptions {
  controlPort: number
  instanceId: string
  token?: string
  host?: string
  path?: string
  connectTimeoutMs?: number
  // Flag named in a connect refusal. Eval callers pass --allow-eval so the
  // 4003 hint matches the verb the user attempted, not the generic gate.
  unlockFlag?: string
}

export interface CommandInput {
  op: CommandOp
  target: BridgeTarget
  args?: Record<string, unknown>
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
        let frame: {type?: unknown}

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

          // Each close code is one cause, and the copy states that cause. The
          // instanceId matched before 4003 was sent, so the session itself has
          // control off, and asking for a flag the caller may already have
          // passed would send them to check something that was never wrong.
          const flag = this.opts.unlockFlag || '--allow-control'
          const detail =
            code === CLOSE_CONTROL_UNAVAILABLE
              ? 'control is off in the session that answered, so it accepts ' +
                `no controller. A session turns control on with ${flag}, and ` +
                'one that had the flag and still answers this way needs ' +
                '`extension doctor`.'
              : code === CLOSE_BAD_INSTANCE
                ? 'the session that wrote ready.json has been replaced. ' +
                  'Re-read ready.json or restart the dev session.'
                : code === CLOSE_BAD_HELLO
                  ? 'the session did not understand the hello. Update the CLI ' +
                    'and the dev session to the same Extension.js version.'
                  : 'the session closed the socket during the handshake.'

          reject(
            Object.assign(
              new Error(
                `control channel refused the controller (code ${code}${
                  reason ? `: ${reason}` : ''
                }). ${detail}`
              ),
              {closeCode: code}
            )
          )
        }

        this.failAllPending(new Error(`control channel closed (code ${code})`))

        this.socket = null
      })

      socket.on('error', () => {
        // 'close' follows and handles rejection/cleanup.
      })
    })

    return this.connectPromise
  }

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
      // Ignore
    }
    this.socket = null
  }

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

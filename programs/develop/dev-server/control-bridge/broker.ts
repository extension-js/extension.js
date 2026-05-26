/**
 * Transport-agnostic agent-bridge broker (Slice 1: logs).
 *
 * Knows nothing about WebSockets — it operates on abstract connections so the
 * core fan-out/replay/gap logic is unit-testable without a socket. The ws
 * adapter (ws-control-server.ts) wraps each socket as a BridgeConnection and
 * forwards parsed frames here.
 *
 * Slice 1 handles producer → ring/file → consumers, with honest `gap` frames.
 * The `controller` role (eval/act, Slice 2) is recognized and politely refused
 * so the handshake stays forward-compatible.
 */

import {LogRingBuffer} from './ring-buffer'
import type {LogsFileWriter} from './logs-file'
import {
  CONTROL_ENVELOPE_VERSION,
  type AnyFrame,
  type BridgeRole,
  type HelloFrame,
  type IncomingLogEvent,
  type ReadyFrame,
  type ServerFrame
} from './contracts'

export interface BridgeConnection {
  readonly id: string
  send(frame: ServerFrame): void
  close(code?: number, reason?: string): void
}

export interface BridgeBrokerOptions {
  instanceId: string
  runId: string
  engine?: 'chromium' | 'firefox'
  ring?: LogRingBuffer
  file?: LogsFileWriter
}

// Close codes (4000–4999 are application-defined for WebSocket).
export const CLOSE_BAD_INSTANCE = 4001
export const CLOSE_BAD_HELLO = 4002
export const CLOSE_CONTROL_UNAVAILABLE = 4003

export class BridgeBroker {
  private readonly instanceId: string
  private readonly runId: string
  private readonly engine?: 'chromium' | 'firefox'
  private readonly ring: LogRingBuffer
  private readonly file?: LogsFileWriter
  private readonly roles = new Map<BridgeConnection, BridgeRole>()

  constructor(options: BridgeBrokerOptions) {
    this.instanceId = options.instanceId
    this.runId = options.runId
    this.engine = options.engine
    this.ring = options.ring ?? new LogRingBuffer()
    this.file = options.file
  }

  get consumerCount(): number {
    return this.countRole('consumer')
  }

  get producerCount(): number {
    return this.countRole('producer')
  }

  /** Dispatch one inbound frame from a connection. */
  onFrame(conn: BridgeConnection, frame: AnyFrame): void {
    switch (frame.type) {
      case 'hello':
        this.onHello(conn, frame)
        return
      case 'log':
        if (this.roles.get(conn) === 'producer') {
          this.ingestLog(frame.event)
        }
        return
      // 'command' / 'result' are Slice 2; ignored until the controller role ships.
      default:
        return
    }
  }

  onClose(conn: BridgeConnection): void {
    this.roles.delete(conn)
  }

  /** Producer entrypoint also usable directly (e.g. in-process tests). */
  ingestLog(incoming: IncomingLogEvent): void {
    const event = this.ring.push(incoming)
    this.file?.write(event)
    this.fanOut({type: 'log', event})

    const gap = this.ring.drainDropped()
    if (gap) {
      this.fanOut({
        type: 'gap',
        dropped: gap.dropped,
        reason: gap.reason,
        sinceSeq: gap.sinceSeq
      })
    }
  }

  // --- internals ---

  private onHello(conn: BridgeConnection, hello: HelloFrame): void {
    if (hello.v !== CONTROL_ENVELOPE_VERSION) {
      conn.close(CLOSE_BAD_HELLO, 'unsupported envelope version')
      return
    }
    if (hello.instanceId !== this.instanceId) {
      conn.close(CLOSE_BAD_INSTANCE, 'instanceId mismatch')
      return
    }
    if (hello.role === 'controller') {
      // Slice 2 capability; refuse cleanly so clients can detect availability.
      conn.close(CLOSE_CONTROL_UNAVAILABLE, 'control channel not available')
      return
    }
    if (hello.role !== 'producer' && hello.role !== 'consumer') {
      conn.close(CLOSE_BAD_HELLO, 'unknown role')
      return
    }

    this.roles.set(conn, hello.role)

    if (hello.role === 'consumer') {
      const ready: ReadyFrame = {
        type: 'ready',
        runId: this.runId,
        bufferedFrom: this.ring.bufferedFrom,
        engine: this.engine
      }
      conn.send(ready)
      // Replay the retained ring so a mid-session consumer sees recent history.
      for (const event of this.ring.snapshot()) {
        conn.send({type: 'log', event})
      }
    }
  }

  private fanOut(frame: ServerFrame): void {
    for (const [conn, role] of this.roles) {
      if (role !== 'consumer') continue
      try {
        conn.send(frame)
      } catch {
        // A failing consumer must not break fan-out to the others; the adapter
        // is responsible for tearing down a dead socket.
      }
    }
  }

  private countRole(role: BridgeRole): number {
    let n = 0
    for (const r of this.roles.values()) if (r === role) n++
    return n
  }
}

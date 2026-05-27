/**
 * Transport-agnostic agent-bridge broker (Slices 1–2: logs + act).
 *
 * Knows nothing about WebSockets — it operates on abstract connections so the
 * core fan-out/replay/gap/command logic is unit-testable without a socket. The
 * ws adapter (ws-control-server.ts) wraps each socket as a BridgeConnection and
 * forwards parsed frames here.
 *
 * Slice 1 handles producer → ring/file → consumers, with honest `gap` frames.
 * Slice 2 adds the `controller` role: it issues `command` frames that the broker
 * routes to the executor (the in-bundle agent, which connects as a producer),
 * correlates the `result` back by cmdId, enforces auth (instanceId + allow-control;
 * eval additionally needs allow-eval + a matching session token), and appends an
 * audit line to actions.ndjson for every command. Reuses Slice 1's socket,
 * handshake, and ring untouched.
 */

import {LogRingBuffer} from './ring-buffer'
import type {LogsFileWriter} from './logs-file'
import {
  fnv1aHex,
  type ActionRecord,
  type ActionsSink
} from './actions-file'
import {
  CONTROL_ENVELOPE_VERSION,
  type AnyFrame,
  type BridgeRole,
  type BridgeTarget,
  type CommandFrame,
  type CommandOp,
  type HelloFrame,
  type IncomingLogEvent,
  type ReadyFrame,
  type ResultFrame,
  type ServerFrame
} from './contracts'

export interface BridgeConnection {
  readonly id: string
  /** The broker may also push `command` frames to the executor connection. */
  send(frame: ServerFrame | CommandFrame): void
  close(code?: number, reason?: string): void
}

export interface BridgeBrokerOptions {
  instanceId: string
  runId: string
  engine?: 'chromium' | 'firefox'
  ring?: LogRingBuffer
  file?: LogsFileWriter
  /** Slice 2: enables the controller role and bounded act (storage/reload/open/tabs). */
  allowControl?: boolean
  /** Slice 2: enables `eval` (additionally requires a matching session token). */
  allowEval?: boolean
  /** The per-session 0600 token a controller must present in its hello to eval. */
  controlToken?: string
  /** Audit sink. Every command resolution writes one line here. */
  actions?: ActionsSink
  /** Author-mode writes the raw eval source to the audit; default hashes it. */
  authorMode?: boolean
  /** Injectable for tests. */
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void
}

// Close codes (4000–4999 are application-defined for WebSocket).
export const CLOSE_BAD_INSTANCE = 4001
export const CLOSE_BAD_HELLO = 4002
export const CLOSE_CONTROL_UNAVAILABLE = 4003

export const DEFAULT_CMD_TIMEOUT_MS = 5000
export const MAX_CMD_TIMEOUT_MS = 30_000

const CONTROL_OPS: ReadonlySet<CommandOp> = new Set([
  'eval',
  'storage.get',
  'storage.set',
  'reload',
  'open',
  'tabs.query',
  'inspect'
])

interface Pending {
  controller: BridgeConnection
  op: CommandOp
  target: BridgeTarget
  issuedAt: number
  timer: ReturnType<typeof setTimeout>
  principal: string
  exprHash?: string
  expr?: string
}

export class BridgeBroker {
  private readonly instanceId: string
  private readonly runId: string
  private readonly engine?: 'chromium' | 'firefox'
  private readonly ring: LogRingBuffer
  private readonly file?: LogsFileWriter
  private readonly roles = new Map<BridgeConnection, BridgeRole>()

  private readonly allowControl: boolean
  private readonly allowEval: boolean
  private readonly controlToken?: string
  private readonly actions?: ActionsSink
  private readonly authorMode: boolean
  private readonly now: () => number
  private readonly setTimer: (
    fn: () => void,
    ms: number
  ) => ReturnType<typeof setTimeout>
  private readonly clearTimer: (handle: ReturnType<typeof setTimeout>) => void
  /** Controllers that presented a valid eval token at hello. */
  private readonly evalAllowed = new Map<BridgeConnection, boolean>()
  private readonly pending = new Map<string, Pending>()

  constructor(options: BridgeBrokerOptions) {
    this.instanceId = options.instanceId
    this.runId = options.runId
    this.engine = options.engine
    this.ring = options.ring ?? new LogRingBuffer()
    this.file = options.file
    this.allowControl = options.allowControl ?? false
    this.allowEval = options.allowEval ?? false
    this.controlToken = options.controlToken
    this.actions = options.actions
    this.authorMode = options.authorMode ?? false
    this.now = options.now ?? (() => Date.now())
    this.setTimer =
      options.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearTimer = options.clearTimer ?? ((h) => clearTimeout(h))
  }

  get consumerCount(): number {
    return this.countRole('consumer')
  }

  get producerCount(): number {
    return this.countRole('producer')
  }

  get controllerCount(): number {
    return this.countRole('controller')
  }

  get pendingCount(): number {
    return this.pending.size
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
      case 'command':
        if (this.roles.get(conn) === 'controller') {
          this.onCommand(conn, frame)
        }
        return
      case 'result':
        // Only the executor (a producer connection) resolves commands.
        if (this.roles.get(conn) === 'producer') {
          this.onResult(frame)
        }
        return
      default:
        return
    }
  }

  onClose(conn: BridgeConnection): void {
    this.roles.delete(conn)
    this.evalAllowed.delete(conn)
    // Drop any commands this controller was awaiting (no result to route).
    for (const [cmdId, p] of this.pending) {
      if (p.controller === conn) {
        this.clearTimer(p.timer)
        this.pending.delete(cmdId)
      }
    }
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
      if (!this.allowControl) {
        // Control was not enabled this session (no --allow-control). Refuse
        // cleanly so the client can detect availability.
        conn.close(CLOSE_CONTROL_UNAVAILABLE, 'control channel not available')
        return
      }
      this.roles.set(conn, 'controller')
      // eval is gated independently: it needs --allow-eval AND a token match.
      this.evalAllowed.set(
        conn,
        this.allowEval &&
          !!hello.token &&
          !!this.controlToken &&
          hello.token === this.controlToken
      )
      conn.send(this.controllerReady())
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

  /** ready frame for a controller: negotiated, auth-aware capabilities. */
  private controllerReady(): ReadyFrame {
    const isFirefox = this.engine === 'firefox'
    return {
      type: 'ready',
      runId: this.runId,
      bufferedFrom: this.ring.bufferedFrom,
      engine: this.engine,
      capabilities: {
        // Reported true only when the engine supports it AND it is enabled this
        // session — so a controller's "can I?" check is honest, not aspirational.
        eval: this.allowEval,
        storage: this.allowControl,
        reload: this.allowControl,
        open: this.allowControl
          ? isFirefox
            ? ['popup', 'options']
            : ['popup', 'options', 'sidebar']
          : [],
        // Closed-shadow piercing is the CDP path — Chromium only.
        deepDom: this.engine === 'chromium'
      }
    }
  }

  private onCommand(controller: BridgeConnection, cmd: CommandFrame): void {
    const principal = 'controller'
    const isEval = cmd.op === 'eval'
    const exprHash =
      isEval && typeof cmd.args?.expression === 'string'
        ? fnv1aHex(cmd.args.expression as string)
        : undefined
    const expr =
      isEval && this.authorMode && typeof cmd.args?.expression === 'string'
        ? (cmd.args.expression as string)
        : undefined

    const deny = (name: string, message: string) => {
      const result: ResultFrame = {type: 'result', cmdId: cmd.cmdId, ok: false, error: {name, message}}
      controller.send(result)
      this.audit({
        cmdId: cmd.cmdId,
        op: cmd.op,
        target: cmd.target,
        ok: false,
        durationMs: 0,
        principal,
        exprHash,
        expr,
        errorName: name
      })
    }

    if (!CONTROL_OPS.has(cmd.op)) {
      deny('BadRequest', `unknown op: ${String(cmd.op)}`)
      return
    }
    if (isEval && !this.evalAllowed.get(controller)) {
      deny(
        'Forbidden',
        'eval requires --allow-eval and a valid session token in the hello'
      )
      return
    }

    const executor = this.firstExecutor()
    if (!executor) {
      deny('Unavailable', 'no executor connected (is the dev session running?)')
      return
    }

    const timeoutMs = Math.min(
      Math.max(cmd.timeoutMs ?? DEFAULT_CMD_TIMEOUT_MS, 1),
      MAX_CMD_TIMEOUT_MS
    )
    const timer = this.setTimer(() => this.onTimeout(cmd.cmdId), timeoutMs)
    this.pending.set(cmd.cmdId, {
      controller,
      op: cmd.op,
      target: cmd.target,
      issuedAt: this.now(),
      timer,
      principal,
      exprHash,
      expr
    })

    // Forward to the executor. The eval token is never relayed onward.
    executor.send({
      type: 'command',
      cmdId: cmd.cmdId,
      op: cmd.op,
      target: cmd.target,
      args: cmd.args,
      timeoutMs
    })
  }

  private onResult(result: ResultFrame): void {
    const p = this.pending.get(result.cmdId)
    if (!p) return // unknown/duplicate/late — ignore
    this.clearTimer(p.timer)
    this.pending.delete(result.cmdId)
    p.controller.send(result)
    this.audit({
      cmdId: result.cmdId,
      op: p.op,
      target: p.target,
      ok: result.ok,
      durationMs: result.durationMs ?? this.now() - p.issuedAt,
      principal: p.principal,
      exprHash: p.exprHash,
      expr: p.expr,
      errorName: result.ok ? undefined : result.error?.name
    })
  }

  private onTimeout(cmdId: string): void {
    const p = this.pending.get(cmdId)
    if (!p) return
    this.pending.delete(cmdId)
    const result: ResultFrame = {
      type: 'result',
      cmdId,
      ok: false,
      error: {name: 'Timeout', message: 'command timed out'}
    }
    p.controller.send(result)
    this.audit({
      cmdId,
      op: p.op,
      target: p.target,
      ok: false,
      durationMs: this.now() - p.issuedAt,
      principal: p.principal,
      exprHash: p.exprHash,
      expr: p.expr,
      errorName: 'Timeout'
    })
  }

  private firstExecutor(): BridgeConnection | null {
    for (const [conn, role] of this.roles) {
      if (role === 'producer') return conn
    }
    return null
  }

  private audit(record: Omit<ActionRecord, 'v' | 'ts'>): void {
    if (!this.actions) return
    const line: ActionRecord = {
      v: 1,
      ts: new Date(this.now()).toISOString(),
      ...record
    }
    // Drop undefined optionals so the line stays schema-clean.
    if (line.exprHash === undefined) delete line.exprHash
    if (line.expr === undefined) delete line.expr
    if (line.errorName === undefined) delete line.errorName
    if (line.durationMs === undefined) delete line.durationMs
    this.actions.write(line)
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

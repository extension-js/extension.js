// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {type ActionRecord, type ActionsSink, fnv1aHex} from './actions-file'
import {
  type AnyFrame,
  type BridgeRole,
  type BridgeTarget,
  CONTROL_ENVELOPE_VERSION,
  type CommandFrame,
  type CommandOp,
  type DevReloadKind,
  type HelloFrame,
  type IncomingLogEvent,
  type ReadyFrame,
  type ReloadFrame,
  type ResultFrame,
  type ServerFrame
} from './contracts'
import type {LogsFileWriter} from './logs-file'
import {LogRingBuffer} from './ring-buffer'

export interface BridgeConnection {
  readonly id: string
  send(frame: ServerFrame | CommandFrame): void
  close(code?: number, reason?: string): void
}

export interface BridgeBrokerOptions {
  instanceId: string
  runId: string
  engine?: 'chromium' | 'firefox'
  ring?: LogRingBuffer
  file?: LogsFileWriter
  allowControl?: boolean
  allowEval?: boolean
  controlToken?: string
  actions?: ActionsSink
  authorMode?: boolean
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void
  // Called once when the extension's SW first connects over the control channel;
  // stamps a distinct "runtime attached" signal into ready.json.
  onExecutorAttached?: () => void
}

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

// Why a controller's eval is (or isn't) permitted, decided once at hello;
// each denial names its specific cause instead of a catch-all.
type EvalGate = 'ok' | 'eval-disabled' | 'no-token' | 'token-mismatch'

const EVAL_DENIED: Record<Exclude<EvalGate, 'ok'>, string> = {
  'eval-disabled':
    'eval is disabled for this session: restart the dev session with --allow-eval',
  'no-token':
    'eval session token missing from the hello: the controller could not ' +
    'read the session token under .extension-js/, run the command against ' +
    'the same project root the dev session was started in',
  'token-mismatch':
    'eval session token mismatch: the token on disk belongs to another ' +
    'session, reconnect the controller, or restart the dev session'
}

// Why no executor is connected, in priority order; each cause has a different
// remediation. The 'no executor connected' prefix is load-bearing for specs.
type ExecutorAbsence =
  | 'stale-resync-pending'
  | 'never-connected'
  | 'recently-disconnected'

const EXECUTOR_ABSENT: Record<ExecutorAbsence, (secs?: number) => string> = {
  'stale-resync-pending': (secs) =>
    'no executor connected: a service worker from a previous dev session ' +
    `dialed in ${secs}s ago and was told to full-reload; the resynced ` +
    'worker should connect shortly, retry in a few seconds',
  'never-connected': () =>
    'no executor connected: no extension service worker has connected since ' +
    'this dev session started. The browser may still be launching, the ' +
    "profile's cached service worker may predate this session, or the " +
    'session runs with --no-browser; check ready.json status and retry',
  'recently-disconnected': (secs) =>
    "no executor connected: the extension's service worker disconnected" +
    `${secs != null ? ` ${secs}s ago` : ''}, MV3 workers idle out and ` +
    'reconnect on their own, or the browser may have exited (see ' +
    'browserExitedAt in dist/extension-js/<browser>/ready.json); retry, and ' +
    'if it persists reload the extension or restart the dev session'
}

/** Stale-resync hint window: a full-reload resync lands within seconds, so
 * past this the stale hello no longer explains the absence. */
const STALE_RESYNC_HINT_MS = 30_000

// How long after session start to stay quiet about a reload that reached zero
// producers: during startup that's expected; past it, surface once.
const UNDELIVERED_RELOAD_GRACE_MS = 10_000

// Operator-facing warnings for a dev-loop reload that reached no page, keyed
// by why no producer is attached. The dev server prints; the broker decides.
const UNDELIVERED_RELOAD_WARN: Record<
  'never-connected' | 'recently-disconnected',
  string
> = {
  'never-connected':
    'SW not attached, your edit compiled but no page received it. The ' +
    "extension's service worker has not connected to the dev server this " +
    'session (a heavy ad/bot-laden page, an auth wall, or a profile-cached ' +
    'worker can prevent it). Reloads resume automatically once it connects.',
  'recently-disconnected':
    'SW not attached, your edit compiled but no page received it. The ' +
    "extension's service worker disconnected (MV3 workers idle out, or the " +
    'browser may have exited). Reloads resume automatically once it reconnects.'
}

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
  private readonly evalGate = new Map<BridgeConnection, EvalGate>()
  private readonly pending = new Map<string, Pending>()
  private staleResyncTimes: number[] = []
  private producerEverConnected = false
  // Broker clock at session start, the anchor for the startup grace window.
  private readonly sessionStartedAt: number
  // Dedup: the absence kind last warned about for an undelivered reload.
  // Cleared on producer attach so warnings fire once per attach transition.
  private lastUndeliveredWarnKind:
    | 'never-connected'
    | 'recently-disconnected'
    | null = null
  /** Fired once, on the first producer hello, to stamp ready.json. */
  private readonly onExecutorAttached?: () => void
  private lastProducerDisconnectedAt: number | null = null
  // When the last stale-instance producer hello arrived; diagnosis state,
  // stamped even for rate-limited hellos (unlike staleResyncTimes).
  private lastStaleHelloAt: number | null = null
  // Latest reload broadcast not yet provably delivered. Latched until a producer
  // confirms (reload-ack for content scripts) or the next producer hello.
  private pendingReload?: ReloadFrame

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
    this.onExecutorAttached = options.onExecutorAttached
    this.now = options.now ?? (() => Date.now())
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearTimer = options.clearTimer ?? ((h) => clearTimeout(h))
    this.sessionStartedAt = this.now()
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
      case 'reload-ack':
        // Reinjection provably ran in the SW: release the delivery latch so
        // the next producer hello doesn't replay an already-applied reload.
        if (
          this.roles.get(conn) === 'producer' &&
          this.pendingReload?.reloadType === frame.reloadType
        ) {
          this.pendingReload = undefined
        }
        return
      default:
        return
    }
  }

  onClose(conn: BridgeConnection): void {
    const role = this.roles.get(conn)
    this.roles.delete(conn)
    this.evalGate.delete(conn)

    if (role === 'producer') {
      this.lastProducerDisconnectedAt = this.now()
    }

    // Drop any commands this controller was awaiting (no result to route).
    for (const [cmdId, p] of this.pending) {
      if (p.controller === conn) {
        this.clearTimer(p.timer)
        this.pending.delete(cmdId)
      }
    }
  }

  // Dev-loop reload broadcast for the controller-less (--no-browser) path. NOT
  // gated on allowControl; returns the number of producers notified.
  broadcastReload(instruction: {
    type: DevReloadKind
    changedContentScriptEntries?: string[]
    label?: string
    changedFiles?: string[]
  }): number {
    const frame: ReloadFrame = {
      type: 'reload',
      reloadType: instruction.type,
      changedContentScriptEntries: instruction.changedContentScriptEntries,
      label: instruction.label,
      changedFiles: instruction.changedFiles
    }

    let notified = 0
    for (const [conn, role] of this.roles) {
      if (role !== 'producer') continue
      try {
        conn.send(frame)
        notified++
      } catch {
        // A failing producer socket must not break the broadcast; the adapter
        // tears down dead sockets on error/close.
      }
    }

    // Latch the newest instruction so the next producer hello still applies it.
    // Content-scripts reloads stay latched until reload-ack; full/SW clear on write.
    this.pendingReload =
      notified === 0 || frame.reloadType === 'content-scripts'
        ? frame
        : undefined

    return notified
  }

  // After a broadcast reached zero producers, decide whether to warn once that
  // the edit isn't reaching any page (grace-gated, deduped per attach state).
  undeliveredReloadWarning(): string | null {
    const now = this.now()

    // Cold start: the browser may still be launching and the SW connecting, so
    // a zero-delivery edit is expected. Stay quiet until the grace window ends.
    if (now - this.sessionStartedAt < UNDELIVERED_RELOAD_GRACE_MS) return null

    // A stale producer just resynced; the restarted worker reconnects in seconds
    // and picks up the latched edit, so warning now would cry wolf.
    if (
      this.lastStaleHelloAt != null &&
      now - this.lastStaleHelloAt < STALE_RESYNC_HINT_MS
    ) {
      return null
    }

    const kind = this.producerEverConnected
      ? 'recently-disconnected'
      : 'never-connected'

    // One warning per attach-state transition, not once per save.
    if (this.lastUndeliveredWarnKind === kind) return null
    this.lastUndeliveredWarnKind = kind

    return UNDELIVERED_RELOAD_WARN[kind]
  }

  // MV3 SW keepalive: any WebSocket message resets its ~30s idle timer, so ping
  // on a shorter interval or reload broadcasts reach nothing between edits.
  pingProducers(): number {
    let pinged = 0
    for (const [conn, role] of this.roles) {
      if (role !== 'producer') continue
      try {
        conn.send({type: 'ping'})
        pinged++
      } catch {
        // Dead sockets are torn down by the adapter on error/close.
      }
    }
    return pinged
  }

  ingestLog(incoming: IncomingLogEvent): void {
    // Producers stamp the only id the SW knows (its instanceId); the server owns
    // the session identity, so rows are normalized to ready.json's runId here.
    const event = this.ring.push({...incoming, runId: this.runId})
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

  /** At most 3 stale-producer resync reloads per rolling minute. */
  private allowStaleProducerResync(): boolean {
    const now = this.now()
    this.staleResyncTimes = this.staleResyncTimes.filter(
      (t) => now - t < 60_000
    )
    if (this.staleResyncTimes.length >= 3) return false
    this.staleResyncTimes.push(now)
    return true
  }

  private onHello(conn: BridgeConnection, hello: HelloFrame): void {
    if (hello.v !== CONTROL_ENVELOPE_VERSION) {
      conn.close(CLOSE_BAD_HELLO, 'unsupported envelope version')
      return
    }

    if (hello.instanceId !== this.instanceId) {
      // A stale instanceId is a live SW from a PREVIOUS session (Chrome caches SW
      // scripts); tell it to full-reload so it re-reads the fresh bundle. Storm-guarded.
      if (hello.role === 'producer') {
        // Diagnosis state, stamped even when the resync below is rate-limited:
        // a stale hello explains a later "no executor connected" either way.
        this.lastStaleHelloAt = this.now()

        if (this.allowStaleProducerResync()) {
          if (this.authorMode) {
            console.log(
              `[control-bridge] stale producer (instance ${hello.instanceId}) → full-reload resync`
            )
          }
          conn.send({
            type: 'reload',
            reloadType: 'full',
            label: 'extension (resyncing previous dev session)'
          })
        }
      }
      conn.close(CLOSE_BAD_INSTANCE, 'instanceId mismatch')
      return
    }

    if (hello.role === 'controller') {
      if (!this.allowControl) {
        // Control was not enabled this session (no --allow-control).
        // Refuse cleanly so the client can detect availability
        conn.close(CLOSE_CONTROL_UNAVAILABLE, 'control channel not available')
        return
      }

      this.roles.set(conn, 'controller')

      // eval is gated independently: --allow-eval AND a token match; the failing leg
      // is recorded per connection so a later denial names the actual cause.
      this.evalGate.set(conn, this.gateEval(hello.token))
      conn.send(this.controllerReady())
      return
    }

    if (hello.role !== 'producer' && hello.role !== 'consumer') {
      conn.close(CLOSE_BAD_HELLO, 'unknown role')
      return
    }

    this.roles.set(conn, hello.role)

    if (hello.role === 'producer') {
      this.producerEverConnected = true
      // A producer is back: clear the undelivered-reload dedup so a later detach
      // can warn again (the attach state genuinely transitioned).
      this.lastUndeliveredWarnKind = null
      // Stamp ready.json's runtime signal on EVERY producer hello: idempotent, and
      // firing each time closes the startup race where the callback wasn't wired yet.
      try {
        this.onExecutorAttached?.()
      } catch {
        // best-effort stamp; never let it disturb the hello path
      }
    }

    if (hello.role === 'producer' && this.pendingReload) {
      // An edit landed while no SW was connected (idle-stopped or not yet
      // started). Deliver the latched instruction so that edit still applies.
      const frame = this.pendingReload
      this.pendingReload = undefined
      conn.send(frame)
    }

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

  // Name WHY no producer is connected: fresh stale-instance hello > nothing ever
  // connected > a producer was here and left.
  private diagnoseExecutorAbsence(): string {
    const now = this.now()

    if (
      this.lastStaleHelloAt != null &&
      now - this.lastStaleHelloAt < STALE_RESYNC_HINT_MS
    ) {
      return EXECUTOR_ABSENT['stale-resync-pending'](
        Math.round((now - this.lastStaleHelloAt) / 1000)
      )
    }

    if (!this.producerEverConnected) {
      return EXECUTOR_ABSENT['never-connected']()
    }

    return EXECUTOR_ABSENT['recently-disconnected'](
      this.lastProducerDisconnectedAt != null
        ? Math.round((now - this.lastProducerDisconnectedAt) / 1000)
        : undefined
    )
  }

  private gateEval(token: string | undefined): EvalGate {
    if (!this.allowEval) return 'eval-disabled'
    if (!token) return 'no-token'
    // No server-side token with --allow-eval set shouldn't happen; treat as a
    // mismatch since no presented token can be valid.
    if (!this.controlToken || token !== this.controlToken) {
      return 'token-mismatch'
    }
    return 'ok'
  }

  private controllerReady(): ReadyFrame {
    const isFirefox = this.engine === 'firefox'
    return {
      type: 'ready',
      runId: this.runId,
      bufferedFrom: this.ring.bufferedFrom,
      engine: this.engine,
      capabilities: {
        eval: this.allowEval,
        storage: this.allowControl,
        reload: this.allowControl,
        open: this.allowControl
          ? isFirefox
            ? ['popup', 'options', 'action', 'command']
            : ['popup', 'options', 'sidebar', 'action', 'command']
          : [],
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
      const result: ResultFrame = {
        type: 'result',
        cmdId: cmd.cmdId,
        ok: false,
        error: {name, message}
      }
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
    const evalGate = this.evalGate.get(controller) ?? 'eval-disabled'
    if (isEval && evalGate !== 'ok') {
      deny('Forbidden', EVAL_DENIED[evalGate])
      return
    }

    const executor = this.firstExecutor()
    if (!executor) {
      deny('Unavailable', this.diagnoseExecutorAbsence())
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

    // Ignore unknown/duplicate/late
    if (!p) {
      return
    }

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
        // A failing consumer must not break fan-out to the others.
        // The adapter is responsible for tearing down a dead socket
      }
    }
  }

  private countRole(role: BridgeRole): number {
    let n = 0

    for (const r of this.roles.values()) if (r === role) n++

    return n
  }
}

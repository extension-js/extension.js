// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import EventEmitter from 'node:events'
import net from 'node:net'
import {
  CODES,
  humanError,
  humanLine,
  isDebug
} from '../../../../helpers/messaging'
import * as messages from '../../../browsers-lib/messages'
import {buildRdpFrame, parseRdpFrame} from './rdp-wire'

type Deferred = {
  resolve: (v?: unknown) => void
  reject: (r?: unknown) => void
}

type ActiveEntry = {
  deferred: Deferred
  timer?: ReturnType<typeof setTimeout>
}

type RdpMessage = {
  from?: string
  type?: string
  error?: unknown
  applicationType?: unknown
}

// Packets Firefox pushes on its own. The wire has no request ids, so these
// are told apart by type and never taken as the reply of an in-flight request.
const UNSOLICITED_PACKET_TYPES = new Set([
  'tabListChanged',
  'addonListChanged',
  'consoleAPICall',
  'pageError',
  'logMessage',
  'evaluationResult',
  'tabNavigated',
  'tabDetached',
  'frameUpdate',
  'target-available-form',
  'target-destroyed-form',
  'newSource',
  'documentLoad'
])

export function isRootGreeting(message: RdpMessage): boolean {
  return message.from === 'root' && typeof message.applicationType === 'string'
}

export function isUnsolicitedPacket(message: RdpMessage): boolean {
  const type = message.type

  if (
    typeof type === 'string' &&
    (UNSOLICITED_PACKET_TYPES.has(type) || type.startsWith('networkEvent'))
  ) {
    return true
  }

  return isRootGreeting(message)
}

// Per-request safety timeout: Firefox occasionally never replies to an RDP
// request, hanging that actor's queue forever; generous so only true hangs trip.
function rdpRequestTimeoutMs(): number {
  const raw = parseInt(
    String(process.env.EXTENSION_RDP_REQUEST_TIMEOUT_MS || ''),
    10
  )

  return Number.isFinite(raw) && raw > 0 ? raw : 30000
}

// An 'error' emitted with nobody listening throws out of the socket's data
// handler and ends the dev process, so protocol garbage is logged instead.
export function surfaceTransportError(
  emitter: EventEmitter,
  error: unknown
): void {
  if (emitter.listenerCount('error') > 0) {
    emitter.emit('error', error)

    return
  }

  humanError(error instanceof Error ? error.message : String(error))
}

// Each way the wire fails carries its own code, so the contract a launch
// stamps can tell a socket that closed from a browser that spoke garbage.
function closedError(message: string): Error {
  return Object.assign(new Error(message), {
    code: CODES.E_BROWSER_CONNECTION_CLOSED
  })
}

function protocolError(message: string): Error {
  return Object.assign(new Error(message), {code: CODES.E_RDP_PROTOCOL})
}

export class RdpTransport extends EventEmitter {
  private conn?: net.Socket
  private incoming: Buffer = Buffer.alloc(0)
  private active = new Map<string, ActiveEntry>()
  private pending: Array<{
    to: string
    payload: Record<string, unknown>
    deferred: Deferred
  }> = []
  private lost = false
  private greetingPending?: (error?: Error) => void

  // Firefox pushes the root greeting the moment it accepts the socket, so
  // the connection counts as open only once that packet has been consumed.
  async connect(port: number, host: string = '127.0.0.1'): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const timeoutMs = rdpRequestTimeoutMs()
      const timer = setTimeout(() => {
        this.settleGreeting(
          Object.assign(
            new Error(
              `Firefox sent no RDP greeting on port ${port} within ${timeoutMs}ms`
            ),
            {code: CODES.E_BROWSER_START_TIMEOUT}
          )
        )

        this.onConnectionLost()
      }, timeoutMs)
      timer.unref?.()

      this.greetingPending = (error) => {
        clearTimeout(timer)
        this.greetingPending = undefined

        if (error) {
          reject(error)

          return
        }

        if (isDebug()) {
          humanLine(messages.firefoxRdpClientConnected(host, port))
        }

        resolve()
      }

      try {
        const c = net.createConnection({host, port})
        this.conn = c
        this.lost = false
        c.on('data', this.onData.bind(this))
        c.on('error', (err) => {
          if (!this.greetingPending) return

          this.conn = undefined
          this.settleGreeting(err)
        })

        c.on('end', () => this.onConnectionLost())
        // A reset fires 'error' then 'close' and never 'end'; only 'close' is
        // guaranteed for every way the socket can die.
        c.on('close', () => this.onConnectionLost())
        c.on('timeout', this.onTimeout.bind(this))
      } catch (err) {
        this.settleGreeting(err as Error)
      }
    })
  }

  private settleGreeting(error?: Error): void {
    this.greetingPending?.(error)
  }

  disconnect(): void {
    const closed = closedError(messages.messagingClientClosedError('firefox'))
    this.settleGreeting(closed)
    const c = this.conn
    if (!c) return

    this.conn = undefined
    this.lost = true
    this.incoming = Buffer.alloc(0)
    c.removeAllListeners()
    c.on('error', () => {
      // Ignore
    })

    c.end()
    this.rejectAll(closed)
  }

  private rejectAll(error: Error): void {
    for (const entry of this.active.values()) {
      if (entry.timer) clearTimeout(entry.timer)

      entry.deferred.reject(error)
    }

    this.active.clear()
    for (const {deferred} of this.pending) deferred.reject(error)
    this.pending = []
  }

  async request(
    payload: Record<string, unknown> & {to?: string}
  ): Promise<unknown> {
    const to = typeof payload?.to === 'string' ? payload.to : 'root'
    const frame = {...payload, to}

    return await new Promise((resolve, reject) => {
      this.pending.push({to, payload: frame, deferred: {resolve, reject}})
      this.flush()
    })
  }

  private flush(): void {
    this.pending = this.pending.filter(({to, payload, deferred}) => {
      if (this.active.has(to)) return true

      if (!this.conn) {
        // Reject and drop rather than throwing out of the filter callback,
        // which would abort iteration and leave `pending` in a corrupt state.
        deferred.reject(closedError(messages.connectionClosedError('firefox')))

        return false
      }

      try {
        this.conn.write(buildRdpFrame(payload))
        this.expectReply(to, deferred)
      } catch (err) {
        deferred.reject(err)
      }

      return false
    })
  }

  private expectReply(to: string, deferred: Deferred): void {
    if (this.active.has(to)) {
      throw protocolError(
        messages.targetActorHasActiveRequestError('firefox', to)
      )
    }

    const timeoutMs = rdpRequestTimeoutMs()
    const timer = setTimeout(() => {
      const entry = this.active.get(to)
      if (!entry) return

      this.active.delete(to)
      entry.deferred.reject(
        new Error(`RDP request to "${to}" timed out after ${timeoutMs}ms`)
      )

      this.flush()
    }, timeoutMs)
    timer.unref?.()
    this.active.set(to, {deferred, timer})
  }

  private onData(buf: Buffer): void {
    this.incoming = Buffer.concat([this.incoming, buf])
    while (this.readMessage());
  }

  private readMessage(): boolean {
    const {remainingData, parsedMessage, error, fatal} = parseRdpFrame(
      this.incoming
    )
    this.incoming = remainingData

    if (error) {
      const malformed = protocolError(
        messages.parsingPacketError('firefox', error)
      )
      surfaceTransportError(this, malformed)

      // A broken length prefix leaves no way to find the next frame boundary;
      // the connection is unusable, so fail its requests instead of waiting.
      if (fatal) this.onConnectionLost(malformed)

      return !fatal
    }

    if (!parsedMessage) return false

    this.handleMessage(parsedMessage as RdpMessage)

    return true
  }

  private handleMessage(message: RdpMessage) {
    const from = message.from

    if (!from) {
      surfaceTransportError(
        this,
        protocolError(messages.messageWithoutSenderError('firefox', message))
      )

      return
    }

    if (this.greetingPending && isRootGreeting(message)) this.settleGreeting()

    const entry = isUnsolicitedPacket(message)
      ? undefined
      : this.active.get(from)

    if (entry) {
      this.active.delete(from)
      if (entry.timer) clearTimeout(entry.timer)
      if (message.error) entry.deferred.reject(message)
      else entry.deferred.resolve(message)

      this.flush()

      return
    }

    this.emit('message', message)
  }

  // Every way a connection dies lands here once (FIN, reset, fatal frame):
  // in-flight and queued requests get the closed reason, the dead socket is
  // dropped so later requests fail fast, and 'end' lets the owner reconnect.
  // A greeting still pending learns the cause when the frame itself was bad.
  private onConnectionLost(cause?: Error): void {
    if (this.lost) return

    this.lost = true
    const c = this.conn
    this.conn = undefined
    this.incoming = Buffer.alloc(0)

    if (c) {
      c.removeAllListeners()
      c.on('error', () => {
        // Ignore
      })

      c.destroy()
    }

    const closed = closedError(messages.messagingClientClosedError('firefox'))
    this.settleGreeting(cause ?? closed)
    this.rejectAll(closed)
    this.emit('end')
  }

  private onTimeout(): void {
    this.emit('timeout')
  }
}

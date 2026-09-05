// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import EventEmitter from 'node:events'
import net from 'node:net'
import {humanError, humanLine, isDebug} from '../../../../helpers/messaging'
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

  async connect(port: number, host: string = '127.0.0.1'): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let connected = false
      try {
        const c = net.createConnection({host, port}, () => {
          connected = true
          if (isDebug()) {
            humanLine(messages.firefoxRdpClientConnected(host, port))
          }
          resolve()
        })
        this.conn = c
        this.lost = false
        c.on('data', this.onData.bind(this))
        c.on('error', (err) => {
          if (connected) return
          this.conn = undefined
          reject(err)
        })
        c.on('end', this.onConnectionLost.bind(this))
        // A reset fires 'error' then 'close' and never 'end'; only 'close' is
        // guaranteed for every way the socket can die.
        c.on('close', this.onConnectionLost.bind(this))
        c.on('timeout', this.onTimeout.bind(this))
      } catch (err) {
        reject(err)
      }
    })
  }

  disconnect(): void {
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
    this.rejectAll(new Error(messages.messagingClientClosedError('firefox')))
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
        deferred.reject(new Error(messages.connectionClosedError('firefox')))
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
      throw new Error(messages.targetActorHasActiveRequestError('firefox', to))
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
      surfaceTransportError(
        this,
        new Error(messages.parsingPacketError('firefox', error))
      )
      // A broken length prefix leaves no way to find the next frame boundary;
      // the connection is unusable, so fail its requests instead of waiting.
      if (fatal) this.onConnectionLost()
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
        new Error(messages.messageWithoutSenderError('firefox', message))
      )
      return
    }
    const entry = this.active.get(from)
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
  private onConnectionLost(): void {
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
    this.rejectAll(new Error(messages.messagingClientClosedError('firefox')))
    this.emit('end')
  }

  private onTimeout(): void {
    this.emit('timeout')
  }
}

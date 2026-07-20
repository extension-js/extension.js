// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import EventEmitter from 'events'
import net from 'net'
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

// Per-request safety timeout. Firefox occasionally never replies to an RDP
// request; without a timeout that actor's deferred (and every queued request to
// it) would hang forever. Generous default so only true hangs trip it
function rdpRequestTimeoutMs(): number {
  const raw = parseInt(
    String(process.env.EXTENSION_RDP_REQUEST_TIMEOUT_MS || ''),
    10
  )
  return Number.isFinite(raw) && raw > 0 ? raw : 30000
}

export class RdpTransport extends EventEmitter {
  private conn?: net.Socket
  private incoming: Buffer = Buffer.alloc(0)
  private active = new Map<string, ActiveEntry>()
  private pending: Array<{to: string; payload: any; deferred: Deferred}> = []

  async connect(port: number, host: string = '127.0.0.1'): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      try {
        const c = net.createConnection({host, port}, () => {
          if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
            console.log(messages.firefoxRdpClientConnected(host, port))
          }
          resolve()
        })
        this.conn = c
        c.on('data', this.onData.bind(this))
        c.on('error', reject)
        c.on('end', this.onEnd.bind(this))
        c.on('timeout', this.onTimeout.bind(this))
      } catch (err) {
        reject(err)
      }
    })
  }

  disconnect(): void {
    if (!this.conn) return
    this.conn.removeAllListeners()
    this.conn.end()
    const err = new Error(messages.messagingClientClosedError('firefox'))
    this.rejectAll(err)
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

  async request(payload: any & {to?: string}): Promise<unknown> {
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
      // Unblock any requests queued behind this actor.
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
      this.emit(
        'error',
        new Error(messages.parsingPacketError('firefox', error))
      )
      if (fatal) this.disconnect()
      return !fatal
    }
    if (!parsedMessage) return false
    this.handleMessage(
      parsedMessage as {from?: string; type?: string; error?: unknown}
    )
    return true
  }

  private handleMessage(message: {
    from?: string
    type?: string
    error?: unknown
  }) {
    if (!message.from) {
      this.emit(
        'error',
        new Error(messages.messageWithoutSenderError('firefox', message))
      )
      return
    }
    const entry = this.active.get(message.from)
    if (entry) {
      this.active.delete(message.from)
      if (entry.timer) clearTimeout(entry.timer)
      if (message.error) entry.deferred.reject(message)
      else entry.deferred.resolve(message)
      this.flush()
      return
    }
    this.emit('message', message)
  }

  private onEnd(): void {
    // A closed socket can never deliver replies for in-flight/queued requests.
    // Reject them so callers stop hanging, the reconnect path replaces this
    // transport without calling disconnect(), so this is the only rejection
    // point on a peer-initiated close.
    this.rejectAll(new Error(messages.messagingClientClosedError('firefox')))
    this.emit('end')
  }

  private onTimeout(): void {
    this.emit('timeout')
  }
}

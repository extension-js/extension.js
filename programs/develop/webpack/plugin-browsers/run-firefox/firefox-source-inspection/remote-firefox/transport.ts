// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import net from 'net'
import EventEmitter from 'events'
import {buildRdpFrame, parseRdpFrame} from './rdp-wire'
import * as messages from '../../../browsers-lib/messages'

type Deferred = {
  resolve: (v?: unknown) => void
  reject: (r?: unknown) => void
}

export class RdpTransport extends EventEmitter {
  private conn?: net.Socket
  private incoming: Buffer = Buffer.alloc(0)
  private active = new Map<string, Deferred>()
  private pending: Array<{to: string; payload: any; deferred: Deferred}> = []

  async connect(port: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      try {
        const c = net.createConnection({host: '127.0.0.1', port}, () => {
          if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
            console.log(messages.firefoxRdpClientConnected('127.0.0.1', port))
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
    for (const d of this.active.values()) d.reject(error)
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
      if (!this.conn) throw new Error(messages.connectionClosedError('firefox'))
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
    this.active.set(to, deferred)
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
    const deferred = this.active.get(message.from)
    if (deferred) {
      this.active.delete(message.from)
      if (message.error) deferred.reject(message)
      else deferred.resolve(message)
      this.flush()
      return
    }
    this.emit('message', message)
  }

  private onEnd(): void {
    this.emit('end')
  }

  private onTimeout(): void {
    this.emit('timeout')
  }
}

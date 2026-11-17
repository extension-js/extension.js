// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import EventEmitter from 'node:events'
import {CODES, humanError} from '../../../../helpers/messaging'
import * as messages from '../../../browsers-lib/messages'
import {evaluate as evalHelper} from './evaluate'
import * as api from './rdp-api'
import {RdpTransport, surfaceTransportError} from './transport'

const RECONNECT_MAX_ATTEMPTS = 5
const RECONNECT_RETRY_DELAY_MS = 1000

export class MessagingClient extends EventEmitter {
  private transport = new RdpTransport()
  private forwardingSetup = false
  private lastPort: number | null = null
  private reconnecting = false
  private disconnectedByUser = false
  private reconnectDelayMs = RECONNECT_RETRY_DELAY_MS

  async connect(port: number, reconnectDelayMs = RECONNECT_RETRY_DELAY_MS) {
    this.disconnectedByUser = false
    this.reconnectDelayMs = reconnectDelayMs
    await this.openTransport(port)
  }

  private async openTransport(port: number) {
    this.lastPort = port
    await this.transport.connect(port)

    if (!this.forwardingSetup) {
      this.forwardingSetup = true
      this.transport.on('message', (message) => this.emit('message', message))
      this.transport.on('error', (error) => surfaceTransportError(this, error))
      // The transport emits 'end' once for any loss, a reset included, so
      // this is the single place that decides whether to reconnect.
      this.transport.on('end', () => {
        this.emit('end')
        void this.attemptReconnect()
      })

      this.transport.on('timeout', () => this.emit('timeout'))
    }
  }

  disconnect() {
    this.disconnectedByUser = true
    this.transport.disconnect()
  }

  private async attemptReconnect() {
    if (this.disconnectedByUser || this.reconnecting || !this.lastPort) return

    this.reconnecting = true
    const port = this.lastPort

    try {
      for (let i = 0; i < RECONNECT_MAX_ATTEMPTS; i++) {
        await new Promise((r) => {
          const backoff = setTimeout(r, this.reconnectDelayMs)
          backoff.unref?.()
        })

        if (this.disconnectedByUser) return

        try {
          this.transport = new RdpTransport()
          this.forwardingSetup = false
          await this.openTransport(this.lastPort)

          if (this.disconnectedByUser) {
            this.transport.disconnect()

            return
          }

          this.emit('reconnected')

          return
        } catch {
          // Ignore
        }
      }

      this.reportReconnectGaveUp(port)
    } finally {
      this.reconnecting = false
    }
  }

  // Said once per lost connection: the loop above is its only caller and it
  // cannot run twice at the same time.
  private reportReconnectGaveUp(port: number) {
    const line = messages.debuggerReconnectGaveUp(
      'firefox',
      port,
      RECONNECT_MAX_ATTEMPTS
    )

    humanError(line)
    this.emit(
      'reconnectFailed',
      Object.assign(new Error(line), {
        code: CODES.E_BROWSER_CONNECTION_CLOSED
      })
    )
  }

  async request(requestProps: unknown) {
    if (typeof requestProps === 'string') {
      return await this.transport.request({to: 'root', type: requestProps})
    }

    if (requestProps && typeof requestProps === 'object') {
      const rp = requestProps as Record<string, unknown>
      const to = typeof rp.to === 'string' ? rp.to : 'root'

      return await this.transport.request({...rp, to})
    }

    throw Object.assign(new Error(messages.rdpInvalidRequestPayload()), {
      code: CODES.E_RDP_PROTOCOL
    })
  }

  async getTargets() {
    return await api.listTabs(this.transport)
  }

  async getTargetFromDescriptor(
    descriptorId: string
  ): Promise<{targetActor?: string; consoleActor?: string}> {
    try {
      const response = await api.getTargetFromDescriptor(
        this.transport,
        descriptorId
      )
      const targetActor =
        response?.frame?.actor ||
        response?.actor ||
        response?.target?.actor ||
        (typeof response?.tab === 'object'
          ? response?.tab?.actor
          : undefined) ||
        (typeof response?.tab === 'string' ? response?.tab : undefined)

      const consoleActor =
        response?.frame?.consoleActor ||
        response?.consoleActor ||
        response?.webConsoleActor ||
        response?.target?.consoleActor ||
        undefined

      return {targetActor, consoleActor}
    } catch {
      return {}
    }
  }

  async evaluate(
    tabId: string,
    expression: string,
    extra?: Record<string, unknown>
  ) {
    return evalHelper(this, tabId, expression, extra)
  }
}

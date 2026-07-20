// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import EventEmitter from 'node:events'
import * as messages from '../../../browsers-lib/messages'
import {evaluate as evalHelper} from './evaluate'
import * as api from './rdp-api'
import {RdpTransport} from './transport'

export class MessagingClient extends EventEmitter {
  private transport = new RdpTransport()
  private forwardingSetup = false
  private lastPort: number | null = null
  private reconnecting = false
  private disconnectedByUser = false

  async connect(port: number) {
    this.lastPort = port
    this.disconnectedByUser = false
    await this.transport.connect(port)
    if (!this.forwardingSetup) {
      this.forwardingSetup = true
      this.transport.on('message', (message) => this.emit('message', message))
      this.transport.on('error', (error) => this.emit('error', error))
      this.transport.on('end', () => {
        this.emit('end')
        this.attemptReconnect()
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
    const maxAttempts = 5
    const retryDelay = 1000
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, retryDelay))
      try {
        this.transport = new RdpTransport()
        this.forwardingSetup = false
        await this.connect(this.lastPort)
        this.reconnecting = false
        this.emit('reconnected')
        return
      } catch {
        // Ignore
      }
    }
    this.reconnecting = false
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
    throw new Error(messages.rdpInvalidRequestPayload())
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

  async evaluate(tabId: string, expression: string) {
    return evalHelper(this, tabId, expression)
  }
}

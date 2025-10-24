import {DevOptions} from '../../types/options'
import * as crypto from 'crypto'
import * as net from 'net'
import {findAvailablePortNear} from '../plugin-browsers/browsers-lib/shared-utils'
import * as messages from '../plugin-browsers/browsers-lib/messages'

export interface PortAllocation {
  port: number
  webSocketPort: number
  instanceId: string
}

// Enhanced port manager for Extension.js development server
// Supports multiple instances with unique port allocation
// Minimal local representation; no global registry
interface LocalInstanceInfo {
  instanceId: string
  port: number
  webSocketPort: number
  extensionId?: string
}

export class PortManager {
  private readonly basePort: number
  private currentInstance: LocalInstanceInfo | null = null

  constructor(
    _browser: DevOptions['browser'],
    _projectPath: string,
    basePort: number = 8080
  ) {
    this.basePort = basePort
  }

  async allocatePorts(
    _browser: DevOptions['browser'],
    _projectPath: string,
    requestedPort?: number
  ): Promise<PortAllocation> {
    try {
      // Treat 0 and invalid ports as "no preference" and fall back to basePort
      const isValidRequested =
        typeof requestedPort === 'number' &&
        requestedPort > 0 &&
        requestedPort < 65536
      const base = isValidRequested ? requestedPort : this.basePort
      const port = await findAvailablePortNear(base)
      const webSocketPort = await findAvailablePortNear(port + 1)
      const instanceId = crypto.randomBytes(8).toString('hex')

      this.currentInstance = {instanceId, port, webSocketPort}

      return {port, webSocketPort, instanceId}
    } catch (error) {
      throw error
    }
  }

  getCurrentInstance(): LocalInstanceInfo | null {
    return this.currentInstance
  }

  async updateExtensionId(extensionId: string): Promise<void> {
    if (this.currentInstance) {
      this.currentInstance.extensionId = extensionId
    }
  }

  async terminateCurrentInstance(): Promise<void> {
    this.currentInstance = null
  }

  getPortInfo(allocation: PortAllocation): string {
    return `Port: ${allocation.port}, WebSocket: ${allocation.webSocketPort}, Instance: ${allocation.instanceId.slice(0, 8)}`
  }

  async isPortInUse(port: number): Promise<boolean> {
    // Try binding to the port; if it fails, it's in use
    return new Promise((resolve) => {
      const server = net.createServer()
      server.once('error', () => resolve(true))
      server.once('listening', () => {
        server.close(() => resolve(false))
      })
      server.listen(port, '127.0.0.1')
    })
  }

  async getRunningInstances(): Promise<LocalInstanceInfo[]> {
    return this.currentInstance ? [this.currentInstance] : []
  }

  async getStats(): Promise<{
    total: number
    running: number
    terminated: number
    error: number
  }> {
    return {
      total: this.currentInstance ? 1 : 0,
      running: this.currentInstance ? 1 : 0,
      terminated: 0,
      error: 0
    }
  }
}

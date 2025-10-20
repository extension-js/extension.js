import {DevOptions} from '../types/options'
// Inline error helper to avoid central messages dependency
function portManagerErrorAllocatingPorts(error: unknown) {
  let errorMessage = String(error)
  if (errorMessage.includes('ENOENT')) {
    errorMessage +=
      '\n\nThis usually means the extension-js data directory could not be created.'
    errorMessage += '\nPossible solutions:'
    errorMessage +=
      '\n1. Check if you have write permissions to your home directory'
    errorMessage += '\n2. Try running: extension cleanup'
    errorMessage +=
      '\n3. Manually delete: ~/Library/Application Support/extension-js (macOS)'
    errorMessage += '\n4. Restart your terminal and try again'
  }
  return `Port Manager: Failed to allocate ports.\n${errorMessage}`
}
import * as crypto from 'crypto'
import {findAvailablePortNear} from '../webpack/plugin-browsers/browsers-lib/shared-utils'
import * as net from 'net'

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
      const base =
        typeof requestedPort === 'number' ? requestedPort : this.basePort
      const port = await findAvailablePortNear(base)
      const webSocketPort = await findAvailablePortNear(port + 1)
      const instanceId = crypto.randomBytes(8).toString('hex')

      this.currentInstance = {instanceId, port, webSocketPort}

      return {port, webSocketPort, instanceId}
    } catch (error) {
      console.error(portManagerErrorAllocatingPorts(error))
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

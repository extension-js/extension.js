import * as net from 'net'
import {DevOptions} from '../../commands/commands-lib/config-types'
import {InstanceManager, InstanceInfo} from '../../lib/instance-manager'

export interface PortAllocation {
  port: number
  webSocketPort: number
  instanceId: string
}

// Enhanced port manager for Extension.js development server
// Supports multiple instances with unique port allocation
export class PortManager {
  private readonly basePort: number
  private readonly instanceManager: InstanceManager
  private currentInstance: InstanceInfo | null = null

  constructor(browser: DevOptions['browser'], basePort: number = 8080) {
    this.basePort = basePort
    this.instanceManager = new InstanceManager(basePort, 9000)
  }

  private async isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer()
      server.once('error', () => resolve(false))
      server.once('listening', () => {
        server.close()
        resolve(true)
      })
      server.listen(port)
    })
  }

  private async findAvailablePort(startPort: number): Promise<number> {
    let port = startPort
    while (!(await this.isPortAvailable(port))) {
      port++
    }
    return port
  }

  /**
   * Allocate ports for a new instance
   */
  async allocatePorts(
    browser: DevOptions['browser'],
    projectPath: string,
    requestedPort?: number
  ): Promise<PortAllocation> {
    // Create a new instance with unique ports
    const instance = await this.instanceManager.createInstance(
      browser,
      projectPath,
      requestedPort
    )

    this.currentInstance = instance

    return {
      port: instance.port,
      webSocketPort: instance.webSocketPort,
      instanceId: instance.instanceId
    }
  }

  /**
   * Get the current instance
   */
  getCurrentInstance(): InstanceInfo | null {
    return this.currentInstance
  }

  /**
   * Update the current instance with extension ID
   */
  async updateExtensionId(extensionId: string): Promise<void> {
    if (this.currentInstance) {
      await this.instanceManager.updateInstance(
        this.currentInstance.instanceId,
        {
          extensionId
        }
      )
      this.currentInstance.extensionId = extensionId
    }
  }

  /**
   * Terminate the current instance
   */
  async terminateCurrentInstance(): Promise<void> {
    if (this.currentInstance) {
      await this.instanceManager.terminateInstance(
        this.currentInstance.instanceId
      )
      this.currentInstance = null
    }
  }

  /**
   * Get port information for display
   */
  getPortInfo(allocation: PortAllocation): string {
    return `Port: ${allocation.port}, WebSocket: ${allocation.webSocketPort}, Instance: ${allocation.instanceId.slice(0, 8)}`
  }

  /**
   * Get instance manager for advanced operations
   */
  getInstanceManager(): InstanceManager {
    return this.instanceManager
  }

  /**
   * Check if an instance is running on a specific port
   */
  async isPortInUse(port: number): Promise<boolean> {
    const instance = await this.instanceManager.getInstanceByPort(port)
    return instance !== null
  }

  /**
   * Get all running instances
   */
  async getRunningInstances(): Promise<InstanceInfo[]> {
    return await this.instanceManager.getRunningInstances()
  }

  /**
   * Get instance statistics
   */
  async getStats(): Promise<{
    total: number
    running: number
    terminated: number
    error: number
  }> {
    return await this.instanceManager.getStats()
  }
}

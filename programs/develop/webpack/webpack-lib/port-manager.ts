import {DevOptions} from '../../develop-lib/config-types'
import {
  InstanceManager,
  InstanceInfo
} from '../plugin-browsers/browsers-lib/instance-manager'
import * as messages from './messages'

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

  constructor(
    browser: DevOptions['browser'],
    projectPath: string,
    basePort: number = 8080
  ) {
    this.basePort = basePort
    this.instanceManager = new InstanceManager(projectPath, basePort, 9000)
  }

  async allocatePorts(
    browser: DevOptions['browser'],
    projectPath: string,
    requestedPort?: number
  ): Promise<PortAllocation> {
    try {
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
    } catch (error) {
      console.error(messages.portManagerErrorAllocatingPorts(error))
      throw error
    }
  }

  getCurrentInstance(): InstanceInfo | null {
    return this.currentInstance
  }

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

  async terminateCurrentInstance(): Promise<void> {
    if (this.currentInstance) {
      await this.instanceManager.terminateInstance(
        this.currentInstance.instanceId
      )
      this.currentInstance = null
    }
  }

  getPortInfo(allocation: PortAllocation): string {
    return `Port: ${allocation.port}, WebSocket: ${allocation.webSocketPort}, Instance: ${allocation.instanceId.slice(0, 8)}`
  }

  getInstanceManager(): InstanceManager {
    return this.instanceManager
  }

  async isPortInUse(port: number): Promise<boolean> {
    const instance = await this.instanceManager.getInstanceByPort(port)
    return instance !== null
  }

  async getRunningInstances(): Promise<InstanceInfo[]> {
    return await this.instanceManager.getRunningInstances()
  }

  async getStats(): Promise<{
    total: number
    running: number
    terminated: number
    error: number
  }> {
    return await this.instanceManager.getStats()
  }
}

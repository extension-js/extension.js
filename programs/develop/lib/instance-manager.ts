import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import * as crypto from 'crypto'
import * as net from 'net'
import {DevOptions} from '../commands/commands-lib/config-types'
import * as messages from '../webpack/lib/messages'

export interface InstanceInfo {
  instanceId: string
  processId: number
  port: number
  webSocketPort: number
  browser: DevOptions['browser']
  extensionId?: string
  managerExtensionId: string
  profilePath: string
  projectPath: string
  startTime: number
  status: 'running' | 'terminated' | 'error'
}

export interface InstanceRegistry {
  instances: Record<string, InstanceInfo>
  lastCleanup: number
}

export class InstanceManager {
  private readonly registryPath: string
  private readonly basePort: number
  private readonly baseWebSocketPort: number
  private readonly cleanupInterval: number = 5 * 60 * 1000 // 5 minutes

  constructor(
    projectPath: string,
    basePort: number = 8080,
    baseWebSocketPort: number = 9000
  ) {
    this.basePort = basePort
    this.baseWebSocketPort = baseWebSocketPort
    this.registryPath = path.join(this.getDataDirectory(), 'instances.json')
  }

  private getDataDirectory(): string {
    const platform = process.platform

    switch (platform) {
      case 'darwin': // macOS
        return path.join(
          os.homedir(),
          'Library',
          'Application Support',
          'extension-js'
        )

      case 'win32': // Windows
        return path.join(process.env.APPDATA || '', 'extension-js')

      case 'linux': // Linux
        return path.join(os.homedir(), '.config', 'extension-js')

      default:
        // Fallback to home directory for other platforms
        return path.join(os.homedir(), '.extension-js')
    }
  }

  private generateInstanceId(): string {
    return crypto.randomBytes(8).toString('hex')
  }

  private generateManagerExtensionId(): string {
    // Generate a valid extension ID format (32 characters, alphanumeric)
    const chars = 'abcdefghijklmnopqrstuvwxyz'
    let result = ''
    for (let i = 0; i < 32; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return result
  }

  private async ensureRegistryDir(): Promise<void> {
    const dir = path.dirname(this.registryPath)
    try {
      await fs.access(dir)
    } catch {
      await fs.mkdir(dir, {recursive: true})
    }
  }

  private async loadRegistry(): Promise<InstanceRegistry> {
    try {
      await this.ensureRegistryDir()
      const data = await fs.readFile(this.registryPath, 'utf-8')
      return JSON.parse(data)
    } catch {
      return {
        instances: {},
        lastCleanup: Date.now()
      }
    }
  }

  private async saveRegistry(registry: InstanceRegistry): Promise<void> {
    try {
      await this.ensureRegistryDir()
      const data = JSON.stringify(registry, null, 2)
      await fs.writeFile(this.registryPath, data)
      console.log(messages.registrySaved(this.registryPath))
    } catch (error) {
      console.error(messages.registrySaveError(error))
      throw error
    }
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

  /**
   * Smart port allocation that considers existing instances
   */
  private async allocateSmartPorts(
    requestedPort?: number
  ): Promise<{port: number; webSocketPort: number}> {
    const registry = await this.loadRegistry()
    const existingInstances = Object.values(registry.instances)

    // Get all used ports from existing instances
    const usedPorts = existingInstances.map((instance) => instance.port)
    const usedWebSocketPorts = existingInstances.map(
      (instance) => instance.webSocketPort
    )

    console.log(messages.smartPortAllocationExistingPorts(usedPorts))
    console.log(
      messages.smartPortAllocationExistingWebSocketPorts(usedWebSocketPorts)
    )

    // If user requested a specific port, try to use it
    if (requestedPort) {
      const isPortAvailable = await this.isPortAvailable(requestedPort)
      if (isPortAvailable && !usedPorts.includes(requestedPort)) {
        // Find available WebSocket port for this instance
        const webSocketPort =
          await this.findAvailableWebSocketPort(usedWebSocketPorts)
        console.log(
          messages.smartPortAllocationUsingRequestedPort(
            requestedPort,
            webSocketPort
          )
        )
        return {port: requestedPort, webSocketPort}
      } else {
        console.log(
          messages.smartPortAllocationRequestedPortUnavailable(requestedPort)
        )
      }
    }

    // Smart port allocation: find the lowest available port
    let port = this.basePort
    while (usedPorts.includes(port) || !(await this.isPortAvailable(port))) {
      port++
    }

    // Find available WebSocket port
    const webSocketPort =
      await this.findAvailableWebSocketPort(usedWebSocketPorts)

    console.log(messages.smartPortAllocationAllocatedPorts(port, webSocketPort))
    return {port, webSocketPort}
  }

  private async findAvailableWebSocketPort(
    usedWebSocketPorts: number[]
  ): Promise<number> {
    let webSocketPort = this.baseWebSocketPort

    // Find the lowest available WebSocket port
    while (
      usedWebSocketPorts.includes(webSocketPort) ||
      !(await this.isPortAvailable(webSocketPort))
    ) {
      webSocketPort++
    }

    return webSocketPort
  }

  private async cleanupTerminatedInstances(
    registry: InstanceRegistry
  ): Promise<void> {
    const now = Date.now()
    const maxAge = 24 * 60 * 60 * 1000 // 24 hours

    for (const [instanceId, instance] of Object.entries(registry.instances)) {
      // Remove instances that are too old or terminated
      if (
        instance.status === 'terminated' ||
        instance.status === 'error' ||
        now - instance.startTime > maxAge
      ) {
        delete registry.instances[instanceId]
      }
    }

    registry.lastCleanup = now
  }

  async createInstance(
    browser: DevOptions['browser'],
    projectPath: string,
    requestedPort?: number
  ): Promise<InstanceInfo> {
    console.log(
      messages.instanceManagerCreateInstanceCalled({
        browser,
        projectPath,
        requestedPort
      })
    )
    const registry = await this.loadRegistry()

    // Clean up old instances periodically
    if (Date.now() - registry.lastCleanup > this.cleanupInterval) {
      await this.cleanupTerminatedInstances(registry)
    }

    // Generate unique identifiers
    const instanceId = this.generateInstanceId()
    const managerExtensionId = this.generateManagerExtensionId()

    // Allocate unique ports
    const {port, webSocketPort} = await this.allocateSmartPorts(requestedPort)

    const instance: InstanceInfo = {
      instanceId,
      browser,
      projectPath,
      port,
      webSocketPort,
      managerExtensionId,
      startTime: Date.now(),
      status: 'running',
      processId: process.pid,
      profilePath: path.join(os.tmpdir(), `extension-js-${instanceId}`)
    }

    registry.instances[instanceId] = instance
    await this.saveRegistry(registry)

    if (process.env.EXTENSION_ENV === 'development') {
      console.log(messages.instanceManagerRegistryAfterCreateInstance(registry))
    }
    return instance
  }

  async updateInstance(
    instanceId: string,
    updates: Partial<InstanceInfo>
  ): Promise<void> {
    const registry = await this.loadRegistry()

    if (registry.instances[instanceId]) {
      registry.instances[instanceId] = {
        ...registry.instances[instanceId],
        ...updates
      }
      await this.saveRegistry(registry)
    }
  }

  async terminateInstance(instanceId: string): Promise<void> {
    const registry = await this.loadRegistry()

    if (registry.instances[instanceId]) {
      registry.instances[instanceId].status = 'terminated'
      await this.saveRegistry(registry)
    }
  }

  async getRunningInstances(): Promise<InstanceInfo[]> {
    const registry = await this.loadRegistry()
    return Object.values(registry.instances).filter(
      (instance) => instance.status === 'running'
    )
  }

  async getInstance(instanceId: string): Promise<InstanceInfo | null> {
    const registry = await this.loadRegistry()
    return registry.instances[instanceId] || null
  }

  async isInstanceRunning(instanceId: string): Promise<boolean> {
    const instance = await this.getInstance(instanceId)
    if (!instance) return false

    try {
      // Check if the process is still running
      process.kill(instance.processId, 0)
      return instance.status === 'running'
    } catch {
      // Process is not running
      await this.terminateInstance(instanceId)
      return false
    }
  }

  async getInstanceByPort(port: number): Promise<InstanceInfo | null> {
    const instances = await this.getRunningInstances()
    return instances.find((instance) => instance.port === port) || null
  }

  async getInstanceByWebSocketPort(
    webSocketPort: number
  ): Promise<InstanceInfo | null> {
    const instances = await this.getRunningInstances()
    return (
      instances.find((instance) => instance.webSocketPort === webSocketPort) ||
      null
    )
  }

  async cleanupAllInstances(): Promise<void> {
    const registry = await this.loadRegistry()
    registry.instances = {}
    registry.lastCleanup = Date.now()
    await this.saveRegistry(registry)
  }

  async getStats(): Promise<{
    total: number
    running: number
    terminated: number
    error: number
  }> {
    const registry = await this.loadRegistry()
    const instances = Object.values(registry.instances)

    return {
      total: instances.length,
      running: instances.filter((i) => i.status === 'running').length,
      terminated: instances.filter((i) => i.status === 'terminated').length,
      error: instances.filter((i) => i.status === 'error').length
    }
  }
}

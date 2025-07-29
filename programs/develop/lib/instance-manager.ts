import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import * as crypto from 'crypto'
import * as net from 'net'
import {DevOptions} from '../commands/commands-lib/config-types'

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

  /**
   * Get the appropriate data directory for the current OS
   */
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

  /**
   * Generate a unique instance ID
   */
  private generateInstanceId(): string {
    return crypto.randomBytes(8).toString('hex')
  }

  /**
   * Generate a unique manager extension ID
   */
  private generateManagerExtensionId(): string {
    // Generate a valid extension ID format (32 characters, alphanumeric)
    const chars = 'abcdefghijklmnopqrstuvwxyz'
    let result = ''
    for (let i = 0; i < 32; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return result
  }

  /**
   * Ensure the registry directory exists
   */
  private async ensureRegistryDir(): Promise<void> {
    const dir = path.dirname(this.registryPath)
    try {
      await fs.access(dir)
    } catch {
      await fs.mkdir(dir, {recursive: true})
    }
  }

  /**
   * Load the instance registry
   */
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

  /**
   * Save the instance registry
   */
  private async saveRegistry(registry: InstanceRegistry): Promise<void> {
    try {
      await this.ensureRegistryDir()
      const data = JSON.stringify(registry, null, 2)
      await fs.writeFile(this.registryPath, data)
      console.log('🔍 Registry saved to:', this.registryPath)
    } catch (error) {
      console.error('🔍 Error saving registry:', error)
      throw error
    }
  }

  /**
   * Check if a port is available
   */
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
   * Find an available port starting from the given port
   */
  private async findAvailablePort(startPort: number): Promise<number> {
    let port = startPort
    while (!(await this.isPortAvailable(port))) {
      port++
    }
    return port
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
    const usedPorts = existingInstances.map(instance => instance.port)
    const usedWebSocketPorts = existingInstances.map(instance => instance.webSocketPort)
    
    console.log('🔍 [SmartPortAllocation] Existing ports:', usedPorts)
    console.log('🔍 [SmartPortAllocation] Existing WebSocket ports:', usedWebSocketPorts)
    
    // If user requested a specific port, try to use it
    if (requestedPort) {
      const isPortAvailable = await this.isPortAvailable(requestedPort)
      if (isPortAvailable && !usedPorts.includes(requestedPort)) {
        // Find available WebSocket port for this instance
        const webSocketPort = await this.findAvailableWebSocketPort(usedWebSocketPorts)
        console.log('🔍 [SmartPortAllocation] Using requested port:', requestedPort, 'WebSocket:', webSocketPort)
        return { port: requestedPort, webSocketPort }
      } else {
        console.log('🔍 [SmartPortAllocation] Requested port unavailable:', requestedPort)
      }
    }
    
    // Smart port allocation: find the lowest available port
    let port = this.basePort
    while (usedPorts.includes(port) || !(await this.isPortAvailable(port))) {
      port++
    }
    
    // Find available WebSocket port
    const webSocketPort = await this.findAvailableWebSocketPort(usedWebSocketPorts)
    
    console.log('🔍 [SmartPortAllocation] Allocated ports:', { port, webSocketPort })
    return { port, webSocketPort }
  }

  /**
   * Find available WebSocket port considering existing instances
   */
  private async findAvailableWebSocketPort(usedWebSocketPorts: number[]): Promise<number> {
    let webSocketPort = this.baseWebSocketPort
    
    // Find the lowest available WebSocket port
    while (usedWebSocketPorts.includes(webSocketPort) || !(await this.isPortAvailable(webSocketPort))) {
      webSocketPort++
    }
    
    return webSocketPort
  }

  /**
   * Get optimal port range for new instances
   */
  private getOptimalPortRange(): {start: number; end: number} {
    return {
      start: this.basePort,
      end: this.basePort + 100 // Allow up to 100 instances
    }
  }

  /**
   * Check if port is in optimal range
   */
  private isPortInOptimalRange(port: number): boolean {
    const range = this.getOptimalPortRange()
    return port >= range.start && port <= range.end
  }

  /**
   * Find gaps in port usage for optimal allocation
   */
  private findPortGaps(usedPorts: number[]): number[] {
    const sortedPorts = [...usedPorts].sort((a, b) => a - b)
    const gaps: number[] = []
    
    for (let i = 0; i < sortedPorts.length - 1; i++) {
      const current = sortedPorts[i]
      const next = sortedPorts[i + 1]
      
      // If there's a gap, add the first available port in the gap
      if (next - current > 1) {
        gaps.push(current + 1)
      }
    }
    
    return gaps
  }

  /**
   * Clean up terminated instances
   */
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

  /**
   * Create a new instance
   */
  async createInstance(
    browser: DevOptions['browser'],
    projectPath: string,
    requestedPort?: number
  ): Promise<InstanceInfo> {
    console.log('🔍 [InstanceManager] createInstance called', {
      browser,
      projectPath,
      requestedPort
    })
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
    console.log('🔍 [InstanceManager] Registry after createInstance:', registry)
    return instance
  }

  /**
   * Update instance information
   */
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

  /**
   * Terminate an instance
   */
  async terminateInstance(instanceId: string): Promise<void> {
    const registry = await this.loadRegistry()

    if (registry.instances[instanceId]) {
      registry.instances[instanceId].status = 'terminated'
      await this.saveRegistry(registry)
    }
  }

  /**
   * Get all running instances
   */
  async getRunningInstances(): Promise<InstanceInfo[]> {
    const registry = await this.loadRegistry()
    return Object.values(registry.instances).filter(
      (instance) => instance.status === 'running'
    )
  }

  /**
   * Get instance by ID
   */
  async getInstance(instanceId: string): Promise<InstanceInfo | null> {
    const registry = await this.loadRegistry()
    return registry.instances[instanceId] || null
  }

  /**
   * Check if an instance is still running
   */
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

  /**
   * Get instance by port
   */
  async getInstanceByPort(port: number): Promise<InstanceInfo | null> {
    const instances = await this.getRunningInstances()
    return instances.find((instance) => instance.port === port) || null
  }

  /**
   * Get instance by WebSocket port
   */
  async getInstanceByWebSocketPort(
    webSocketPort: number
  ): Promise<InstanceInfo | null> {
    const instances = await this.getRunningInstances()
    return (
      instances.find((instance) => instance.webSocketPort === webSocketPort) ||
      null
    )
  }

  /**
   * Clean up all instances (for testing or emergency cleanup)
   */
  async cleanupAllInstances(): Promise<void> {
    const registry = await this.loadRegistry()
    registry.instances = {}
    registry.lastCleanup = Date.now()
    await this.saveRegistry(registry)
  }

  /**
   * Get registry statistics
   */
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

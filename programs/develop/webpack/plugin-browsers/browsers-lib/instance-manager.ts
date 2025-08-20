import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import * as crypto from 'crypto'
import * as net from 'net'
import {DevOptions} from '../../../develop-lib/config-types'
import * as messages from '../../../webpack/webpack-lib/messages'

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
  private healthChecks: Map<string, NodeJS.Timeout> = new Map()

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
    const isWSL = process.env.WSL_DISTRO_NAME || process.env.WSLENV

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

      case 'linux': // Linux (including WSL)
        if (isWSL) {
          // WSL: Use Windows-style AppData if available, fallback to Linux-style
          const windowsAppData = process.env.APPDATA
          if (windowsAppData) {
            return path.join(windowsAppData, 'extension-js')
          }
        }
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
      if (process.env.EXTENSION_ENV === 'development') {
        console.log(messages.registrySaved(this.registryPath))
      }
    } catch (error) {
      if (process.env.EXTENSION_ENV === 'development') {
        console.error(messages.registrySaveError(error))
      }
      throw error
    }
  }

  private async isPortAvailable(port: number): Promise<boolean> {
    type CheckResult = {available: boolean; errorCode?: string}
    const check = (host: string) =>
      new Promise<CheckResult>((resolve) => {
        const server = net.createServer()
        const complete = (result: CheckResult) => {
          try {
            server.close(() => resolve(result))
          } catch {
            resolve(result)
          }
        }
        server.once('error', (err: NodeJS.ErrnoException) =>
          resolve({available: false, errorCode: err.code})
        )
        server.once('listening', () => complete({available: true}))
        try {
          server.listen(port, host)
        } catch (err: any) {
          resolve({available: false, errorCode: err?.code})
        }
      })

    const [v6, v4] = await Promise.all([check('::1'), check('127.0.0.1')])

    // If IPv6 stack is unavailable, rely on IPv4 result only
    const ipv6Unsupported =
      v6.errorCode === 'EADDRNOTAVAIL' ||
      v6.errorCode === 'ENETUNREACH' ||
      v6.errorCode === 'EINVAL' ||
      typeof v6.errorCode === 'undefined'

    if (ipv6Unsupported) {
      return v4.available
    }

    // Otherwise require both to be free to avoid dual-stack collisions
    return v4.available && v6.available
  }

  /**
   * Smart port allocation that considers existing instances
   */
  private async allocateSmartPorts(
    requestedPort?: number
  ): Promise<{port: number; webSocketPort: number}> {
    const registry = await this.loadRegistry()

    // Always run cleanup before allocation to ensure fresh state
    await this.cleanupTerminatedInstances(registry)

    // Refresh registry after cleanup
    const cleanRegistry = await this.loadRegistry()
    const existingInstances = Object.values(cleanRegistry.instances)

    // Get all used ports from ACTIVE instances only
    const usedPorts = existingInstances
      .filter((instance) => instance.status === 'running')
      .map((instance) => instance.port)
    const usedWebSocketPorts = existingInstances
      .filter((instance) => instance.status === 'running')
      .map((instance) => instance.webSocketPort)

    if (process.env.EXTENSION_ENV === 'development') {
      console.log(messages.smartPortAllocationExistingPorts(usedPorts))
      console.log(
        messages.smartPortAllocationExistingWebSocketPorts(usedWebSocketPorts)
      )
    }

    // If user requested a specific port, try to use it
    if (requestedPort) {
      const isPortAvailable = await this.isPortAvailable(requestedPort)
      if (isPortAvailable && !usedPorts.includes(requestedPort)) {
        // Find available WebSocket port for this instance
        const webSocketPort =
          await this.findAvailableWebSocketPort(usedWebSocketPorts)
        if (process.env.EXTENSION_ENV === 'development') {
          console.log(
            messages.smartPortAllocationUsingRequestedPort(
              requestedPort,
              webSocketPort
            )
          )
        }
        return {port: requestedPort, webSocketPort}
      } else {
        if (process.env.EXTENSION_ENV === 'development') {
          console.log(
            messages.smartPortAllocationRequestedPortUnavailable(requestedPort)
          )
        }
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

    if (process.env.EXTENSION_ENV === 'development') {
      console.log(
        messages.smartPortAllocationAllocatedPorts(port, webSocketPort)
      )
    }
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
    const instancesToRemove: string[] = []

    for (const [instanceId, instance] of Object.entries(registry.instances)) {
      let shouldRemove = false

      // Check if instance is explicitly terminated or errored
      if (
        instance.status === 'terminated' ||
        instance.status === 'error' ||
        now - instance.startTime > maxAge
      ) {
        shouldRemove = true
      }
      // NEW: Check if process is still running
      else if (!(await this.isProcessRunning(instance.processId))) {
        if (process.env.EXTENSION_ENV === 'development') {
          console.log(
            messages.instanceManagerProcessNoLongerRunning(
              instanceId,
              instance.processId
            )
          )
        }
        shouldRemove = true
      }
      // NEW: Check if ports are actually in use (both must be free to consider orphaned)
      else if (
        (await this.isPortAvailable(instance.port)) &&
        (await this.isPortAvailable(instance.webSocketPort))
      ) {
        if (process.env.EXTENSION_ENV === 'development') {
          console.log(
            messages.instanceManagerPortsNotInUse(
              instanceId,
              instance.port,
              instance.webSocketPort
            )
          )
        }
        shouldRemove = true
      }

      if (shouldRemove) {
        instancesToRemove.push(instanceId)
      }
    }

    // Remove orphaned instances
    for (const instanceId of instancesToRemove) {
      delete registry.instances[instanceId]
      if (process.env.EXTENSION_ENV === 'development') {
        console.log(
          messages.instanceManagerCleanedUpOrphanedInstance(instanceId)
        )
      }
    }

    registry.lastCleanup = now
  }

  /**
   * Check if a process is still running
   */
  private async isProcessRunning(pid: number): Promise<boolean> {
    try {
      // Sending signal 0 checks if process exists without actually sending a signal
      process.kill(pid, 0)
      return true
    } catch (error: any) {
      // ESRCH means process doesn't exist
      return error.code !== 'ESRCH'
    }
  }

  /**
   * Enhanced process monitoring for AI usage
   */
  private async monitorProcessHealth(instanceId: string): Promise<void> {
    const instance = await this.getInstance(instanceId)
    if (!instance) return

    if (process.env.EXTENSION_ENV === 'development') {
      console.log(messages.instanceManagerHealthMonitoringStart(instanceId))
    }

    // Check process health every 30 seconds
    const healthCheck = setInterval(async () => {
      try {
        const isHealthy = await this.isProcessRunning(instance.processId)
        const portsInUse = await this.arePortsInUse(
          instance.port,
          instance.webSocketPort
        )

        // Consider orphaned only when the process is not this process,
        // the process is not running, and both ports are free
        const isCurrentProcess = instance.processId === process.pid
        const definitelyOrphaned =
          !isCurrentProcess && !isHealthy && !portsInUse

        if (definitelyOrphaned) {
          console.log(
            messages.instanceManagerHealthMonitoringOrphaned(instanceId)
          )
          await this.terminateInstance(instanceId)
          clearInterval(healthCheck)
          this.healthChecks.delete(instanceId)
        } else {
          if (process.env.EXTENSION_ENV === 'development') {
            console.log(
              messages.instanceManagerHealthMonitoringPassed(instanceId)
            )
          }
        }
      } catch (error) {
        console.error(
          messages.instanceManagerHealthMonitoringFailed(instanceId, error)
        )
        clearInterval(healthCheck)
        this.healthChecks.delete(instanceId)
      }
    }, 30000)

    // Store health check reference for cleanup
    this.healthChecks.set(instanceId, healthCheck)
  }

  private async arePortsInUse(
    port: number,
    webSocketPort: number
  ): Promise<boolean> {
    const portInUse = !(await this.isPortAvailable(port))
    const webSocketPortInUse = !(await this.isPortAvailable(webSocketPort))
    return portInUse || webSocketPortInUse
  }

  /**
   * Force cleanup all processes for this project
   */
  async forceCleanupProjectProcesses(projectPath: string): Promise<void> {
    if (process.env.EXTENSION_ENV === 'development') {
      console.log(messages.instanceManagerForceCleanupProject(projectPath))
    }

    const registry = await this.loadRegistry()
    const projectInstances = Object.values(registry.instances).filter(
      (instance) => instance.projectPath === projectPath
    )

    if (process.env.EXTENSION_ENV === 'development') {
      console.log(
        messages.instanceManagerForceCleanupFound(projectInstances.length)
      )
    }

    for (const instance of projectInstances) {
      try {
        if (process.env.EXTENSION_ENV === 'development') {
          console.log(
            messages.instanceManagerForceCleanupInstance(instance.instanceId)
          )
        }

        // Kill process if still running
        if (await this.isProcessRunning(instance.processId)) {
          if (process.env.EXTENSION_ENV === 'development') {
            console.log(
              messages.instanceManagerForceCleanupTerminating(
                instance.processId
              )
            )
          }
          process.kill(instance.processId, 'SIGTERM')

          // Force kill after timeout
          setTimeout(() => {
            try {
              process.kill(instance.processId, 'SIGKILL')
              if (process.env.EXTENSION_ENV === 'development') {
                console.log(
                  messages.instanceManagerForceCleanupForceKilled(
                    instance.processId
                  )
                )
              }
            } catch (error) {
              // Process already terminated
            }
          }, 3000)
        }

        // Mark as terminated
        instance.status = 'terminated'
        if (process.env.EXTENSION_ENV === 'development') {
          console.log(
            messages.instanceManagerForceCleanupInstanceTerminated(
              instance.instanceId
            )
          )
        }
      } catch (error) {
        if (process.env.EXTENSION_ENV === 'development') {
          console.error(
            messages.instanceManagerForceCleanupError(
              instance.instanceId,
              error
            )
          )
        }
      }
    }

    await this.saveRegistry(registry)
    if (process.env.EXTENSION_ENV === 'development') {
      console.log(messages.instanceManagerForceCleanupComplete())
    }
  }

  async createInstance(
    browser: DevOptions['browser'],
    projectPath: string,
    requestedPort?: number
  ): Promise<InstanceInfo> {
    if (process.env.EXTENSION_ENV === 'development') {
      console.log(
        messages.instanceManagerCreateInstanceCalled({
          browser,
          projectPath,
          requestedPort
        })
      )
    }
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

    // Start health monitoring for this instance
    await this.monitorProcessHealth(instanceId)

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

      // Stop health monitoring for this instance
      const healthCheck = this.healthChecks.get(instanceId)
      if (healthCheck) {
        clearInterval(healthCheck)
        this.healthChecks.delete(instanceId)
      }
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

    // Stop all health checks
    for (const healthCheck of this.healthChecks.values()) {
      clearInterval(healthCheck)
    }
    this.healthChecks.clear()
  }

  /**
   * Force cleanup of all orphaned instances
   */
  async forceCleanupOrphanedInstances(): Promise<void> {
    const registry = await this.loadRegistry()
    await this.cleanupTerminatedInstances(registry)
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

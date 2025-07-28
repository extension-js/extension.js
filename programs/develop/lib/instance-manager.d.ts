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
export declare class InstanceManager {
  private readonly registryPath
  private readonly basePort
  private readonly baseWebSocketPort
  private readonly cleanupInterval
  constructor(basePort?: number, baseWebSocketPort?: number)
  /**
   * Generate a unique instance ID
   */
  private generateInstanceId
  /**
   * Generate a unique manager extension ID
   */
  private generateManagerExtensionId
  /**
   * Ensure the registry directory exists
   */
  private ensureRegistryDir
  /**
   * Load the instance registry
   */
  private loadRegistry
  /**
   * Save the instance registry
   */
  private saveRegistry
  /**
   * Check if a port is available
   */
  private isPortAvailable
  /**
   * Find an available port starting from the given port
   */
  private findAvailablePort
  /**
   * Clean up terminated instances
   */
  private cleanupTerminatedInstances
  /**
   * Create a new instance
   */
  createInstance(
    browser: DevOptions['browser'],
    projectPath: string,
    requestedPort?: number
  ): Promise<InstanceInfo>
  /**
   * Update instance information
   */
  updateInstance(
    instanceId: string,
    updates: Partial<InstanceInfo>
  ): Promise<void>
  /**
   * Terminate an instance
   */
  terminateInstance(instanceId: string): Promise<void>
  /**
   * Get all running instances
   */
  getRunningInstances(): Promise<InstanceInfo[]>
  /**
   * Get instance by ID
   */
  getInstance(instanceId: string): Promise<InstanceInfo | null>
  /**
   * Check if an instance is still running
   */
  isInstanceRunning(instanceId: string): Promise<boolean>
  /**
   * Get instance by port
   */
  getInstanceByPort(port: number): Promise<InstanceInfo | null>
  /**
   * Get instance by WebSocket port
   */
  getInstanceByWebSocketPort(
    webSocketPort: number
  ): Promise<InstanceInfo | null>
  /**
   * Clean up all instances (for testing or emergency cleanup)
   */
  cleanupAllInstances(): Promise<void>
  /**
   * Get registry statistics
   */
  getStats(): Promise<{
    total: number
    running: number
    terminated: number
    error: number
  }>
}

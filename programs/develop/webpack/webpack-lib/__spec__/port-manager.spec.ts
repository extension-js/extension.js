import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import {PortManager} from '../port-manager'

// Mock InstanceManager used inside PortManager
vi.mock('../../lib/instance-manager', () => {
  class FakeInstanceManager {
    projectPath: string
    basePort: number
    baseWebSocketPort: number
    instance: any
    constructor(projectPath: string, basePort: number) {
      this.projectPath = projectPath
      this.basePort = basePort
      this.baseWebSocketPort = 9000
    }
    async createInstance(
      browser: string,
      projectPath: string,
      requestedPort?: number
    ) {
      this.instance = {
        instanceId: 'abcdef1234567890',
        port: requestedPort || this.basePort,
        webSocketPort: 9000,
        browser,
        projectPath,
        processId: 123,
        startTime: Date.now(),
        status: 'running',
        managerExtensionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        profilePath: '',
        extensionId: undefined
      }
      return this.instance
    }
    async updateInstance() {
      /* noop */
    }
    async terminateInstance() {
      /* noop */
    }
    async getInstanceByPort(port: number) {
      return this.instance && this.instance.port === port ? this.instance : null
    }
    async getRunningInstances() {
      return this.instance ? [this.instance] : []
    }
    async getStats() {
      return {
        total: this.instance ? 1 : 0,
        running: this.instance ? 1 : 0,
        terminated: 0,
        error: 0
      }
    }
  }
  return {InstanceManager: FakeInstanceManager}
})

describe('PortManager', () => {
  const browser = 'chrome'
  const projectPath = '/project'

  it('allocates ports and returns allocation info', async () => {
    const pm = new PortManager(browser as any, projectPath, 8080)
    const allocation = await pm.allocatePorts(browser as any, projectPath)
    expect(allocation.port).toBeGreaterThan(0)
    expect(allocation.webSocketPort).toBeGreaterThan(0)
    expect(allocation.instanceId).toHaveLength(16)
    // getCurrentInstance reflects allocation
    expect(pm.getCurrentInstance()).not.toBeNull()
  })

  it('updates extension id on current instance', async () => {
    const pm = new PortManager(browser as any, projectPath, 8081)
    await pm.allocatePorts(browser as any, projectPath)
    await pm.updateExtensionId('ext-id')
    expect(pm.getCurrentInstance()?.extensionId).toBe('ext-id')
  })

  it('terminates current instance', async () => {
    const pm = new PortManager(browser as any, projectPath, 8082)
    await pm.allocatePorts(browser as any, projectPath)
    await pm.terminateCurrentInstance()
    expect(pm.getCurrentInstance()).toBeNull()
  })

  it('reports whether a port is in use', async () => {
    const pm = new PortManager(browser as any, projectPath, 8083)
    const allocation = await pm.allocatePorts(browser as any, projectPath)
    expect(await pm.isPortInUse(allocation.port)).toBe(true)
    expect(await pm.isPortInUse(9999)).toBe(false)
  })

  it('returns running instances and stats', async () => {
    const pm = new PortManager(browser as any, projectPath, 8084)
    await pm.allocatePorts(browser as any, projectPath)
    const running = await pm.getRunningInstances()
    expect(running.length).toBeGreaterThan(0)
    const stats = await pm.getStats()
    expect(stats.running).toBeGreaterThan(0)
    expect(stats.total).toBeGreaterThan(0)
  })
})

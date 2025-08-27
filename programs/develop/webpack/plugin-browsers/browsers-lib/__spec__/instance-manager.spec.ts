import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import {InstanceManager, type InstanceInfo} from '../instance-manager'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'

// Mock fs.promises
vi.mock('fs/promises')

// Mock os.homedir
vi.mock('os', () => ({
  homedir: vi.fn(() => '/mock/home'),
  tmpdir: vi.fn(() => '/mock/tmp')
}))

describe('InstanceManager', () => {
  let instanceManager: InstanceManager
  let mockFs: any
  let mockOs: any

  beforeEach(() => {
    vi.clearAllMocks()

    // Reset mocks
    mockFs = {
      access: vi.fn(),
      mkdir: vi.fn(),
      readFile: vi.fn(),
      writeFile: vi.fn(),
      unlink: vi.fn(),
      open: vi.fn()
    }

    mockOs = {
      homedir: vi.fn(() => '/mock/home'),
      tmpdir: vi.fn(() => '/mock/tmp')
    }

    // Mock fs.promises methods
    vi.mocked(fs.access).mockImplementation(mockFs.access)
    vi.mocked(fs.mkdir).mockImplementation(mockFs.mkdir)
    vi.mocked(fs.readFile).mockImplementation(mockFs.readFile)
    vi.mocked(fs.writeFile).mockImplementation(mockFs.writeFile)
    vi.mocked(fs.unlink).mockImplementation(mockFs.unlink)
    vi.mocked(fs.open).mockImplementation(mockFs.open)

    // Mock os methods
    vi.mocked(os.homedir).mockImplementation(mockOs.homedir)
    vi.mocked(os.tmpdir).mockImplementation(mockOs.tmpdir)

    instanceManager = new InstanceManager('/mock/project', 8080, 9000)
  })

  afterEach(async () => {
    await instanceManager.cleanupAllInstances()
  })

  describe('getDataDirectory', () => {
    it('returns correct path for macOS', () => {
      // Mock process.platform for this test
      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true
      })

      const dataDir = (instanceManager as any).getDataDirectory()
      expect(dataDir).toBe(
        '/mock/home/Library/Application Support/extension-js'
      )

      // Restore original platform
      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
        writable: true
      })
    })

    it('returns correct path for Windows', () => {
      // Mock process.platform and APPDATA for this test
      const originalPlatform = process.platform
      const originalAppData = process.env.APPDATA

      Object.defineProperty(process, 'platform', {
        value: 'win32',
        writable: true
      })
      process.env.APPDATA = '/mock/appdata'

      const dataDir = (instanceManager as any).getDataDirectory()
      expect(dataDir).toBe('/mock/appdata/extension-js')

      // Restore original values
      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
        writable: true
      })
      if (originalAppData) {
        process.env.APPDATA = originalAppData
      } else {
        delete process.env.APPDATA
      }
    })

    it('returns correct path for Linux', () => {
      // Mock process.platform for this test
      const originalPlatform = process.platform

      Object.defineProperty(process, 'platform', {
        value: 'linux',
        writable: true
      })

      const dataDir = (instanceManager as any).getDataDirectory()
      expect(dataDir).toBe('/mock/home/.config/extension-js')

      // Restore original platform
      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
        writable: true
      })
    })
  })

  describe('ensureDataDirectory', () => {
    it('creates data directory when it does not exist', async () => {
      const dataDir = (instanceManager as any).getDataDirectory()

      // Mock access to fail (directory doesn't exist)
      mockFs.access.mockRejectedValueOnce(new Error('ENOENT'))

      await instanceManager.ensureDataDirectory()

      expect(mockFs.mkdir).toHaveBeenCalledWith(dataDir, {recursive: true})
    })

    it('does not create data directory when it already exists', async () => {
      // Mock access to succeed (directory exists)
      mockFs.access.mockResolvedValueOnce(undefined)

      await instanceManager.ensureDataDirectory()

      expect(mockFs.mkdir).not.toHaveBeenCalled()
    })

    it('handles mkdir errors gracefully', async () => {
      const dataDir = (instanceManager as any).getDataDirectory()

      // Mock access to fail, then mkdir to fail
      mockFs.access.mockRejectedValueOnce(new Error('ENOENT'))
      mockFs.mkdir.mockRejectedValueOnce(new Error('EACCES'))

      await expect(instanceManager.ensureDataDirectory()).rejects.toThrow(
        'EACCES'
      )
    })
  })

  describe('createInstance', () => {
    beforeEach(() => {
      // Mock successful file operations
      mockFs.access.mockResolvedValue(undefined)
      mockFs.readFile.mockResolvedValue('{"instances": {}, "lastCleanup": 0}')
      mockFs.writeFile.mockResolvedValue(undefined)
      mockFs.open.mockResolvedValue({
        close: vi.fn().mockResolvedValue(undefined)
      })
      mockFs.unlink.mockResolvedValue(undefined)
    })

    it('ensures data directory exists before creating lock file', async () => {
      const ensureDataDirectorySpy = vi.spyOn(
        instanceManager,
        'ensureDataDirectory'
      )

      await instanceManager.createInstance('chrome', '/mock/project')

      expect(ensureDataDirectorySpy).toHaveBeenCalled()
    })

    it('creates instance successfully with proper data', async () => {
      const instance = await instanceManager.createInstance(
        'chrome',
        '/mock/project'
      )

      expect(instance).toMatchObject({
        browser: 'chrome',
        projectPath: '/mock/project',
        status: 'running',
        processId: process.pid
      })
      expect(instance.instanceId).toHaveLength(16)
      expect(instance.port).toBeGreaterThanOrEqual(8080)
      expect(instance.webSocketPort).toBeGreaterThanOrEqual(9000)
    })

    it('handles lock file creation failure gracefully', async () => {
      // Mock lock file creation to fail
      mockFs.open.mockRejectedValueOnce(new Error('ENOENT'))

      await expect(
        instanceManager.createInstance('chrome', '/mock/project')
      ).rejects.toThrow('ENOENT')
    })

    it('retries lock file creation on EEXIST', async () => {
      // Mock first attempt to fail with EEXIST, second to succeed
      mockFs.open
        .mockRejectedValueOnce({code: 'EEXIST'})
        .mockResolvedValueOnce({
          close: vi.fn().mockResolvedValue(undefined)
        })

      const instance = await instanceManager.createInstance(
        'chrome',
        '/mock/project'
      )

      expect(instance).toBeDefined()
      expect(mockFs.open).toHaveBeenCalledTimes(2)
    })

    it('fails after maximum retry attempts', async () => {
      // Mock all attempts to fail with EEXIST
      for (let i = 0; i < 10; i++) {
        mockFs.open.mockRejectedValueOnce({code: 'EEXIST'})
      }

      // The method should now fail after all retries because we added a lock check
      await expect(
        instanceManager.createInstance('chrome', '/mock/project')
      ).rejects.toThrow('Failed to acquire instance lock after 10 attempts')

      expect(mockFs.open).toHaveBeenCalledTimes(10)
    })
  })

  describe('port allocation', () => {
    beforeEach(() => {
      // Mock successful file operations
      mockFs.access.mockResolvedValue(undefined)
      mockFs.readFile.mockResolvedValue('{"instances": {}, "lastCleanup": 0}')
      mockFs.writeFile.mockResolvedValue(undefined)
      mockFs.open.mockResolvedValue({
        close: vi.fn().mockResolvedValue(undefined)
      })
      mockFs.unlink.mockResolvedValue(undefined)
    })

    it('creates instances with valid port ranges', async () => {
      const instance = await instanceManager.createInstance(
        'chrome',
        '/mock/project'
      )

      // Verify port is within expected range
      expect(instance.port).toBeGreaterThanOrEqual(8080)
      expect(instance.port).toBeLessThan(8100) // Reasonable upper bound
      expect(instance.webSocketPort).toBeGreaterThanOrEqual(9000)
      expect(instance.webSocketPort).toBeLessThan(9100) // Reasonable upper bound
    })

    it('respects requested port when available', async () => {
      const requestedPort = 8085

      // Mock port availability to return true for the requested port
      const mockIsPortAvailable = vi.spyOn(
        instanceManager as any,
        'isPortAvailable'
      )
      mockIsPortAvailable.mockResolvedValue(true)

      const instance = await instanceManager.createInstance(
        'chrome',
        '/mock/project',
        requestedPort
      )

      expect(instance.port).toBe(requestedPort)
    })

    it('generates unique instance IDs for different instances', async () => {
      const instance1 = await instanceManager.createInstance(
        'chrome',
        '/mock/project'
      )
      const instance2 = await instanceManager.createInstance(
        'chrome',
        '/mock/project'
      )

      expect(instance1.instanceId).not.toBe(instance2.instanceId)
      expect(instance1.instanceId).toHaveLength(16)
      expect(instance2.instanceId).toHaveLength(16)
    })
  })

  describe('cleanup and health monitoring', () => {
    it('cleans up terminated instances', async () => {
      // Create an instance first
      mockFs.access.mockResolvedValue(undefined)
      mockFs.readFile.mockResolvedValue('{"instances": {}, "lastCleanup": 0}')
      mockFs.writeFile.mockResolvedValue(undefined)
      mockFs.open.mockResolvedValue({
        close: vi.fn().mockResolvedValue(undefined)
      })
      mockFs.unlink.mockResolvedValue(undefined)

      await instanceManager.createInstance('chrome', '/mock/project')

      // Mock cleanup to find old instances
      const mockCleanup = vi.spyOn(
        instanceManager as any,
        'cleanupTerminatedInstances'
      )

      await instanceManager.forceCleanupOrphanedInstances()

      expect(mockCleanup).toHaveBeenCalled()
    })
  })
})

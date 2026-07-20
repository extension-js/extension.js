import * as net from 'node:net'
import {afterEach, describe, expect, it} from 'vitest'
import {PortManager} from '../port-manager'

describe('PortManager instance ids', () => {
  const OLD_ENV = {...process.env}

  afterEach(() => {
    process.env = {...OLD_ENV}
  })

  it('uses EXTENSION_INSTANCE_ID when provided', async () => {
    process.env = {
      ...OLD_ENV,
      EXTENSION_INSTANCE_ID: 'firefox-suite:content-react/attempt-1'
    }

    const manager = new PortManager(48080)
    const allocation = await manager.allocatePorts()

    expect(allocation.instanceId).toBe('firefox-suite-content-react-attempt-1')
  })

  it('generates a random instance id when no override is provided', async () => {
    process.env = {...OLD_ENV}
    delete process.env.EXTENSION_INSTANCE_ID
    delete process.env.EXTENSION_DEV_INSTANCE_ID
    delete process.env.EXTJS_INSTANCE_ID

    const manager = new PortManager(48180)
    const allocation = await manager.allocatePorts()

    expect(allocation.instanceId).toMatch(/^[a-f0-9]{16}$/)
  })
})

describe('PortManager port 0 (OS-assigned)', () => {
  it('allocates a real port when requestedPort is 0', async () => {
    const manager = new PortManager()
    const allocation = await manager.allocatePorts(0)

    expect(allocation.port).toBeGreaterThan(0)
    expect(allocation.port).toBeLessThan(65536)
  })

  it('does not return port 0 as the allocated port', async () => {
    const manager = new PortManager()
    const allocation = await manager.allocatePorts(0)

    expect(allocation.port).not.toBe(0)
  })

  it('falls back to basePort when requestedPort is undefined', async () => {
    const manager = new PortManager(49100)
    const allocation = await manager.allocatePorts()

    expect(allocation.port).toBeGreaterThanOrEqual(49100)
    expect(allocation.port).toBeLessThan(49200)
  })
})

describe('PortManager host-aware probing', () => {
  it('probes the requested host, skipping a port taken there', async () => {
    const host = '127.0.0.1'
    const taken = 49533
    const blocker = net.createServer()
    await new Promise<void>((resolve, reject) => {
      blocker.once('error', reject)
      blocker.listen(taken, host, resolve)
    })

    try {
      const allocation = await new PortManager().allocatePorts(taken, host)
      expect(allocation.port).toBeGreaterThan(taken)
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()))
    }
  })
})

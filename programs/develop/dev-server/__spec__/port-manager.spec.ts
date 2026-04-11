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

    const manager = new PortManager('firefox', '/tmp/project', 48080)
    const allocation = await manager.allocatePorts('firefox', '/tmp/project')

    expect(allocation.instanceId).toBe('firefox-suite-content-react-attempt-1')
  })

  it('generates a random instance id when no override is provided', async () => {
    process.env = {...OLD_ENV}
    delete process.env.EXTENSION_INSTANCE_ID
    delete process.env.EXTENSION_DEV_INSTANCE_ID
    delete process.env.EXTJS_INSTANCE_ID

    const manager = new PortManager('firefox', '/tmp/project', 48180)
    const allocation = await manager.allocatePorts('firefox', '/tmp/project')

    expect(allocation.instanceId).toMatch(/^[a-f0-9]{16}$/)
  })
})

describe('PortManager port 0 (OS-assigned)', () => {
  it('allocates real ports when requestedPort is 0', async () => {
    const manager = new PortManager('chrome', '/tmp/project')
    const allocation = await manager.allocatePorts('chrome', '/tmp/project', 0)

    expect(allocation.port).toBeGreaterThan(0)
    expect(allocation.port).toBeLessThan(65536)
    expect(allocation.webSocketPort).toBeGreaterThan(0)
    expect(allocation.webSocketPort).toBeLessThan(65536)
    expect(allocation.webSocketPort).not.toBe(allocation.port)
  })

  it('does not return port 0 as the allocated port', async () => {
    const manager = new PortManager('chrome', '/tmp/project')
    const allocation = await manager.allocatePorts('chrome', '/tmp/project', 0)

    expect(allocation.port).not.toBe(0)
    expect(allocation.webSocketPort).not.toBe(0)
  })

  it('falls back to basePort when requestedPort is undefined', async () => {
    const manager = new PortManager('chrome', '/tmp/project', 49100)
    const allocation = await manager.allocatePorts('chrome', '/tmp/project')

    // Should start searching from basePort 49100
    expect(allocation.port).toBeGreaterThanOrEqual(49100)
    expect(allocation.port).toBeLessThan(49200)
  })
})

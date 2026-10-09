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

describe('PortManager port reservation', () => {
  function bind(port: number, host = '127.0.0.1') {
    return new Promise<net.Server>((resolve, reject) => {
      const server = net.createServer()
      server.once('error', reject)
      server.listen(port, host, () => resolve(server))
    })
  }

  it('keeps the allocated port taken until the dev server binds it', async () => {
    const manager = new PortManager(49640)
    const {port} = await manager.allocatePorts(49640, '127.0.0.1')

    await expect(bind(port)).rejects.toMatchObject({code: 'EADDRINUSE'})

    await manager.releaseReservedPort()
    const late = await bind(port)

    try {
      expect((late.address() as net.AddressInfo).port).toBe(port)
    } finally {
      await new Promise<void>((resolve) => late.close(() => resolve()))
    }
  })

  it('steps a session that starts while the first one boots to the next port', async () => {
    const first = new PortManager(49660)
    const second = new PortManager(49660)

    // The first session is still loading config and building its compiler, so
    // it has not bound anything yet when the second one asks.
    const booting = await first.allocatePorts(49660, '127.0.0.1')
    const joining = await second.allocatePorts(49660, '127.0.0.1')

    try {
      expect(joining.port).toBeGreaterThan(booting.port)
    } finally {
      await first.terminateCurrentInstance()
      await second.terminateCurrentInstance()
    }
  })

  it('releases the reservation when the instance is terminated', async () => {
    const manager = new PortManager(49680)
    const {port} = await manager.allocatePorts(49680, '127.0.0.1')
    await manager.terminateCurrentInstance()

    const late = await bind(port)
    await new Promise<void>((resolve) => late.close(() => resolve()))
  })
})

describe('PortManager exhaustion', () => {
  it('refuses with the declared port code when no candidate is free', async () => {
    const host = '127.0.0.1'
    const blocker = net.createServer()
    await new Promise<void>((resolve, reject) => {
      blocker.once('error', reject)
      blocker.listen(65535, host, resolve)
    })

    try {
      await expect(
        new PortManager().allocatePorts(65535, host)
      ).rejects.toMatchObject({code: 'E_PORT_UNAVAILABLE'})
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()))
    }
  })
})

describe('PortManager host-aware probing', () => {
  it('probes the requested host, skipping a port taken there', async () => {
    const host = '127.0.0.1'
    const blocker = net.createServer()
    // An ephemeral port, since any fixed one can already be held on the host.
    await new Promise<void>((resolve, reject) => {
      blocker.once('error', reject)
      blocker.listen(0, host, resolve)
    })

    const taken = (blocker.address() as net.AddressInfo).port

    try {
      const allocation = await new PortManager().allocatePorts(taken, host)
      expect(allocation.port).toBeGreaterThan(taken)
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()))
    }
  })
})

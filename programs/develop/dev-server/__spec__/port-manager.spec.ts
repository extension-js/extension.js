import * as net from 'node:net'
import {afterEach, describe, expect, it} from 'vitest'
import {PortManager} from '../port-manager'

// A base the OS just handed out sits inside a range this host can bind, which
// a constant cannot promise: Windows runners exclude whole blocks of the
// 49xxx dynamic range, and the manager probes twenty ports from the base.
function freeBase(host = '127.0.0.1') {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, host, () => {
      const {port} = server.address() as net.AddressInfo
      server.close(() => resolve(port))
    })
  })
}

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

    const manager = new PortManager(await freeBase())
    const allocation = await manager.allocatePorts()

    expect(allocation.instanceId).toBe('firefox-suite-content-react-attempt-1')
  })

  it('generates a random instance id when no override is provided', async () => {
    process.env = {...OLD_ENV}
    delete process.env.EXTENSION_INSTANCE_ID
    delete process.env.EXTENSION_DEV_INSTANCE_ID
    delete process.env.EXTJS_INSTANCE_ID

    const manager = new PortManager(await freeBase())
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
    const base = await freeBase()
    const manager = new PortManager(base)
    const allocation = await manager.allocatePorts()

    expect(allocation.port).toBeGreaterThanOrEqual(base)
    expect(allocation.port).toBeLessThan(base + 100)
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
    const base = await freeBase()
    const manager = new PortManager(base)
    const {port} = await manager.allocatePorts(base, '127.0.0.1')

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
    const base = await freeBase()
    const first = new PortManager(base)
    const second = new PortManager(base)

    // The first session is still loading config and building its compiler, so
    // it has not bound anything yet when the second one asks.
    const booting = await first.allocatePorts(base, '127.0.0.1')
    const joining = await second.allocatePorts(base, '127.0.0.1')

    try {
      expect(joining.port).toBeGreaterThan(booting.port)
    } finally {
      await first.terminateCurrentInstance()
      await second.terminateCurrentInstance()
    }
  })

  it('releases the reservation when the instance is terminated', async () => {
    const base = await freeBase()
    const manager = new PortManager(base)
    const {port} = await manager.allocatePorts(base, '127.0.0.1')
    await manager.terminateCurrentInstance()

    const late = await bind(port)
    await new Promise<void>((resolve) => late.close(() => resolve()))
  })
})

describe('PortManager exhaustion', () => {
  it('refuses with the declared port code when no candidate is free', async () => {
    const host = '127.0.0.1'
    const blocker = net.createServer()
    const ownsBlocker = await new Promise<boolean>((resolve, reject) => {
      blocker.once('error', (error: NodeJS.ErrnoException) =>
        error.code === 'EADDRINUSE' ? resolve(false) : reject(error)
      )

      blocker.listen(65535, host, () => resolve(true))
    })

    try {
      await expect(
        new PortManager().allocatePorts(65535, host)
      ).rejects.toMatchObject({code: 'E_PORT_UNAVAILABLE'})
    } finally {
      if (ownsBlocker) {
        await new Promise<void>((resolve) => blocker.close(() => resolve()))
      }
    }
  })
})

function listenOn(port: number, host: string): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(port, host, () => resolve(server))
  })
}

async function portWithFreeNeighbor(host: string): Promise<number> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const first = await listenOn(0, host)
    const {port} = first.address() as net.AddressInfo
    const start = port > 60000 ? port - 2000 : port
    await new Promise((resolve) => first.close(resolve))

    try {
      const pair = [await listenOn(start, host)]

      try {
        pair.push(await listenOn(start + 1, host))
      } finally {
        await Promise.all(
          pair.map((server) => new Promise((resolve) => server.close(resolve)))
        )
      }

      if (pair.length === 2) return start
    } catch {
      // Held or reserved, so another start is tried.
    }
  }

  throw new Error('no port with a free neighbor to probe')
}

describe('PortManager host-aware probing', () => {
  it('probes the requested host, skipping a port taken there', async () => {
    const host = '127.0.0.1'
    // A port the system names with a free neighbor above it, since on a busy
    // host the ports beside an ephemeral one can all be held or reserved.
    const taken = await portWithFreeNeighbor(host)
    const blocker = await listenOn(taken, host)

    try {
      const allocation = await new PortManager().allocatePorts(taken, host)
      expect(allocation.port).toBeGreaterThan(taken)
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()))
    }
  })
})

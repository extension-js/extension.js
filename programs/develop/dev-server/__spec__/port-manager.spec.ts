import * as net from 'node:net'
import {afterEach, describe, expect, it} from 'vitest'
import {exportInstanceId, PortManager} from '../port-manager'

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

describe('the instance id a session exports for its compilers', () => {
  const OLD_ENV = {...process.env}

  afterEach(() => {
    process.env = {...OLD_ENV}
  })

  it('is not read as a pin by the next session of the same host', async () => {
    process.env = {...OLD_ENV}
    delete process.env.EXTENSION_INSTANCE_ID
    delete process.env.EXTENSION_DEV_INSTANCE_ID
    delete process.env.EXTJS_INSTANCE_ID

    // Two sessions live at once, then one after both ended.
    const first = new PortManager(await freeBase())
    const a = await first.allocatePorts()
    const restoreA = exportInstanceId(a.instanceId)
    expect(process.env.EXTENSION_INSTANCE_ID).toBe(a.instanceId)

    const second = new PortManager(await freeBase())
    const b = await second.allocatePorts()
    const restoreB = exportInstanceId(b.instanceId)
    expect(b.instanceId).not.toBe(a.instanceId)
    expect(second.getCurrentInstance()?.instanceExplicit).toBe(false)

    restoreB()
    restoreA()
    expect(process.env.EXTENSION_INSTANCE_ID).toBeUndefined()

    const third = new PortManager(await freeBase())
    const c = await third.allocatePorts()
    expect([a.instanceId, b.instanceId]).not.toContain(c.instanceId)

    for (const manager of [first, second, third]) {
      await manager.terminateCurrentInstance()
    }
  })

  it('gives the environment back the pin a user set', async () => {
    process.env = {...OLD_ENV, EXTENSION_INSTANCE_ID: 'pinned'}

    const manager = new PortManager(await freeBase())
    const allocation = await manager.allocatePorts()
    expect(allocation.instanceId).toBe('pinned')
    expect(manager.getCurrentInstance()?.instanceExplicit).toBe(true)

    // A drawn id exported over a pin puts the pin back when it leaves.
    const restore = exportInstanceId('drawn-by-a-session')
    restore()
    expect(process.env.EXTENSION_INSTANCE_ID).toBe('pinned')
    await manager.terminateCurrentInstance()
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

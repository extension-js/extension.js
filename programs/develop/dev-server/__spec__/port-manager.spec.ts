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

describe('the instance id a session exports for its compilers', () => {
  const OLD_ENV = {...process.env}

  afterEach(() => {
    process.env = {...OLD_ENV}
  })

  it('is drawn for each session and never written to the environment', async () => {
    process.env = {...OLD_ENV}
    delete process.env.EXTENSION_INSTANCE_ID
    delete process.env.EXTENSION_DEV_INSTANCE_ID
    delete process.env.EXTJS_INSTANCE_ID

    // Two sessions live at once, then one after both ended.
    const first = new PortManager(await freeBase())
    const a = await first.allocatePorts()
    const second = new PortManager(await freeBase())
    const b = await second.allocatePorts()

    expect(b.instanceId).not.toBe(a.instanceId)
    expect(second.getCurrentInstance()?.instanceExplicit).toBe(false)
    expect(process.env.EXTENSION_INSTANCE_ID).toBeUndefined()

    const third = new PortManager(await freeBase())
    const c = await third.allocatePorts()

    expect([a.instanceId, b.instanceId]).not.toContain(c.instanceId)
    expect(process.env.EXTENSION_INSTANCE_ID).toBeUndefined()

    for (const manager of [first, second, third]) {
      await manager.terminateCurrentInstance()
    }
  })

  it('leaves the pin a user set where the user set it', async () => {
    process.env = {...OLD_ENV, EXTENSION_INSTANCE_ID: 'pinned'}

    const manager = new PortManager(await freeBase())
    const allocation = await manager.allocatePorts()

    expect(allocation.instanceId).toBe('pinned')
    expect(manager.getCurrentInstance()?.instanceExplicit).toBe(true)

    await manager.terminateCurrentInstance()
    expect(process.env.EXTENSION_INSTANCE_ID).toBe('pinned')
  })
})

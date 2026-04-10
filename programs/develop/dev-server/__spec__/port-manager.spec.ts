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

import {spawnSync} from 'node:child_process'
import {afterEach, describe, expect, it, vi} from 'vitest'

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const previousPath = process.env.PATH
const platform = Object.getOwnPropertyDescriptor(process, 'platform')

// The answer is kept for the life of the module, so each case loads its own.
async function freshOwnProcessStartedAt(): Promise<() => string> {
  vi.resetModules()

  return (await import('../process-started-at')).ownProcessStartedAt
}

function ownClockStart(): number {
  return Date.now() - process.uptime() * 1000
}

afterEach(() => {
  process.env.PATH = previousPath
  if (platform) Object.defineProperty(process, 'platform', platform)
})

describe('ownProcessStartedAt', () => {
  it('answers an ISO 8601 UTC instant close to when this process started', async () => {
    const ownProcessStartedAt = await freshOwnProcessStartedAt()
    const startedAt = ownProcessStartedAt()

    expect(startedAt).toMatch(ISO)
    // ps answers in whole seconds and the own clock a few milliseconds late.
    expect(Math.abs(Date.parse(startedAt) - ownClockStart())).toBeLessThan(2500)
  })

  it.skipIf(process.platform === 'win32')(
    'answers what the process table says about this pid',
    async () => {
      const ownProcessStartedAt = await freshOwnProcessStartedAt()
      const table = spawnSync(
        'ps',
        ['-o', 'lstart=', '-p', String(process.pid)],
        {encoding: 'utf-8', env: {...process.env, LC_ALL: 'C'}}
      )

      expect(table.status).toBe(0)
      expect(ownProcessStartedAt()).toBe(
        new Date(Date.parse(table.stdout.trim())).toISOString()
      )
    }
  )

  it('reads the process table once and repeats the same answer', async () => {
    const ownProcessStartedAt = await freshOwnProcessStartedAt()
    const first = ownProcessStartedAt()

    // With no ps to ask, a second read would come off the own clock instead.
    process.env.PATH = ''

    expect(ownProcessStartedAt()).toBe(first)
  })

  it('reads its own clock when the machine has no ps', async () => {
    process.env.PATH = ''

    const ownProcessStartedAt = await freshOwnProcessStartedAt()
    const startedAt = ownProcessStartedAt()

    expect(startedAt).toMatch(ISO)
    expect(Math.abs(Date.parse(startedAt) - ownClockStart())).toBeLessThan(50)
  })

  it('reads its own clock on Windows without asking ps', async () => {
    Object.defineProperty(process, 'platform', {value: 'win32'})

    const ownProcessStartedAt = await freshOwnProcessStartedAt()
    const startedAt = ownProcessStartedAt()

    expect(startedAt).toMatch(ISO)
    expect(Math.abs(Date.parse(startedAt) - ownClockStart())).toBeLessThan(50)
  })
})

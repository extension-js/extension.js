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

describe('processStartId', () => {
  // Field 22 is the start tick. The command name may hold spaces and
  // parentheses, so nothing before the last one is counted.
  const STAT =
    '4242 (node (dev) x) S 1 4242 4242 0 -1 4194304 100 0 0 0 5 3 0 0 20 0 11 0 987654 1000000 200 18446744073709551615 1 1 0 0 0 0 0 0 0 0 0 0 17 3 0 0 0 0 0'

  const reading = (files: Record<string, string>) => ({
    platform: 'linux' as const,
    readFile: (file: string) => {
      if (!(file in files)) throw new Error(`ENOENT ${file}`)

      return files[file]
    }
  })

  it('joins the boot id and the start tick of the pid on Linux', async () => {
    const {processStartId} = await import('../process-started-at')

    expect(
      processStartId(
        4242,
        reading({
          '/proc/4242/stat': STAT,
          '/proc/sys/kernel/random/boot_id': 'boot-a\n'
        })
      )
    ).toBe('boot-a:987654')
  })

  it('answers nothing off Linux, for a pid that is gone or a bad pid', async () => {
    const {processStartId} = await import('../process-started-at')
    const files = {
      '/proc/4242/stat': STAT,
      '/proc/sys/kernel/random/boot_id': 'boot-a\n'
    }

    expect(
      processStartId(4242, {...reading(files), platform: 'darwin'})
    ).toBeUndefined()

    expect(processStartId(7, reading(files))).toBeUndefined()
    expect(processStartId(0, reading(files))).toBeUndefined()
    expect(
      processStartId(4242, reading({'/proc/4242/stat': STAT}))
    ).toBeUndefined()
  })

  it.runIf(process.platform === 'linux')(
    'names this process the same way twice and a child differently',
    async () => {
      const {processStartId} = await import('../process-started-at')
      const own = processStartId(process.pid)

      expect(own).toMatch(/^[0-9a-f-]{36}:\d+$/)
      expect(processStartId(process.pid)).toBe(own)
      expect(processStartId(process.ppid)).not.toBe(own)
    }
  )
})

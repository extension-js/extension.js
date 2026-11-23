import {afterEach, describe, expect, it, vi} from 'vitest'

// Only the two spawn calls are faked, so no taskkill runs on this machine.
const calls = vi.hoisted(() => ({
  sync: [] as unknown[][],
  async: [] as unknown[][]
}))

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()

  return {
    ...actual,
    spawnSync: (...args: unknown[]) => {
      calls.sync.push(args)

      return {status: 0}
    },
    spawn: (...args: unknown[]) => {
      calls.async.push(args)

      return {on: () => undefined}
    }
  }
})

const {killProcessTree, windowsTaskkillPath} = await import(
  '../../browsers-lib/process-teardown'
)

// Above every platform's pid ceiling, so a signal that slips through names
// no process on this machine.
const PID = 2 ** 30

afterEach(() => {
  calls.sync.length = 0
  calls.async.length = 0
  vi.restoreAllMocks()
})

describe('killProcessTree', () => {
  it.each([
    ['waits for the system taskkill when asked to', true, 'sync'],
    ['starts the system taskkill and returns', false, 'async']
  ] as const)('on Windows %s', (_name, sync, kind) => {
    killProcessTree(PID, {sync, platform: 'win32'})

    expect(calls[kind]).toEqual([
      [
        windowsTaskkillPath(),
        ['/PID', String(PID), '/T', '/F'],
        {stdio: 'ignore', windowsHide: true}
      ]
    ])

    expect(calls[kind === 'sync' ? 'async' : 'sync']).toEqual([])
  })

  it('on Windows bounds the wait for taskkill when given one', () => {
    killProcessTree(PID, {sync: true, platform: 'win32', waitMs: 5000})

    expect(calls.sync).toEqual([
      [
        windowsTaskkillPath(),
        ['/PID', String(PID), '/T', '/F'],
        {stdio: 'ignore', windowsHide: true, timeout: 5000}
      ]
    ])

    expect(calls.async).toEqual([])
  })

  it('ends the process group elsewhere, with no taskkill', () => {
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)

    killProcessTree(PID, {platform: 'linux'})

    expect(kill.mock.calls).toEqual([[-PID, 'SIGKILL']])
    expect(calls.sync).toEqual([])
    expect(calls.async).toEqual([])
  })

  it('survives a group that is already gone', () => {
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('kill ESRCH'), {code: 'ESRCH'})
    })

    expect(() => killProcessTree(PID, {platform: 'darwin'})).not.toThrow()
  })

  it('sends nothing without a pid', () => {
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)

    killProcessTree(undefined, {platform: 'win32'})
    killProcessTree(undefined, {platform: 'linux'})

    expect(kill).not.toHaveBeenCalled()
    expect(calls.sync).toEqual([])
    expect(calls.async).toEqual([])
  })
})

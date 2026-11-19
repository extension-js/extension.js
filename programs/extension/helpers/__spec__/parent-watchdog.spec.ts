import {type ChildProcess, spawn} from 'node:child_process'
import {once} from 'node:events'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {parseParentPid, setupParentWatchdog} from '../parent-watchdog'

// Above every platform's pid ceiling, so no process can hold it.
const DEAD_PID = 2 ** 30
const POLL_MS = 20

const cancels: Array<() => void> = []
const children: ChildProcess[] = []

afterEach(() => {
  while (cancels.length > 0) cancels.pop()?.()
  for (const child of children.splice(0)) child.kill('SIGKILL')

  vi.useRealTimers()
})

async function liveParent(): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'])

  children.push(child)
  await once(child, 'spawn')

  return child
}

async function kill(child: ChildProcess) {
  child.kill('SIGKILL')
  await once(child, 'exit')
}

describe('parseParentPid', () => {
  it.each([
    ['1234', 1234],
    ['4242', 4242],
    [42, 42]
  ])('reads %j as the pid %i', (value, pid) => {
    expect(parseParentPid(value)).toBe(pid)
  })

  it.each([
    '0',
    '-1',
    '-5',
    'abc',
    'zero',
    '1e3',
    '12abc',
    '1.5',
    '',
    undefined
  ])('reads no pid from %j', (value) => {
    expect(parseParentPid(value)).toBeUndefined()
  })
})

describe('setupParentWatchdog', () => {
  it('logs, frames, then shuts down, once, when the parent is already dead', () => {
    const order: string[] = []

    cancels.push(
      setupParentWatchdog(DEAD_PID, {
        log: (line) => order.push(`log: ${line}`),
        emitFrame: () => order.push('frame'),
        onDeath: () => order.push('shutdown'),
        pollIntervalMs: POLL_MS
      })
    )

    expect(order).toEqual([
      `log: ⏵⏵⏵ Error: Parent process ${DEAD_PID} is gone (--parent-pid). Shutting down.`,
      'frame',
      'shutdown'
    ])
  })

  it('stays quiet while the parent lives, fires once when it dies', async () => {
    const order: string[] = []
    const parent = await liveParent()

    vi.useFakeTimers()
    cancels.push(
      setupParentWatchdog(parent.pid as number, {
        log: () => order.push('log'),
        emitFrame: () => order.push('frame'),
        onDeath: () => order.push('shutdown'),
        pollIntervalMs: POLL_MS
      })
    )

    vi.advanceTimersByTime(POLL_MS * 5)
    expect(order).toEqual([])

    await kill(parent)
    vi.advanceTimersByTime(POLL_MS)
    expect(order).toEqual(['log', 'frame', 'shutdown'])

    // The poll stops with the first report: later ticks say nothing more.
    vi.advanceTimersByTime(POLL_MS * 5)
    expect(order).toEqual(['log', 'frame', 'shutdown'])
  })

  it('cancel stops the watchdog', async () => {
    const onDeath = vi.fn()
    const parent = await liveParent()

    vi.useFakeTimers()

    const cancel = setupParentWatchdog(parent.pid as number, {
      onDeath,
      log: () => {},
      pollIntervalMs: POLL_MS
    })

    expect(vi.getTimerCount()).toBe(1)
    cancel()
    expect(vi.getTimerCount()).toBe(0)

    await kill(parent)
    vi.advanceTimersByTime(POLL_MS * 5)
    expect(onDeath).not.toHaveBeenCalled()
  })
})

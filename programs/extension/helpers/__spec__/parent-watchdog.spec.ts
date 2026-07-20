import {spawn} from 'node:child_process'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {parseParentPid, setupParentWatchdog} from '../parent-watchdog'

const cancels: Array<() => void> = []

afterEach(() => {
  while (cancels.length > 0) cancels.pop()!()
})

function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const tick = () => {
      if (predicate()) return resolve()
      if (Date.now() - start > timeoutMs) {
        return reject(new Error('waitFor timed out'))
      }
      setTimeout(tick, 20)
    }
    tick()
  })
}

describe('parseParentPid', () => {
  it('accepts positive integers, rejects everything else', () => {
    expect(parseParentPid('1234')).toBe(1234)
    expect(parseParentPid(42)).toBe(42)
    expect(parseParentPid('0')).toBeUndefined()
    expect(parseParentPid('-5')).toBeUndefined()
    expect(parseParentPid('abc')).toBeUndefined()
    expect(parseParentPid('')).toBeUndefined()
    expect(parseParentPid(undefined)).toBeUndefined()
  })
})

describe('setupParentWatchdog', () => {
  it('fires immediately when the parent pid is already dead', () => {
    const onDeath = vi.fn()
    const cancel = setupParentWatchdog(2 ** 30, {
      onDeath,
      log: () => {},
      pollIntervalMs: 20
    })
    cancels.push(cancel)
    expect(onDeath).toHaveBeenCalledTimes(1)
  })

  it('stays quiet while the parent lives, fires when it dies', async () => {
    const onDeath = vi.fn()
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'])
    await waitFor(() => typeof child.pid === 'number')

    const cancel = setupParentWatchdog(child.pid!, {
      onDeath,
      log: () => {},
      pollIntervalMs: 20
    })
    cancels.push(cancel)

    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(onDeath).not.toHaveBeenCalled()

    child.kill('SIGKILL')
    await waitFor(() => onDeath.mock.calls.length > 0)
    expect(onDeath).toHaveBeenCalledTimes(1)
  })

  it('cancel stops the watchdog', async () => {
    const onDeath = vi.fn()
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'])
    await waitFor(() => typeof child.pid === 'number')

    const cancel = setupParentWatchdog(child.pid!, {
      onDeath,
      log: () => {},
      pollIntervalMs: 20
    })
    cancel()

    child.kill('SIGKILL')
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(onDeath).not.toHaveBeenCalled()
  })
})

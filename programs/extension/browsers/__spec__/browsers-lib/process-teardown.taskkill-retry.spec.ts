import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  FORCE_KILL_GRACE_MS,
  forceWindowsTree,
  TASKKILL_RETRIES,
  TASKKILL_RETRY_MS
} from '../../browsers-lib/process-teardown'

const PID = 4242

// Each taskkill answers with the next code on the list, then with the last.
function scriptedTaskkill(codes: Array<number | null>) {
  const asked: number[] = []

  const start = (pid: number, done: (code: number | null) => void) => {
    const code = codes[Math.min(asked.length, codes.length - 1)]

    asked.push(pid)
    done(code)
  }

  return {asked, start}
}

describe('the forced end of a browser tree on Windows', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs one taskkill when the first one ends the tree', () => {
    const {asked, start} = scriptedTaskkill([0])

    forceWindowsTree(PID, start, () => true)
    vi.advanceTimersByTime(FORCE_KILL_GRACE_MS)

    expect(asked).toEqual([PID])
  })

  it('runs a failed taskkill again long before the grace ends', () => {
    const {asked, start} = scriptedTaskkill([1, 0])

    forceWindowsTree(PID, start, () => true)
    expect(asked).toEqual([PID])

    vi.advanceTimersByTime(TASKKILL_RETRY_MS)

    expect(asked).toEqual([PID, PID])
    expect(TASKKILL_RETRY_MS * TASKKILL_RETRIES).toBeLessThan(
      FORCE_KILL_GRACE_MS / 10
    )
  })

  it('runs a taskkill that could not start again', () => {
    const {asked, start} = scriptedTaskkill([null, 0])

    forceWindowsTree(PID, start, () => true)
    vi.advanceTimersByTime(TASKKILL_RETRY_MS)

    expect(asked).toEqual([PID, PID])
  })

  it('stops after its retries when every taskkill fails', () => {
    const {asked, start} = scriptedTaskkill([1])

    forceWindowsTree(PID, start, () => true)
    vi.advanceTimersByTime(FORCE_KILL_GRACE_MS)

    expect(asked).toHaveLength(1 + TASKKILL_RETRIES)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not run again for a pid taskkill did not find', () => {
    const {asked, start} = scriptedTaskkill([128])

    forceWindowsTree(PID, start, () => true)
    vi.advanceTimersByTime(FORCE_KILL_GRACE_MS)

    expect(asked).toEqual([PID])
  })

  it('does not run again once the pid is gone', () => {
    const {asked, start} = scriptedTaskkill([1])

    forceWindowsTree(PID, start, () => false)
    vi.advanceTimersByTime(FORCE_KILL_GRACE_MS)

    expect(asked).toEqual([PID])
  })
})

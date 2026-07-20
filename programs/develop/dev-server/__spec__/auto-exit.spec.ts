import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {setupAutoExit} from '../auto-exit'

describe('auto-exit', () => {
  const originalLog = console.log
  const originalExit = process.exit

  beforeEach(() => {
    vi.useFakeTimers()
    console.log = vi.fn()
    // @ts-expect-error override for test
    process.exit = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
    console.log = originalLog
    process.exit = originalExit as any
  })

  it('returns no-op when auto-exit is disabled', () => {
    const onCleanup = vi.fn().mockResolvedValue(undefined)
    const cancel = setupAutoExit(undefined, undefined as any, onCleanup)
    expect(typeof cancel).toBe('function')
    vi.advanceTimersByTime(10_000)
    expect(onCleanup).not.toHaveBeenCalled()
    expect(process.exit).not.toHaveBeenCalled()
  })

  it('triggers cleanup and force-exit after timeouts', async () => {
    const onCleanup = vi.fn().mockResolvedValue(undefined)
    const cancel = setupAutoExit(1000, 2000, onCleanup)
    vi.advanceTimersByTime(1000)
    expect(onCleanup).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1000)
    expect(process.exit).toHaveBeenCalledWith(0)

    cancel()
  })

  it('computes default force-kill timeout as autoExit+4000', () => {
    const onCleanup = vi.fn().mockResolvedValue(undefined)
    setupAutoExit(500, undefined as any, onCleanup)
    vi.advanceTimersByTime(500)
    expect(onCleanup).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(4000)
    expect(process.exit).toHaveBeenCalledWith(0)
  })
})

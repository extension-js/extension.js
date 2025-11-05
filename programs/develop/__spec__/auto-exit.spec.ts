import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import {setupAutoExit} from '../webpack/dev-server/auto-exit'

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
    // Fast-forward to ensure no timers were scheduled
    vi.advanceTimersByTime(10_000)
    expect(onCleanup).not.toHaveBeenCalled()
    expect(process.exit).not.toHaveBeenCalled()
  })

  it('triggers cleanup and force-exit after timeouts', async () => {
    const onCleanup = vi.fn().mockResolvedValue(undefined)
    const cancel = setupAutoExit(1000, 2000, onCleanup)
    // advance to auto-exit
    vi.advanceTimersByTime(1000)
    expect(onCleanup).toHaveBeenCalledTimes(1)

    // advance to force kill
    vi.advanceTimersByTime(1000)
    expect(process.exit).toHaveBeenCalledWith(0)

    // cancel should clear timers without throwing
    cancel()
  })

  it('computes default force-kill timeout as autoExit+4000', () => {
    const onCleanup = vi.fn().mockResolvedValue(undefined)
    setupAutoExit(500, undefined as any, onCleanup)
    // run cleanup
    vi.advanceTimersByTime(500)
    expect(onCleanup).toHaveBeenCalledTimes(1)
    // run default force-kill
    vi.advanceTimersByTime(4000)
    expect(process.exit).toHaveBeenCalledWith(0)
  })
})

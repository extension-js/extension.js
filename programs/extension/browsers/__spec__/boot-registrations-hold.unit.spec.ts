import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  BOOT_REGISTRATIONS_WAIT_MS,
  holdForBootRegistrations
} from '../browsers-lib/boot-registrations-hold'

const URL = 'http://127.0.0.1:8080/page.html'

describe('the hold on the starting url for boot registrations', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // A project that registers nothing is handed no wait and loses no time.
  it('returns at once, with no timer, when no wait was handed over', async () => {
    const warn = vi.fn()

    await expect(holdForBootRegistrations({}, URL, {warn})).resolves.toBe(
      'none'
    )

    expect(vi.getTimerCount()).toBe(0)
    expect(warn).not.toHaveBeenCalled()
  })

  it('holds until the registrations settle, then says nothing', async () => {
    const warn = vi.fn()
    let settle: (outcome: 'settled') => void = () => undefined
    const awaitBootRegistrations = vi.fn(
      () => new Promise<'settled'>((resolve) => (settle = resolve))
    )
    const done = vi.fn()

    void holdForBootRegistrations({awaitBootRegistrations}, URL, {warn}).then(
      done
    )

    await vi.advanceTimersByTimeAsync(1400)

    expect(awaitBootRegistrations).toHaveBeenCalledWith(
      BOOT_REGISTRATIONS_WAIT_MS
    )

    expect(done).not.toHaveBeenCalled()

    settle('settled')
    await vi.advanceTimersByTimeAsync(0)

    expect(done).toHaveBeenCalledWith('settled')
    expect(warn).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('opens anyway and says so in one line when the wait runs out', async () => {
    const warn = vi.fn()
    const awaitBootRegistrations = vi.fn(
      (timeoutMs: number) =>
        new Promise<'timeout'>((resolve) =>
          setTimeout(() => resolve('timeout'), timeoutMs)
        )
    )
    const done = vi.fn()

    void holdForBootRegistrations({awaitBootRegistrations}, URL, {warn}).then(
      done
    )

    await vi.advanceTimersByTimeAsync(BOOT_REGISTRATIONS_WAIT_MS - 1)

    expect(done).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)

    expect(done).toHaveBeenCalledWith('timeout')
    expect(warn).toHaveBeenCalledTimes(1)

    const line = String(warn.mock.calls[0][0])

    expect(line).toContain(URL)
    expect(line).toContain('waited 5s')
    expect(line).not.toContain('\n')
  })

  // The bound is this side's own too: a wait that never answers cannot
  // keep the session from opening its page.
  it('opens the page when the wait never answers', async () => {
    const warn = vi.fn()
    const done = vi.fn()

    void holdForBootRegistrations(
      {awaitBootRegistrations: () => new Promise(() => undefined)},
      URL,
      {warn, timeoutMs: 1000}
    ).then(done)

    await vi.advanceTimersByTimeAsync(1000)

    expect(done).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(250)

    expect(done).toHaveBeenCalledWith('timeout')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('waited 1s')
  })

  it('opens the page when the wait throws', async () => {
    const warn = vi.fn()

    await expect(
      holdForBootRegistrations(
        {awaitBootRegistrations: () => Promise.reject(new Error('gone'))},
        URL,
        {warn}
      )
    ).resolves.toBe('timeout')

    expect(warn).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})

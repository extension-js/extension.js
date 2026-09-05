import {afterEach, describe, expect, it, vi} from 'vitest'
import {
  bindDevSessionRestart,
  canAutoRestartDevSession,
  DevSessionRestartScheduler,
  isCompilerRestarting,
  requestDevSessionRestart,
  unbindDevSessionRestart
} from '../session-restart'

const tick = () => new Promise((r) => setTimeout(r, 0))
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

afterEach(() => {
  unbindDevSessionRestart()
})

describe('DevSessionRestartScheduler', () => {
  it('settles a burst of requests into one restart carrying the last one', async () => {
    const handler = vi.fn()
    const scheduler = new DevSessionRestartScheduler(20)
    scheduler.setHandler(handler)

    scheduler.request({reason: 'scripts', pathAfter: '/one.js'})
    scheduler.request({reason: 'scripts', pathAfter: '/two.js'})
    scheduler.request({reason: 'icons', pathAfter: '/icon.png'})
    expect(scheduler.isPending()).toBe(true)

    await sleep(60)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({reason: 'icons', pathAfter: '/icon.png'})
    )
    expect(scheduler.isPending()).toBe(false)
  })

  it('runs one more restart for a request that lands mid-restart', async () => {
    let release: () => void = () => {}
    const handler = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    )
    const scheduler = new DevSessionRestartScheduler(0)
    scheduler.setHandler(handler)

    scheduler.request({reason: 'scripts', pathAfter: '/first.js'})
    await tick()
    expect(handler).toHaveBeenCalledTimes(1)

    scheduler.request({reason: 'scripts', pathAfter: '/second.js'})
    scheduler.request({reason: 'scripts', pathAfter: '/third.js'})
    expect(handler).toHaveBeenCalledTimes(1)

    release()
    await tick()
    await tick()
    expect(handler).toHaveBeenCalledTimes(2)
    expect(handler.mock.calls[1][0]).toMatchObject({pathAfter: '/third.js'})
    release()
  })

  it('keeps serving after a restart handler throws', async () => {
    const handler = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(undefined)
    const scheduler = new DevSessionRestartScheduler(0)
    scheduler.setHandler(handler)

    scheduler.request({reason: 'html', pathAfter: '/a.html'})
    await tick()
    await tick()
    scheduler.request({reason: 'html', pathAfter: '/b.html'})
    await tick()
    await tick()
    expect(handler).toHaveBeenCalledTimes(2)
  })

  it('drops queued work on dispose', async () => {
    const handler = vi.fn()
    const scheduler = new DevSessionRestartScheduler(20)
    scheduler.setHandler(handler)
    scheduler.request({reason: 'json', pathAfter: '/x.json'})
    scheduler.dispose()
    await sleep(40)
    expect(handler).not.toHaveBeenCalled()
  })
})

describe('requestDevSessionRestart', () => {
  it('reports no live session until a scheduler is bound', () => {
    const compiler = {}
    expect(canAutoRestartDevSession()).toBe(false)
    expect(
      requestDevSessionRestart(compiler, {reason: 'scripts', pathAfter: '/a'})
    ).toBe(false)
    expect(isCompilerRestarting(compiler)).toBe(false)
  })

  it('hands the request to the bound scheduler and marks the compiler', async () => {
    const handler = vi.fn()
    const scheduler = new DevSessionRestartScheduler(0)
    scheduler.setHandler(handler)
    bindDevSessionRestart(scheduler)
    const compiler = {}

    expect(canAutoRestartDevSession()).toBe(true)
    expect(
      requestDevSessionRestart(compiler, {reason: 'scripts', pathAfter: '/a'})
    ).toBe(true)
    expect(isCompilerRestarting(compiler)).toBe(true)
    expect(isCompilerRestarting({})).toBe(false)
    await tick()
    expect(handler).toHaveBeenCalledTimes(1)
  })
})

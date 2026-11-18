import {afterEach, describe, expect, it, vi} from 'vitest'
import {
  assignCompilerToDevSession,
  bindDevSessionRestart,
  canAutoRestartDevSession,
  type DevSessionRestartRequest,
  DevSessionRestartScheduler,
  endCompilerRestart,
  isCompilerRestarting,
  isDevSessionRestartPending,
  releaseCompilerFromDevSession,
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
      (_request: DevSessionRestartRequest) =>
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

  it('hands a restart that threw to the failure handler with its request', async () => {
    const failures: Array<[unknown, DevSessionRestartRequest]> = []
    const boom = new Error('boom')
    const scheduler = new DevSessionRestartScheduler(0)
    scheduler.setFailureHandler((error, request) =>
      failures.push([error, request])
    )

    scheduler.setHandler(async () => {
      throw boom
    })

    scheduler.request({reason: 'html', pathAfter: '/a.html'})
    await tick()
    await tick()

    expect(failures).toEqual([[boom, {reason: 'html', pathAfter: '/a.html'}]])
    expect(scheduler.isPending()).toBe(false)
  })

  it('runs the next restart after a failure handler that throws', async () => {
    const handler = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(undefined)
    const scheduler = new DevSessionRestartScheduler(0)
    scheduler.setFailureHandler(() => {
      throw new Error('report broke')
    })

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

  it('lets a compiler report again once its restart is abandoned', () => {
    const scheduler = new DevSessionRestartScheduler(20)
    scheduler.setHandler(() => {})
    bindDevSessionRestart(scheduler)
    const compiler = {}

    requestDevSessionRestart(compiler, {reason: 'env', pathChanged: '/.env'})
    expect(isCompilerRestarting(compiler)).toBe(true)

    endCompilerRestart(compiler)
    expect(isCompilerRestarting(compiler)).toBe(false)
    endCompilerRestart(undefined)
    scheduler.dispose()
  })

  it('sends a request to the session its compiler belongs to', async () => {
    const handlerA = vi.fn()
    const handlerB = vi.fn()
    const a = new DevSessionRestartScheduler(0)
    const b = new DevSessionRestartScheduler(0)
    a.setHandler(handlerA)
    b.setHandler(handlerB)
    const compilerA = {}
    const compilerB = {}
    assignCompilerToDevSession(compilerA, a)
    assignCompilerToDevSession(compilerB, b)

    // Two sessions live in one host, the second bound after the first.
    bindDevSessionRestart(a)
    bindDevSessionRestart(b)

    expect(
      requestDevSessionRestart(compilerA, {reason: 'scripts', pathAfter: '/a'})
    ).toBe(true)

    await tick()
    expect(handlerA).toHaveBeenCalledTimes(1)
    expect(handlerB).not.toHaveBeenCalled()

    // The newer session ends first and the older one goes on restarting.
    unbindDevSessionRestart(b)
    expect(canAutoRestartDevSession()).toBe(true)
    expect(
      requestDevSessionRestart(compilerB, {reason: 'scripts', pathAfter: '/b'})
    ).toBe(false)

    expect(isCompilerRestarting(compilerB)).toBe(false)
    expect(
      requestDevSessionRestart(compilerA, {reason: 'env', pathChanged: '/.env'})
    ).toBe(true)

    // A request that names no known compiler goes to the session still live.
    expect(requestDevSessionRestart({}, {reason: 'env'})).toBe(true)
    await tick()
    expect(handlerA).toHaveBeenCalledTimes(3)
    expect(handlerB).not.toHaveBeenCalled()

    unbindDevSessionRestart(a)
    expect(canAutoRestartDevSession()).toBe(false)
    expect(requestDevSessionRestart(compilerA, {reason: 'env'})).toBe(false)
  })

  it('answers for the session a compiler belongs to, not for another live one', async () => {
    let endB = () => {}

    const a = new DevSessionRestartScheduler(0)
    const b = new DevSessionRestartScheduler(0)
    a.setHandler(() => {})
    b.setHandler(
      () =>
        new Promise<void>((resolve) => {
          endB = resolve
        })
    )

    const compilerA = {}
    const compilerB = {}
    assignCompilerToDevSession(compilerA, a)
    assignCompilerToDevSession(compilerB, b)

    // B is live and restarting while A has a compiler and is not bound yet.
    bindDevSessionRestart(b)
    requestDevSessionRestart(compilerB, {reason: 'env', pathChanged: '/.env'})

    expect(canAutoRestartDevSession(compilerB)).toBe(true)
    expect(isDevSessionRestartPending(compilerB)).toBe(true)
    expect(canAutoRestartDevSession(compilerA)).toBe(false)
    expect(isDevSessionRestartPending(compilerA)).toBe(false)
    expect(requestDevSessionRestart(compilerA, {reason: 'env'})).toBe(false)

    bindDevSessionRestart(a)
    expect(canAutoRestartDevSession(compilerA)).toBe(true)
    expect(isDevSessionRestartPending(compilerA)).toBe(false)

    // No compiler named, or one no session knows: the newest session answers.
    expect(canAutoRestartDevSession()).toBe(true)
    expect(isDevSessionRestartPending()).toBe(false)
    expect(isDevSessionRestartPending({})).toBe(false)

    endB()
    await tick()
    expect(isDevSessionRestartPending(compilerB)).toBe(false)
  })

  it('gives a compiler that will not serve again no session at all', async () => {
    const handler = vi.fn()
    const scheduler = new DevSessionRestartScheduler(0)
    scheduler.setHandler(handler)
    const replaced = {}
    assignCompilerToDevSession(replaced, scheduler)
    bindDevSessionRestart(scheduler)

    releaseCompilerFromDevSession(replaced)

    // Not even the newest session, which an unknown compiler falls back to.
    expect(canAutoRestartDevSession(replaced)).toBe(false)
    expect(isDevSessionRestartPending(replaced)).toBe(false)
    expect(requestDevSessionRestart(replaced, {reason: 'env'})).toBe(false)
    expect(isCompilerRestarting(replaced)).toBe(false)

    await tick()
    expect(handler).not.toHaveBeenCalled()

    // A compiler handed to a session again is live again.
    assignCompilerToDevSession(replaced, scheduler)
    expect(canAutoRestartDevSession(replaced)).toBe(true)
  })

  it('says a restart is pending from the request until the restart ends', async () => {
    expect(isDevSessionRestartPending()).toBe(false)

    let end = () => {}

    const scheduler = new DevSessionRestartScheduler(0)

    scheduler.setHandler(
      () =>
        new Promise<void>((resolve) => {
          end = resolve
        })
    )

    bindDevSessionRestart(scheduler)

    requestDevSessionRestart({}, {reason: 'env', pathChanged: '/.env'})
    expect(isDevSessionRestartPending()).toBe(true)

    end()
    await tick()
    expect(isDevSessionRestartPending()).toBe(false)

    unbindDevSessionRestart()
    expect(isDevSessionRestartPending()).toBe(false)
  })
})

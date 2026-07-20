import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

// Proves the exit-path safety net that both launchers now share: on a plain
// `process.exit` a child that ignored SIGTERM still gets a synchronous SIGKILL,
// with no reliance on the unref'd grace timer that never fires once the loop
// drains. Fake children only, no real browser is launched.

describe('process-teardown shared module', () => {
  afterEach(() => vi.restoreAllMocks())

  it('gracefulTerminateChild asks the child to stop, and is a no-op once killed', async () => {
    const {gracefulTerminateChild} = await import(
      '../browsers-lib/process-teardown'
    )
    const child: any = {killed: false, kill: vi.fn(), pid: 1}
    gracefulTerminateChild(child, 'chrome' as any)
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')

    const killed: any = {killed: true, kill: vi.fn(), pid: 2}
    gracefulTerminateChild(killed, 'chrome' as any)
    expect(killed.kill).not.toHaveBeenCalled()

    expect(() => gracefulTerminateChild(null, 'chrome' as any)).not.toThrow()
  })

  it('forceKillChildOnExit SIGKILLs synchronously and survives an already-dead child', async () => {
    const {forceKillChildOnExit} = await import(
      '../browsers-lib/process-teardown'
    )
    const child: any = {killed: false, kill: vi.fn(), pid: 1}
    forceKillChildOnExit(child, 'firefox' as any)
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')

    const gone: any = {
      killed: false,
      pid: 2,
      kill: vi.fn(() => {
        const e: NodeJS.ErrnoException = new Error('no such process')
        e.code = 'ESRCH'
        throw e
      })
    }
    expect(() => forceKillChildOnExit(gone, 'firefox' as any)).not.toThrow()
    expect(() => forceKillChildOnExit(null, 'firefox' as any)).not.toThrow()
  })
})

function withCapturedProcessOn() {
  const registered = new Map<string, Function[]>()
  const original = process.on
  ;(process as any).on = vi.fn((event: string, handler: Function) => {
    const existing = registered.get(event) || []
    existing.push(handler)
    registered.set(event, existing)
    return process
  })
  return {
    registered,
    restore: () => {
      process.on = original
    }
  }
}

describe('chromium exit handler force-kills a stubborn child', () => {
  let cap: ReturnType<typeof withCapturedProcessOn>
  beforeEach(async () => {
    cap = withCapturedProcessOn()
    const mod = await import('../run-chromium/chromium-launch/process-handlers')
    mod.__resetChromiumProcessHandlersForTest()
  })
  afterEach(() => {
    cap.restore()
    vi.restoreAllMocks()
  })

  it('SIGKILLs on plain exit even after the child ignored SIGTERM', async () => {
    const {setupProcessSignalHandlers} = await import(
      '../run-chromium/chromium-launch/process-handlers'
    )
    const child: any = {killed: false, kill: vi.fn(), pid: 99}
    setupProcessSignalHandlers('chrome', child, vi.fn())

    cap.registered.get('SIGINT')?.forEach((h) => h())
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')

    cap.registered.get('exit')?.forEach((h) => h())
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
  })
})

describe('firefox exit handler force-kills a stubborn child', () => {
  let cap: ReturnType<typeof withCapturedProcessOn>
  beforeEach(async () => {
    cap = withCapturedProcessOn()
    const mod = await import('../run-firefox/firefox-launch/process-handlers')
    mod.__resetFirefoxProcessHandlersForTest()
  })
  afterEach(() => {
    cap.restore()
    vi.restoreAllMocks()
  })

  it('SIGKILLs on plain exit even after the child ignored SIGTERM', async () => {
    const {setupFirefoxProcessHandlers} = await import(
      '../run-firefox/firefox-launch/process-handlers'
    )
    const child: any = {killed: false, kill: vi.fn(), pid: 99}
    setupFirefoxProcessHandlers(
      'firefox',
      () => child,
      vi.fn(async () => {})
    )

    cap.registered.get('SIGINT')?.forEach((h) => h())
    await new Promise((r) => setTimeout(r, 20))
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')

    cap.registered.get('exit')?.forEach((h) => h())
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
  })
})

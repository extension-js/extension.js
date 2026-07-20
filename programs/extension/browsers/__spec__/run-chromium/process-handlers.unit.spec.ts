import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

describe('Chromium setupProcessSignalHandlers', () => {
  let originalProcessOn: typeof process.on
  let registeredHandlers: Map<string, Function[]>

  beforeEach(async () => {
    registeredHandlers = new Map()
    originalProcessOn = process.on

    ;(process as any).on = vi.fn((event: string, handler: Function) => {
      const existing = registeredHandlers.get(event) || []
      existing.push(handler)
      registeredHandlers.set(event, existing)
      return process
    })

    const mod = await import(
      '../../run-chromium/chromium-launch/process-handlers'
    )
    mod.__resetChromiumProcessHandlersForTest()
  })

  afterEach(() => {
    process.on = originalProcessOn
    vi.restoreAllMocks()
  })

  it('registers handlers for SIGINT, SIGTERM, SIGHUP, and exit', async () => {
    const {setupProcessSignalHandlers} = await import(
      '../../run-chromium/chromium-launch/process-handlers'
    )

    const child: any = {killed: false, kill: vi.fn(), pid: 12345}
    const cleanupInstance = vi.fn()

    setupProcessSignalHandlers('chrome', child, cleanupInstance)

    expect(registeredHandlers.has('SIGINT')).toBe(true)
    expect(registeredHandlers.has('SIGTERM')).toBe(true)
    expect(registeredHandlers.has('SIGHUP')).toBe(true)
    expect(registeredHandlers.has('exit')).toBe(true)
    expect(registeredHandlers.has('uncaughtException')).toBe(true)
    expect(registeredHandlers.has('unhandledRejection')).toBe(true)
  })

  it('kills the child process and calls cleanupInstance on signal', async () => {
    const {setupProcessSignalHandlers} = await import(
      '../../run-chromium/chromium-launch/process-handlers'
    )

    const child: any = {killed: false, kill: vi.fn(), pid: 12345}
    const cleanupInstance = vi.fn()

    setupProcessSignalHandlers('chrome', child, cleanupInstance)

    const sigintHandlers = registeredHandlers.get('SIGINT') || []
    for (const h of sigintHandlers) h()

    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    expect(cleanupInstance).toHaveBeenCalledTimes(1)
  })

  it('skips kill when child is already killed', async () => {
    const {setupProcessSignalHandlers} = await import(
      '../../run-chromium/chromium-launch/process-handlers'
    )

    const child: any = {killed: true, kill: vi.fn(), pid: 12345}
    const cleanupInstance = vi.fn()

    setupProcessSignalHandlers('chrome', child, cleanupInstance)

    const sigintHandlers = registeredHandlers.get('SIGINT') || []
    for (const h of sigintHandlers) h()

    expect(child.kill).not.toHaveBeenCalled()
    expect(cleanupInstance).toHaveBeenCalledTimes(1)
  })

  it('ignores ECONNRESET / EPIPE thrown during browser teardown', async () => {
    const {setupProcessSignalHandlers} = await import(
      '../../run-chromium/chromium-launch/process-handlers'
    )

    const child: any = {killed: false, kill: vi.fn(), pid: 12345}
    const cleanupInstance = vi.fn()
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    setupProcessSignalHandlers('chrome', child, cleanupInstance)

    const handlers = registeredHandlers.get('uncaughtException') || []
    expect(handlers).toHaveLength(1)

    for (const code of ['ECONNRESET', 'EPIPE', 'ECONNABORTED', 'ENOTCONN']) {
      const err: NodeJS.ErrnoException = new Error(`read ${code}`)
      err.code = code
      handlers[0](err)
    }

    expect(exitSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
    expect(cleanupInstance).not.toHaveBeenCalled()

    handlers[0](new Error('real failure'))
    expect(cleanupInstance).toHaveBeenCalledTimes(1)
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('installs only one SIGINT listener even when setup is called twice', async () => {
    const {setupProcessSignalHandlers} = await import(
      '../../run-chromium/chromium-launch/process-handlers'
    )

    const child: any = {killed: false, kill: vi.fn(), pid: 12345}

    const dispose1 = setupProcessSignalHandlers('chrome', child, vi.fn())
    const dispose2 = setupProcessSignalHandlers('chrome', child, vi.fn())

    const sigintHandlers = registeredHandlers.get('SIGINT') || []
    expect(sigintHandlers).toHaveLength(1)

    for (const h of sigintHandlers) h()

    dispose1()
    const survivorCleanup = vi.fn()
    setupProcessSignalHandlers('chrome', child, survivorCleanup)
    expect((registeredHandlers.get('SIGINT') || []).length).toBe(1)

    dispose2()
  })

  it('unregisters an instance via the returned disposer', async () => {
    const {setupProcessSignalHandlers, __activeChromiumInstanceCount} =
      await import('../../run-chromium/chromium-launch/process-handlers')

    const child: any = {killed: false, kill: vi.fn(), pid: 12345}
    const base = __activeChromiumInstanceCount()

    const dispose = setupProcessSignalHandlers('chrome', child, vi.fn())
    expect(__activeChromiumInstanceCount()).toBe(base + 1)

    dispose()
    expect(__activeChromiumInstanceCount()).toBe(base)
  })
})

describe('Firefox setupFirefoxProcessHandlers', () => {
  let originalProcessOn: typeof process.on
  let registeredHandlers: Map<string, Function[]>

  beforeEach(async () => {
    registeredHandlers = new Map()
    originalProcessOn = process.on
    ;(process as any).on = vi.fn((event: string, handler: Function) => {
      const existing = registeredHandlers.get(event) || []
      existing.push(handler)
      registeredHandlers.set(event, existing)
      return process
    })
    const mod = await import(
      '../../run-firefox/firefox-launch/process-handlers'
    )
    mod.__resetFirefoxProcessHandlersForTest()
  })

  afterEach(() => {
    process.on = originalProcessOn
    vi.restoreAllMocks()
  })

  it('has isCleaningUp guard that prevents double cleanup', async () => {
    const {setupFirefoxProcessHandlers} = await import(
      '../../run-firefox/firefox-launch/process-handlers'
    )

    const child: any = {killed: false, kill: vi.fn(), pid: 12345}
    const cleanupInstance = vi.fn(async () => {})

    setupFirefoxProcessHandlers('firefox', () => child, cleanupInstance)

    const sigintHandlers = registeredHandlers.get('SIGINT') || []
    expect(sigintHandlers.length).toBeGreaterThan(0)

    const handler = sigintHandlers[0]
    handler()
    handler()

    await new Promise((r) => setTimeout(r, 50))

    expect(cleanupInstance).toHaveBeenCalledTimes(1)
  })

  it('registers handlers for Firefox-specific signals including SIGBREAK and beforeExit', async () => {
    const {setupFirefoxProcessHandlers} = await import(
      '../../run-firefox/firefox-launch/process-handlers'
    )

    const child: any = {killed: false, kill: vi.fn(), pid: 12345}
    const cleanupInstance = vi.fn(async () => {})

    setupFirefoxProcessHandlers('firefox', () => child, cleanupInstance)

    expect(registeredHandlers.has('SIGINT')).toBe(true)
    expect(registeredHandlers.has('SIGTERM')).toBe(true)
    expect(registeredHandlers.has('SIGHUP')).toBe(true)
    expect(registeredHandlers.has('SIGBREAK')).toBe(true)
    expect(registeredHandlers.has('beforeExit')).toBe(true)
    expect(registeredHandlers.has('exit')).toBe(true)
  })

  it('uses childRef function to get current child process', async () => {
    const {setupFirefoxProcessHandlers} = await import(
      '../../run-firefox/firefox-launch/process-handlers'
    )

    const child: any = {killed: false, kill: vi.fn(), pid: 12345}
    const childRef = vi.fn(() => child)
    const cleanupInstance = vi.fn(async () => {})

    setupFirefoxProcessHandlers('firefox', childRef, cleanupInstance)

    const sigintHandlers = registeredHandlers.get('SIGINT') || []
    sigintHandlers[0]()

    await new Promise((r) => setTimeout(r, 50))

    expect(childRef).toHaveBeenCalled()
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('ignores ECONNRESET / EPIPE thrown during Firefox teardown', async () => {
    const {setupFirefoxProcessHandlers} = await import(
      '../../run-firefox/firefox-launch/process-handlers'
    )

    const child: any = {killed: false, kill: vi.fn(), pid: 12345}
    const cleanupInstance = vi.fn(async () => {})
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    setupFirefoxProcessHandlers('firefox', () => child, cleanupInstance)

    const handlers = registeredHandlers.get('uncaughtException') || []
    expect(handlers).toHaveLength(1)

    for (const code of ['ECONNRESET', 'EPIPE', 'ECONNABORTED', 'ENOTCONN']) {
      const err: NodeJS.ErrnoException = new Error(`read ${code}`)
      err.code = code
      await handlers[0](err)
    }

    expect(exitSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
    expect(cleanupInstance).not.toHaveBeenCalled()

    await handlers[0](new Error('real failure'))
    expect(cleanupInstance).toHaveBeenCalledTimes(1)
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('handles null child ref gracefully', async () => {
    const {setupFirefoxProcessHandlers} = await import(
      '../../run-firefox/firefox-launch/process-handlers'
    )

    const cleanupInstance = vi.fn(async () => {})

    setupFirefoxProcessHandlers('firefox', () => null, cleanupInstance)

    const sigintHandlers = registeredHandlers.get('SIGINT') || []

    expect(() => sigintHandlers[0]()).not.toThrow()

    await new Promise((r) => setTimeout(r, 50))
    expect(cleanupInstance).toHaveBeenCalledTimes(1)
  })
})

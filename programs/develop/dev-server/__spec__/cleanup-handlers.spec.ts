import {EventEmitter} from 'node:events'
import * as net from 'node:net'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {
  FORCED_SHUTDOWN_EXIT_CODE,
  REPEATED_SIGNAL_GRACE_MS,
  SHUTDOWN_TIMEOUT_MS,
  setupCleanupHandlers
} from '../cleanup'
import type {BridgeBroker} from '../control-bridge/broker'
import {startControlServer} from '../control-bridge/ws-control-server'
import {stripAnsi} from '../lifecycle-stream'
import type {PortManager} from '../port-manager'

const LISTENED = [
  'uncaughtException',
  'unhandledRejection',
  'SIGINT',
  'SIGTERM',
  'SIGHUP'
] as const

function counts() {
  return LISTENED.map((event) => process.listenerCount(event))
}

function fakePortManager() {
  return {
    terminateCurrentInstance: vi.fn(async () => {})
  } as unknown as PortManager
}

const disposers: Array<() => void> = []

afterEach(() => {
  while (disposers.length) disposers.pop()?.()
  vi.useRealTimers()
})

describe('setupCleanupHandlers', () => {
  it('removes every process listener it added when disposed', () => {
    const before = counts()

    for (let session = 0; session < 3; session++) {
      const dispose = setupCleanupHandlers(
        () => null,
        fakePortManager(),
        undefined,
        {exit: () => {}, env: {}}
      )

      expect(counts()).toEqual(before.map((count) => count + 1))
      dispose()
    }

    expect(counts()).toEqual(before)
  })

  function hangingSession(
    dependencies: Parameters<typeof setupCleanupHandlers>[3] = {}
  ) {
    const events = new EventEmitter()
    const exit = vi.fn()
    const onSignal = vi.fn()
    const printed: string[] = []

    let finishStop: () => void = () => {}

    const stop = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishStop = resolve
        })
    )
    const terminateCurrentInstance = vi.fn(async () => {})
    const portManager = {terminateCurrentInstance} as unknown as PortManager
    disposers.push(
      setupCleanupHandlers(() => ({stop}) as never, portManager, onSignal, {
        events,
        exit,
        env: {},
        print: (line) => printed.push(stripAnsi(line)),
        ...dependencies
      })
    )

    return {
      events,
      exit,
      onSignal,
      printed,
      stop,
      terminateCurrentInstance,
      finishStop: () => finishStop()
    }
  }

  it('ends the process with a line when the server never stops', async () => {
    vi.useFakeTimers()
    const s = hangingSession()

    s.events.emit('SIGINT', 'SIGINT')
    await vi.advanceTimersByTimeAsync(SHUTDOWN_TIMEOUT_MS - 1)
    expect(s.exit).not.toHaveBeenCalled()
    expect(s.printed).toEqual([])

    await vi.advanceTimersByTimeAsync(1)
    expect(s.exit.mock.calls).toEqual([[FORCED_SHUTDOWN_EXIT_CODE]])
    expect(s.printed).toHaveLength(1)
    expect(s.printed[0]).toContain(
      `didn't shut down within ${SHUTDOWN_TIMEOUT_MS} ms`
    )

    expect(s.stop).toHaveBeenCalledTimes(1)
    expect(s.terminateCurrentInstance).not.toHaveBeenCalled()
  })

  it('ends the process at once on a second signal while stop is pending', async () => {
    vi.useFakeTimers()
    const s = hangingSession()

    s.events.emit('SIGINT', 'SIGINT')
    await vi.advanceTimersByTimeAsync(REPEATED_SIGNAL_GRACE_MS)
    s.events.emit('SIGINT', 'SIGINT')

    expect(s.exit.mock.calls).toEqual([[FORCED_SHUTDOWN_EXIT_CODE]])
    expect(s.printed).toHaveLength(1)
    expect(s.printed[0]).toContain('Received SIGINT again during shutdown')
    expect(s.stop).toHaveBeenCalledTimes(1)
    expect(s.onSignal.mock.calls).toEqual([['SIGINT']])

    // The bound is disarmed with the exit, so nothing exits a second time.
    await vi.advanceTimersByTimeAsync(SHUTDOWN_TIMEOUT_MS)
    expect(s.exit).toHaveBeenCalledTimes(1)
    expect(s.printed).toHaveLength(1)
  })

  it('reads a repeat that lands with the first signal as the same request', async () => {
    vi.useFakeTimers()
    const s = hangingSession()

    s.events.emit('SIGINT', 'SIGINT')
    s.events.emit('SIGINT', 'SIGINT')
    await vi.advanceTimersByTimeAsync(REPEATED_SIGNAL_GRACE_MS - 1)
    s.events.emit('SIGTERM', 'SIGTERM')

    expect(s.stop).toHaveBeenCalledTimes(1)
    expect(s.onSignal.mock.calls).toEqual([['SIGINT']])
    expect(s.exit).not.toHaveBeenCalled()
    expect(s.printed).toEqual([])

    s.finishStop()
    await vi.waitFor(() =>
      expect(s.terminateCurrentInstance).toHaveBeenCalledTimes(1)
    )

    await vi.advanceTimersByTimeAsync(500)
    expect(s.exit.mock.calls).toEqual([[]])

    // A clean shutdown disarms the bound as well.
    await vi.advanceTimersByTimeAsync(SHUTDOWN_TIMEOUT_MS)
    expect(s.exit).toHaveBeenCalledTimes(1)
  })

  it('exits 1 and says so when the server stop rejects', async () => {
    vi.useFakeTimers()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const events = new EventEmitter()
    const exit = vi.fn()
    const terminateCurrentInstance = vi.fn(async () => {})
    const closeControlBridge = vi.fn(async () => {})
    const stop = vi.fn(async () => {
      throw new Error('close EBUSY')
    })
    disposers.push(
      setupCleanupHandlers(
        () => ({stop}) as never,
        {terminateCurrentInstance} as unknown as PortManager,
        undefined,
        {events, exit, env: {}, closeControlBridge}
      )
    )

    try {
      events.emit('SIGTERM', 'SIGTERM')
      await vi.advanceTimersByTimeAsync(500)

      expect(exit.mock.calls).toEqual([[1]])
      expect(terminateCurrentInstance).toHaveBeenCalledTimes(1)
      expect(closeControlBridge).toHaveBeenCalledTimes(1)
      expect(stripAnsi(String(consoleError.mock.calls[0][0]))).toContain(
        'The dev server could not shut down cleanly: close EBUSY'
      )
    } finally {
      consoleError.mockRestore()
    }
  })

  it('closes the control bridge and keeps the grace when the port release rejects', async () => {
    vi.useFakeTimers()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const events = new EventEmitter()
    const exit = vi.fn()
    const order: string[] = []
    const onShutdownStart = vi.fn(() => order.push('shutdown start'))
    const portManager = {
      terminateCurrentInstance: async () => {
        order.push('release port')

        throw new Error('release EPERM')
      }
    } as unknown as PortManager
    disposers.push(
      setupCleanupHandlers(
        () =>
          ({
            stop: async () => {
              order.push('stop')
            }
          }) as never,
        portManager,
        undefined,
        {
          events,
          exit,
          env: {},
          onShutdownStart,
          closeControlBridge: async () => {
            order.push('close control bridge')
          }
        }
      )
    )

    try {
      events.emit('SIGTERM', 'SIGTERM')
      await vi.advanceTimersByTimeAsync(499)
      expect(exit).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)

      expect(exit.mock.calls).toEqual([[1]])
      expect(order).toEqual([
        'shutdown start',
        'stop',
        'close control bridge',
        'release port'
      ])

      expect(onShutdownStart).toHaveBeenCalledTimes(1)
      expect(stripAnsi(String(consoleError.mock.calls[0][0]))).toContain(
        'The dev server could not shut down cleanly: release EPERM'
      )
    } finally {
      consoleError.mockRestore()
    }
  })

  it('closes the control server on shutdown', async () => {
    const events = new EventEmitter()
    const exit = vi.fn()
    const broker = {
      pingProducers: () => {},
      onFrame: () => {},
      onClose: () => {}
    } as unknown as BridgeBroker
    const control = await startControlServer({
      broker,
      host: '127.0.0.1',
      port: 0
    })

    try {
      vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']})
      disposers.push(
        setupCleanupHandlers(() => null, fakePortManager(), undefined, {
          events,
          exit,
          env: {},
          closeControlBridge: () => control.close()
        })
      )

      events.emit('SIGINT', 'SIGINT')
      await vi.waitFor(() => expect(vi.getTimerCount()).toBe(2))
      await vi.advanceTimersByTimeAsync(500)
      expect(exit.mock.calls).toEqual([[]])
      vi.useRealTimers()

      const reached = await new Promise<boolean>((resolve) => {
        const socket = net.connect(control.port, '127.0.0.1')
        socket.once('connect', () => {
          socket.destroy()
          resolve(true)
        })

        socket.once('error', () => resolve(false))
      })

      expect(reached).toBe(false)
    } finally {
      vi.useRealTimers()
      await control.close()
    }
  })
})

import {EventEmitter} from 'node:events'
import * as net from 'node:net'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {setupCleanupHandlers} from '../cleanup'
import type {BridgeBroker} from '../control-bridge/broker'
import {startControlServer} from '../control-bridge/ws-control-server'
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

  // Pins today's behavior. Ledger 1391 D5.
  it('returns early on a second signal while stop is pending and exits nothing', async () => {
    const events = new EventEmitter()
    const exit = vi.fn()
    const onSignal = vi.fn()

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
        env: {}
      })
    )

    events.emit('SIGINT', 'SIGINT')
    events.emit('SIGINT', 'SIGINT')
    events.emit('SIGTERM', 'SIGTERM')
    await new Promise((resolve) => setImmediate(resolve))

    expect(stop).toHaveBeenCalledTimes(1)
    expect(onSignal.mock.calls).toEqual([['SIGINT']])
    expect(terminateCurrentInstance).not.toHaveBeenCalled()
    expect(exit).not.toHaveBeenCalled()

    vi.useFakeTimers()
    finishStop()
    await vi.waitFor(() =>
      expect(terminateCurrentInstance).toHaveBeenCalledTimes(1)
    )

    expect(exit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(500)
    expect(exit.mock.calls).toEqual([[]])
  })

  // Pins today's behavior. Ledger 1391 D8.
  it('leaves the control server listening after shutdown', async () => {
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
      vi.useFakeTimers({toFake: ['setTimeout']})
      disposers.push(
        setupCleanupHandlers(() => null, fakePortManager(), undefined, {
          events,
          exit,
          env: {}
        })
      )

      events.emit('SIGINT', 'SIGINT')
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

      expect(reached).toBe(true)
    } finally {
      vi.useRealTimers()
      await control.close()
    }
  })
})

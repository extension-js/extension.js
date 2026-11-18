import {afterEach, describe, expect, it, type Mock, vi} from 'vitest'
import {stripAnsi} from '../lifecycle-stream'
import * as messages from '../messages'
import {DevSessionRestartScheduler} from '../session-restart'
import {
  createSessionRestartHandler,
  type RestartBundle,
  type SessionRestartSteps
} from '../session-restart-handler'

interface FakeServer {
  name: string
  stop: Mock<() => Promise<void>>
}

function fakeServer(name: string, stop = async () => {}): FakeServer {
  return {name, stop: vi.fn(stop)}
}

function session(overrides: Partial<SessionRestartSteps<FakeServer>> = {}) {
  const printed: string[] = []
  const calls: string[] = []
  const first = fakeServer('first')
  const next = fakeServer('next')
  let current: FakeServer | null = first
  const steps: SessionRestartSteps<FakeServer> = {
    announce: (request) =>
      printed.push(stripAnsi(messages.devServerRestarting(request))),
    createBundle: async (): Promise<RestartBundle<FakeServer>> => {
      calls.push('createBundle')

      return {
        server: next,
        firstCompile: Promise.resolve({hasErrors: () => false})
      }
    },
    currentServer: () => current,
    setCurrentServer: (server) => {
      current = server
    },
    holdPort: () => calls.push('holdPort'),
    endPortHold: () => calls.push('endPortHold'),
    startBundler: async (server) => {
      calls.push(`start ${server.name}`)
    },
    fullReloadsDelivered: () => 3,
    reloadAfterRestart: async (before) => {
      calls.push(`reload after ${before}`)
    },
    ...overrides
  }
  const scheduler = new DevSessionRestartScheduler(0)
  scheduler.setHandler(createSessionRestartHandler(steps))

  return {
    printed,
    calls,
    first,
    next,
    current: () => current,
    restart: async () => {
      scheduler.request({reason: 'scripts', pathAfter: 'scripts/new.js'})
      await vi.waitFor(() => expect(scheduler.isPending()).toBe(false))
    }
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('a dev session restart', () => {
  it('stops the old server, starts the new one and reloads once', async () => {
    const s = session()
    await s.restart()

    expect(s.first.stop).toHaveBeenCalledTimes(1)
    expect(s.current()).toBe(s.next)
    expect(s.calls).toEqual([
      'createBundle',
      'holdPort',
      'start next',
      'endPortHold',
      'reload after 3'
    ])
  })

  it('skips the reload when the new first compile has errors', async () => {
    const s = session({
      createBundle: async () => ({
        server: fakeServer('next'),
        firstCompile: Promise.resolve({hasErrors: () => true})
      })
    })
    await s.restart()

    expect(s.calls).toEqual(['holdPort', 'start next', 'endPortHold'])
  })

  // Pins today's behavior. Ledger 1391 D2.
  it('prints only the restart line when the next config fails to load', async () => {
    const consoleCalls = [
      vi.spyOn(console, 'log').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {})
    ]
    const s = session({
      createBundle: async () => {
        throw new Error('extension.config.js: Unexpected token')
      }
    })
    await s.restart()

    expect(s.printed).toEqual([
      stripAnsi(
        messages.devServerRestarting({
          reason: 'scripts',
          pathAfter: 'scripts/new.js'
        })
      )
    ])

    expect(s.printed[0]).toContain('Restarting the dev server')
    for (const spy of consoleCalls) expect(spy).not.toHaveBeenCalled()
    expect(s.first.stop).not.toHaveBeenCalled()
    expect(s.current()).toBe(s.first)
    expect(s.calls).toEqual([])
  })

  // Pins today's behavior. Ledger 1391 D2.
  it('leaves no current server and the port held when the old stop rejects', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const s = session()
    s.first.stop.mockRejectedValueOnce(new Error('close EBUSY'))
    await s.restart()

    expect(s.current()).toBeNull()
    expect(s.next.stop).not.toHaveBeenCalled()
    expect(s.calls).toEqual(['createBundle', 'holdPort'])
    expect(consoleError).not.toHaveBeenCalled()
  })
})

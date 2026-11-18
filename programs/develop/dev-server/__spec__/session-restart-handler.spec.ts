import {afterEach, describe, expect, it, type Mock, vi} from 'vitest'
import {codedError} from '../../lib/coded-error'
import {CODES} from '../../lib/messaging'
import {createLifecycleStream, stripAnsi} from '../lifecycle-stream'
import * as messages from '../messages'
import {DevSessionRestartScheduler} from '../session-restart'
import {
  createSessionRestartHandler,
  type RestartBundle,
  type SessionRestartSteps
} from '../session-restart-handler'
import {createRestartFailure} from '../start-bundler'

type Frame = {
  ok: boolean
  status: string
  value: Record<string, unknown> | null
  error: {code: string; message: string} | null
  hint?: string
}

interface FakeServer {
  name: string
  stop: Mock<() => Promise<void>>
}

function fakeServer(name: string, stop = async () => {}): FakeServer {
  return {name, stop: vi.fn(stop)}
}

function session(
  overrides: Partial<SessionRestartSteps<FakeServer>> = {},
  options: {exitOnError?: boolean} = {}
) {
  const printed: string[] = []
  const calls: string[] = []
  const lines: string[] = []
  const first = fakeServer('first')
  const next = fakeServer('next')
  let current: FakeServer | null = first
  // The real stream and the real failure reporter, as the session wires them.
  const lifecycle = createLifecycleStream({
    command: 'dev',
    browser: 'chromium',
    distPath: '/proj/dist/chromium',
    write: (line) => lines.push(line)
  })
  const failure = createRestartFailure({
    metadata: {writeError: (code) => calls.push(`writeError ${code}`)},
    lifecycle,
    keepServing: () => calls.push('keepServing'),
    release: async (server) => {
      calls.push(`release ${(server as FakeServer).name}`)
    },
    onExitError: (_error, code) => calls.push(`onExitError ${code}`),
    print: (line) => printed.push(stripAnsi(line)),
    exit: (code) => calls.push(`exit ${code}`),
    exitOnError: options.exitOnError ?? true
  })
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
    onBundleFailure: failure.bundle,
    onStopFailure: failure.stop,
    onStartFailure: failure.start,
    fullReloadsDelivered: () => 3,
    reloadAfterRestart: async (before) => {
      calls.push(`reload after ${before}`)
    },
    ...overrides
  }
  const scheduler = new DevSessionRestartScheduler(0)
  scheduler.setFailureHandler(failure.unexpected)
  scheduler.setHandler(createSessionRestartHandler(steps))

  return {
    printed,
    calls,
    first,
    next,
    current: () => current,
    frames: () => lines.map((line) => JSON.parse(line) as Frame),
    restart: async () => {
      scheduler.request({reason: 'scripts', pathAfter: 'scripts/new.js'})
      await vi.waitFor(() => expect(scheduler.isPending()).toBe(false))
    }
  }
}

const savedOutput = process.env.EXTENSION_OUTPUT

afterEach(() => {
  vi.restoreAllMocks()

  if (savedOutput === undefined) delete process.env.EXTENSION_OUTPUT
  else process.env.EXTENSION_OUTPUT = savedOutput
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

  it('says why the next config failed to load and keeps the old server', async () => {
    process.env.EXTENSION_OUTPUT = 'ndjson'

    let loads = 0
    const s = session({
      createBundle: async () => {
        if (loads++ > 0) {
          return {
            server: s.next,
            firstCompile: Promise.resolve({hasErrors: () => false})
          }
        }

        throw codedError(
          CODES.E_CONFIG_LOAD,
          'extension.config.js: Unexpected token'
        )
      }
    })
    await s.restart()

    expect(s.printed).toHaveLength(2)
    expect(s.printed[0]).toContain('Restarting the dev server')
    expect(s.printed[1]).toContain('The dev server could not restart.')
    expect(s.printed[1]).toContain('extension.config.js: Unexpected token')
    expect(s.printed[1]).toContain('The previous build keeps serving.')
    expect(s.first.stop).not.toHaveBeenCalled()
    expect(s.current()).toBe(s.first)
    expect(s.calls).toEqual(['keepServing'])

    const frames = s.frames()
    expect(frames).toHaveLength(1)
    expect(frames[0]).toMatchObject({
      ok: false,
      status: 'restart-failed',
      error: {
        code: 'E_CONFIG_LOAD',
        message: 'extension.config.js: Unexpected token'
      },
      value: {serving: true}
    })

    expect(frames[0].hint).toContain('save the changed file again')

    // The session is not stuck: the next save restarts for real.
    await s.restart()
    expect(s.current()).toBe(s.next)
    expect(s.first.stop).toHaveBeenCalledTimes(1)
  })

  it('codes an uncoded build failure as a dev server start failure', async () => {
    process.env.EXTENSION_OUTPUT = 'ndjson'
    const s = session({
      createBundle: async () => {
        throw new Error('Invalid configuration object')
      }
    })
    await s.restart()

    expect(s.frames().map((frame) => frame.error?.code)).toEqual([
      'E_DEV_SERVER_START'
    ])
  })

  it('starts the next server when the old one does not stop cleanly', async () => {
    const s = session()
    s.first.stop.mockRejectedValueOnce(new Error('close EBUSY'))
    await s.restart()

    expect(s.current()).toBe(s.next)
    expect(s.calls).toEqual([
      'createBundle',
      'holdPort',
      'start next',
      'endPortHold',
      'reload after 3'
    ])

    expect(s.printed).toHaveLength(2)
    expect(s.printed[1]).toContain('did not stop cleanly')
    expect(s.printed[1]).toContain('close EBUSY')
  })

  it('ends the session with a coded frame when the next server cannot start', async () => {
    process.env.EXTENSION_OUTPUT = 'ndjson'
    const s = session({
      startBundler: async () => {
        throw new Error('listen EADDRINUSE: address already in use')
      }
    })
    await s.restart()

    expect(s.current()).toBeNull()
    expect(s.calls).toEqual([
      'createBundle',
      'holdPort',
      'writeError dev_server_start_failed',
      'onExitError E_DEV_SERVER_START',
      'exit 1',
      'endPortHold'
    ])

    expect(s.printed[1]).toContain('The dev server could not restart.')
    expect(s.printed[1]).toContain('listen EADDRINUSE')
    expect(s.printed[1]).toContain('The session has no server left.')
    expect(s.frames()).toHaveLength(1)
    expect(s.frames()[0]).toMatchObject({
      ok: false,
      status: 'failed',
      error: {code: 'E_DEV_SERVER_START'}
    })
  })

  it('releases the session instead of exiting for a caller that keeps running', async () => {
    const s = session(
      {
        startBundler: async () => {
          throw new Error('listen EADDRINUSE')
        }
      },
      {exitOnError: false}
    )
    await s.restart()

    expect(s.current()).toBeNull()
    expect(s.calls).toContain('release next')
    expect(s.calls).toContain('onExitError E_DEV_SERVER_START')
    expect(s.calls.some((call) => call.startsWith('exit'))).toBe(false)
    expect(s.printed[1]).toContain('The session has no server left.')
  })

  it('prints a failure no step expected', async () => {
    const s = session({
      reloadAfterRestart: async () => {
        throw new Error('reload dispatch broke')
      }
    })
    await s.restart()

    expect(s.current()).toBe(s.next)
    expect(s.printed[1]).toContain('The dev server restart did not finish.')
    expect(s.printed[1]).toContain('reload dispatch broke')
  })
})

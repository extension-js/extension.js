import {afterEach, describe, expect, it, type Mock, vi} from 'vitest'
import {codedError} from '../../lib/coded-error'
import {CODES} from '../../lib/messaging'
import {stripAnsi} from '../../lib/strip-ansi'
import {createLifecycleStream} from '../lifecycle-stream'
import * as messages from '../messages'
import {
  assignCompilerToDevSession,
  bindDevSessionRestart,
  canAutoRestartDevSession,
  DevSessionRestartScheduler,
  requestDevSessionRestart,
  unbindDevSessionRestart
} from '../session-restart'
import {
  createSessionRestartHandler,
  type RestartBundle,
  type SessionRestartSteps
} from '../session-restart-handler'
import {
  createRestartFailure,
  type RestartFailureTargets,
  type StartFailureTargets
} from '../start-bundler'

type IsRequired<T, K extends keyof T> =
  Record<string, never> extends Pick<T, K> ? false : true

// A host that leaves one out would swallow a throw, leave the compiler marked
// restarting, or write a second terminal frame, so the type refuses it.
const HOOKS_A_HOST_MUST_PASS: [
  IsRequired<SessionRestartSteps<FakeServer>, 'onUnexpectedFailure'>,
  IsRequired<RestartFailureTargets, 'hasQueuedRestart'>,
  IsRequired<StartFailureTargets['lifecycle'], 'ended'>
] = [true, true, true]

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
    hasQueuedRestart: () => scheduler.hasQueuedRequest(),
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
    onUnexpectedFailure: failure.unexpected,
    isShuttingDown: () => false,
    fullReloadsDelivered: () => 3,
    reloadAfterRestart: async (before) => {
      calls.push(`reload after ${before}`)
    },
    ...overrides
  }
  const scheduler = new DevSessionRestartScheduler(0)
  scheduler.setFailureHandler((error) => failure.unexpected(error))
  scheduler.setHandler(createSessionRestartHandler(steps))

  return {
    printed,
    calls,
    first,
    next,
    current: () => current,
    frames: () => lines.map((line) => JSON.parse(line) as Frame),
    request: () =>
      scheduler.request({reason: 'scripts', pathAfter: 'scripts/later.js'}),
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

it('requires the restart and start hooks a host passes', () => {
  expect(HOOKS_A_HOST_MUST_PASS).toEqual([true, true, true])
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

    expect(frames[0].hint).toContain('save a project file to retry')

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
    // The old server is gone by then, so nothing is said to keep serving.
    expect(s.calls).not.toContain('keepServing')
    expect(s.frames()).toEqual([])
  })

  it('keeps the old server reporting when a step before its stop throws', async () => {
    process.env.EXTENSION_OUTPUT = 'ndjson'

    let announced = 0
    const s = session({
      announce: () => {
        if (announced++ === 0) throw new Error('announce broke')
      }
    })
    await s.restart()

    expect(s.first.stop).not.toHaveBeenCalled()
    expect(s.current()).toBe(s.first)
    expect(s.calls).toEqual(['keepServing'])
    expect(s.printed).toHaveLength(1)
    expect(s.printed[0]).toContain('announce broke')
    expect(s.printed[0]).toContain('The previous build keeps serving.')
    expect(s.frames()).toHaveLength(1)
    expect(s.frames()[0]).toMatchObject({
      ok: false,
      status: 'restart-failed',
      error: {code: 'E_DEV_SERVER_START', message: 'announce broke'}
    })

    // The session goes on: the next restart runs as any other.
    await s.restart()
    expect(s.current()).toBe(s.next)
  })

  it('ends the session as a failed start when a step throws once the old server is set aside', async () => {
    process.env.EXTENSION_OUTPUT = 'ndjson'
    const s = session({
      fullReloadsDelivered: () => {
        throw new Error('broker read broke')
      }
    })
    await s.restart()

    // The port hold is lifted and the next server is handed to the release.
    expect(s.first.stop).toHaveBeenCalledTimes(1)
    expect(s.current()).toBeNull()
    expect(s.calls).toEqual([
      'createBundle',
      'holdPort',
      'endPortHold',
      'writeError dev_server_start_failed',
      'onExitError E_DEV_SERVER_START',
      'exit 1'
    ])

    expect(s.printed[1]).toContain('broker read broke')
    expect(s.printed[1]).toContain('The session has no server left.')
    expect(s.frames().map((frame) => frame.status)).toEqual(['failed'])

    // For a caller that keeps running, the unadopted server is released.
    const library = session(
      {
        fullReloadsDelivered: () => {
          throw new Error('broker read broke')
        }
      },
      {exitOnError: false}
    )
    await library.restart()
    expect(library.calls).toContain('endPortHold')
    expect(library.calls).toContain('release next')
  })

  it('runs the queued restart after one that failed, and fails it the same way', async () => {
    process.env.EXTENSION_OUTPUT = 'ndjson'

    let builds = 0
    const s = session({
      createBundle: async () => {
        // A second change lands while the first restart builds its bundle.
        if (builds++ === 0) s.request()

        throw new Error(`config hook broke ${builds}`)
      }
    })
    await s.restart()

    // The first failure leaves the marker to the queued restart, and the
    // second, with nothing queued behind it, puts the compiler back.
    expect(builds).toBe(2)
    expect(s.calls).toEqual(['keepServing'])
    expect(s.current()).toBe(s.first)
    expect(s.frames().map((frame) => frame.error?.message)).toEqual([
      'config hook broke 1',
      'config hook broke 2'
    ])
  })

  it('leaves the old compiler marked while another restart is queued', async () => {
    process.env.EXTENSION_OUTPUT = 'ndjson'

    let builds = 0
    const s = session({
      createBundle: async () => {
        if (builds++ > 0) {
          return {
            server: s.next,
            firstCompile: Promise.resolve({hasErrors: () => false})
          }
        }

        // A second change lands while the first restart builds its bundle.
        s.request()

        throw new Error('config hook broke')
      }
    })
    await s.restart()

    // The failure is still said, and the queued restart then replaces the
    // compiler, which never went back to reporting in between.
    expect(builds).toBe(2)
    expect(s.calls).not.toContain('keepServing')
    expect(s.frames().map((frame) => frame.status)).toEqual(['restart-failed'])
    expect(s.current()).toBe(s.next)
  })

  it('retires the server it replaces, and the compiler of a bundle it discards', async () => {
    const retired: string[] = []
    const replacing = session({
      retireServer: (server) => retired.push(server.name)
    })
    await replacing.restart()

    expect(retired).toEqual(['first'])

    // A bundle built as the shutdown begins never serves.
    const scheduler = new DevSessionRestartScheduler(0)
    scheduler.setHandler(() => {})
    const compiler = {close: vi.fn((done: () => void) => done())}
    assignCompilerToDevSession(compiler, scheduler)
    bindDevSessionRestart(scheduler)

    const discarding = session({
      retireServer: (server) => retired.push(server.name),
      createBundle: async () => ({
        server: discarding.next,
        firstCompile: Promise.resolve({hasErrors: () => false}),
        compiler
      }),
      isShuttingDown: () => true
    })
    await discarding.restart()

    expect(retired).toEqual(['first'])
    expect(compiler.close).toHaveBeenCalledTimes(1)
    expect(canAutoRestartDevSession(compiler)).toBe(false)
    expect(requestDevSessionRestart(compiler, {reason: 'env'})).toBe(false)

    unbindDevSessionRestart()
  })

  it('leaves the servers to a shutdown that starts while it runs', async () => {
    process.env.EXTENSION_OUTPUT = 'ndjson'

    // Shutdown begins while the next bundle is being built.
    let shuttingDown = false
    const building = session({
      createBundle: async () => {
        shuttingDown = true

        return {
          server: building.next,
          firstCompile: Promise.resolve({hasErrors: () => false})
        }
      },
      isShuttingDown: () => shuttingDown
    })
    await building.restart()

    expect(building.first.stop).not.toHaveBeenCalled()
    expect(building.current()).toBe(building.first)
    expect(building.calls).toEqual([])
    // The bundle that will never serve is stopped, so it holds nothing.
    expect(building.next.stop).toHaveBeenCalledTimes(1)

    // Shutdown begins while the old server stops: nothing new may listen.
    shuttingDown = false
    const stopping = session({isShuttingDown: () => shuttingDown})
    stopping.first.stop.mockImplementationOnce(async () => {
      shuttingDown = true
    })

    await stopping.restart()

    expect(stopping.calls).toEqual(['createBundle', 'holdPort', 'endPortHold'])
    expect(stopping.current()).toBeNull()
    expect(stopping.next.stop).toHaveBeenCalledTimes(1)

    // Shutdown stops the next server mid-start: no failure frame, no exit.
    shuttingDown = false
    const starting = session({
      startBundler: async () => {
        shuttingDown = true

        throw new Error('server closed while starting')
      },
      isShuttingDown: () => shuttingDown
    })
    await starting.restart()

    expect(starting.calls).toEqual(['createBundle', 'holdPort', 'endPortHold'])
    expect(starting.printed).toHaveLength(1)

    // Shutdown begins once the next server listens: no reload is sent.
    shuttingDown = false
    const compiling = session({
      startBundler: async () => {
        shuttingDown = true
      },
      isShuttingDown: () => shuttingDown
    })
    await compiling.restart()

    expect(compiling.calls).toEqual(['createBundle', 'holdPort', 'endPortHold'])
    expect(compiling.current()).toBe(compiling.next)

    // A bundle that fails after shutdown began reports nothing.
    shuttingDown = false
    const failing = session({
      createBundle: async () => {
        shuttingDown = true

        throw new Error('config hook broke')
      },
      isShuttingDown: () => shuttingDown
    })
    await failing.restart()

    expect(failing.calls).toEqual([])
    expect(failing.printed).toHaveLength(1)
    expect(failing.current()).toBe(failing.first)

    // Nor does an old server whose stop rejects once shutdown owns it.
    shuttingDown = false
    const rejecting = session({isShuttingDown: () => shuttingDown})
    rejecting.first.stop.mockImplementationOnce(async () => {
      shuttingDown = true

      throw new Error('close EBUSY')
    })

    await rejecting.restart()

    expect(rejecting.calls).toEqual(['createBundle', 'holdPort', 'endPortHold'])
    expect(rejecting.printed).toHaveLength(1)

    for (const s of [
      building,
      stopping,
      starting,
      compiling,
      failing,
      rejecting
    ]) {
      expect(s.frames()).toEqual([])
    }
  })
})

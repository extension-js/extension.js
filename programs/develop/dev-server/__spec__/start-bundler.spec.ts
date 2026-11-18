import {EventEmitter} from 'node:events'
import fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {codedError} from '../../lib/coded-error'
import {CODES} from '../../lib/messaging'
import {setupCleanupHandlers} from '../cleanup'
import {LogsFileWriter} from '../control-bridge/logs-file'
import {createLifecycleStream, stripAnsi} from '../lifecycle-stream'
import {createSessionHoldings} from '../session-holdings'
import {
  bindDevSessionRestart,
  canAutoRestartDevSession,
  DevSessionRestartScheduler,
  requestDevSessionRestart,
  unbindDevSessionRestart
} from '../session-restart'
import {
  announceReadyOnCleanCompile,
  createBindFailureRelay,
  createReadyAnnouncer,
  createStartFailure,
  declaredErrorCode,
  devServerStartError,
  MAX_TIMER_MS,
  readStartTimeoutMs,
  releaseEndedSession,
  releaseFailedStart,
  rethrowStartFailure,
  startBundler
} from '../start-bundler'

afterEach(() => {
  vi.useRealTimers()
})

function fakeCompiler() {
  const doneTaps: Array<{name: string; fn: (stats: unknown) => void}> = []
  const compiler = {
    hooks: {
      done: {
        tap: (name: string, fn: (stats: unknown) => void) =>
          doneTaps.push({name, fn})
      }
    }
  }

  return {
    compiler,
    doneTaps,
    compile: (hasErrors: boolean) => {
      for (const tap of doneTaps) tap.fn({hasErrors: () => hasErrors})
    }
  }
}

describe('ready announcement', () => {
  it('says ready once, at the first clean compile, when no browser is launched', () => {
    const onReady = vi.fn()
    const {compiler, doneTaps, compile} = fakeCompiler()

    announceReadyOnCleanCompile(
      compiler as never,
      createReadyAnnouncer(onReady)
    )

    expect(doneTaps.map((tap) => tap.name)).toEqual(['extjs-session-ready'])
    expect(onReady).not.toHaveBeenCalled()
    compile(true)
    expect(onReady).not.toHaveBeenCalled()
    compile(false)
    compile(false)
    expect(onReady).toHaveBeenCalledTimes(1)
  })

  it('leaves ready to the plugin that opens the browser', () => {
    const onReady = vi.fn()
    const announce = createReadyAnnouncer(onReady)

    announce()
    announce()

    expect(onReady).toHaveBeenCalledTimes(1)
  })

  it('never lets a throwing caller stop the session', () => {
    const announce = createReadyAnnouncer(() => {
      throw new Error('caller broke')
    })

    expect(() => announce()).not.toThrow()
  })
})

describe('starting the bundler', () => {
  it('hands a server that cannot start to onExitError before exiting', async () => {
    const failure = new Error('listen EADDRINUSE 127.0.0.1:8080')
    const order: string[] = []
    const writeError = vi.fn(() => order.push('writeError'))
    const failed = vi.fn(() => order.push('lifecycle.failed'))
    const printed: string[] = []
    const onExitError = vi.fn(() => order.push('onExitError'))
    const exit = vi.fn((code: number): never => {
      order.push(`exit ${code}`)

      throw new Error(`exit ${code}`)
    })
    const fail = createStartFailure({
      metadata: {writeError},
      lifecycle: {failed, sessionValue: () => ({})},
      onExitError,
      print: (line) => {
        order.push('print')
        printed.push(stripAnsi(line))
      },
      exit
    })

    await expect(
      startBundler(
        {start: async () => Promise.reject(failure)},
        {timeoutMs: 30000, onSlowStart: () => {}, onFailure: fail}
      )
    ).rejects.toThrow(new Error('exit 1'))

    expect(writeError).toHaveBeenCalledWith(
      'dev_server_start_failed',
      failure.message
    )

    expect(failed).toHaveBeenCalledWith(failure.message)
    expect(onExitError.mock.calls).toEqual([[failure, 'E_DEV_SERVER_START']])
    expect(printed).toHaveLength(1)
    expect(printed[0]).toContain("couldn't start the runner")
    expect(order).toEqual([
      'writeError',
      'lifecycle.failed',
      'print',
      'onExitError',
      'exit 1'
    ])
  })

  it('exits even when the caller report throws', () => {
    const exit = vi.fn((code: number): never => {
      throw new Error(`exit ${code}`)
    })
    const fail = createStartFailure({
      metadata: {writeError: () => {}},
      lifecycle: {
        failed: () => {},
        sessionValue: () => ({})
      },
      onExitError: () => {
        throw new Error('report broke')
      },
      print: () => {},
      exit
    })

    expect(() => fail(new Error('boom'))).toThrow(new Error('exit 1'))
  })

  it('ends the process for a caller that did not say otherwise', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit')
    }) as never)

    try {
      const fail = createStartFailure({
        metadata: {writeError: () => {}},
        lifecycle: {
          failed: () => {},
          sessionValue: () => ({})
        },
        print: () => {}
      })

      expect(() => fail(new Error('boom'))).toThrow(new Error('process.exit'))
      expect(exit.mock.calls).toEqual([[1]])
    } finally {
      exit.mockRestore()
    }
  })

  it('rejects with a coded error and exits nothing for a library caller', async () => {
    const failure = new Error(
      '\u001b[31m\u23f5\u23f5\u23f5 listen EADDRINUSE 127.0.0.1:8080\u001b[39m'
    )
    const writeError = vi.fn()
    const failed = vi.fn((_message: string) => ({status: 'failed'}))
    const print = vi.fn()
    const onExitError = vi.fn()
    const exit = vi.fn((): never => {
      throw new Error('exit')
    })
    const processExit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit')
    }) as never)

    try {
      const fail = createStartFailure({
        metadata: {writeError},
        lifecycle: {
          failed,
          sessionValue: () => ({pid: 7, port: 8080})
        },
        onExitError,
        print,
        exit,
        exitOnError: false
      })
      const rejection = await startBundler(
        {start: async () => Promise.reject(failure)},
        {timeoutMs: 30000, onSlowStart: () => {}, onFailure: fail}
      ).then(
        () => null,
        (error: unknown) => error
      )

      expect(rejection).toBeInstanceOf(Error)
      expect(rejection).toMatchObject({
        code: 'E_DEV_SERVER_START',
        message: 'listen EADDRINUSE 127.0.0.1:8080',
        cause: failure,
        session: {pid: 7, port: 8080},
        framed: true
      })

      // The session records still say why it ended.
      expect(writeError).toHaveBeenCalledWith(
        'dev_server_start_failed',
        failure.message
      )

      // The one terminal frame is written here, and the rejection says so.
      expect(failed).toHaveBeenCalledTimes(1)
      expect(failed).toHaveBeenCalledWith(failure.message)
      expect(print).not.toHaveBeenCalled()
      expect(onExitError).not.toHaveBeenCalled()
      expect(exit).not.toHaveBeenCalled()
      expect(processExit).not.toHaveBeenCalled()
    } finally {
      processExit.mockRestore()
    }
  })

  it('codes a failure that is not an Error and one with no text', () => {
    expect(devServerStartError('plain reason')).toMatchObject({
      code: 'E_DEV_SERVER_START',
      message: 'plain reason',
      cause: 'plain reason'
    })

    expect(devServerStartError(new Error('')).message).toBe(
      'The dev server could not start.'
    )
  })

  it('hands a bind failure to the start that is waiting on it', async () => {
    const relay = createBindFailureRelay()
    const bind = new Error('listen EADDRINUSE')
    const pending = relay.during(() => new Promise<void>(() => {}))

    relay.report(bind)
    await expect(pending).rejects.toBe(bind)

    // A start that settles on its own is passed through either way.
    await expect(relay.during(async () => 'up')).resolves.toBe('up')
    await expect(
      relay.during(async () => Promise.reject(new Error('other')))
    ).rejects.toThrow('other')

    // One reported with no start waiting fails the next start, once.
    relay.report(bind)
    const work = vi.fn(async () => 'up')

    await expect(relay.during(work)).rejects.toBe(bind)
    expect(work).not.toHaveBeenCalled()
    await expect(relay.during(work)).resolves.toBe('up')
  })

  it('releases a failed start step by step, whatever each step does', async () => {
    const order: string[] = []

    await releaseFailedStart({
      server: {
        stop: async () => {
          order.push('stop')

          throw new Error('not running')
        }
      },
      releasePort: async () => {
        order.push('port')
      },
      closeControlBridge: async () => {
        order.push('bridge')
      }
    })

    // The port goes last, as it does at a shutdown.
    expect(order).toEqual(['stop', 'bridge', 'port'])

    // A stop that never answers is given up on, and the rest still runs.
    const late: string[] = []

    await releaseFailedStart({
      server: {stop: () => new Promise<void>(() => {})},
      releasePort: async () => {
        late.push('port')
      },
      closeControlBridge: async () => {
        late.push('bridge')
      },
      stopTimeoutMs: 20
    })

    expect(late).toEqual(['bridge', 'port'])
    await releaseFailedStart({
      server: {},
      releasePort: async () => {},
      closeControlBridge: async () => {}
    })
  })

  it('warns once when the start outlives the timeout and clears it after', async () => {
    vi.useFakeTimers()
    const onSlowStart = vi.fn()

    let finish: () => void = () => {}

    const started = startBundler(
      {start: () => new Promise<void>((resolve) => (finish = resolve))},
      {timeoutMs: 30000, onSlowStart, onFailure: () => {}}
    )

    await vi.advanceTimersByTimeAsync(29999)
    expect(onSlowStart).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(onSlowStart).toHaveBeenCalledTimes(1)
    finish()
    await started
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reads the start timeout from the environment', () => {
    expect(readStartTimeoutMs({})).toBe(30000)
    expect(readStartTimeoutMs({EXTENSION_START_TIMEOUT_MS: '5000'})).toBe(5000)
  })

  it('caps a start timeout the timer could not hold', async () => {
    vi.useFakeTimers()
    const timeoutMs = readStartTimeoutMs({
      EXTENSION_START_TIMEOUT_MS: '2147483648'
    })
    const onSlowStart = vi.fn()

    let finish: () => void = () => {}

    const started = startBundler(
      {start: () => new Promise<void>((resolve) => (finish = resolve))},
      {timeoutMs, onSlowStart, onFailure: () => {}}
    )

    // Past the cap a timer fires after one millisecond.
    expect(timeoutMs).toBe(MAX_TIMER_MS)
    expect(MAX_TIMER_MS).toBe(2147483647)
    expect(
      readStartTimeoutMs({EXTENSION_START_TIMEOUT_MS: '9007199254740991'})
    ).toBe(MAX_TIMER_MS)

    // Digits past what a number holds are a long wait too, not the default.
    expect(
      readStartTimeoutMs({EXTENSION_START_TIMEOUT_MS: '9007199254740993000'})
    ).toBe(MAX_TIMER_MS)

    expect(
      readStartTimeoutMs({EXTENSION_START_TIMEOUT_MS: '9'.repeat(400)})
    ).toBe(MAX_TIMER_MS)

    await vi.advanceTimersByTimeAsync(60000)
    expect(onSlowStart).not.toHaveBeenCalled()
    finish()
    await started
  })

  it.each([
    ['a word', 'soon'],
    ['zero', '0'],
    ['a negative number', '-5'],
    ['digits followed by letters', '10abc'],
    ['an exponent', '1e3'],
    ['a fraction', '5.5'],
    ['an empty value', '']
  ])('keeps the default start timeout for %s', async (_name, value) => {
    vi.useFakeTimers()
    const timeoutMs = readStartTimeoutMs({EXTENSION_START_TIMEOUT_MS: value})
    const onSlowStart = vi.fn()

    let finish: () => void = () => {}

    const started = startBundler(
      {start: () => new Promise<void>((resolve) => (finish = resolve))},
      {timeoutMs, onSlowStart, onFailure: () => {}}
    )

    expect(timeoutMs).toBe(30000)
    await vi.advanceTimersByTimeAsync(29999)
    expect(onSlowStart).not.toHaveBeenCalled()
    finish()
    await started
  })
})

describe('a start whose caller reports the failure', () => {
  it('rejects with the error the server gave and leaves no timer', async () => {
    vi.useFakeTimers()
    const failure = new Error('listen EADDRINUSE')

    await expect(
      startBundler(
        {start: async () => Promise.reject(failure)},
        {
          timeoutMs: 30000,
          onSlowStart: () => {},
          onFailure: rethrowStartFailure
        }
      )
    ).rejects.toBe(failure)

    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('a session that ended without a process exit', () => {
  const hostEvents = [
    'exit',
    'SIGINT',
    'SIGTERM',
    'SIGHUP',
    'uncaughtException',
    'unhandledRejection'
  ]
  const listened = () => hostEvents.map((event) => process.listenerCount(event))

  // What the dev server registers for one session, wired as it wires it.
  function startSession() {
    const closed: string[] = []
    const handler = vi.fn()
    const exit = vi.fn()
    const holdings = createSessionHoldings()
    holdings.add(() => closed.push('log file'))

    const lifecycle = createLifecycleStream({
      command: 'dev',
      browser: 'chromium',
      distPath: '/proj/dist/chromium',
      readyPath: '/proj/dist/extension-js/chromium/ready.json',
      write: () => {}
    })
    holdings.addForRelease(lifecycle.emitOnExit())

    const scheduler = new DevSessionRestartScheduler(300)
    scheduler.setHandler(handler)
    bindDevSessionRestart(scheduler)
    holdings.addEarly(() => {
      scheduler.dispose()
      unbindDevSessionRestart(scheduler)
    })

    holdings.addEarly(lifecycle.watchBrowserExit(1000, () => {}))
    holdings.addEarly(lifecycle.watchBrowserLaunchFailure(1000, () => {}))
    holdings.addForRelease(
      setupCleanupHandlers(
        () => null,
        {terminateCurrentInstance: async () => {}} as never,
        undefined,
        {exit, env: {}}
      )
    )

    return {closed, handler, exit, holdings, scheduler}
  }

  it('leaves the host as it found it after six sessions', async () => {
    vi.useFakeTimers()
    const before = listened()
    const sessions = []

    for (let index = 0; index < 6; index++) {
      const session = startSession()
      sessions.push(session)

      // One exit listener for the holdings and one for the last frame, and
      // both watchers plus a restart waiting on its timer.
      expect(process.listenerCount('exit')).toBe(before[0] + 2)
      session.scheduler.request({reason: 'env'})
      expect(vi.getTimerCount()).toBe(3)

      const order: string[] = []

      await releaseEndedSession({
        server: {
          stop: async () => {
            order.push('stop')
          }
        },
        releasePort: async () => {
          order.push('port')
        },
        closeControlBridge: async () => {
          order.push('bridge')
        },
        holdings: session.holdings
      })

      expect(order).toEqual(['stop', 'bridge', 'port'])
      expect(listened()).toEqual(before)
      expect(vi.getTimerCount()).toBe(0)
      expect(session.closed).toEqual(['log file'])
      expect(canAutoRestartDevSession()).toBe(false)
      expect(requestDevSessionRestart({}, {reason: 'env'})).toBe(false)
    }

    // Nothing of an ended session answers later: no restart, no second close.
    await vi.advanceTimersByTimeAsync(5000)

    for (const session of sessions) {
      session.holdings.releaseAll()
      expect(session.handler).not.toHaveBeenCalled()
      expect(session.closed).toEqual(['log file'])
      expect(session.exit).not.toHaveBeenCalled()
    }
  })

  it('runs what a session holds once, at the exit or at the release', () => {
    const events = new EventEmitter()
    const ran: string[] = []
    const holdings = createSessionHoldings(events)
    holdings.add(() => ran.push('file'))
    holdings.addEarly(() => ran.push('poller'))
    holdings.addEarly(() => {
      throw new Error('stop failed')
    })

    holdings.addEarly(() => ran.push('restart'))
    holdings.addForRelease(() => ran.push('release only'))

    expect(events.listenerCount('exit')).toBe(1)
    events.emit('exit', 0)

    // The exit keeps what only a release may remove, and closes files last.
    expect(ran).toEqual(['restart', 'poller', 'file'])
    holdings.beginRelease()
    holdings.releaseAll()
    events.emit('exit', 0)
    expect(ran).toEqual(['restart', 'poller', 'file'])

    // A release runs in two parts, and an exit between them does the rest.
    const later = new EventEmitter()
    const order: string[] = []
    const ending = createSessionHoldings(later)
    ending.add(() => order.push('file'))
    ending.addEarly(() => order.push('restart'))
    ending.addForRelease(() => order.push('release only'))
    ending.beginRelease()
    ending.beginRelease()
    expect(order).toEqual(['release only', 'restart'])
    expect(later.listenerCount('exit')).toBe(1)
    later.emit('exit', 0)
    later.emit('exit', 0)
    ending.releaseAll()

    // Begun, then the exit: each ran exactly once.
    expect(order).toEqual(['release only', 'restart', 'file'])
  })

  it('keeps the log file open until the server has stopped', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-ended-session-'))
    const filePath = path.join(root, 'logs.ndjson')
    const logFile = new LogsFileWriter({filePath, runId: 'run-1'})
    const row = (message: string) =>
      ({level: 'info', message, timestamp: 1}) as never
    const order: string[] = []
    const holdings = createSessionHoldings(new EventEmitter())
    holdings.add(() => {
      order.push('log file closed')
      logFile.close()
    })

    holdings.addEarly(() => order.push('restart disposed'))
    holdings.addForRelease(() => order.push('handlers removed'))

    try {
      logFile.start()
      logFile.write(row('before the session ended'))

      await releaseEndedSession({
        server: {
          stop: async () => {
            order.push('stop')
            logFile.write(row('while the server stopped'))
          }
        },
        closeControlBridge: async () => {
          order.push('bridge')
          logFile.write(row('while the bridge closed'))
        },
        releasePort: async () => {
          order.push('port')
        },
        holdings
      })

      expect(order).toEqual([
        'handlers removed',
        'restart disposed',
        'stop',
        'bridge',
        'port',
        'log file closed'
      ])

      const written = fs.readFileSync(filePath, 'utf8')
      expect(written).toContain('before the session ended')
      expect(written).toContain('while the server stopped')
      expect(written).toContain('while the bridge closed')
    } finally {
      logFile.close()
      fs.rmSync(root, {recursive: true, force: true})
    }
  })

  it('unbinds only the scheduler the session bound', () => {
    const ended = new DevSessionRestartScheduler(0)
    const running = new DevSessionRestartScheduler(0)
    bindDevSessionRestart(ended)
    bindDevSessionRestart(running)

    try {
      unbindDevSessionRestart(ended)
      expect(canAutoRestartDevSession()).toBe(true)
      unbindDevSessionRestart(running)
      expect(canAutoRestartDevSession()).toBe(false)
    } finally {
      unbindDevSessionRestart()
    }
  })
})

describe('the terminal frame of a start failure', () => {
  it('is written once by the engine, with the session, for a library caller', async () => {
    const saved = process.env.EXTENSION_OUTPUT
    process.env.EXTENSION_OUTPUT = 'ndjson'
    const lines: string[] = []
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-start-failure-'))
    const readyPath = path.join(root, 'ready.json')
    const eventsPath = path.join(root, 'events.ndjson')
    fs.writeFileSync(
      readyPath,
      JSON.stringify({port: 8080, runId: 'run-1', instanceId: 'instance-1'})
    )

    const lifecycle = createLifecycleStream({
      command: 'dev',
      browser: 'chromium',
      distPath: '/proj/dist/chromium',
      readyPath,
      eventsPath,
      write: (line) => lines.push(line)
    })

    try {
      lifecycle.starting({requestedPort: 8080, port: 8080})

      const fail = createStartFailure({
        metadata: {writeError: () => {}},
        lifecycle,
        exitOnError: false
      })

      // The rejection names the session and says the frame is written.
      await expect(
        startBundler(
          {start: async () => Promise.reject(new Error('watch broke'))},
          {timeoutMs: 30000, onSlowStart: () => {}, onFailure: fail}
        )
      ).rejects.toMatchObject({
        code: 'E_DEV_SERVER_START',
        session: {
          command: 'dev',
          browser: 'chromium',
          pid: process.pid,
          port: 8080,
          readyPath,
          eventsPath,
          runId: 'run-1',
          instanceId: 'instance-1'
        },
        framed: true
      })

      // The exit that follows adds nothing to a stream that has ended.
      lifecycle.exited(1)

      const frames = lines.map((line) => JSON.parse(line))
      expect(frames.map((frame) => frame.status)).toEqual([
        'starting',
        'failed'
      ])

      expect(frames[1]).toMatchObject({
        ok: false,
        error: {code: 'E_DEV_SERVER_START', message: 'watch broke'},
        value: {
          pid: process.pid,
          port: 8080,
          readyPath,
          eventsPath,
          runId: 'run-1',
          instanceId: 'instance-1'
        }
      })
    } finally {
      fs.rmSync(root, {recursive: true, force: true})

      if (saved === undefined) {
        Reflect.deleteProperty(process.env, 'EXTENSION_OUTPUT')
      } else process.env.EXTENSION_OUTPUT = saved
    }
  })

  it('says the frame is not written when the stream is off', async () => {
    const saved = process.env.EXTENSION_OUTPUT
    Reflect.deleteProperty(process.env, 'EXTENSION_OUTPUT')
    const lines: string[] = []
    const lifecycle = createLifecycleStream({
      command: 'dev',
      browser: 'chromium',
      distPath: '/proj/dist/chromium',
      write: (line) => lines.push(line)
    })

    try {
      await expect(
        startBundler(
          {start: async () => Promise.reject(new Error('watch broke'))},
          {
            timeoutMs: 30000,
            onSlowStart: () => {},
            onFailure: createStartFailure({
              metadata: {writeError: () => {}},
              lifecycle,
              exitOnError: false
            })
          }
        )
      ).rejects.toMatchObject({code: 'E_DEV_SERVER_START', framed: false})

      expect(lines).toEqual([])
    } finally {
      if (saved !== undefined) process.env.EXTENSION_OUTPUT = saved
    }
  })

  it('still writes the frame when the engine ends the process', () => {
    const saved = process.env.EXTENSION_OUTPUT
    process.env.EXTENSION_OUTPUT = 'ndjson'
    const lines: string[] = []
    const lifecycle = createLifecycleStream({
      command: 'dev',
      browser: 'chromium',
      distPath: '/proj/dist/chromium',
      write: (line) => lines.push(line)
    })

    try {
      createStartFailure({
        metadata: {writeError: () => {}},
        lifecycle,
        print: () => {},
        exit: (() => {}) as never,
        exitOnError: true
      })(new Error('watch broke'))

      lifecycle.exited(1)

      expect(lines.map((line) => JSON.parse(line).status)).toEqual(['failed'])
    } finally {
      if (saved === undefined) {
        Reflect.deleteProperty(process.env, 'EXTENSION_OUTPUT')
      } else process.env.EXTENSION_OUTPUT = saved
    }
  })
})

describe('the code a restart failure is reported under', () => {
  it('keeps a code the catalog knows and drops any other', () => {
    expect(declaredErrorCode(codedError(CODES.E_CONFIG_LOAD, 'x'))).toBe(
      'E_CONFIG_LOAD'
    )

    expect(
      declaredErrorCode(Object.assign(new Error('x'), {code: 'EADDRINUSE'}))
    ).toBeUndefined()

    expect(declaredErrorCode(new Error('x'))).toBeUndefined()
    expect(declaredErrorCode(null)).toBeUndefined()
  })
})

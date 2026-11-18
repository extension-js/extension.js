import {afterEach, describe, expect, it, vi} from 'vitest'
import {codedError} from '../../lib/coded-error'
import {CODES} from '../../lib/messaging'
import {stripAnsi} from '../lifecycle-stream'
import {
  announceReadyOnCleanCompile,
  createBindFailureRelay,
  createReadyAnnouncer,
  createStartFailure,
  declaredErrorCode,
  devServerStartError,
  readStartTimeoutMs,
  releaseFailedStart,
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
      lifecycle: {failed},
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
      lifecycle: {failed: () => {}},
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
        lifecycle: {failed: () => {}},
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
    const failed = vi.fn()
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
        lifecycle: {failed},
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
        cause: failure
      })

      // The session records still say why it ended.
      expect(writeError).toHaveBeenCalledWith(
        'dev_server_start_failed',
        failure.message
      )

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

    expect(order).toEqual(['stop', 'port', 'bridge'])

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

    expect(late).toEqual(['port', 'bridge'])
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

  it.each([
    ['a word', 'soon'],
    ['zero', '0'],
    ['a negative number', '-5'],
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

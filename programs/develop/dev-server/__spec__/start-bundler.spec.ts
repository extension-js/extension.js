import {afterEach, describe, expect, it, vi} from 'vitest'
import {stripAnsi} from '../lifecycle-stream'
import {
  announceReadyOnCleanCompile,
  createReadyAnnouncer,
  createStartFailure,
  readStartTimeoutMs,
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

  // Pins today's behavior. Ledger 1391 D8.
  it('warns at once when EXTENSION_START_TIMEOUT_MS is not a number', async () => {
    vi.useFakeTimers()
    const timeoutMs = readStartTimeoutMs({EXTENSION_START_TIMEOUT_MS: 'soon'})
    const onSlowStart = vi.fn()

    let finish: () => void = () => {}

    const started = startBundler(
      {start: () => new Promise<void>((resolve) => (finish = resolve))},
      {timeoutMs, onSlowStart, onFailure: () => {}}
    )

    expect(timeoutMs).toBeNaN()
    await vi.advanceTimersByTimeAsync(1)
    expect(onSlowStart).toHaveBeenCalledTimes(1)
    finish()
    await started
  })
})

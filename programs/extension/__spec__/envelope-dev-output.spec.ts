import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi
} from 'vitest'
import {registerDevCommand} from '../commands/dev'
import {WaitModeError} from '../commands/dev-wait'
import {CODES} from '../helpers/messaging'
import {
  makeProgram,
  runCli,
  stubCommandEnv,
  stubProcessExit
} from './command-harness'

const extensionDev = vi.fn(async () => {})
// The one call that sends a failure row, so a spec can read what would travel.
const reportFailure = vi.fn()
const runWaitMode = vi.fn(async (_input: unknown) => ({
  format: 'pretty' as const,
  browsers: ['chromium'],
  results: [{browser: 'chromium', status: 'ready'}]
}))

let logSpy: MockInstance<typeof console.log>

beforeEach(() => {
  stubProcessExit()
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  stubCommandEnv()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

// Only waitForReady is faked on the wait path: describeWaitError is the code
// under test here.
function run(argv: string[]) {
  return runCli(
    makeProgram((program) =>
      registerDevCommand(program, {
        loadDevelop: async () => ({extensionDev}),
        launcher: vi.fn(async () => {}) as never,
        safariPreflight: () => null,
        waitForReady: (input) => runWaitMode(input) as never,
        reportFailure
      })
    ),
    argv
  )
}

function frames(): any[] {
  return logSpy.mock.calls.map((call) => JSON.parse(String(call[0])))
}

describe('extension dev --output json', () => {
  it('emits one startup frame and keeps running', async () => {
    expect(await run(['dev', '.', '--output', 'json'])).toBe(0)
    const emitted = frames()
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({
      schema: 1,
      ok: true,
      command: 'dev',
      status: 'started',
      error: null,
      warnings: []
    })

    expect(emitted[0].value).toMatchObject({
      browser: 'chromium',
      browsers: ['chromium'],
      port: 8080,
      pid: process.pid,
      noBrowser: false
    })

    // The startup frame must not stand in for running the dev server.
    expect(extensionDev).toHaveBeenCalledTimes(1)
  })

  it('reports the requested port and the no-browser decision', async () => {
    vi.stubEnv('EXTENSION_CLI_NO_BROWSER', '1')
    expect(await run(['dev', '.', '--output', 'json', '--port', '9331'])).toBe(
      0
    )

    expect(frames()[0].value).toMatchObject({port: 9331, noBrowser: true})
  })

  it('stays silent on stdout without --output json', async () => {
    expect(await run(['dev', '.'])).toBe(0)
    expect(logSpy).not.toHaveBeenCalled()
  })

  it('emits a failure frame for an unsupported browser', async () => {
    expect(
      await run(['dev', '.', '--browser', 'netscape', '--output', 'json'])
    ).toBe(1)

    const emitted = frames()
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({
      schema: 1,
      ok: false,
      command: 'dev',
      status: 'usage',
      value: null,
      error: {code: CODES.E_UNSUPPORTED_BROWSER}
    })

    expect(String(emitted[0].error.message)).toContain('netscape')
    expect(extensionDev).not.toHaveBeenCalled()
  })

  it('turns --wait into an envelope without --wait-format', async () => {
    expect(await run(['dev', '.', '--wait', '--output', 'json'])).toBe(0)
    expect(frames()[0]).toMatchObject({
      schema: 1,
      ok: true,
      command: 'dev',
      status: 'ready',
      value: {
        mode: 'wait',
        command: 'dev',
        browsers: ['chromium'],
        results: [{browser: 'chromium', status: 'ready'}]
      }
    })
  })

  it('reports a wait timeout as E_READY_TIMEOUT', async () => {
    runWaitMode.mockRejectedValueOnce(
      new WaitModeError(
        'Timed out waiting for ready contract',
        CODES.E_READY_TIMEOUT
      )
    )

    await expect(
      run(['dev', '.', '--wait', '--output', 'json'])
    ).rejects.toThrow('Timed out')

    expect(frames()[0]).toMatchObject({
      schema: 1,
      ok: false,
      command: 'dev',
      status: 'timeout',
      value: null,
      error: {code: CODES.E_READY_TIMEOUT}
    })

    expect(typeof frames()[0].hint).toBe('string')
  })

  it('frames a locked profile on --wait as failed with the hint preview gives', async () => {
    runWaitMode.mockRejectedValueOnce(
      new WaitModeError('The profile is in use.', CODES.E_PROFILE_LOCKED)
    )

    await expect(
      run(['dev', '.', '--wait', '--output', 'json'])
    ).rejects.toThrow('The profile is in use.')

    expect(frames()).toEqual([
      {
        schema: 1,
        ok: false,
        command: 'dev',
        status: 'failed',
        value: null,
        error: {
          code: CODES.E_PROFILE_LOCKED,
          message: 'The profile is in use.'
        },
        warnings: [],
        hint: 'Close the browser that has this profile open, or pass --profile <path> to use another one.'
      }
    ])
  })

  it('frames a locked profile from develop with the same hint', async () => {
    extensionDev.mockRejectedValueOnce(
      Object.assign(new Error('The profile is in use.'), {
        code: CODES.E_PROFILE_LOCKED
      })
    )

    expect(await run(['dev', '.', '--output', 'json'])).toBe(1)
    expect(frames()).toEqual([
      {
        schema: 1,
        ok: false,
        command: 'dev',
        status: 'failed',
        value: null,
        error: {
          code: CODES.E_PROFILE_LOCKED,
          message: 'The profile is in use.'
        },
        warnings: [],
        hint: 'Close the browser that has this profile open, or pass --profile <path> to use another one.'
      }
    ])
  })

  it('reports the remote-url refusal as E_REMOTE_URL_UNSUPPORTED', async () => {
    runWaitMode.mockRejectedValueOnce(
      new WaitModeError(
        '--wait requires a local project path (remote URLs are not supported)',
        CODES.E_REMOTE_URL_UNSUPPORTED
      )
    )

    await expect(
      run(['dev', 'https://example.com/ext.zip', '--wait', '--output', 'json'])
    ).rejects.toThrow('remote URLs')

    expect(frames()[0]).toMatchObject({
      ok: false,
      command: 'dev',
      status: 'usage',
      error: {code: CODES.E_REMOTE_URL_UNSUPPORTED}
    })
  })

  it('lets --output win over a contradicting --wait-format alias', async () => {
    expect(
      await run([
        'dev',
        '.',
        '--wait',
        '--output',
        'pretty',
        '--wait-format',
        'json'
      ])
    ).toBe(0)

    expect(logSpy).not.toHaveBeenCalled()
  })

  it('frames a runtime failure instead of dying with a bare exit', async () => {
    extensionDev.mockRejectedValueOnce(
      Object.assign(new Error('dev server start failed'), {
        code: 'E_DEV_SERVER_START'
      })
    )

    expect(await run(['dev', '.', '--output', 'json'])).toBe(1)

    const emitted = frames()
    // One frame: the run was refused before a session existed, so no ok
    // "started" may stand ahead of the failure.
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({
      schema: 1,
      ok: false,
      command: 'dev',
      status: 'failed',
      value: null,
      error: {
        code: CODES.E_DEV_SERVER_START,
        message: 'dev server start failed'
      }
    })

    expect(typeof emitted[0].hint).toBe('string')
  })

  it('prints the startup frame when develop says the session exists', async () => {
    extensionDev.mockImplementationOnce((async (
      _path: string,
      opts: {onSessionStart?: () => void}
    ) => {
      expect(frames()).toEqual([])
      opts.onSessionStart?.()
      expect(frames()).toHaveLength(1)
      // A second call, from a second browser, must not print it again.
      opts.onSessionStart?.()
    }) as never)

    expect(await run(['dev', '.', '--output', 'json'])).toBe(0)

    const emitted = frames()
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({ok: true, status: 'started'})
  })

  it('hands develop an onReady that prints no frame of its own', async () => {
    extensionDev.mockImplementationOnce((async (
      _path: string,
      opts: {onReady?: () => void}
    ) => {
      expect(typeof opts.onReady).toBe('function')
      opts.onReady?.()
      opts.onReady?.()
    }) as never)

    expect(await run(['dev', '.', '--output', 'json'])).toBe(0)

    expect(frames().map((frame) => frame.status)).toEqual(['started'])
  })

  it('keeps the startup frame once a session failed after it began', async () => {
    extensionDev.mockImplementationOnce((async (
      _path: string,
      opts: {onSessionStart?: () => void}
    ) => {
      opts.onSessionStart?.()

      throw Object.assign(new Error('the port was taken'), {
        code: 'E_DEV_SERVER_START'
      })
    }) as never)

    expect(await run(['dev', '.', '--output', 'json'])).toBe(1)

    const emitted = frames()
    expect(emitted.map((frame) => frame.status)).toEqual(['started', 'failed'])
  })

  it('asks extensionDev to reject under json and to exit under pretty', async () => {
    expect(await run(['dev', '.', '--output', 'json'])).toBe(0)
    expect((extensionDev.mock.calls[0] as unknown[])?.[1]).toMatchObject({
      exitOnError: false
    })

    extensionDev.mockClear()
    expect(await run(['dev', '.'])).toBe(0)
    expect((extensionDev.mock.calls[0] as unknown[])?.[1]).toMatchObject({
      exitOnError: true
    })
  })

  it('reports a failure develop exits on itself, with its catalog code', async () => {
    type ExitHook = (error: unknown, code?: string) => void
    const hookOf = () =>
      (extensionDev.mock.calls[0] as unknown[])?.[1] as {onExitError: ExitHook}

    expect(await run(['dev', '.'])).toBe(0)
    expect(reportFailure).not.toHaveBeenCalled()

    hookOf().onExitError(
      Object.assign(new Error('bad config'), {code: 'E_CONFIG_LOAD'})
    )

    hookOf().onExitError(new Error('port taken'), 'E_DEV_SERVER_START')
    hookOf().onExitError(new Error('boom'))

    expect(reportFailure.mock.calls).toEqual([
      [{code: CODES.E_CONFIG_LOAD, exitCode: 1}],
      [{code: CODES.E_DEV_SERVER_START, exitCode: 1}],
      [{code: CODES.E_INTERNAL, exitCode: 1}]
    ])

    // Reporting prints nothing: develop already said what failed.
    expect(logSpy).not.toHaveBeenCalled()
    expect(console.error).not.toHaveBeenCalled()
  })

  it('keeps the json failure on the path that frames it, reported once', async () => {
    extensionDev.mockRejectedValueOnce(
      Object.assign(new Error('bad config'), {code: 'E_CONFIG_LOAD'})
    )

    expect(await run(['dev', '.', '--output', 'json'])).toBe(1)
    expect(frames().map((frame) => frame.status)).toEqual(['failed'])
    expect(reportFailure.mock.calls).toEqual([
      [{code: CODES.E_CONFIG_LOAD, exitCode: 1}]
    ])
  })

  it('reports a refusal before the run once, with its catalog code', async () => {
    expect(
      await run(['dev', '.', '--browser', 'nope', '--output', 'json'])
    ).toBe(1)

    expect(frames().map((frame) => frame.error.code)).toEqual([
      CODES.E_UNSUPPORTED_BROWSER
    ])

    expect(reportFailure.mock.calls).toEqual([
      [{code: CODES.E_UNSUPPORTED_BROWSER, exitCode: 1}]
    ])
  })

  it('maps an untagged runtime failure to E_INTERNAL', async () => {
    extensionDev.mockRejectedValueOnce(new Error('boom'))
    expect(await run(['dev', '.', '--output', 'json'])).toBe(1)
    expect(frames()).toHaveLength(1)
    expect(frames()[0]).toMatchObject({
      ok: false,
      status: 'failed',
      error: {code: CODES.E_INTERNAL, message: 'boom'}
    })
  })
})

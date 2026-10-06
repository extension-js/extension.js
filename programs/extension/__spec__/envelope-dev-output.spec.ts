import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi
} from 'vitest'

const extensionDev = vi.fn(async () => {})
const runWaitMode = vi.fn(async (_input: unknown) => ({
  format: 'pretty' as const,
  browsers: ['chromium'],
  results: [{browser: 'chromium', status: 'ready'}]
}))

vi.mock('../browsers', () => ({
  launchBrowser: vi.fn(async () => {})
}))

vi.mock('../helpers/extension-develop-runtime', () => ({
  loadExtensionDevelopModule: vi.fn(async () => ({extensionDev}))
}))

vi.mock('../browsers/run-safari/safari-launch', () => ({
  packageSafariExtension: vi.fn(async () => {}),
  safariPreflightError: () => null
}))

vi.mock('../browsers/run-safari/safari-launch/safari-config', () => ({
  isValidBundleId: (id: string) => id.includes('.') && !id.includes(' ')
}))

// Only runWaitMode is stubbed: describeWaitError is the code under test here.
vi.mock('../commands/dev-wait', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../commands/dev-wait')>()

  return {...actual, runWaitMode: (input: unknown) => runWaitMode(input)}
})

import {registerDevCommand} from '../commands/dev'
import {WaitModeError} from '../commands/dev-wait'
import {CODES} from '../helpers/messaging'
import {makeProgram, runCli, stubProcessExit} from './command-harness'

const ORIG_ENV = {...process.env}

let logSpy: MockInstance<typeof console.log>

beforeEach(() => {
  stubProcessExit()
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  delete process.env.EXTENSION_CLI_NO_BROWSER
})

afterEach(() => {
  process.env = {...ORIG_ENV}
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

function run(argv: string[]) {
  return runCli(makeProgram(registerDevCommand), argv)
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
    process.env.EXTENSION_CLI_NO_BROWSER = '1'
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

  it('emits a failure frame for a malformed --parent-pid', async () => {
    expect(
      await run(['dev', '.', '--parent-pid', 'zero', '--output', 'json'])
    ).toBe(1)

    expect(frames()[0]).toMatchObject({
      ok: false,
      status: 'usage',
      error: {code: CODES.E_INVALID_OPTION}
    })
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

  it('keeps the legacy --wait-format=json trigger working', async () => {
    expect(await run(['dev', '.', '--wait', '--wait-format', 'json'])).toBe(0)
    expect(frames()[0]).toMatchObject({schema: 1, status: 'ready'})
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

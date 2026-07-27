import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const extensionDev = vi.fn(async () => {})
const runWaitMode = vi.fn(async () => ({
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
  return {...actual, runWaitMode: (input: unknown) => runWaitMode(input as any)}
})

import {registerDevCommand} from '../commands/dev'
import {WaitModeError} from '../commands/dev-wait'
import {CODES} from '../helpers/messaging'
import {makeProgram, runCli, stubProcessExit} from './command-harness'

const ORIG_ENV = {...process.env}

let logSpy: ReturnType<typeof vi.spyOn>

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

  it('reports the remote-url refusal as E_ARGS', async () => {
    runWaitMode.mockRejectedValueOnce(
      new WaitModeError(
        '--wait requires a local project path (remote URLs are not supported)',
        CODES.E_ARGS
      )
    )
    await expect(
      run(['dev', 'https://example.com/ext.zip', '--wait', '--output', 'json'])
    ).rejects.toThrow('remote URLs')
    expect(frames()[0]).toMatchObject({
      ok: false,
      command: 'dev',
      status: 'usage',
      error: {code: CODES.E_ARGS}
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
    // Frame 1 is the startup frame; the failure closes the stream.
    expect(emitted[0]).toMatchObject({ok: true, status: 'started'})
    expect(emitted[1]).toMatchObject({
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
    expect(typeof emitted[1].hint).toBe('string')
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
    expect(frames()[1]).toMatchObject({
      ok: false,
      status: 'failed',
      error: {code: CODES.E_INTERNAL, message: 'boom'}
    })
  })
})

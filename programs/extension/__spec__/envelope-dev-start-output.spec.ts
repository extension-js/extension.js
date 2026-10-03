import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi
} from 'vitest'

const extensionBuild = vi.fn(async () => {})
const extensionPreview = vi.fn(
  async (_path: string, _opts: any, launcher: (o: any) => unknown) => {
    launcher({launched: true})
  }
)
const runWaitMode = vi.fn(async (_input: unknown) => ({
  format: 'pretty' as const,
  browsers: ['chromium'],
  results: [{browser: 'chromium', status: 'ready'}]
}))

vi.mock('../helpers/extension-develop-runtime', () => ({
  loadExtensionDevelopModule: vi.fn(async () => ({extensionBuild})),
  loadExtensionDevelopPreviewModule: vi.fn(async () => ({extensionPreview}))
}))

vi.mock('../browsers/run-only', () => ({
  runOnlyPreviewBrowser: vi.fn(async () => {})
}))

// Only runWaitMode is stubbed: describeWaitError is the code under test here.
vi.mock('../commands/dev-wait', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../commands/dev-wait')>()

  return {...actual, runWaitMode: (input: unknown) => runWaitMode(input)}
})

import {WaitModeError} from '../commands/dev-wait'
import {registerStartCommand} from '../commands/start'
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
  return runCli(makeProgram(registerStartCommand), argv)
}

function frames(): any[] {
  return logSpy.mock.calls.map((call) => JSON.parse(String(call[0])))
}

describe('extension start --output json', () => {
  it('emits one startup frame and still builds and launches', async () => {
    expect(await run(['start', '.', '--output', 'json'])).toBe(0)
    // Same contract as build/preview: develop's previewing banner is a
    // humanLine, and this env is what keeps it off the envelope stream.
    expect(process.env.EXTENSION_OUTPUT).toBe('json')
    const emitted = frames()
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({
      schema: 1,
      ok: true,
      command: 'start',
      status: 'started',
      error: null,
      warnings: []
    })

    // `port` stayed on the frame for readers of the 4.1.30 shape. It was the
    // requested port then and nothing ever listened on it, so it is null now.
    expect(emitted[0].value).toMatchObject({
      browser: 'chromium',
      browsers: ['chromium'],
      pid: process.pid,
      port: null
    })

    expect(extensionBuild).toHaveBeenCalledTimes(1)
    expect(extensionPreview).toHaveBeenCalledTimes(1)

    // The frame says started, so it waits for the build and the launch.
    const framedAt = logSpy.mock.invocationCallOrder[0]
    expect(extensionBuild.mock.invocationCallOrder[0]).toBeLessThan(framedAt)
    expect(extensionPreview.mock.invocationCallOrder[0]).toBeLessThan(framedAt)
  })

  it('hands the build its own error handling under json', async () => {
    expect(await run(['start', '.', '--output', 'json'])).toBe(0)
    const [, buildOpts] = extensionBuild.mock.calls[0] as any[]
    expect(buildOpts.exitOnError).toBe(false)
  })

  it('keeps exitOnError under the default pretty output', async () => {
    expect(await run(['start', '.'])).toBe(0)
    const [, buildOpts] = extensionBuild.mock.calls[0] as any[]
    expect(buildOpts.exitOnError).toBe(true)
    expect(logSpy).not.toHaveBeenCalled()
  })

  it('emits a failure frame when the build rejects', async () => {
    extensionBuild.mockRejectedValueOnce(new Error('Build failed with errors'))
    expect(await run(['start', '.', '--output', 'json'])).toBe(1)
    const emitted = frames()
    // One frame: an ok "started" ahead of it described a run that failed.
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({
      schema: 1,
      ok: false,
      command: 'start',
      status: 'build-failed',
      value: null,
      error: {code: CODES.E_COMPILE, message: 'Build failed with errors'}
    })

    expect(extensionPreview).not.toHaveBeenCalled()
  })

  it('prints no ok frame when the launch rejects', async () => {
    extensionPreview.mockRejectedValueOnce(
      Object.assign(new Error('the browser never started'), {
        code: CODES.E_BROWSER_LAUNCH
      })
    )

    await expect(run(['start', '.', '--output', 'json'])).rejects.toThrow(
      'the browser never started'
    )

    expect(frames()).toEqual([])
  })

  it('emits a failure frame for safari', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(
      await run(['start', '.', '--browser', 'safari', '--output', 'json'])
    ).toBe(1)

    expect(frames()[0]).toMatchObject({
      ok: false,
      command: 'start',
      status: 'usage',
      error: {
        code: CODES.E_COMMAND_UNSUPPORTED_FOR_TARGET,
        message: 'Safari is not supported by start.'
      }
    })

    expect(frames()[0].error.code).not.toBe(CODES.E_UNSUPPORTED_BROWSER)
    expect(errorSpy).not.toHaveBeenCalled()
    expect(extensionBuild).not.toHaveBeenCalled()
  })

  it('turns --wait into an envelope without --wait-format', async () => {
    expect(await run(['start', '.', '--wait', '--output', 'json'])).toBe(0)
    expect(frames()[0]).toMatchObject({
      schema: 1,
      ok: true,
      command: 'start',
      status: 'ready',
      value: {mode: 'wait', command: 'start', browsers: ['chromium']}
    })

    expect(extensionBuild).not.toHaveBeenCalled()
  })

  it('reports a wait timeout as E_READY_TIMEOUT', async () => {
    runWaitMode.mockRejectedValueOnce(
      new WaitModeError('Timed out waiting', CODES.E_READY_TIMEOUT)
    )

    await expect(
      run(['start', '.', '--wait', '--output', 'json'])
    ).rejects.toThrow('Timed out')

    expect(frames()[0]).toMatchObject({
      ok: false,
      command: 'start',
      status: 'timeout',
      error: {code: CODES.E_READY_TIMEOUT}
    })
  })

  it('falls back to E_INTERNAL for an untagged wait failure', async () => {
    runWaitMode.mockRejectedValueOnce(new Error('Compilation failed'))
    await expect(
      run(['start', '.', '--wait', '--output', 'json'])
    ).rejects.toThrow('Compilation failed')

    expect(frames()[0]).toMatchObject({
      ok: false,
      status: 'failed',
      error: {code: CODES.E_INTERNAL, message: 'Compilation failed'}
    })
  })
})

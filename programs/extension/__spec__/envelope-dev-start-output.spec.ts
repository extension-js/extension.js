import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const extensionBuild = vi.fn(async () => {})
const extensionPreview = vi.fn(
  async (_path: string, _opts: any, launcher: (o: any) => unknown) => {
    launcher({launched: true})
  }
)
const runWaitMode = vi.fn(async () => ({
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
  return {...actual, runWaitMode: (input: unknown) => runWaitMode(input as any)}
})

import {WaitModeError} from '../commands/dev-wait'
import {registerStartCommand} from '../commands/start'
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
    expect(emitted[0].value).toMatchObject({
      browser: 'chromium',
      browsers: ['chromium'],
      port: 8080,
      pid: process.pid
    })
    expect(extensionBuild).toHaveBeenCalledTimes(1)
    expect(extensionPreview).toHaveBeenCalledTimes(1)
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
    expect(emitted).toHaveLength(2)
    expect(emitted[0]).toMatchObject({status: 'started'})
    expect(emitted[1]).toMatchObject({
      schema: 1,
      ok: false,
      command: 'start',
      status: 'build-failed',
      value: null,
      error: {code: CODES.E_COMPILE, message: 'Build failed with errors'}
    })
    expect(extensionPreview).not.toHaveBeenCalled()
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

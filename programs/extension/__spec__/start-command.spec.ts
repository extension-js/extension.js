import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const extensionBuild = vi.fn(async () => {})
const extensionPreview = vi.fn(
  async (_path: string, _opts: any, launcher: (o: any) => unknown) => {
    launcher({launched: true})
  }
)
const runWaitMode = vi.fn(async () => ({
  format: 'json' as const,
  browsers: ['chromium'],
  results: [{browser: 'chromium', ok: true}]
}))

vi.mock('../helpers/extension-develop-runtime', () => ({
  loadExtensionDevelopModule: vi.fn(async () => ({extensionBuild})),
  loadExtensionDevelopPreviewModule: vi.fn(async () => ({extensionPreview}))
}))
vi.mock('../browsers/run-only', () => ({
  runOnlyPreviewBrowser: vi.fn(async () => {})
}))
vi.mock('../commands/dev-wait', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../commands/dev-wait')>()
  return {...actual, runWaitMode: (input: unknown) => runWaitMode(input as any)}
})

import {runOnlyPreviewBrowser} from '../browsers/run-only'
import {registerStartCommand} from '../commands/start'
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

describe('extension start', () => {
  it('builds in production then launches the preview browser', async () => {
    expect(await run(['start', './my-extension'])).toBe(0)
    expect(extensionBuild).toHaveBeenCalledTimes(1)
    const [, buildOpts] = extensionBuild.mock.calls[0] as any[]
    expect(buildOpts).toMatchObject({
      browser: 'chromium',
      exitOnError: true,
      metadataCommand: 'start',
      silent: true
    })
    // Unset polyfill stays undefined so commands.start.polyfill can apply.
    // The start-phase build still defaults it on inside extensionBuild.
    expect(buildOpts.polyfill).toBeUndefined()

    expect(extensionPreview).toHaveBeenCalledTimes(1)
    const [, previewOpts] = extensionPreview.mock.calls[0] as any[]
    expect(previewOpts).toMatchObject({
      mode: 'production',
      metadataCommand: 'start'
    })
    // Logger defaults live in extensionPreview, not forced at the CLI layer.
    expect(previewOpts.logLevel).toBeUndefined()
    expect(previewOpts.logFormat).toBeUndefined()
    expect(previewOpts.logTimestamps).toBeUndefined()
    expect(previewOpts.logColor).toBeUndefined()
    expect(runOnlyPreviewBrowser).toHaveBeenCalledWith({launched: true})
  })

  it('disables the polyfill with --polyfill false', async () => {
    expect(await run(['start', '.', '--polyfill', 'false'])).toBe(0)
    const [, buildOpts] = extensionBuild.mock.calls[0] as any[]
    expect(buildOpts.polyfill).toBe(false)
  })

  it('enables the polyfill explicitly with --polyfill', async () => {
    expect(await run(['start', '.', '--polyfill'])).toBe(0)
    const [, buildOpts] = extensionBuild.mock.calls[0] as any[]
    expect(buildOpts.polyfill).toBe(true)
  })

  it('normalizes --profile false to the system-profile sentinel', async () => {
    expect(await run(['start', '.', '--profile', 'false'])).toBe(0)
    const [, previewOpts] = extensionPreview.mock.calls[0] as any[]
    expect(previewOpts.profile).toBe(false)
  })

  it('keeps an explicit --profile path as a string', async () => {
    expect(await run(['start', '.', '--profile', '/tmp/my-profile'])).toBe(0)
    const [, previewOpts] = extensionPreview.mock.calls[0] as any[]
    expect(previewOpts.profile).toBe('/tmp/my-profile')
  })

  it('skips the browser phase when EXTENSION_CLI_NO_BROWSER is set', async () => {
    process.env.EXTENSION_CLI_NO_BROWSER = '1'
    expect(await run(['start', '.'])).toBe(0)
    expect(extensionBuild).toHaveBeenCalledTimes(1)
    expect(extensionPreview).not.toHaveBeenCalled()
  })

  it('enables author diagnostics with --author', async () => {
    delete process.env.EXTENSION_AUTHOR_MODE
    delete process.env.EXTENSION_VERBOSE
    expect(await run(['start', '.', '--author'])).toBe(0)
    expect(process.env.EXTENSION_AUTHOR_MODE).toBe('true')
    expect(process.env.EXTENSION_VERBOSE).toBe('1')
  })

  it('exits on an unsupported browser name', async () => {
    expect(await run(['start', '.', '--browser', 'netscape'])).toBe(1)
    expect(extensionBuild).not.toHaveBeenCalled()
  })

  it('rejects safari with a clear error', async () => {
    expect(await run(['start', '.', '--browser', 'safari'])).toBe(1)
    expect(extensionBuild).not.toHaveBeenCalled()
  })

  it('emits E_UNSUPPORTED_BROWSER instead of prose with --output json', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(
      await run(['start', '.', '--browser', 'netscape', '--output', 'json'])
    ).toBe(1)
    const frame = JSON.parse(String(logSpy.mock.calls[0][0]))
    expect(frame.status).toBe('usage')
    expect(frame.error.code).toBe('E_UNSUPPORTED_BROWSER')
    expect(errorSpy).not.toHaveBeenCalled()
  })

  // Safari is a supported browser that this command has no path for, which is
  // a different failure from an unknown vendor. The two codes must not collapse.
  it('separates safari-on-start from an unknown vendor', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(
      await run(['start', '.', '--browser', 'safari', '--output', 'json'])
    ).toBe(1)
    const frame = JSON.parse(String(logSpy.mock.calls[0][0]))
    expect(frame.status).toBe('usage')
    expect(frame.error.code).toBe('E_COMMAND_UNSUPPORTED_FOR_TARGET')
    expect(frame.error.code).not.toBe('E_UNSUPPORTED_BROWSER')
    expect(frame.error.message).toContain('Safari')
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('delegates --wait to wait mode and prints the json envelope', async () => {
    expect(await run(['start', '.', '--wait', '--wait-format', 'json'])).toBe(0)
    expect(runWaitMode).toHaveBeenCalledWith(
      expect.objectContaining({command: 'start'})
    )
    const payload = JSON.parse(String(logSpy.mock.calls[0][0]))
    // The pre-envelope wait frame now rides inside value.
    expect(payload).toMatchObject({
      schema: 1,
      ok: true,
      command: 'start',
      status: 'ready',
      error: null,
      value: {mode: 'wait', command: 'start'}
    })
    expect(extensionBuild).not.toHaveBeenCalled()
  })
})

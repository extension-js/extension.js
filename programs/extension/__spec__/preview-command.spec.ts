import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const extensionPreview = vi.fn(
  async (_path: string, _opts: any, launcher: (o: any) => unknown) => {
    launcher({launched: true})
  }
)

vi.mock('../helpers/extension-develop-runtime', () => ({
  loadExtensionDevelopPreviewModule: vi.fn(async () => ({extensionPreview}))
}))
vi.mock('../browsers/run-only', () => ({
  runOnlyPreviewBrowser: vi.fn(async () => {})
}))

import {readFile} from 'node:fs/promises'
import {runOnlyPreviewBrowser} from '../browsers/run-only'
import {
  PREVIEW_NOT_FOUND_NEEDLES,
  registerPreviewCommand
} from '../commands/preview'
import {makeProgram, runCli, stubProcessExit} from './command-harness'

const ORIG_ENV = {...process.env}

beforeEach(() => {
  stubProcessExit()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  delete process.env.EXTJS_LIGHT
  delete process.env.EXTENSION_CLI_NO_BROWSER
  delete process.env.EXTENSION_AUTHOR_MODE
  delete process.env.EXTENSION_VERBOSE
})

afterEach(() => {
  process.env = {...ORIG_ENV}
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

function run(argv: string[]) {
  return runCli(makeProgram(registerPreviewCommand), argv)
}

describe('extension preview', () => {
  it('previews with production mode and quiet logger defaults', async () => {
    expect(await run(['preview', './my-extension'])).toBe(0)
    expect(extensionPreview).toHaveBeenCalledTimes(1)
    const [projectPath, opts] = extensionPreview.mock.calls[0]
    expect(projectPath).toBe('./my-extension')
    expect(opts).toMatchObject({
      mode: 'production',
      browser: 'chromium',
      logLevel: 'off',
      logFormat: 'pretty',
      logTimestamps: true,
      logColor: true,
      noBrowser: false
    })
    expect(runOnlyPreviewBrowser).toHaveBeenCalledWith({launched: true})
  })

  it('rejects safari with a clear error', async () => {
    expect(await run(['preview', '.', '--browser', 'safari'])).toBe(1)
    expect(extensionPreview).not.toHaveBeenCalled()
  })

  it('exits on an unsupported browser name', async () => {
    expect(await run(['preview', '.', '--browser', 'netscape'])).toBe(1)
    expect(extensionPreview).not.toHaveBeenCalled()
  })

  it('turns on light mode for remote extension urls', async () => {
    expect(await run(['preview', 'https://example.com/ext.zip'])).toBe(0)
    expect(process.env.EXTJS_LIGHT).toBe('1')
  })

  it('maps --logs and honors EXTENSION_CLI_NO_BROWSER', async () => {
    process.env.EXTENSION_CLI_NO_BROWSER = '1'
    expect(await run(['preview', '.', '--logs', 'debug'])).toBe(0)
    const [, opts] = extensionPreview.mock.calls[0]
    expect(opts.logLevel).toBe('debug')
    expect(opts.noBrowser).toBe(true)
  })

  it('enables author diagnostics with --author', async () => {
    expect(await run(['preview', '.', '--author'])).toBe(0)
    expect(process.env.EXTENSION_AUTHOR_MODE).toBe('true')
    expect(process.env.EXTENSION_VERBOSE).toBe('1')
  })

  it('emits a schema-1 envelope with --output json', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(await run(['preview', '.', '--output', 'json'])).toBe(0)
    expect(JSON.parse(String(logSpy.mock.calls[0][0]))).toEqual({
      schema: 1,
      ok: true,
      command: 'preview',
      status: 'ready',
      value: {projectPath: '.', browsers: ['chromium']},
      error: null,
      warnings: []
    })
  })

  // Both needles are matched against real producer copy, so a rewrite of either
  // message fails here rather than silently downgrading to E_INTERNAL.
  it('pins the not-found needles against the real producers', async () => {
    const developMessages = await import('../../develop/lib/messages')
    expect(developMessages.manifestNotFoundError('/p/manifest.json')).toContain(
      PREVIEW_NOT_FOUND_NEEDLES[1]
    )
    const previewSource = await readFile(
      new URL('../../develop/command-preview.ts', import.meta.url),
      'utf8'
    )
    expect(previewSource).toContain(PREVIEW_NOT_FOUND_NEEDLES[0])
  })

  it.each(
    PREVIEW_NOT_FOUND_NEEDLES
  )('maps %j to E_PREVIEW_NO_DIST', async (needle) => {
    extensionPreview.mockRejectedValueOnce(new Error(`${needle} …`))
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(await run(['preview', '.', '--output', 'json'])).toBe(1)
    const frame = JSON.parse(String(logSpy.mock.calls[0][0]))
    expect(frame).toMatchObject({
      schema: 1,
      ok: false,
      command: 'preview',
      status: 'not-found',
      value: null
    })
    expect(frame.error.code).toBe('E_PREVIEW_NO_DIST')
  })

  it('emits E_INTERNAL for any other preview failure', async () => {
    extensionPreview.mockRejectedValueOnce(new Error('launcher exploded'))
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(await run(['preview', '.', '--output', 'json'])).toBe(1)
    const frame = JSON.parse(String(logSpy.mock.calls[0][0]))
    expect(frame.status).toBe('failed')
    expect(frame.error.code).toBe('E_INTERNAL')
  })

  it('emits E_UNSUPPORTED_BROWSER instead of prose with --output json', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(
      await run(['preview', '.', '--browser', 'netscape', '--output', 'json'])
    ).toBe(1)
    const frame = JSON.parse(String(logSpy.mock.calls[0][0]))
    expect(frame.status).toBe('usage')
    expect(frame.error.code).toBe('E_UNSUPPORTED_BROWSER')
    expect(errorSpy).not.toHaveBeenCalled()
  })

  // Safari is a supported browser that this command has no path for, which is
  // a different failure from an unknown vendor. The two codes must not collapse.
  it('separates safari-on-preview from an unknown vendor', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(
      await run(['preview', '.', '--browser', 'safari', '--output', 'json'])
    ).toBe(1)
    const frame = JSON.parse(String(logSpy.mock.calls[0][0]))
    expect(frame.status).toBe('usage')
    expect(frame.error.code).toBe('E_COMMAND_UNSUPPORTED_FOR_TARGET')
    expect(frame.error.code).not.toBe('E_UNSUPPORTED_BROWSER')
    expect(frame.error.message).toContain('Safari')
  })
})

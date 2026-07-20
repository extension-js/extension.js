import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const extensionPreview = vi.fn(
  async (_path: string, _opts: any, launcher: (o: any) => unknown) => {
    // The command wires the browser launcher as a callback; exercise it the
    // way develop's plugin would.
    launcher({launched: true})
  }
)

vi.mock('../helpers/extension-develop-runtime', () => ({
  loadExtensionDevelopPreviewModule: vi.fn(async () => ({extensionPreview}))
}))
vi.mock('../browsers/run-only', () => ({
  runOnlyPreviewBrowser: vi.fn(async () => {})
}))

import {runOnlyPreviewBrowser} from '../browsers/run-only'
import {registerPreviewCommand} from '../commands/preview'
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
    // The launcher callback routes to the CDP-free preview browser runner.
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
})

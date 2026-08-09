import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

function notInstallableError(browser: string): Error {
  const error = new Error(
    `${browser} cannot be installed by Extension.js. This CLI never downloads it.`
  )
  error.name = 'BrowserNotInstallableError'
  ;(error as Error & {code: string}).code = 'BROWSER_NOT_INSTALLABLE'
  return error
}

vi.mock('extension-install', () => ({
  extensionInstall: vi.fn(async () => {}),
  extensionUninstall: vi.fn(async () => {}),
  getManagedBrowsersCacheRoot: vi.fn(() => '/cache/root'),
  getManagedBrowserInstallDir: vi.fn((browser: string) => `/cache/${browser}`)
}))

import {
  extensionInstall,
  extensionUninstall,
  getManagedBrowserInstallDir,
  getManagedBrowsersCacheRoot
} from 'extension-install'
import {registerInstallCommand} from '../commands/install'
import {makeProgram, runCli, stubProcessExit} from './command-harness'

let logSpy: ReturnType<typeof vi.spyOn>
let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  stubProcessExit()
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

function run(argv: string[]) {
  return runCli(makeProgram(registerInstallCommand), argv)
}

function lastJsonFrame(): Record<string, unknown> {
  const printed = logSpy.mock.calls.map((call) => String(call[0]))
  const jsonLine = [...printed].reverse().find((line) => {
    try {
      JSON.parse(line)
      return true
    } catch {
      return false
    }
  })
  expect(jsonLine).toBeTruthy()
  return JSON.parse(String(jsonLine)) as Record<string, unknown>
}

describe('extension install', () => {
  it('installs chromium by default', async () => {
    expect(await run(['install'])).toBe(0)
    expect(extensionInstall).toHaveBeenCalledWith({browser: 'chromium'})
  })

  it('installs every browser in a comma-separated list', async () => {
    expect(await run(['install', '--browser', 'chrome,firefox'])).toBe(0)
    expect(extensionInstall).toHaveBeenCalledWith({browser: 'chrome'})
    expect(extensionInstall).toHaveBeenCalledWith({browser: 'firefox'})
  })

  it('installs a positional comma-separated list', async () => {
    expect(await run(['install', 'chrome,edge'])).toBe(0)
    expect(extensionInstall).toHaveBeenCalledWith({browser: 'chrome'})
    expect(extensionInstall).toHaveBeenCalledWith({browser: 'edge'})
  })

  it('prints per-browser install dirs with --where and a browser', async () => {
    expect(await run(['install', 'chrome', '--where'])).toBe(0)
    expect(getManagedBrowserInstallDir).toHaveBeenCalledWith('chrome')
    expect(logSpy).toHaveBeenCalledWith('/cache/chrome')
    expect(extensionInstall).not.toHaveBeenCalled()
  })

  it('prints the cache root with --where and no browser', async () => {
    expect(await run(['install', '--where'])).toBe(0)
    expect(getManagedBrowsersCacheRoot).toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledWith('/cache/root')
  })

  it('exits on an unsupported browser name', async () => {
    expect(await run(['install', 'netscape'])).toBe(1)
    expect(extensionInstall).not.toHaveBeenCalled()
  })

  it('emits a schema-1 envelope with --output json', async () => {
    expect(await run(['install', 'chrome', '--output', 'json'])).toBe(0)
    expect(JSON.parse(String(logSpy.mock.calls[0][0]))).toEqual({
      schema: 1,
      ok: true,
      command: 'install',
      status: 'installed',
      value: {browsers: ['chrome']},
      error: null,
      warnings: []
    })
  })

  it('emits E_BROWSER_DOWNLOAD when the download fails', async () => {
    vi.mocked(extensionInstall).mockRejectedValueOnce(new Error('404 from CDN'))
    expect(await run(['install', 'chrome', '--output', 'json'])).toBe(1)
    const frame = JSON.parse(String(logSpy.mock.calls[0][0]))
    expect(frame).toMatchObject({
      schema: 1,
      ok: false,
      command: 'install',
      status: 'failed',
      value: null
    })
    expect(frame.error.code).toBe('E_BROWSER_DOWNLOAD')
    expect(frame.error.message).toContain('404 from CDN')
    expect(frame.hint).toMatch(/Retry/)
  })

  it('prints a download failure without a stack in pretty mode', async () => {
    vi.mocked(extensionInstall).mockRejectedValueOnce(new Error('404 from CDN'))
    expect(await run(['install', 'chrome'])).toBe(1)
    const printed = String(errorSpy.mock.calls[0][0])
    expect(printed).toMatch(/download/i)
    expect(printed).toContain('404 from CDN')
    expect(printed).not.toMatch(/at /)
  })

  it('emits E_UNSUPPORTED_BROWSER for an unknown name under --output json', async () => {
    expect(await run(['install', 'netscape', '--output', 'json'])).toBe(1)
    const frame = JSON.parse(String(logSpy.mock.calls[0][0]))
    expect(frame.status).toBe('usage')
    expect(frame.error.code).toBe('E_UNSUPPORTED_BROWSER')
  })

  it('emits E_BROWSER_NOT_INSTALLABLE for a known fork under --output json', async () => {
    expect(await run(['install', 'brave', '--output', 'json'])).toBe(1)
    const frame = lastJsonFrame()
    expect(frame.status).toBe('usage')
    expect((frame.error as {code: string}).code).toBe(
      'E_BROWSER_NOT_INSTALLABLE'
    )
    expect((frame.error as {message: string}).message).toMatch(
      /never downloads/i
    )
    expect(extensionInstall).not.toHaveBeenCalled()
  })

  it('wraps --where paths in an envelope with --output json', async () => {
    expect(
      await run(['install', 'chrome', '--where', '--output', 'json'])
    ).toBe(0)
    expect(JSON.parse(String(logSpy.mock.calls[0][0])).value).toEqual({
      paths: ['/cache/chrome']
    })
  })

  it('emits E_BROWSER_NOT_INSTALLABLE for fork --where under --output json', async () => {
    expect(await run(['install', 'brave', '--where', '--output', 'json'])).toBe(
      1
    )
    const frame = lastJsonFrame()
    expect(frame).toMatchObject({
      schema: 1,
      ok: false,
      command: 'install',
      status: 'usage',
      value: null
    })
    expect((frame.error as {code: string}).code).toBe(
      'E_BROWSER_NOT_INSTALLABLE'
    )
    expect((frame.error as {message: string}).message).toContain('brave')
    // One JSON frame only: no raw stack on stdout for the setup-script parser.
    expect(logSpy.mock.calls).toHaveLength(1)
  })

  it('emits E_BROWSER_NOT_INSTALLABLE for safari --where under --output json', async () => {
    expect(
      await run(['install', 'safari', '--where', '--output', 'json'])
    ).toBe(1)
    const frame = lastJsonFrame()
    expect(frame.status).toBe('usage')
    expect((frame.error as {code: string}).code).toBe(
      'E_BROWSER_NOT_INSTALLABLE'
    )
  })

  it('emits E_BROWSER_NOT_INSTALLABLE when install itself rejects a fork', async () => {
    vi.mocked(extensionInstall).mockRejectedValueOnce(
      notInstallableError('brave')
    )
    expect(await run(['install', 'brave', '--output', 'json'])).toBe(1)
    const frame = lastJsonFrame()
    expect(frame.status).toBe('usage')
    expect((frame.error as {code: string}).code).toBe(
      'E_BROWSER_NOT_INSTALLABLE'
    )
  })

  it('pretty mode distinguishes unknown names from non-fetchable browsers', async () => {
    expect(await run(['install', 'netscape'])).toBe(1)
    const unknown = String(errorSpy.mock.calls[0][0])
    expect(unknown).toMatch(/Unsupported/)
    expect(unknown).toMatch(/chrome/)

    errorSpy.mockClear()
    expect(await run(['install', 'brave'])).toBe(1)
    const notFetchable = String(errorSpy.mock.calls[0][0])
    expect(notFetchable).toMatch(/never downloads|cannot be installed/i)
    expect(notFetchable).not.toMatch(/Unsupported --browser value/)
  })
})

describe('extension uninstall', () => {
  it('uninstalls the targeted browser', async () => {
    expect(await run(['uninstall', 'firefox'])).toBe(0)
    expect(extensionUninstall).toHaveBeenCalledWith({
      browser: 'firefox',
      all: false
    })
  })

  it('uninstalls every browser in a comma-separated list', async () => {
    expect(await run(['uninstall', 'chrome,edge'])).toBe(0)
    expect(extensionUninstall).toHaveBeenCalledWith({
      browser: 'chrome,edge',
      all: false
    })
  })

  it('uninstalls a comma list via --browser', async () => {
    expect(await run(['uninstall', '--browser', 'chrome,firefox'])).toBe(0)
    expect(extensionUninstall).toHaveBeenCalledWith({
      browser: 'chrome,firefox',
      all: false
    })
  })

  it('expands all the same way install does', async () => {
    expect(await run(['uninstall', 'all'])).toBe(0)
    expect(extensionUninstall).toHaveBeenCalledWith({
      browser: undefined,
      all: true
    })
  })

  it('prints all install dirs with --where --all', async () => {
    expect(await run(['uninstall', '--where', '--all'])).toBe(0)
    for (const browser of ['chrome', 'chromium', 'edge', 'firefox']) {
      expect(getManagedBrowserInstallDir).toHaveBeenCalledWith(browser)
    }
  })

  it('prints the targeted dir with --where and a browser', async () => {
    expect(await run(['uninstall', 'edge', '--where'])).toBe(0)
    expect(getManagedBrowserInstallDir).toHaveBeenCalledWith('edge')
    expect(extensionUninstall).not.toHaveBeenCalled()
  })

  it('prints comma-list dirs with --where', async () => {
    expect(await run(['uninstall', 'chrome,edge', '--where'])).toBe(0)
    expect(getManagedBrowserInstallDir).toHaveBeenCalledWith('chrome')
    expect(getManagedBrowserInstallDir).toHaveBeenCalledWith('edge')
  })

  it('prints the cache root with --where and no target', async () => {
    expect(await run(['uninstall', '--where'])).toBe(0)
    expect(getManagedBrowsersCacheRoot).toHaveBeenCalled()
  })

  it('emits a schema-1 envelope with --output json', async () => {
    expect(await run(['uninstall', 'firefox', '--output', 'json'])).toBe(0)
    expect(JSON.parse(String(logSpy.mock.calls[0][0]))).toEqual({
      schema: 1,
      ok: true,
      command: 'uninstall',
      status: 'uninstalled',
      value: {browsers: ['firefox'], all: false},
      error: null,
      warnings: []
    })
  })

  it('emits browsers for a comma list under --output json', async () => {
    expect(await run(['uninstall', 'chrome,edge', '--output', 'json'])).toBe(0)
    expect(JSON.parse(String(logSpy.mock.calls[0][0])).value).toEqual({
      browsers: ['chrome', 'edge'],
      all: false
    })
  })

  it('emits a failure envelope when the uninstall throws', async () => {
    vi.mocked(extensionUninstall).mockRejectedValueOnce(new Error('EBUSY'))
    expect(await run(['uninstall', 'firefox', '--output', 'json'])).toBe(1)
    const frame = JSON.parse(String(logSpy.mock.calls[0][0]))
    expect(frame.ok).toBe(false)
    expect(frame.status).toBe('failed')
    expect(frame.error.code).toBe('E_BROWSER_UNINSTALL')
    expect(frame.error.message).toContain('EBUSY')
  })

  it('uses the same three refusal codes as install for name errors', async () => {
    expect(
      await run(['uninstall', 'brave', '--where', '--output', 'json'])
    ).toBe(1)
    expect((lastJsonFrame().error as {code: string}).code).toBe(
      'E_BROWSER_NOT_INSTALLABLE'
    )

    logSpy.mockClear()
    expect(await run(['uninstall', 'brave', '--output', 'json'])).toBe(1)
    expect((lastJsonFrame().error as {code: string}).code).toBe(
      'E_BROWSER_NOT_INSTALLABLE'
    )

    logSpy.mockClear()
    expect(await run(['uninstall', 'netscape', '--output', 'json'])).toBe(1)
    expect((lastJsonFrame().error as {code: string}).code).toBe(
      'E_UNSUPPORTED_BROWSER'
    )
  })
})

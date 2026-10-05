import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi
} from 'vitest'

function notInstallableError(browser: string): Error {
  const error = new Error(
    `${browser} cannot be installed by Extension.js. This CLI never downloads it.`
  )
  error.name = 'BrowserNotInstallableError'
  ;(error as Error & {code: string}).code = 'BROWSER_NOT_INSTALLABLE'

  return error
}

function privilegeError(): Error {
  const error = new Error(
    'Edge needs a privileged interactive session on Linux. Run this command in a terminal where sudo can prompt for credentials.'
  )
  error.name = 'BrowserInstallPrivilegeError'
  ;(error as Error & {code: string}).code = 'BROWSER_INSTALL_PRIVILEGE'

  return error
}

function removedAll({browser, all}: {browser?: string; all?: boolean}) {
  const names = all
    ? ['chrome', 'chromium', 'edge', 'firefox']
    : String(browser || '').split(',')

  return names.map((name) => ({
    browser: name,
    removed: true,
    path: `/cache/${name}`
  }))
}

vi.mock('extension-install', () => ({
  extensionInstall: vi.fn(async () => {}),
  extensionUninstall: vi.fn(
    async (options: {browser?: string; all?: boolean}) => removedAll(options)
  ),
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

let logSpy: MockInstance<typeof console.log>
let errorSpy: MockInstance<typeof console.error>
let stdoutSpy: MockInstance<typeof process.stdout.write>
const prevOutput = process.env.EXTENSION_OUTPUT

beforeEach(() => {
  stubProcessExit()
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()

  if (typeof prevOutput === 'undefined') {
    delete process.env.EXTENSION_OUTPUT
  } else {
    process.env.EXTENSION_OUTPUT = prevOutput
  }
})

function run(argv: string[]) {
  return runCli(makeProgram(registerInstallCommand), argv)
}

type Frame = Record<string, unknown> & {
  error?: {code?: string; message?: string}
}

function wholeStdout(): Frame {
  const printed = [
    ...logSpy.mock.calls.map((call) => call.map(String).join(' ')),
    ...stdoutSpy.mock.calls.map((call) => String(call[0]))
  ].join('\n')

  return JSON.parse(printed) as Frame
}

describe('extension install', () => {
  it('installs chromium by default', async () => {
    expect(await run(['install'])).toBe(0)
    expect(extensionInstall).toHaveBeenCalledWith(
      expect.objectContaining({browser: 'chromium'})
    )
  })

  it('tells the installer the browser was a default when none was named', async () => {
    expect(await run(['install'])).toBe(0)
    expect(extensionInstall).toHaveBeenCalledTimes(1)
    expect(extensionInstall).toHaveBeenCalledWith(
      expect.objectContaining({browser: 'chromium', defaulted: true})
    )
  })

  it('tells the installer the browser was a choice when it was named', async () => {
    expect(await run(['install', 'chromium'])).toBe(0)
    expect(await run(['install', '--browser', 'firefox'])).toBe(0)
    expect(extensionInstall).toHaveBeenCalledTimes(2)
    expect(extensionInstall).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({browser: 'chromium', defaulted: false})
    )

    expect(extensionInstall).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({browser: 'firefox', defaulted: false})
    )
  })

  it('installs every browser in a comma-separated list', async () => {
    expect(await run(['install', '--browser', 'chrome,firefox'])).toBe(0)
    expect(extensionInstall).toHaveBeenCalledWith(
      expect.objectContaining({browser: 'chrome'})
    )

    expect(extensionInstall).toHaveBeenCalledWith(
      expect.objectContaining({browser: 'firefox'})
    )
  })

  it('installs a positional comma-separated list', async () => {
    expect(await run(['install', 'chrome,edge'])).toBe(0)
    expect(extensionInstall).toHaveBeenCalledWith(
      expect.objectContaining({browser: 'chrome'})
    )

    expect(extensionInstall).toHaveBeenCalledWith(
      expect.objectContaining({browser: 'edge'})
    )
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
    expect(wholeStdout()).toEqual({
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
    const frame = wholeStdout()
    expect(frame).toMatchObject({
      schema: 1,
      ok: false,
      command: 'install',
      status: 'failed',
      value: null
    })

    expect(frame.error?.code).toBe('E_BROWSER_DOWNLOAD')
    expect(frame.error?.message).toContain('404 from CDN')
    expect(frame.hint).toMatch(/Retry/)
  })

  it('sets EXTENSION_OUTPUT to json before the installer runs', async () => {
    delete process.env.EXTENSION_OUTPUT
    vi.mocked(extensionInstall).mockImplementationOnce(async () => {
      expect(process.env.EXTENSION_OUTPUT).toBe('json')
    })

    expect(await run(['install', 'chrome', '--output', 'json'])).toBe(0)
    expect(extensionInstall).toHaveBeenCalledTimes(1)
  })

  it('leaves EXTENSION_OUTPUT alone in pretty mode', async () => {
    delete process.env.EXTENSION_OUTPUT
    expect(await run(['install', 'chrome'])).toBe(0)
    expect(process.env.EXTENSION_OUTPUT).toBeUndefined()
  })

  it('emits E_BROWSER_INSTALL_PRIVILEGE with a hint that is not retry', async () => {
    vi.mocked(extensionInstall).mockRejectedValueOnce(privilegeError())
    expect(await run(['install', 'edge', '--output', 'json'])).toBe(1)
    const frame = wholeStdout()
    expect(frame).toMatchObject({
      schema: 1,
      ok: false,
      command: 'install',
      status: 'failed',
      value: null
    })

    expect((frame.error as {code: string}).code).toBe(
      'E_BROWSER_INSTALL_PRIVILEGE'
    )

    expect((frame.error as {message: string}).message).toMatch(
      /privileged interactive session/
    )

    expect(String(frame.hint)).not.toMatch(/retry/i)
    expect(String(frame.hint)).toMatch(/interactive terminal|system-wide/)
  })

  it('prints the privilege refusal without a retry line in pretty mode', async () => {
    vi.mocked(extensionInstall).mockRejectedValueOnce(privilegeError())
    expect(await run(['install', 'edge'])).toBe(1)
    const printed = String(errorSpy.mock.calls[0][0])
    expect(printed).toMatch(/privileged/i)
    expect(printed).not.toMatch(/Retry/)
    expect(printed).not.toMatch(/at /)
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
    const frame = wholeStdout()
    expect(frame.status).toBe('usage')
    expect(frame.error?.code).toBe('E_UNSUPPORTED_BROWSER')
  })

  it('emits E_BROWSER_NOT_INSTALLABLE for a known fork under --output json', async () => {
    expect(await run(['install', 'brave', '--output', 'json'])).toBe(1)
    const frame = wholeStdout()
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

    expect(wholeStdout().value).toEqual({
      paths: ['/cache/chrome']
    })
  })

  it('emits E_BROWSER_NOT_INSTALLABLE for fork --where under --output json', async () => {
    expect(await run(['install', 'brave', '--where', '--output', 'json'])).toBe(
      1
    )

    const frame = wholeStdout()
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

    const frame = wholeStdout()
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
    const frame = wholeStdout()
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
    expect(wholeStdout()).toEqual({
      schema: 1,
      ok: true,
      command: 'uninstall',
      status: 'uninstalled',
      value: {
        browsers: ['firefox'],
        all: false,
        results: [{browser: 'firefox', removed: true, path: '/cache/firefox'}]
      },
      error: null,
      warnings: []
    })
  })

  it('emits browsers for a comma list under --output json', async () => {
    expect(await run(['uninstall', 'chrome,edge', '--output', 'json'])).toBe(0)
    expect(wholeStdout().value).toEqual({
      browsers: ['chrome', 'edge'],
      all: false,
      results: [
        {browser: 'chrome', removed: true, path: '/cache/chrome'},
        {browser: 'edge', removed: true, path: '/cache/edge'}
      ]
    })
  })

  it('warns E_UNINSTALL_NOOP with status noop when nothing matched', async () => {
    vi.mocked(extensionUninstall).mockResolvedValueOnce([
      {browser: 'firefox', removed: false, path: '/cache/firefox'}
    ])

    expect(await run(['uninstall', 'firefox', '--output', 'json'])).toBe(0)
    const frame = wholeStdout()
    expect(frame.ok).toBe(true)
    expect(frame.status).toBe('noop')
    expect(frame.warnings).toEqual([
      'E_UNINSTALL_NOOP: Nothing to remove for firefox.'
    ])

    expect((frame.value as {results: unknown[]}).results).toEqual([
      {browser: 'firefox', removed: false, path: '/cache/firefox'}
    ])
  })

  it('keeps status uninstalled when at least one target was removed', async () => {
    vi.mocked(extensionUninstall).mockResolvedValueOnce([
      {browser: 'chrome', removed: true, path: '/cache/chrome'},
      {browser: 'edge', removed: false, path: '/cache/edge'}
    ])

    expect(await run(['uninstall', 'chrome,edge', '--output', 'json'])).toBe(0)
    const frame = wholeStdout()
    expect(frame.status).toBe('uninstalled')
    expect(frame.warnings).toEqual([])
  })

  it('sets EXTENSION_OUTPUT to json before the uninstall runs', async () => {
    delete process.env.EXTENSION_OUTPUT
    vi.mocked(extensionUninstall).mockImplementationOnce(async () => {
      expect(process.env.EXTENSION_OUTPUT).toBe('json')

      return [{browser: 'firefox', removed: true, path: '/cache/firefox'}]
    })

    expect(await run(['uninstall', 'firefox', '--output', 'json'])).toBe(0)
    expect(extensionUninstall).toHaveBeenCalledTimes(1)
  })

  it('emits a failure envelope when the uninstall throws', async () => {
    vi.mocked(extensionUninstall).mockRejectedValueOnce(new Error('EBUSY'))
    expect(await run(['uninstall', 'firefox', '--output', 'json'])).toBe(1)
    const frame = wholeStdout()
    expect(frame.ok).toBe(false)
    expect(frame.status).toBe('failed')
    expect(frame.error?.code).toBe('E_BROWSER_UNINSTALL')
    expect(frame.error?.message).toContain('EBUSY')
  })

  it('uses the same three refusal codes as install for name errors', async () => {
    expect(
      await run(['uninstall', 'brave', '--where', '--output', 'json'])
    ).toBe(1)

    expect((wholeStdout().error as {code: string}).code).toBe(
      'E_BROWSER_NOT_INSTALLABLE'
    )

    logSpy.mockClear()
    expect(await run(['uninstall', 'brave', '--output', 'json'])).toBe(1)
    expect((wholeStdout().error as {code: string}).code).toBe(
      'E_BROWSER_NOT_INSTALLABLE'
    )

    logSpy.mockClear()
    expect(await run(['uninstall', 'netscape', '--output', 'json'])).toBe(1)
    expect((wholeStdout().error as {code: string}).code).toBe(
      'E_UNSUPPORTED_BROWSER'
    )
  })
})

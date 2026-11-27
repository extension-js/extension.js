import * as fs from 'node:fs'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi
} from 'vitest'

function removedAll({browser, all}: {browser?: string; all?: boolean}) {
  const names = all
    ? ['chrome', 'chromium', 'edge', 'firefox']
    : String(browser || '').split(',')

  return names.map((name) => ({
    browser: name,
    removed: true,
    path: `/cache/${name}`,
    outcome: 'removed' as const
  }))
}

// Only the calls that would download, delete or read this machine's cache are
// faked. The error classes, the guards and the name rules are the real ones.
vi.mock('extension-install', async (importOriginal) => {
  const actual = await importOriginal<typeof import('extension-install')>()

  return {
    ...actual,
    extensionInstall: vi.fn(async () => {}),
    extensionUninstall: vi.fn(
      async (options: {browser?: string; all?: boolean}) => removedAll(options)
    ),
    getManagedBrowsersCacheRoot: vi.fn(() => '/cache/root'),
    getManagedBrowserInstallDir: vi.fn((browser: string) => {
      const real = actual.getManagedBrowserInstallDir(browser)

      return `/cache/${real.split(/[\\/]/).pop()}`
    })
  }
})

import * as installPackage from 'extension-install'
import {
  BrowserCacheRootError,
  BrowserInstallBusyError,
  BrowserInstallerNotFoundError,
  BrowserInstallFailedError,
  BrowserInstallForeignFolderError,
  BrowserInstallPrivilegeError,
  BrowserInstallTimeoutError,
  BrowserNotInstallableError,
  BrowserUninstallError,
  extensionInstall,
  extensionUninstall,
  getManagedBrowserInstallDir,
  getManagedBrowsersCacheRoot,
  isBrowserInstallPrivilegeError,
  isBrowserNotInstallableError,
  type UninstallResult
} from 'extension-install'
import {registerInstallCommand} from '../commands/install'
import {
  cliRun,
  useTelemetrySandbox
} from '../helpers/__spec__/telemetry-sandbox'
import {makeProgram, runCli, stubProcessExit} from './command-harness'

const sandbox = useTelemetrySandbox()

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
  // A queued rejection a test never reached must not fail the next test.
  vi.mocked(extensionInstall).mockReset()
  vi.mocked(extensionUninstall).mockReset()
  vi.unstubAllEnvs()

  if (typeof prevOutput === 'undefined') {
    delete process.env.EXTENSION_OUTPUT
  } else {
    process.env.EXTENSION_OUTPUT = prevOutput
  }
})

function notInstallableError(browser: string): Error {
  return new BrowserNotInstallableError(
    `${browser} cannot be installed by Extension.js. This CLI never downloads it.`
  )
}

function privilegeError(): Error {
  return new BrowserInstallPrivilegeError(
    'Edge needs a privileged interactive session on Linux. Run this command in a terminal where sudo can prompt for credentials.'
  )
}

function installerNotFoundError(): Error {
  return Object.assign(
    new BrowserInstallerNotFoundError(
      "Couldn't install Chrome. The package runner bunx wasn't found on this machine. Install Bun, or run this command through a package manager that is installed."
    ),
    {cause: Object.assign(new Error('spawn bunx ENOENT'), {code: 'ENOENT'})}
  )
}

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

  describe('when several names are given', () => {
    function installedNames() {
      return vi
        .mocked(extensionInstall)
        .mock.calls.map(([options]) => options.browser)
    }

    it('installs each of two positional names', async () => {
      expect(await run(['install', 'chrome', 'firefox'])).toBe(0)
      expect(installedNames()).toEqual(['chrome', 'firefox'])
    })

    it('reads two arguments the same as one comma list', async () => {
      expect(await run(['install', 'chrome,firefox'])).toBe(0)
      const fromList = installedNames()

      vi.mocked(extensionInstall).mockClear()
      expect(await run(['install', 'chrome', 'firefox'])).toBe(0)
      expect(installedNames()).toEqual(fromList)
    })

    it('takes a mix of comma lists and single names', async () => {
      expect(await run(['install', 'chrome,edge', 'firefox'])).toBe(0)
      expect(installedNames()).toEqual(['chrome', 'edge', 'firefox'])
    })

    it('installs a name given twice once', async () => {
      expect(await run(['install', 'chrome', 'chrome,firefox'])).toBe(0)
      expect(installedNames()).toEqual(['chrome', 'firefox'])
    })

    it('takes the two arguments PowerShell makes of an unquoted chrome,firefox', async () => {
      expect(
        await run(['install', 'chrome', 'firefox', '--output', 'json'])
      ).toBe(0)

      expect(wholeStdout()).toMatchObject({
        ok: true,
        status: 'installed',
        value: {browsers: ['chrome', 'firefox']}
      })
    })

    it('refuses the whole list by the name it cannot install, before any download', async () => {
      expect(
        await run(['install', 'chrome', 'netscape', '--output', 'json'])
      ).toBe(1)

      expect(wholeStdout().error).toMatchObject({
        code: 'E_UNSUPPORTED_BROWSER',
        message: 'Unsupported browser: netscape.'
      })

      expect(extensionInstall).not.toHaveBeenCalled()
    })

    it('refuses a known browser it never downloads by its name', async () => {
      expect(
        await run(['install', 'firefox', 'brave', '--output', 'json'])
      ).toBe(1)

      expect(wholeStdout().error?.code).toBe('E_BROWSER_NOT_INSTALLABLE')
      expect(wholeStdout().error?.message).toContain('brave')
      expect(extensionInstall).not.toHaveBeenCalled()
    })

    it('prints the folder of each name with --where', async () => {
      expect(await run(['install', 'chrome', 'edge', '--where'])).toBe(0)
      expect(logSpy.mock.calls).toEqual([['/cache/chrome'], ['/cache/edge']])
    })

    it('reads all among the names as every managed browser', async () => {
      expect(await run(['install', 'chrome', 'all'])).toBe(0)
      expect(installedNames()).toEqual([
        'chrome',
        'chromium',
        'edge',
        'firefox'
      ])
    })

    it('lets --browser decide over positional names, as its help says', async () => {
      expect(
        await run(['install', 'chrome', 'edge', '--browser', 'firefox'])
      ).toBe(0)

      expect(installedNames()).toEqual(['firefox'])
    })
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
    vi.mocked(extensionInstall).mockRejectedValueOnce(
      new BrowserInstallFailedError('404 from CDN')
    )

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
    vi.mocked(extensionInstall).mockRejectedValueOnce(
      new BrowserInstallFailedError('404 from CDN')
    )

    expect(await run(['install', 'chrome'])).toBe(1)
    const printed = String(errorSpy.mock.calls[0][0])
    expect(printed).toMatch(/download/i)
    expect(printed).toContain('404 from CDN')
    expect(printed).not.toMatch(/at /)
  })

  it('recognizes an installer failure by its code from another module instance', async () => {
    vi.mocked(extensionInstall).mockRejectedValueOnce(
      Object.assign(new Error('exit code 7'), {code: 'BROWSER_INSTALL_FAILED'})
    )

    expect(await run(['install', 'chrome', '--output', 'json'])).toBe(1)
    expect(wholeStdout().hint).toBe('Retry, or install chrome manually.')
  })

  const refusals = [
    {
      name: 'an installer stopped at the timeout',
      error: () =>
        new BrowserInstallTimeoutError(
          "Couldn't install Chrome. The installer didn't finish within 30 minutes and was stopped. Set EXTENSION_INSTALL_TIMEOUT_MS to a larger number of milliseconds, then run the install again.",
          1_800_000
        ),
      packageCode: 'BROWSER_INSTALL_TIMEOUT',
      code: 'E_BROWSER_INSTALL_TIMEOUT',
      hint: 'Set EXTENSION_INSTALL_TIMEOUT_MS to a larger number of milliseconds, then run the install again.'
    },
    {
      name: 'another install that never let go of the browser folder',
      error: () =>
        new BrowserInstallBusyError(
          "Couldn't install Chrome. Another install of Chrome (PID 41250) was still running after 30 minutes."
        ),
      packageCode: 'BROWSER_INSTALL_BUSY',
      code: 'E_BROWSER_INSTALL_BUSY',
      hint: 'Wait for the other install of this browser to finish, then run the install again.'
    },
    {
      name: 'a cache root that is a file',
      error: () =>
        new BrowserCacheRootError(
          "Couldn't install Chrome. The browser cache path /tmp/a-file is a file, not a folder."
        ),
      packageCode: 'BROWSER_CACHE_ROOT',
      code: 'E_BROWSER_CACHE_NOT_WRITABLE',
      hint: 'Set EXT_BROWSERS_CACHE_DIR to a folder Extension.js can write to.'
    },
    {
      name: 'a browser folder that holds files of someone else',
      error: () =>
        new BrowserInstallForeignFolderError(
          "Couldn't install Chrome. The folder /apps/Google/chrome holds files Extension.js didn't put there, so nothing in it was changed."
        ),
      packageCode: 'BROWSER_INSTALL_FOREIGN_FOLDER',
      code: 'E_BROWSER_FOLDER_FOREIGN',
      hint: 'Set EXT_BROWSERS_CACHE_DIR to a folder that only Extension.js uses.'
    }
  ]

  it.each(
    refusals
  )('frames $name as $code with its own hint, never a download to retry', async ({
    error,
    code,
    hint
  }) => {
    const thrown = error()
    vi.mocked(extensionInstall).mockRejectedValueOnce(thrown)
    expect(await run(['install', 'chrome', '--output', 'json'])).toBe(1)
    const frame = wholeStdout()

    expect(frame).toMatchObject({
      schema: 1,
      ok: false,
      command: 'install',
      status: 'failed',
      value: null
    })

    expect(frame.error).toMatchObject({code, message: thrown.message})
    expect(frame.hint).toBe(hint)
    expect(String(frame.hint)).not.toMatch(/retry|manually|download/i)
  })

  it.each(
    refusals
  )('prints $name as the installer worded it in pretty mode', async ({
    error
  }) => {
    const thrown = error()
    vi.mocked(extensionInstall).mockRejectedValueOnce(thrown)
    expect(await run(['install', 'chrome'])).toBe(1)
    expect(errorSpy.mock.calls).toEqual([[thrown.message]])
  })

  it.each(
    refusals
  )('recognizes $name by its code from another module instance', async ({
    packageCode,
    code
  }) => {
    vi.mocked(extensionInstall).mockRejectedValueOnce(
      Object.assign(new Error('worded by the package'), {code: packageCode})
    )

    expect(await run(['install', 'chrome', '--output', 'json'])).toBe(1)
    expect(wholeStdout().error?.code).toBe(code)
  })

  // An error the package gave no type is a fault nobody classified, not a
  // failed download, so it never takes the download code or a retry hint.
  it('reports an error of no known kind as internal, in its own words, with how to report it', async () => {
    vi.mocked(extensionInstall).mockRejectedValue(
      Object.assign(new Error('spawn pnpm EACCES'), {code: 'EACCES'})
    )

    expect(await run(['install', 'chrome', '--output', 'json'])).toBe(1)
    const frame = wholeStdout()

    expect(frame.error).toEqual(
      expect.objectContaining({
        code: 'E_INTERNAL',
        message: 'spawn pnpm EACCES'
      })
    )

    expect(frame.hint).toBe(
      'Run the install again. If it fails the same way, report it with this ' +
        'message at https://github.com/extension-js/extension.js/issues.'
    )

    expect(await run(['install', 'chrome'])).toBe(1)
    expect(errorSpy.mock.calls).toEqual([['spawn pnpm EACCES']])
    vi.mocked(extensionInstall).mockReset()
    vi.mocked(extensionInstall).mockImplementation(async () => {})
  })

  it('frames a missing package runner as its own failure, with no retry hint', async () => {
    vi.mocked(extensionInstall).mockRejectedValueOnce(installerNotFoundError())
    expect(await run(['install', 'chrome', '--output', 'json'])).toBe(1)
    const frame = wholeStdout()
    expect(frame).toMatchObject({
      schema: 1,
      ok: false,
      command: 'install',
      status: 'failed',
      value: null
    })

    expect(frame.error?.code).toBe('E_BROWSER_INSTALLER_NOT_FOUND')
    expect(frame.error?.message).toContain(
      "The package runner bunx wasn't found on this machine."
    )

    expect(frame.hint).toBe(
      'Install the package runner the message names, or run this command through a package manager that is installed.'
    )

    expect(`${frame.hint} ${frame.error?.message}`).not.toMatch(
      /retry|manually|download/i
    )
  })

  it('prints a missing package runner as the installer worded it in pretty mode', async () => {
    vi.mocked(extensionInstall).mockRejectedValueOnce(installerNotFoundError())
    expect(await run(['install', 'chrome'])).toBe(1)
    expect(errorSpy.mock.calls).toEqual([
      [
        "Couldn't install Chrome. The package runner bunx wasn't found on this machine. Install Bun, or run this command through a package manager that is installed."
      ]
    ])
  })

  it('recognizes a missing package runner by its code from another module instance', async () => {
    vi.mocked(extensionInstall).mockRejectedValueOnce(
      Object.assign(new Error("The package runner npx wasn't found."), {
        code: 'BROWSER_INSTALLER_NOT_FOUND'
      })
    )

    expect(await run(['install', 'chrome', '--output', 'json'])).toBe(1)
    const frame = wholeStdout()
    expect(frame.error?.code).toBe('E_BROWSER_INSTALLER_NOT_FOUND')
    expect(String(frame.hint)).toMatch(/^Install the package runner/)
  })

  it('hands the installer no system Edge lookup of its own by default', async () => {
    expect(await run(['install', 'edge'])).toBe(0)
    expect(vi.mocked(extensionInstall).mock.calls[0][0]).not.toHaveProperty(
      'systemEdge'
    )
  })

  it('shows the installer no system Edge when the run is told to see none', async () => {
    vi.stubEnv('EXTENSION_INTERNAL_SKIP_SYSTEM_BROWSERS', '1')
    expect(await run(['install', 'edge'])).toBe(0)
    expect(await run(['uninstall', 'edge'])).toBe(0)

    for (const options of [
      vi.mocked(extensionInstall).mock.calls[0][0],
      vi.mocked(extensionUninstall).mock.calls[0][0]
    ]) {
      expect(options.systemEdge?.exists?.('/any/path')).toBe(false)
      expect(options.systemEdge?.lookup?.('where', 'msedge')).toBe(null)
      expect(options.systemEdge?.registry?.('HKLM\\any')).toBe(null)
    }
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

  it('raises the refusals as the classes the package exports', () => {
    expect(vi.isMockFunction(isBrowserNotInstallableError)).toBe(false)
    expect(vi.isMockFunction(isBrowserInstallPrivilegeError)).toBe(false)
    expect(notInstallableError('brave')).toMatchObject({
      name: 'BrowserNotInstallableError',
      code: 'BROWSER_NOT_INSTALLABLE'
    })

    expect(privilegeError()).toMatchObject({
      name: 'BrowserInstallPrivilegeError',
      code: 'BROWSER_INSTALL_PRIVILEGE'
    })

    expect(isBrowserNotInstallableError(notInstallableError('brave'))).toBe(
      true
    )

    expect(isBrowserInstallPrivilegeError(privilegeError())).toBe(true)
    expect(isBrowserNotInstallableError(privilegeError())).toBe(false)
    expect(isBrowserInstallPrivilegeError(notInstallableError('brave'))).toBe(
      false
    )
  })

  it('maps a refusal the real name rules throw from inside the installer', async () => {
    let refusal: unknown

    try {
      getManagedBrowserInstallDir('brave')
    } catch (error) {
      refusal = error
    }

    expect(isBrowserNotInstallableError(refusal)).toBe(true)
    vi.mocked(extensionInstall).mockRejectedValueOnce(refusal)

    expect(await run(['install', 'chrome', '--output', 'json'])).toBe(1)
    expect(extensionInstall).toHaveBeenCalledTimes(1)
    const frame = wholeStdout()
    expect(frame.status).toBe('usage')
    expect(frame.error?.code).toBe('E_BROWSER_NOT_INSTALLABLE')
    expect(frame.error?.message).toContain('brave cannot be installed')
  })

  // The CLI lets a managed name through, so this refusal is install's own.
  it('emits E_BROWSER_NOT_INSTALLABLE when install itself refuses the browser', async () => {
    vi.mocked(extensionInstall).mockRejectedValueOnce(
      notInstallableError('firefox')
    )

    expect(await run(['install', 'firefox', '--output', 'json'])).toBe(1)
    expect(extensionInstall).toHaveBeenCalledTimes(1)

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

  it('uninstalls each of several positional names, a repeat once', async () => {
    expect(
      await run(['uninstall', 'chrome', 'firefox,chrome', '--output', 'json'])
    ).toBe(0)

    expect(extensionUninstall).toHaveBeenCalledWith({
      browser: 'chrome,firefox',
      all: false
    })

    expect(wholeStdout().value).toMatchObject({browsers: ['chrome', 'firefox']})
  })

  it('reads all among several names as every managed browser', async () => {
    expect(await run(['uninstall', 'chrome', 'all'])).toBe(0)
    expect(extensionUninstall).toHaveBeenCalledWith({
      browser: undefined,
      all: true
    })
  })

  it('refuses several names by the one it cannot remove', async () => {
    expect(
      await run(['uninstall', 'edge', 'netscape', '--output', 'json'])
    ).toBe(1)

    expect(wholeStdout().error).toMatchObject({
      code: 'E_UNSUPPORTED_BROWSER',
      message: 'Unsupported browser: netscape.'
    })

    expect(extensionUninstall).not.toHaveBeenCalled()
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
        results: [
          {
            browser: 'firefox',
            removed: true,
            path: '/cache/firefox',
            outcome: 'removed'
          }
        ]
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
        {
          browser: 'chrome',
          removed: true,
          path: '/cache/chrome',
          outcome: 'removed'
        },
        {
          browser: 'edge',
          removed: true,
          path: '/cache/edge',
          outcome: 'removed'
        }
      ]
    })
  })

  it('warns W_UNINSTALL_NOOP with status noop when nothing matched', async () => {
    vi.mocked(extensionUninstall).mockResolvedValueOnce([
      {
        browser: 'firefox',
        removed: false,
        path: '/cache/firefox',
        outcome: 'absent'
      }
    ])

    expect(await run(['uninstall', 'firefox', '--output', 'json'])).toBe(0)
    const frame = wholeStdout()
    expect(frame.ok).toBe(true)
    expect(frame.status).toBe('noop')
    expect(frame.warnings).toEqual([
      'W_UNINSTALL_NOOP: Nothing to remove for firefox.'
    ])

    expect((frame.value as {results: unknown[]}).results).toEqual([
      {
        browser: 'firefox',
        removed: false,
        path: '/cache/firefox',
        outcome: 'absent'
      }
    ])
  })

  it('reports a system Edge as not removed, exit 0, with the path it names', async () => {
    const system: UninstallResult = {
      browser: 'edge',
      removed: false,
      path: '/cache/edge',
      outcome: 'system' as const,
      systemPath: '/usr/bin/microsoft-edge-stable'
    }
    vi.mocked(extensionUninstall).mockResolvedValueOnce([system])

    expect(await run(['uninstall', 'edge', '--output', 'json'])).toBe(0)
    const frame = wholeStdout()
    expect(frame.ok).toBe(true)
    expect(frame.status).toBe('noop')
    expect(frame.error).toBe(null)
    expect((frame.value as {results: unknown[]}).results).toEqual([system])

    logSpy.mockClear()
    vi.mocked(extensionUninstall).mockResolvedValueOnce([system])
    expect(await run(['uninstall', 'edge'])).toBe(0)
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('keeps status uninstalled when at least one target was removed', async () => {
    vi.mocked(extensionUninstall).mockResolvedValueOnce([
      {
        browser: 'chrome',
        removed: true,
        path: '/cache/chrome',
        outcome: 'removed'
      },
      {browser: 'edge', removed: false, path: '/cache/edge', outcome: 'absent'}
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

      return [
        {
          browser: 'firefox',
          removed: true,
          path: '/cache/firefox',
          outcome: 'removed'
        }
      ]
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
    expect(frame.value).toBe(null)
  })

  describe('when one target of several could not be removed', () => {
    const results: UninstallResult[] = [
      {
        browser: 'chrome',
        removed: true,
        path: '/cache/chrome',
        outcome: 'removed' as const
      },
      {
        browser: 'firefox',
        removed: false,
        path: '/cache/firefox',
        outcome: 'failed' as const,
        kind: 'removal',
        reason: 'EBUSY: resource busy or locked'
      }
    ]
    const message =
      "Couldn't remove Firefox. /cache/firefox is still there (EBUSY: resource busy or locked). Close any browser running from that folder, then run the uninstall again."

    it('exits 1 with every outcome in the envelope, the removed one included', async () => {
      vi.mocked(extensionUninstall).mockRejectedValueOnce(
        new BrowserUninstallError(message, results)
      )

      expect(
        await run(['uninstall', 'chrome,firefox', '--output', 'json'])
      ).toBe(1)

      expect(wholeStdout()).toEqual({
        schema: 1,
        ok: false,
        command: 'uninstall',
        status: 'failed',
        value: {browsers: ['chrome', 'firefox'], all: false, results},
        error: {code: 'E_BROWSER_UNINSTALL', message},
        warnings: []
      })
    })

    it('exits 1 and prints the one line that lists the failures in pretty mode', async () => {
      vi.mocked(extensionUninstall).mockRejectedValueOnce(
        new BrowserUninstallError(message, results)
      )

      expect(await run(['uninstall', '--all'])).toBe(1)
      expect(errorSpy.mock.calls).toEqual([[message]])
    })
  })

  it.each([
    [['uninstall', 'chrome', '--all']],
    [['uninstall', '--browser', 'chrome,firefox', '--all']]
  ])('refuses names beside --all and removes nothing: %j', async (argv) => {
    expect(await run([...argv, '--output', 'json'])).toBe(1)
    expect(wholeStdout()).toMatchObject({
      ok: false,
      command: 'uninstall',
      status: 'usage',
      error: {
        code: 'E_ARGS',
        message:
          'Pass browser names to remove those browsers, or --all to remove every browser, not both.'
      }
    })

    expect(await run(argv)).toBe(1)
    expect(errorSpy).toHaveBeenCalledWith(
      'Pass browser names to remove those browsers, or --all to remove every browser, not both.'
    )

    expect(extensionUninstall).not.toHaveBeenCalled()
  })

  it('takes the name all beside --all as the one request it is', async () => {
    expect(await run(['uninstall', 'all', '--all', '--output', 'json'])).toBe(0)
    expect(extensionUninstall).toHaveBeenCalledWith(
      expect.objectContaining({all: true, browser: undefined})
    )
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

// The classes are read off the package itself, so one added later has to
// gain a code of its own here before it can ride on another's.
describe('the code each package error class is framed as', () => {
  type PackageError = new (message: string) => Error

  const table = JSON.parse(
    fs.readFileSync(new URL('./contract/codes.json', import.meta.url), 'utf8')
  ) as {codes: Record<string, unknown>}

  const classes = Object.entries(installPackage).filter(
    ([name, value]) =>
      /^Browser\w+Error$/.test(name) &&
      typeof value === 'function' &&
      value.prototype instanceof Error
  ) as Array<[string, PackageError]>

  async function codeOf(name: string, ErrorClass: PackageError) {
    const thrown = new ErrorClass('worded by the package')
    // Uninstall is the only command that can be handed this one.
    const command = name === 'BrowserUninstallError' ? 'uninstall' : 'install'

    logSpy.mockClear()
    stdoutSpy.mockClear()

    if (command === 'uninstall') {
      vi.mocked(extensionUninstall).mockRejectedValueOnce(thrown)
    } else {
      vi.mocked(extensionInstall).mockRejectedValueOnce(thrown)
    }

    expect(await run([command, 'chrome', '--output', 'json'])).toBe(1)

    return String(wholeStdout().error?.code)
  }

  it('reads every error class the package exports', () => {
    expect(classes.map(([name]) => name)).toEqual(
      expect.arrayContaining([
        'BrowserCacheRootError',
        'BrowserInstallBusyError',
        'BrowserInstallerNotFoundError',
        'BrowserInstallFailedError',
        'BrowserInstallForeignFolderError',
        'BrowserInstallPrivilegeError',
        'BrowserInstallTimeoutError',
        'BrowserNotInstallableError',
        'BrowserUninstallError'
      ])
    )
  })

  it('gives each class a code from the table that no other class shares', async () => {
    const classesByCode: Record<string, string[]> = {}

    for (const [name, ErrorClass] of classes) {
      const code = await codeOf(name, ErrorClass)

      expect(code, `${name} reads as an internal error`).not.toBe('E_INTERNAL')
      expect(
        table.codes,
        `${name} maps to unknown code ${code}`
      ).toHaveProperty(code)

      classesByCode[code] = [...(classesByCode[code] ?? []), name]
    }

    const shared = Object.entries(classesByCode)
      .filter(([, names]) => names.length > 1)
      .map(([code, names]) => `${code}: ${names.join(', ')}`)

    expect(shared).toEqual([])
  })
})

// The row a refused run leaves in telemetry, captured in a sandbox this file
// owns. The code must match the one the envelope printed, for every refusal.
describe('the code a refused run reports to telemetry', () => {
  function telemetryRun(argv: string[]) {
    const box = sandbox({env: {EXTENSION_TELEMETRY: '1'}})
    const {cli} = cliRun(box, {argv: ['node', 'extension', ...argv]})

    return {box, cli}
  }

  async function refusedRow(argv: string[]) {
    const {box, cli} = telemetryRun([...argv, '--output', 'json'])

    logSpy.mockClear()
    stdoutSpy.mockClear()

    const exitCode = await runCli(
      makeProgram((program) =>
        registerInstallCommand(program, {telemetry: cli})
      ),
      argv.concat('--output', 'json')
    )

    const failed = box
      .sentRows()
      .filter((row) => row.event === 'command_failed')

    return {exitCode, failed, envelopeCode: wholeStdout().error?.code}
  }

  const cases: Array<[string, string[], () => void]> = [
    ['an unknown name', ['install', 'netscape'], () => {}],
    ['a browser it never downloads', ['install', 'brave'], () => {}],
    [
      'a failed download',
      ['install', 'chrome'],
      () => {
        vi.mocked(extensionInstall).mockRejectedValueOnce(
          new BrowserInstallFailedError('404 from CDN')
        )
      }
    ],
    [
      'a download that ran out of time',
      ['install', 'chrome'],
      () => {
        vi.mocked(extensionInstall).mockRejectedValueOnce(
          new BrowserInstallTimeoutError('took too long', 1)
        )
      }
    ],
    [
      'a missing package runner',
      ['install', 'chrome'],
      () => {
        vi.mocked(extensionInstall).mockRejectedValueOnce(
          installerNotFoundError()
        )
      }
    ],
    [
      'a session without the needed rights',
      ['install', 'edge'],
      () => {
        vi.mocked(extensionInstall).mockRejectedValueOnce(privilegeError())
      }
    ],
    [
      'an error of no known kind',
      ['install', 'chrome'],
      () => {
        vi.mocked(extensionInstall).mockRejectedValueOnce(new Error('odd'))
      }
    ],
    ['an uninstall with no target', ['uninstall'], () => {}],
    ['an uninstall of an unknown name', ['uninstall', 'netscape'], () => {}],
    [
      'an uninstall that could not remove a folder',
      ['uninstall', 'firefox'],
      () => {
        vi.mocked(extensionUninstall).mockRejectedValueOnce(new Error('EBUSY'))
      }
    ]
  ]

  it.each(
    cases
  )('sends the envelope code for %s', async (_title, argv, arrange) => {
    arrange()

    const {exitCode, failed, envelopeCode} = await refusedRow(argv)

    expect(exitCode).toBe(1)
    expect(envelopeCode).toMatch(/^E_/)
    expect(failed).toHaveLength(1)
    expect(failed[0].properties).toMatchObject({
      command: argv[0],
      success: false,
      code: envelopeCode,
      exit_code: 1
    })
  })

  it('sends no failure for an install that worked', async () => {
    const {box, cli} = telemetryRun(['install', 'chrome'])

    expect(
      await runCli(
        makeProgram((program) =>
          registerInstallCommand(program, {telemetry: cli})
        ),
        ['install', 'chrome']
      )
    ).toBe(0)

    expect(
      box.sentRows().filter((row) => row.event === 'command_failed')
    ).toEqual([])
  })
})

// One word from a fixed list, so a failure count can be read by browser. A
// list of several names, an alias or anything typed by hand sends nothing.
describe('the browser an install row names', () => {
  async function installRow(argv: string[], arrange: () => void = () => {}) {
    const box = sandbox({
      env: {EXTENSION_TELEMETRY: '1', EXTENSION_TELEMETRY_SAMPLE_RATE: '1'}
    })
    const {cli} = cliRun(box, {argv: ['node', 'extension', ...argv]})

    arrange()
    const exitCode = await runCli(
      makeProgram((program) =>
        registerInstallCommand(program, {telemetry: cli})
      ),
      argv
    )

    // The entry point marks a success once the action resolves.
    if (exitCode === 0) cli.markCommandSuccess()

    await cli.telemetry.flush()

    const rows = box
      .sentRows()
      .filter((row) => row.properties.command === argv[0])

    expect(rows).toHaveLength(1)

    return rows[0].properties
  }

  it.each([
    [['install', 'chrome'], 'chrome'],
    [['install', 'firefox'], 'firefox'],
    [['install', '--browser', 'edge'], 'edge'],
    [['install'], 'chromium'],
    [['install', 'all'], 'all'],
    [['install', 'chrome', 'all'], 'all']
  ])('sends install_target for %j', async (argv, target) => {
    expect((await installRow(argv)).install_target).toBe(target)
  })

  it.each([
    [['install', 'chrome', 'firefox']],
    [['install', 'chrome,firefox']],
    [['install', 'chromium-based']],
    [['install', 'netscape']],
    [['install', 'brave']]
  ])('sends no install_target for %j', async (argv) => {
    expect(await installRow(argv)).not.toHaveProperty('install_target')
  })

  it('names the browser on a failed download beside its code', async () => {
    const row = await installRow(['install', 'firefox'], () => {
      vi.mocked(extensionInstall).mockRejectedValueOnce(
        new BrowserInstallFailedError('404 from CDN')
      )
    })

    expect(row).toMatchObject({
      success: false,
      code: 'E_BROWSER_DOWNLOAD',
      install_target: 'firefox'
    })
  })

  it('never puts the name on an uninstall row', async () => {
    expect(await installRow(['uninstall', 'chrome'])).not.toHaveProperty(
      'install_target'
    )
  })
})

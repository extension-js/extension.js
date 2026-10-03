import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi
} from 'vitest'

const spawnMock = vi.hoisted(() => vi.fn())
vi.mock('cross-spawn', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args)
}))

import {
  extensionInstall,
  extensionUninstall,
  getManagedBrowsersCacheRoot,
  isBrowserInstallPrivilegeError
} from '../module'

const GLYPH = '⏵⏵⏵'
const ANSI = /\[[0-9;]*m/

function fakeChild(exit: {
  code: number | null
  signal?: NodeJS.Signals
  stderr?: string
}) {
  return {
    stdout: {on: () => undefined},
    stderr: {
      on: (event: string, cb: (chunk: Buffer) => void) => {
        if (event === 'data' && exit.stderr) {
          setImmediate(() => cb(Buffer.from(exit.stderr as string)))
        }
      }
    },
    on: (
      event: string,
      cb: (code: number | null, signal: NodeJS.Signals | null) => void
    ) => {
      if (event === 'close') {
        setImmediate(() => cb(exit.code, exit.signal ?? null))
      }
    }
  }
}

describe('install module exports', () => {
  it('resolves cache root from EXT_BROWSERS_CACHE_DIR override', () => {
    const prev = process.env.EXT_BROWSERS_CACHE_DIR
    process.env.EXT_BROWSERS_CACHE_DIR = '/tmp/extjs-custom-cache'

    try {
      expect(getManagedBrowsersCacheRoot()).toBe(
        path.resolve('/tmp/extjs-custom-cache')
      )
    } finally {
      if (typeof prev === 'undefined') {
        delete process.env.EXT_BROWSERS_CACHE_DIR
      } else {
        process.env.EXT_BROWSERS_CACHE_DIR = prev
      }
    }
  })
})

describe('extensionUninstall against a temp cache root', () => {
  const prevEnv = {...process.env}
  let cacheRoot = ''
  let logSpy: MockInstance<typeof console.log>
  let stdoutSpy: MockInstance<typeof process.stdout.write>

  beforeEach(() => {
    cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-uninstall-'))
    process.env.EXT_BROWSERS_CACHE_DIR = cacheRoot
    fs.mkdirSync(path.join(cacheRoot, 'chrome'), {recursive: true})
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    process.env = {...prevEnv}
    fs.rmSync(cacheRoot, {recursive: true, force: true})
  })

  it('reports each target as removed or absent with its path', async () => {
    const results = await extensionUninstall({browser: 'chrome,edge'})

    expect(results).toEqual([
      {browser: 'chrome', removed: true, path: path.join(cacheRoot, 'chrome')},
      {browser: 'edge', removed: false, path: path.join(cacheRoot, 'edge')}
    ])

    expect(fs.existsSync(path.join(cacheRoot, 'chrome'))).toBe(false)
  })

  it('reports every managed target under all', async () => {
    const results = await extensionUninstall({all: true})

    expect(results.map((result) => result.browser)).toEqual([
      'chrome',
      'chromium',
      'edge',
      'firefox'
    ])

    expect(results.filter((result) => result.removed)).toHaveLength(1)
  })

  it('writes nothing to stdout under machine output', async () => {
    process.env.EXTENSION_OUTPUT = 'json'

    await extensionUninstall({browser: 'chrome,edge'})

    expect(logSpy).not.toHaveBeenCalled()
    expect(stdoutSpy).not.toHaveBeenCalled()
  })

  it('keeps the human lines on stdout in pretty mode', async () => {
    delete process.env.EXTENSION_OUTPUT

    await extensionUninstall({browser: 'chrome'})

    const printed = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(printed).toContain(GLYPH)
    expect(printed).toMatch(/Chrome is removed/)
  })
})

describe('extensionInstall refusals and failures', () => {
  const prevEnv = {...process.env}
  const platformDescriptor = Object.getOwnPropertyDescriptor(
    process,
    'platform'
  ) as PropertyDescriptor
  const isTTYDescriptor = Object.getOwnPropertyDescriptor(
    process.stdin,
    'isTTY'
  )
  let cacheRoot = ''

  beforeEach(() => {
    spawnMock.mockReset()
    cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-install-'))
    process.env.EXT_BROWSERS_CACHE_DIR = cacheRoot
    process.env.EXTENSION_OUTPUT = 'json'
    delete process.env.npm_config_user_agent
    delete process.env.npm_execpath
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(process, 'platform', platformDescriptor)

    if (isTTYDescriptor) {
      Object.defineProperty(process.stdin, 'isTTY', isTTYDescriptor)
    } else {
      Reflect.deleteProperty(process.stdin, 'isTTY')
    }

    process.env = {...prevEnv}
    fs.rmSync(cacheRoot, {recursive: true, force: true})
  })

  it('refuses edge on linux without a tty with a named, coded error', async () => {
    Object.defineProperty(process, 'platform', {
      value: 'linux',
      configurable: true
    })

    Object.defineProperty(process.stdin, 'isTTY', {
      value: false,
      configurable: true,
      writable: true
    })

    const error = await extensionInstall({
      browser: 'edge',
      locateInstalledBinary: () => null
    }).catch((thrown: unknown) => thrown)

    expect(isBrowserInstallPrivilegeError(error)).toBe(true)
    expect((error as Error).name).toBe('BrowserInstallPrivilegeError')
    expect((error as {code: string}).code).toBe('BROWSER_INSTALL_PRIVILEGE')
    expect((error as Error).message).toMatch(/privileged interactive session/)
    expect((error as Error).message).not.toContain(GLYPH)
    expect((error as Error).message).not.toMatch(ANSI)
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('throws a plain sentence when the installer exits non-zero', async () => {
    spawnMock.mockImplementation(() =>
      fakeChild({code: 7, stderr: '[31mfake npx failure[0m\n'})
    )

    const error = await extensionInstall({
      browser: 'chrome',
      locateInstalledBinary: () => null
    }).catch((thrown: unknown) => thrown)

    const message = (error as Error).message
    expect(message).toMatch(/^Couldn't install Chrome\. /)
    expect(message).toMatch(/failed with exit code 7\./)
    expect(message).toContain('fake npx failure')
    expect(message).not.toContain(GLYPH)
    expect(message).not.toMatch(ANSI)
    expect(message).not.toContain('\n')
  })

  it('names the signal when the installer was killed', async () => {
    spawnMock.mockImplementation(() =>
      fakeChild({code: null, signal: 'SIGKILL'})
    )

    const error = await extensionInstall({
      browser: 'chrome',
      locateInstalledBinary: () => null
    }).catch((thrown: unknown) => thrown)

    expect((error as Error).message).toMatch(/was killed by SIGKILL\./)
    expect((error as Error).message).not.toContain('null')
  })
})

describe('extensionInstall checks the destination before claiming success', () => {
  const prevEnv = {...process.env}
  let cacheRoot = ''
  let logSpy: MockInstance<typeof console.log>

  beforeEach(() => {
    spawnMock.mockReset()
    cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-install-ok-'))
    process.env.EXT_BROWSERS_CACHE_DIR = cacheRoot
    delete process.env.EXTENSION_OUTPUT
    delete process.env.npm_config_user_agent
    delete process.env.npm_execpath
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    process.env = {...prevEnv}
    fs.rmSync(cacheRoot, {recursive: true, force: true})
  })

  function plantTruncatedTree(destination: string): string {
    const dir = path.join(destination, 'chrome', 'mac_arm-152.0.9999.1')
    fs.mkdirSync(dir, {recursive: true})
    const stub = path.join(dir, 'Google Chrome for Testing')
    fs.writeFileSync(stub, '')

    return stub
  }

  it('reports a truncated tree as a failure naming the path, and removes it', async () => {
    spawnMock.mockImplementation(() => fakeChild({code: 0}))
    const destination = path.join(cacheRoot, 'chrome')
    plantTruncatedTree(destination)
    const locate = vi.fn(() => null)

    const error = await extensionInstall({
      browser: 'chrome',
      locateInstalledBinary: locate
    }).catch((thrown: unknown) => thrown)

    expect(locate).toHaveBeenCalledWith(destination, 'chrome')
    const message = (error as Error).message
    expect(message).toMatch(/^Couldn't install Chrome\. /)
    expect(message).toContain(destination)
    expect(message).toMatch(/non-empty executable file/)
    expect(message).toMatch(/The incomplete files were removed\./)
    expect(message).not.toContain(GLYPH)
    expect(message).not.toMatch(ANSI)
    expect(fs.existsSync(destination)).toBe(false)

    const printed = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(printed).not.toMatch(/is installed/)
  })

  it('claims success only once the locator finds the binary', async () => {
    spawnMock.mockImplementation(() => fakeChild({code: 0}))
    const destination = path.join(cacheRoot, 'chrome')
    const binary = plantTruncatedTree(destination)

    await extensionInstall({
      browser: 'chrome',
      locateInstalledBinary: () => binary
    })

    expect(fs.existsSync(destination)).toBe(true)
    const printed = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(printed).toMatch(/Chrome is installed/)
  })

  it('leaves no browser directory behind when the installer fails mid-way', async () => {
    spawnMock.mockImplementation(() =>
      fakeChild({code: null, signal: 'SIGKILL'})
    )

    const destination = path.join(cacheRoot, 'chrome')
    plantTruncatedTree(destination)

    await extensionInstall({
      browser: 'chrome',
      locateInstalledBinary: () => null
    }).catch(() => undefined)

    expect(fs.existsSync(destination)).toBe(false)
  })

  it('keeps a destination the locator still finds a binary in when the installer fails', async () => {
    spawnMock.mockImplementation(() => fakeChild({code: 7}))
    const destination = path.join(cacheRoot, 'chrome')
    const older = plantTruncatedTree(destination)

    await extensionInstall({
      browser: 'chrome',
      locateInstalledBinary: () => older
    }).catch(() => undefined)

    expect(fs.existsSync(older)).toBe(true)
  })
})

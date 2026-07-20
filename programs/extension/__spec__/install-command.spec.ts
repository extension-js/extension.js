import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

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

beforeEach(() => {
  stubProcessExit()
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

function run(argv: string[]) {
  return runCli(makeProgram(registerInstallCommand), argv)
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
})

describe('extension uninstall', () => {
  it('uninstalls the targeted browser', async () => {
    expect(await run(['uninstall', 'firefox'])).toBe(0)
    expect(extensionUninstall).toHaveBeenCalledWith({
      browser: 'firefox',
      all: undefined
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

  it('prints the cache root with --where and no target', async () => {
    expect(await run(['uninstall', '--where'])).toBe(0)
    expect(getManagedBrowsersCacheRoot).toHaveBeenCalled()
  })
})

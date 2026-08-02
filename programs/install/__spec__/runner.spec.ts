import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const spawnSyncMock = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', async () => {
  const actual: Record<string, unknown> =
    await vi.importActual('node:child_process')
  return {...actual, spawnSync: spawnSyncMock}
})

import {
  browserInstallArgs,
  browserInstallCommand,
  browserInstallEnv,
  detectSystemEdgeBinary,
  isEdgePrivilegeEscalationFailure
} from '../lib/runner'

describe('install runner mapping', () => {
  const prevEnv = {...process.env}

  afterEach(() => {
    process.env = {...prevEnv}
  })

  function clearPackageManagerEnv() {
    delete process.env.npm_config_user_agent
    delete process.env.npm_execpath
    delete process.env.NPM_EXEC_PATH
  }

  it('maps chromium-family browsers to puppeteer installer args', () => {
    clearPackageManagerEnv()

    const chromiumArgs = browserInstallArgs('chromium', '/tmp/x')
    expect(chromiumArgs).toEqual([
      '-y',
      '@puppeteer/browsers@latest',
      'install',
      'chromium',
      '--path',
      '/tmp/x'
    ])

    const chromeArgs = browserInstallArgs('chrome', '/tmp/x')
    expect(chromeArgs).toEqual([
      '-y',
      '@puppeteer/browsers@latest',
      'install',
      'chrome@stable',
      '--path',
      '/tmp/x'
    ])
  })

  it('maps edge to playwright installer args + env', () => {
    clearPackageManagerEnv()

    expect(browserInstallArgs('edge', '/tmp/edge')).toEqual([
      '-y',
      'playwright@latest',
      'install',
      'msedge'
    ])
    expect(
      browserInstallEnv('edge', '/tmp/edge').PLAYWRIGHT_BROWSERS_PATH
    ).toBe('/tmp/edge')
  })

  it('returns package runner command variant by platform', () => {
    clearPackageManagerEnv()

    const cmd = browserInstallCommand('firefox')
    expect(cmd === 'npx' || cmd === 'npx.cmd').toBe(true)
  })

  it('prefers pnpm dlx when running under pnpm', () => {
    process.env.npm_config_user_agent = 'pnpm/10.28.0 npm/? node/v23.8.0'

    const cmd = browserInstallCommand('chrome')
    expect(cmd === 'pnpm' || cmd === 'pnpm.cmd').toBe(true)
    expect(browserInstallArgs('chrome', '/tmp/x')).toEqual([
      'dlx',
      '@puppeteer/browsers@latest',
      'install',
      'chrome@stable',
      '--path',
      '/tmp/x'
    ])
  })

  it('detects sudo-driven edge installation failures', () => {
    expect(
      isEdgePrivilegeEscalationFailure(
        'Switching to root user to install dependencies...'
      )
    ).toBe(true)
    expect(
      isEdgePrivilegeEscalationFailure(
        'sudo: a terminal is required to read the password'
      )
    ).toBe(true)
    expect(isEdgePrivilegeEscalationFailure('random error')).toBe(false)
  })
})

describe('detectSystemEdgeBinary lookup exit codes', () => {
  const platformDescriptor = Object.getOwnPropertyDescriptor(
    process,
    'platform'
  )!

  function setPlatform(platform: string) {
    Object.defineProperty(process, 'platform', {value: platform})
  }

  beforeEach(() => {
    spawnSyncMock.mockReset()
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', platformDescriptor)
  })

  it('returns the first which hit on linux when the lookup succeeds', () => {
    setPlatform('linux')
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: '/usr/bin/microsoft-edge-stable\n'
    })

    expect(detectSystemEdgeBinary()).toBe('/usr/bin/microsoft-edge-stable')
    expect(spawnSyncMock).toHaveBeenCalledWith(
      'which',
      ['microsoft-edge-stable'],
      expect.objectContaining({encoding: 'utf8'})
    )
  })

  it('takes only the first line of a multi-line which output', () => {
    setPlatform('linux')
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: '/usr/bin/microsoft-edge-stable\n/opt/edge/microsoft-edge\n'
    })

    expect(detectSystemEdgeBinary()).toBe('/usr/bin/microsoft-edge-stable')
  })

  it('returns null on linux when every candidate lookup fails', () => {
    setPlatform('linux')
    spawnSyncMock.mockReturnValue({status: 1, stdout: ''})

    expect(detectSystemEdgeBinary()).toBe(null)
    expect(spawnSyncMock).toHaveBeenCalledTimes(3)
  })

  it('returns the first where hit on win32 when the lookup succeeds', () => {
    setPlatform('win32')
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout:
        'C:\\Program Files\\Microsoft\\Edge\\msedge.exe\r\n' +
        'C:\\Users\\dev\\msedge.exe\r\n'
    })

    expect(detectSystemEdgeBinary()).toBe(
      'C:\\Program Files\\Microsoft\\Edge\\msedge.exe'
    )
  })

  it('returns null on win32 when where exits non-zero', () => {
    setPlatform('win32')
    spawnSyncMock.mockReturnValue({status: 1, stdout: ''})

    expect(detectSystemEdgeBinary()).toBe(null)
  })
})

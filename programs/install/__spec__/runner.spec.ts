import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const spawnSyncMock = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', async () => {
  const actual: Record<string, unknown> =
    await vi.importActual('node:child_process')

  return {...actual, spawnSync: spawnSyncMock}
})

const spawnMock = vi.hoisted(() => vi.fn())
vi.mock('cross-spawn', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args)
}))

import {
  PLAYWRIGHT_VERSION,
  PUPPETEER_BROWSERS_VERSION
} from '../lib/installer-versions'
import {
  browserInstallArgs,
  browserInstallCommand,
  browserInstallEnv,
  detectSystemEdgeBinary,
  isEdgePrivilegeEscalationFailure,
  runCommand
} from '../lib/runner'

describe('install runner runCommand', () => {
  beforeEach(() => {
    spawnMock.mockReset()
  })

  it('hands the destination to cross-spawn as one argument with no shell option', async () => {
    spawnMock.mockImplementation(() => ({
      stdout: {on: () => undefined},
      stderr: {on: () => undefined},
      on: (event: string, cb: (code: number) => void) => {
        if (event === 'close') setImmediate(() => cb(0))
      }
    }))

    // A shell would split or execute this path, so it must arrive verbatim.
    const destination = 'C:\\Users\\me & rm -rf x\\browsers'
    const args = browserInstallArgs('chrome', destination)

    const result = await runCommand('npx.cmd', args, {
      cwd: process.cwd(),
      env: {...process.env}
    })

    expect(result.code).toBe(0)
    expect(spawnMock).toHaveBeenCalledTimes(1)
    const [command, spawnArgs, options] = spawnMock.mock.calls[0]
    expect(command).toBe('npx.cmd')
    expect(spawnArgs).toEqual(args)
    expect(spawnArgs[spawnArgs.length - 1]).toBe(destination)
    expect(options).not.toHaveProperty('shell')
    expect(options.stdio).toBe('pipe')
  })
})

describe('install runner pinned installer versions', () => {
  it('pins each installer to an exact version, never a tag or a range', () => {
    const exact = /^\d+\.\d+\.\d+$/
    expect(PUPPETEER_BROWSERS_VERSION).toMatch(exact)
    expect(PLAYWRIGHT_VERSION).toMatch(exact)
  })

  it('never hands a package runner an unpinned installer', () => {
    for (const ua of ['', 'pnpm/10.28.0 npm/? node/v24', 'bun/1.3.0']) {
      process.env.npm_config_user_agent = ua

      for (const target of ['chromium', 'chrome', 'firefox', 'edge'] as const) {
        const spec = browserInstallArgs(target, '/tmp/x').find((arg) =>
          /^(@puppeteer\/browsers|playwright)@/.test(arg)
        )
        expect(spec).toMatch(/@\d+\.\d+\.\d+$/)
      }
    }

    delete process.env.npm_config_user_agent
  })
})

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
      `@puppeteer/browsers@${PUPPETEER_BROWSERS_VERSION}`,
      'install',
      'chromium',
      '--path',
      '/tmp/x'
    ])

    const chromeArgs = browserInstallArgs('chrome', '/tmp/x')
    expect(chromeArgs).toEqual([
      '-y',
      `@puppeteer/browsers@${PUPPETEER_BROWSERS_VERSION}`,
      'install',
      'chrome@stable',
      '--path',
      '/tmp/x'
    ])
  })

  it('pins firefox to the stable channel instead of the nightly default', () => {
    clearPackageManagerEnv()

    expect(browserInstallArgs('firefox', '/tmp/x')).toEqual([
      '-y',
      `@puppeteer/browsers@${PUPPETEER_BROWSERS_VERSION}`,
      'install',
      'firefox@stable',
      '--path',
      '/tmp/x'
    ])
  })

  it('maps edge to playwright installer args + env', () => {
    clearPackageManagerEnv()

    expect(browserInstallArgs('edge', '/tmp/edge')).toEqual([
      '-y',
      `playwright@${PLAYWRIGHT_VERSION}`,
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
      `@puppeteer/browsers@${PUPPETEER_BROWSERS_VERSION}`,
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

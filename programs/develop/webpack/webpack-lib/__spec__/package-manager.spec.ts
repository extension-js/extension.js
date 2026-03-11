import {describe, expect, it, vi, beforeEach} from 'vitest'

const fakeChild = {
  on: (ev: string, fn: (...a: any[]) => void) => {
    if (ev === 'close') setImmediate(() => fn(0))
    return fakeChild
  }
}
const spawnMock = vi.fn(() => fakeChild)

vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
  spawn: (...args: any[]) => spawnMock(...args),
  spawnSync: vi.fn(() => ({status: 0}))
}))

import {
  buildInstallCommand,
  execInstallCommand,
  resolvePackageManager
} from '../package-manager'

describe('package-manager buildInstallCommand', () => {
  it('executes native package manager binaries directly', () => {
    const execPath =
      process.platform === 'win32'
        ? 'C:\\tools\\pnpm\\pnpm.exe'
        : '/usr/local/bin/pnpm'
    const args = ['install', '--silent']

    const invocation = buildInstallCommand({name: 'pnpm', execPath}, args)

    expect(invocation).toEqual({
      command: execPath,
      args
    })
  })

  it('runs JS CLI entrypoints with node', () => {
    const execPath =
      process.platform === 'win32'
        ? 'C:\\node\\npm\\bin\\npm-cli.js'
        : '/tmp/npm-cli.js'
    const args = ['install', '--silent']

    const invocation = buildInstallCommand({name: 'npm', execPath}, args)

    expect(invocation).toEqual({
      command: process.execPath,
      args: [execPath, ...args]
    })
  })

  it('preserves npm_execpath when env user agent identifies pnpm', () => {
    const originalUserAgent = process.env.npm_config_user_agent
    const originalExecPath = process.env.npm_execpath

    process.env.npm_config_user_agent = 'pnpm/10.24.0 npm/? node/v23.8.0 darwin'
    process.env.npm_execpath = '/tmp/pnpm.cjs'

    try {
      const resolution = resolvePackageManager()
      expect(resolution).toEqual({
        name: 'pnpm',
        execPath: '/tmp/pnpm.cjs'
      })
    } finally {
      if (originalUserAgent === undefined) {
        delete process.env.npm_config_user_agent
      } else {
        process.env.npm_config_user_agent = originalUserAgent
      }

      if (originalExecPath === undefined) {
        delete process.env.npm_execpath
      } else {
        process.env.npm_execpath = originalExecPath
      }
    }
  })

  it('reuses npm_execpath when override only specifies manager name', () => {
    const originalOverride = process.env.EXTENSION_JS_PACKAGE_MANAGER
    const originalOverrideExecPath = process.env.EXTENSION_JS_PM_EXEC_PATH
    const originalExecPath = process.env.npm_execpath

    process.env.EXTENSION_JS_PACKAGE_MANAGER = 'pnpm'
    delete process.env.EXTENSION_JS_PM_EXEC_PATH
    process.env.npm_execpath = '/tmp/pnpm.cjs'

    try {
      const resolution = resolvePackageManager()
      expect(resolution).toEqual({
        name: 'pnpm',
        execPath: '/tmp/pnpm.cjs'
      })
    } finally {
      if (originalOverride === undefined) {
        delete process.env.EXTENSION_JS_PACKAGE_MANAGER
      } else {
        process.env.EXTENSION_JS_PACKAGE_MANAGER = originalOverride
      }

      if (originalOverrideExecPath === undefined) {
        delete process.env.EXTENSION_JS_PM_EXEC_PATH
      } else {
        process.env.EXTENSION_JS_PM_EXEC_PATH = originalOverrideExecPath
      }

      if (originalExecPath === undefined) {
        delete process.env.npm_execpath
      } else {
        process.env.npm_execpath = originalExecPath
      }
    }
  })
})

describe('package-manager execInstallCommand', () => {
  beforeEach(() => spawnMock.mockClear())

  it('uses shell: true on Windows when command is .cmd or .bat', async () => {
    if (process.platform !== 'win32') return
    await execInstallCommand('C:\\path\\to\\pnpm.cmd', ['install'], {
      cwd: process.cwd()
    })
    expect(spawnMock).toHaveBeenCalledWith(
      'C:\\path\\to\\pnpm.cmd',
      ['install'],
      expect.objectContaining({shell: true})
    )
  })
})
